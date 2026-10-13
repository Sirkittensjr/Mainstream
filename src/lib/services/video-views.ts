import 'server-only';
import { db, isDuplicateRow, isMissingColumn, isMissingRelation } from '@/lib/db';
import { underReview } from '@/lib/auto-review-rules';
import { newId } from '@/lib/ids';
import type { ID, Media, Post } from '@/lib/types';
import {
  VIEW_COOLDOWN_MS,
  VIEW_HOURLY_LIMIT,
  decideView,
  dedupeKey,
} from '@/lib/video/views';
import { serially } from './serial';

/**
 * Counting video views, server-side.
 *
 * The authoritative number lives in `posts.video_views` and is written here and
 * nowhere else. A browser's part in this is one sentence — "this playback
 * session watched post X, and here is its session key" — and even that is
 * checked rather than believed: the post has to exist, carry a video, and not
 * belong to the person watching it; the session key has to be one that has not
 * been counted; and the same person cannot count twice on the same video
 * inside the cooldown however many session keys they invent.
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
 * Counts a watch, if it is one.
 *
 * Returns the stored total either way, so a player that was not counted still
 * shows the right number rather than a stale one.
 */
export async function recordVideoView(request: ViewRequest): Promise<ViewResult> {
  const { postId, viewerId, browserId, sessionKey } = request;
  const now = request.now ?? Date.now();
  const store = db();

  const post = await store.get('posts', postId);
  if (!post || post.removed) return { count: 0, counted: false };

  const count = videoViewsOf(post);
  // A photo or a text post has nothing to play, so it has no video views. The
  // `views` counter it has always had is a different number and is untouched.
  if (!hasVideo(post.media)) return { count: 0, counted: false };
  // Watching your own video back while editing the caption is not an audience.
  if (viewerId && post.author_id === viewerId) return { count, counted: false };
  // Hidden while it is reviewed: only its author and moderators can see it,
  // and a moderator looking at it is not an audience either.
  if (underReview(post)) return { count, counted: false };
  if (storable === false) return { count, counted: false };

  // Who watched. The account when there is one; otherwise the browser, which is
  // the most that can honestly be said about a visitor.
  const identity = viewerId ?? (browserId ? `anon:${browserId}` : null);
  if (!identity) return { count, counted: false };
  const key = dedupeKey(postId, identity, sessionKey);

  // One person's reports of one video are decided one at a time, so two copies
  // of the same report — a retry, a handler that fired twice — cannot both read
  // "not counted yet" and both count. Across server processes the unique index
  // on `dedupe_key` does the same job; see the DuplicateRowError below.
  return serially(`video-view:${postId}:${identity}`, async () => {
    try {
      const [already, mine] = await Promise.all([
        // Exact, and indexed: has THIS playback session been counted, ever.
        store.query('video_views', { where: { dedupe_key: key }, limit: 1 }),
        // This person's latest views of this video, for the cooldown and the
        // hourly ceiling.
        store.query('video_views', {
          where: { post_id: postId, identity },
          orderBy: 'created_at',
          desc: true,
          limit: VIEW_HOURLY_LIMIT,
        }),
      ]);
      storable ??= true;

      // Every rule about what a view is lives in decideView, which is pure and
      // tested: this playback session counts once, and no identity counts twice
      // inside the cooldown or past the hourly ceiling, whatever session key
      // arrived — the half of the defence that does not trust the client.
      const verdict = decideView({
        post: { authorId: post.author_id, removed: post.removed, hasVideo: true },
        viewerId,
        identity,
        dedupeKey: key,
        sessionCounted: already.length > 0,
        recent: mine,
        now,
        cooldownMs: VIEW_COOLDOWN_MS,
      });
      if (verdict !== 'count') return { count, counted: false };

      await store.insert('video_views', {
        id: newId(),
        post_id: postId,
        viewer_id: viewerId,
        identity,
        dedupe_key: key,
        created_at: new Date(now).toISOString(),
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        switchOff(error);
        return { count, counted: false };
      }
      // Another server process stored this same playback session a moment
      // ago. It has been counted — once, by that request.
      if (isDuplicateRow(error)) return { count, counted: false };
      throw error;
    }

    // The database adds the one, so two people watching at the same moment
    // are two views. The row above is the record; this is the total.
    try {
      const next = await store.increment('posts', postId, 'video_views', 1);
      return { count: next ?? count + 1, counted: true };
    } catch (error) {
      if (isMissingColumn(error, 'posts', 'video_views')) {
        switchOff(error);
        return { count, counted: false };
      }
      throw error;
    }
  });
}
