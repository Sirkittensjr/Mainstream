import 'server-only';
import { db, isDuplicateRow, isMissingColumn, isMissingRelation } from '@/lib/db';
import { newId } from '@/lib/ids';
import type { ID, Media, Post } from '@/lib/types';
import { MAX_VIEWS_PER_HOUR, decideView, dedupeKey, type ViewVerdict } from '@/lib/video/views';

/**
 * Counting video views, server-side.
 *
 * The authoritative number lives in `posts.video_views` and is written here and
 * nowhere else. A browser's part in this is one sentence — "a playback
 * session of post X started, and here is its session key" — and even that is
 * checked rather than believed: the post has to exist and carry a video; the
 * session must not have been counted already; and one person cannot add views
 * faster than the gap or past the hourly cap, however many session keys they
 * invent. See lib/video/views.ts for what a view is.
 *
 * No count ever comes from the client, and the client is never told anything
 * except the total the database now holds.
 */

/** Whether this post has a video on it at all. Photos do not get video views. */
export const hasVideo = (media: Media[] | undefined): boolean =>
  Array.isArray(media) && media.some((item) => item?.kind === 'video');

/** The count as stored. Absent means the column is not there yet, which is zero. */
export const videoViewsOf = (post: Pick<Post, 'video_views'>): number =>
  typeof post.video_views === 'number' && post.video_views > 0 ? post.video_views : 0;

export interface ViewRequest {
  postId: ID;
  /** The signed-in account, or null. */
  viewerId: ID | null;
  /** An opaque per-browser id, for a visitor who is not signed in. */
  browserId: string | null;
  /** The browser's key for this one playback session. */
  sessionKey: string | null;
  now?: number;
}

export interface ViewResult {
  /** The total as the database now holds it. Never a number a client sent. */
  count: number;
  /** Whether this request added one. */
  counted: boolean;
  /** Why it did or did not, for tests and logs. */
  verdict?: ViewVerdict | 'switched-off';
}

/**
 * Whether this database can store video views.
 *
 * Null until something has tried. A deployment that has not run migration 0010
 * has no `video_views` table and no `video_views` column, and a feature whose
 * storage was never installed should switch itself off quietly rather than
 * throw on every video anybody plays. See src/lib/db/errors.ts.
 */
let storable: boolean | null = null;

function switchOff(reason: unknown): void {
  if (storable === false) return;
  storable = false;
  console.error(
    '[faytarra] Video view counts are switched off: this database has no `video_views` ' +
      'storage. Run supabase/migrations/0010_video_views.sql against it. Videos play as ' +
      'normal; nothing is counted until then.',
    reason,
  );
}

/**
 * One person's decisions about one video, one at a time.
 *
 * "Has this session been counted, and how recently did they view it?" and
 * "store it" have to happen as one step, or two reports of the same session
 * arriving together both see "not yet". The unique index on `dedupe_key`
 * settles that in Postgres whatever happens here; this settles it for the
 * local driver, and saves Postgres the refused insert.
 */
const queues = new Map<string, Promise<unknown>>();
function serially<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  const settled = next.catch(() => undefined);
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}

/**
 * Adds one to the stored total, without losing a view to a race.
 *
 * Compare-and-set: the write only lands if the total is still what was read,
 * so of two views counted at the same moment one wins, the other reads the
 * new total and tries again. Nothing is ever written that a read did not see,
 * so a total can never go backwards or skip.
 */
async function addOne(postId: ID): Promise<number | null> {
  const store = db();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const post = await store.get('posts', postId);
    if (!post) return null;
    const current = typeof post.video_views === 'number' ? post.video_views : null;
    const changed = await store.updateWhere(
      'posts',
      { id: postId, video_views: current } as Partial<Post>,
      { video_views: (current ?? 0) + 1 },
    );
    if (changed > 0) return (current ?? 0) + 1;
    // Somebody else's view landed first. Read again; a short, uneven pause
    // keeps a crowd of these from retrying in lockstep.
    await new Promise((resolve) => setTimeout(resolve, 2 + Math.floor(Math.random() * 8)));
  }
  console.error(`[faytarra] a view of ${postId} was recorded but the total could not be raised`);
  return null;
}

/**
 * Counts a playback, if it is a view.
 *
 * Returns the stored total either way, so a player that was not counted still
 * shows the right number rather than a stale one.
 */
export async function recordVideoView(request: ViewRequest): Promise<ViewResult> {
  const { postId, viewerId, browserId, sessionKey } = request;
  const store = db();

  const post = await store.get('posts', postId);
  if (!post || post.removed) return { count: 0, counted: false, verdict: 'no-post' };
  // A photo or a text post has nothing to play, so it has no video views. The
  // `views` counter it has always had is a different number and is untouched.
  if (!hasVideo(post.media)) return { count: 0, counted: false, verdict: 'not-a-video' };
  const count = videoViewsOf(post);
  if (storable === false) return { count, counted: false, verdict: 'switched-off' };

  // Who watched. The account when there is one; otherwise the browser, which is
  // the most that can honestly be said about a visitor.
  const identity = viewerId ?? (browserId ? `anon:${browserId}` : null);
  if (!identity) return { count, counted: false, verdict: 'unknown-viewer' };
  const key = dedupeKey(postId, identity, sessionKey);

  return serially(`${postId}:${identity}`, async () => {
    const now = request.now ?? Date.now();
    try {
      const [already, recent] = await Promise.all([
        store.query('video_views', { where: { dedupe_key: key }, limit: 1 }),
        store.query('video_views', {
          where: { post_id: postId, identity },
          orderBy: 'created_at',
          desc: true,
          limit: MAX_VIEWS_PER_HOUR + 1,
        }),
      ]);
      storable ??= true;

      const verdict = decideView({
        post: { removed: post.removed, hasVideo: true },
        identity,
        sessionCounted: already.length > 0,
        recent,
        now,
      });
      if (verdict !== 'count') {
        const latest = await store.get('posts', postId);
        return { count: latest ? videoViewsOf(latest) : count, counted: false, verdict };
      }

      await store.insert('video_views', {
        id: newId(),
        post_id: postId,
        viewer_id: viewerId,
        identity,
        dedupe_key: key,
        created_at: new Date(now).toISOString(),
      });
    } catch (error) {
      // Another server instance stored this exact session first. The index is
      // the rule; this request is the duplicate.
      if (isDuplicateRow(error)) {
        const latest = await store.get('posts', postId);
        return { count: latest ? videoViewsOf(latest) : count, counted: false, verdict: 'duplicate-session' as const };
      }
      if (isMissingRelation(error)) {
        switchOff(error);
        return { count, counted: false, verdict: 'switched-off' as const };
      }
      throw error;
    }

    try {
      const next = await addOne(postId);
      return { count: next ?? count, counted: next !== null, verdict: 'count' as const };
    } catch (error) {
      if (isMissingColumn(error, 'posts', 'video_views')) {
        switchOff(error);
        return { count, counted: false, verdict: 'switched-off' as const };
      }
      throw error;
    }
  });
}
