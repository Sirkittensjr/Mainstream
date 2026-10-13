import 'server-only';
import { db, isMissingRelation } from '@/lib/db';
import { underReview } from '@/lib/auto-review-rules';
import { newId } from '@/lib/ids';
import type { ID, Media, Post } from '@/lib/types';
import {
  VIEW_COOLDOWN_MS,
  VIEW_HOURLY_LIMIT,
  decideView,
  dedupeKey,
  type ViewVerdict,
} from '@/lib/video/views';
import { serially } from './serial';

/**
 * Counting video views, server-side.
 *
 * The authoritative number lives in `posts.video_views` and is written here and
 * nowhere else. A browser's part in this is one sentence — "this playback
 * session watched post X, and here is its session key" — and even that is
 * checked rather than believed: the post has to exist and carry a video; the
 * session key has to be one that has not been counted; and the same person
 * cannot run the count up with a burst of invented session keys or past the
 * hourly ceiling.
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

/** Why a report was not counted: one of the rules, or the counter being unavailable. */
export type ViewRefusal = Exclude<ViewVerdict, 'count'> | 'unavailable';

export interface ViewResult {
  /** The total as the database now holds it. Never a number a client sent. */
  count: number;
  /** Whether this request added one. */
  counted: boolean;
  /** Why it did not, when it did not. Safe to show anybody: it names a rule. */
  reason?: ViewRefusal;
}

/**
 * How long view counting stays off after the database says it has no
 * `video_views` storage, before it is looked for again.
 *
 * It used to stay off until the server restarted. A migration is run against
 * a database that warm servers are already using, so applying 0010 changed
 * nothing for them: they went on answering "not counted" — with no error
 * anywhere a person would see — until the platform happened to recycle them.
 * Half a minute is long enough not to hammer a database that really has no
 * such table, and short enough that applying the migration is the fix.
 */
export const STORAGE_RECHECK_MS = 30_000;

/** Until when (ms since epoch) counting is off; 0 while it is on. */
let offUntil = 0;

function switchOff(reason: unknown, now: number): void {
  offUntil = now + STORAGE_RECHECK_MS;
  console.error(
    '[faytarra:views] Video views are NOT being counted: this database has no `video_views` ' +
      'storage. Run supabase/migrations/0010_video_views.sql against it. Looking again in ' +
      `${STORAGE_RECHECK_MS / 1000}s; videos play as normal meanwhile.`,
    errorSummary(reason),
  );
}

/**
 * An error as one line for the log: its name and message, never the request.
 *
 * Supabase's messages name tables, columns and functions; the values in a row
 * — which would include who watched — are in a separate `details` field that
 * never reaches the errors the driver throws.
 */
function errorSummary(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300);
  return String(error).slice(0, 300);
}

/**
 * One line per report, when FAYTARRA_DEBUG_VIEWS=1 is set on the server.
 *
 * Which post (its id is in every link to it), whether the viewer was signed in
 * or a browser, what was decided, the total, and how long it took. Never who:
 * no account id, browser id, session key or address.
 */
function trace(postId: ID, identity: string | null, result: ViewResult, started: number): ViewResult {
  if (process.env.FAYTARRA_DEBUG_VIEWS === '1') {
    const who = identity === null ? 'nobody' : identity.startsWith('anon:') ? 'browser' : 'account';
    const outcome = result.counted ? 'counted' : `not-counted:${result.reason ?? 'unknown'}`;
    console.info(
      `[faytarra:views] post=${postId} viewer=${who} ${outcome} total=${result.count} ` +
        `${Math.round(performance.now() - started)}ms`,
    );
  }
  return result;
}

/**
 * Counts a watch, if it is one.
 *
 * Returns the stored total either way, so a player that was not counted still
 * shows the right number rather than a stale one. Throws when the view could
 * not be stored — and then nothing was stored, so the same report can be sent
 * again and will count.
 */
export async function recordVideoView(request: ViewRequest): Promise<ViewResult> {
  const { postId, viewerId, browserId, sessionKey } = request;
  const now = request.now ?? Date.now();
  const started = performance.now();
  const store = db();
  // Who watched. The account when there is one; otherwise the browser, which is
  // the most that can honestly be said about a visitor.
  const identity = viewerId ?? (browserId ? `anon:${browserId}` : null);
  const done = (result: ViewResult) => trace(postId, identity, result, started);

  const post = await store.get('posts', postId);
  if (!post || post.removed) return done({ count: 0, counted: false, reason: 'no-post' });

  const count = videoViewsOf(post);
  // A photo or a text post has nothing to play, so it has no video views. The
  // `views` counter it has always had is a different number and is untouched.
  if (!hasVideo(post.media)) return done({ count: 0, counted: false, reason: 'not-a-video' });
  // Hidden while it is reviewed: only its author and moderators can see it,
  // and a moderator looking at it is not an audience either.
  if (underReview(post)) return done({ count, counted: false, reason: 'no-post' });
  if (now < offUntil) return done({ count, counted: false, reason: 'unavailable' });
  if (!identity) return done({ count, counted: false, reason: 'unknown-viewer' });
  const key = dedupeKey(postId, identity, sessionKey);

  // One person's reports of one video are decided one at a time, so two copies
  // of the same report — a retry, a handler that fired twice — cannot both read
  // "not counted yet" and both count. Across server processes the unique index
  // on `dedupe_key` does the same job, inside recordView.
  return serially(`video-view:${postId}:${identity}`, async () => {
    try {
      const [already, mine] = await Promise.all([
        // Exact, and indexed: has THIS playback session been counted, ever.
        store.query('video_views', { where: { dedupe_key: key }, limit: 1 }),
        // This person's latest views of this video, for the gap between two
        // views and the hourly ceiling.
        store.query('video_views', {
          where: { post_id: postId, identity },
          orderBy: 'created_at',
          desc: true,
          limit: VIEW_HOURLY_LIMIT,
        }),
      ]);
      offUntil = 0;

      // Every rule about what a view is lives in decideView, which is pure and
      // tested: this playback session counts once, and no identity can run the
      // count up with invented session keys or past the hourly ceiling,
      // whatever session key arrived — the half of the defence that does not
      // trust the client. The author's own plays count like anybody's.
      const verdict = decideView({
        post: { removed: post.removed, hasVideo: true },
        identity,
        dedupeKey: key,
        sessionCounted: already.length > 0,
        recent: mine,
        now,
        cooldownMs: VIEW_COOLDOWN_MS,
      });
      if (verdict !== 'count') return done({ count, counted: false, reason: verdict });

      // The row and the total together, or neither: see Driver.recordView.
      const stored = await store.recordView({
        id: newId(),
        post_id: postId,
        viewer_id: viewerId,
        identity,
        dedupe_key: key,
        created_at: new Date(now).toISOString(),
      });
      if (stored.total === null) return done({ count: 0, counted: false, reason: 'no-post' });
      // Not counted means another copy of this same report got there first —
      // on another server, since this one decides them one at a time.
      return done(
        stored.counted
          ? { count: stored.total, counted: true }
          : { count: stored.total, counted: false, reason: 'duplicate-session' },
      );
    } catch (error) {
      if (isMissingRelation(error)) {
        switchOff(error, now);
        return done({ count, counted: false, reason: 'unavailable' });
      }
      console.error(
        `[faytarra:views] A view of post ${postId} could not be stored. Nothing was written, ` +
          'so the player sending it again will count it.',
        errorSummary(error),
      );
      throw error;
    }
  });
}
