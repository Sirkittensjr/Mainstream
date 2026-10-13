import 'server-only';
import { db, isMissingRelation } from '@/lib/db';
import type { PlayOutcome } from '@/lib/db';
import { underReview } from '@/lib/auto-review-rules';
import { newId } from '@/lib/ids';
import type { ID, Media, Post, VideoView } from '@/lib/types';
import {
  PLAY_BURST_LIMIT,
  decideView,
  dedupeKey,
  isPostId,
  type ViewVerdict,
} from '@/lib/video/views';
import { serially } from './serial';

/**
 * Counting video views, server-side.
 *
 * A view is a playback start (lib/video/views.ts), and every one counts. The
 * authoritative number lives in `posts.video_views` and is written here and
 * nowhere else. A browser's part in this is one sentence — "a playback session
 * of post X started, and here is its key" — and even that is checked rather
 * than believed: the post has to exist, be visible and carry a video; the key
 * has to be one that has not been counted, which is what makes a retried or
 * duplicated report count once; and one viewer cannot start the same video
 * faster than a person can.
 *
 * On Supabase with migration 0017 all of that is ONE call to the database
 * (record_video_play), which decides and stores in a single transaction.
 * Anywhere else the same rules are applied here and the play is stored with
 * Driver.recordView.
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

/**
 * Why a report was not counted: one of the rules; `invalid` for a report that
 * is not one (no usable post id or session key); or `unavailable` when this
 * database has nowhere to count views.
 */
export type ViewRefusal = Exclude<ViewVerdict, 'count'> | 'invalid' | 'unavailable';

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
 * a database that warm servers are already using, so applying one changed
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
      'storage, so every play is answered "unavailable" and every eye stays where it is. Run ' +
      'supabase/migrations/0017_count_every_play.sql against it (it installs the storage too). ' +
      `Looking again in ${STORAGE_RECHECK_MS / 1000}s; videos play as normal meanwhile.`,
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

/** The answer for a play the database decided. */
function fromOutcome(outcome: PlayOutcome): ViewResult {
  if (outcome.total === null) return { count: 0, counted: false, reason: 'no-post' };
  if (outcome.counted) return { count: outcome.total, counted: true };
  return { count: outcome.total, counted: false, reason: outcome.reason ?? 'duplicate-session' };
}

/**
 * Counts a play, if it is one.
 *
 * Returns the stored total either way, so a player that was not counted still
 * shows the right number rather than a stale one. Throws when the play could
 * not be stored — and then nothing was stored, so the same report can be sent
 * again and will count.
 */
export async function recordVideoView(request: ViewRequest): Promise<ViewResult> {
  const { postId, viewerId, browserId, sessionKey } = request;
  const now = request.now ?? Date.now();
  const started = performance.now();
  // Who watched. The account when there is one; otherwise the browser, which is
  // the most that can honestly be said about a visitor.
  const identity = viewerId ?? (browserId ? `anon:${browserId}` : null);
  const done = (result: ViewResult) => trace(postId, identity, result, started);

  // Not a report at all: nothing to look up, and nothing a retry would change.
  if (!isPostId(postId) || !sessionKey) return done({ count: 0, counted: false, reason: 'invalid' });
  if (!identity) return done({ count: 0, counted: false, reason: 'unknown-viewer' });
  if (now < offUntil) return done({ count: 0, counted: false, reason: 'unavailable' });

  const store = db();
  const play: VideoView = {
    id: newId(),
    post_id: postId,
    viewer_id: viewerId,
    identity,
    dedupe_key: dedupeKey(postId, identity, sessionKey),
    created_at: new Date(now).toISOString(),
  };

  try {
    // Decided and stored by the database, in one round trip, when it can.
    const outcome = await store.recordPlay(play);
    if (outcome) {
      offUntil = 0;
      return done(fromOutcome(outcome));
    }
  } catch (error) {
    return failed(error, postId, now, done);
  }

  // Otherwise the same rules, here. One viewer's reports of one video are
  // decided one at a time, so two copies of the same report — a retry, a
  // handler that fired twice — cannot both read "not counted yet" and both
  // count. Across server processes the unique index on `dedupe_key` does the
  // same job, inside recordView.
  return serially(`video-view:${postId}:${identity}`, async () => {
    try {
      const post = await store.get('posts', postId);
      if (!post || post.removed) return done({ count: 0, counted: false, reason: 'no-post' });
      const count = videoViewsOf(post);
      // A photo or a text post has nothing to play, so it has no video views.
      // The `views` counter it has always had is a different number and is
      // untouched.
      if (!hasVideo(post.media)) return done({ count: 0, counted: false, reason: 'not-a-video' });

      const [already, mine] = await Promise.all([
        // Exact, and indexed: has THIS playback session been counted, ever.
        store.query('video_views', { where: { dedupe_key: play.dedupe_key }, limit: 1 }),
        // This viewer's latest plays of this video, for the burst ceiling.
        store.query('video_views', {
          where: { post_id: postId, identity },
          orderBy: 'created_at',
          desc: true,
          limit: PLAY_BURST_LIMIT,
        }),
      ]);
      offUntil = 0;

      // Every rule about what a view is lives in decideView, which is pure and
      // tested — and is what record_video_play does in SQL. Hidden while it is
      // reviewed: only its author and moderators can see it, and a moderator
      // looking at it is not an audience.
      const verdict = decideView({
        post: { removed: post.removed, hasVideo: true, hidden: underReview(post) },
        identity,
        dedupeKey: play.dedupe_key,
        sessionCounted: already.length > 0,
        recent: mine,
        now,
      });
      if (verdict !== 'count') return done({ count, counted: false, reason: verdict });

      // The row and the total together, or neither: see Driver.recordView.
      const stored = await store.recordView(play);
      if (stored.total === null) return done({ count: 0, counted: false, reason: 'no-post' });
      // Not counted means another copy of this same report got there first —
      // on another server, since this one decides them one at a time.
      return done(
        stored.counted
          ? { count: stored.total, counted: true }
          : { count: stored.total, counted: false, reason: 'duplicate-session' },
      );
    } catch (error) {
      return failed(error, postId, now, done);
    }
  });
}

/**
 * A play that could not be stored. Missing storage switches counting off for a
 * while, loudly, and says so in the answer; anything else is logged and thrown,
 * because nothing was written and the player's retry will count it.
 */
function failed(
  error: unknown,
  postId: ID,
  now: number,
  done: (result: ViewResult) => ViewResult,
): ViewResult {
  if (isMissingRelation(error)) {
    switchOff(error, now);
    return done({ count: 0, counted: false, reason: 'unavailable' });
  }
  console.error(
    `[faytarra:views] A play of post ${postId} could not be stored. Nothing was written, ` +
      'so the player sending it again will count it.',
    errorSummary(error),
  );
  throw error;
}
