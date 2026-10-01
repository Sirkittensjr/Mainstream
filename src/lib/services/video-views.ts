import 'server-only';
import { db, isMissingColumn, isMissingRelation } from '@/lib/db';
import { newId } from '@/lib/ids';
import type { ID, Media, Post } from '@/lib/types';
import { VIEW_COOLDOWN_MS, decideView, dedupeKey } from '@/lib/video/views';

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
  if (storable === false) return { count, counted: false };

  // Who watched. The account when there is one; otherwise the browser, which is
  // the most that can honestly be said about a visitor.
  const identity = viewerId ?? (browserId ? `anon:${browserId}` : null);
  if (!identity) return { count, counted: false };
  const key = dedupeKey(postId, identity, sessionKey);

  try {
    const mine = await store.query('video_views', {
      where: { post_id: postId, identity },
      orderBy: 'created_at',
      desc: true,
      limit: 25,
    });
    storable ??= true;

    // Every rule about what a view is lives in decideView, which is pure and
    // tested. The two that matter here: this playback session may only be
    // counted once — the player remounted, the feed scrolled back, the tab was
    // refocused — and no identity may count twice inside the cooldown, whatever
    // session key arrived, which is the half of the defence that does not trust
    // the client.
    const verdict = decideView({
      post: { authorId: post.author_id, removed: post.removed, hasVideo: true },
      viewerId,
      identity,
      dedupeKey: key,
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
    throw error;
  }

  // Read-then-write rather than an atomic increment, because that is the whole
  // of the Driver contract. Two watches landing in the same millisecond can
  // therefore cost one of them, which is the right way to be wrong for a
  // counter nobody is paid by: an undercount, never an invented view.
  const next = count + 1;
  try {
    await store.update('posts', postId, { video_views: next });
  } catch (error) {
    if (isMissingColumn(error, 'posts', 'video_views')) {
      switchOff(error);
      return { count, counted: false };
    }
    throw error;
  }
  return { count: next, counted: true };
}
