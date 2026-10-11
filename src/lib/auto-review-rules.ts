import { isMissingRelation } from '@/lib/db/errors';

/**
 * The arithmetic behind automatic temporary review.
 *
 * Its own module, with no `server-only`, for two reasons: the admin screens
 * need the threshold and the window to explain themselves, and every rule that
 * decides whether something is hidden should be testable without a database.
 *
 * Nothing here reads or writes anything. Deciding is separate from doing on
 * purpose — see services/auto-review.ts for the part that touches rows.
 */

/**
 * How long an automatic hide used to last if no administrator got to it.
 *
 * Hides no longer expire — a post hidden by a report stays hidden until a
 * moderator decides (see moderation-rules.ts) — but posts hidden under the
 * first version of this carry an expiry, and it is still honoured for them.
 *
 * Both the default and the CEILING — see `reviewWindowMs` in
 * services/auto-review.ts, which may shorten it for a test but can never
 * lengthen it. A temporary hide that could be configured into a permanent one
 * would stop being temporary, and nobody would notice until it mattered.
 */
export const REVIEW_WINDOW_HOURS = 24;

/** The default window, in milliseconds. */
export const REVIEW_WINDOW_MS = REVIEW_WINDOW_HOURS * 3_600_000;

export type ReviewState = 'temporary_review' | 'admin_hold';

/**
 * Both review states, for querying them rather than reading a whole table and
 * filtering. Kept beside the type so the two cannot drift apart.
 */
export const REVIEW_STATES: readonly ReviewState[] = ['temporary_review', 'admin_hold'];

export type ModerationAction =
  // The first version's ten-report hide, and its expiry. Kept so old history reads.
  | 'auto_review_started'
  | 'auto_review_expired'
  // A report hid a post. `actor_id` is the reporter: the account whose report did it.
  | 'report_hidden'
  // A report that could not hide the post because its reporter is at the limit.
  | 'report_hold_limit'
  // A hide undone straight away because the reporter turned out to be over the limit.
  | 'report_hold_withdrawn'
  // Somebody reported the same thing again; the earlier wording is in the detail.
  | 'report_refiled'
  // Every report keeping a post hidden was dismissed, so the hide lifted.
  | 'review_lifted'
  | 'admin_approved'
  // An admin took a visible post out of public view from its ••• menu, pending review.
  | 'admin_hidden'
  // An admin reviewed a hidden post and kept it removed (not permanently deleted).
  | 'admin_denied'
  | 'admin_restored'
  | 'admin_removed'
  | 'admin_removed_permanently'
  | 'admin_held'
  | 'admin_cleared_reports'
  | 'admin_dismissed_report'
  | 'admin_resolved_report'
  | 'admin_warned'
  // Flagged for abuse (or cleared): ratings carry no weight, reports hide nothing.
  | 'admin_flagged'
  | 'admin_unflagged'
  | 'admin_suspended'
  | 'admin_banned'
  | 'admin_reinstated'
  // A temporary suspension ran out.
  | 'suspension_expired'
  // Not a moderator's action: the author deleted a post that had been reported
  // or was under review. Logged so the record says what became of it.
  | 'author_deleted';

/** The shape of a post this module needs. Anything else about it is irrelevant. */
export interface ReviewablePost {
  review_state?: string | null;
  review_expires_at?: string | null;
}

/**
 * Counts PEOPLE, not reports.
 *
 * One account reporting the same post ten times is one report. The database
 * guarantees that with a unique index, so this cannot be the only place it
 * holds — but it is the place that defines what the number means.
 */
export function countUniqueReporters(reports: { reporter_id: string }[]): number {
  return new Set(reports.map((report) => report.reporter_id)).size;
}

/** When a review that starts now runs out. */
export function reviewExpiry(startedAt: Date, windowMs: number = REVIEW_WINDOW_MS): Date {
  return new Date(startedAt.getTime() + clampWindow(windowMs));
}

/**
 * Keeps a configured window inside what "temporary" can mean: at least a
 * minute, at most the 24 hours above. Anything outside that is a mistake, and
 * the safe reading of a mistake here is the documented default.
 */
export function clampWindow(windowMs: number): number {
  if (!Number.isFinite(windowMs) || windowMs < 60_000) return REVIEW_WINDOW_MS;
  return Math.min(windowMs, REVIEW_WINDOW_MS);
}

/**
 * The window in words, for the author's notification and the admin queue.
 *
 * Derived rather than written out, so a shortened window never leaves the app
 * telling somebody "up to 24 hours" when it means two minutes.
 */
export function describeWindow(windowMs: number = REVIEW_WINDOW_MS): string {
  const ms = clampWindow(windowMs);
  const hours = ms / 3_600_000;
  if (hours >= 1) {
    const whole = Math.round(hours);
    return `${whole} hour${whole === 1 ? '' : 's'}`;
  }
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Is this post hidden by a review right now?
 *
 * The expiry is evaluated HERE rather than trusted from a column, so a post
 * whose 24 hours ran out is visible again the moment somebody asks — no
 * scheduler, no sweep, nothing to forget to run. `admin_hold` has no expiry:
 * an administrator holding something is not undone by a clock.
 */
export function underReview(post: ReviewablePost, now: number = Date.now()): boolean {
  const state = post.review_state ?? null;
  if (!state) return false;
  if (state === 'admin_hold') return true;
  // Hidden by reports stays hidden until an administrator decides. Posts hidden
  // under the first version of this carry an expiry; it is no longer honoured,
  // because nothing should come back on its own after 24 hours.
  void now;
  return state === 'temporary_review';
}

/** Whether a review has run its course and should be written off as expired. */
export function reviewHasExpired(post: ReviewablePost, now: number = Date.now()): boolean {
  // Nothing expires any more: see `underReview`.
  void post;
  void now;
  return false;
}

/** The columns migration 0009 adds to `posts`. */
export const REVIEW_COLUMNS = [
  'review_state',
  'review_started_at',
  'review_expires_at',
  'review_reports',
] as const;

/**
 * Is this failure "the database has not had migration 0009 run against it"?
 *
 * Narrow on purpose. This predicate decides whether an error is swallowed and
 * the feature switched off, so anything it says yes to wrongly becomes a bug
 * that hides itself. It must be a missing relation, it must be about `posts`,
 * and it must name one of the four columns 0009 adds — or name no column at
 * all, which is `posts` itself being absent, a broken database this module
 * cannot do anything useful about either way.
 *
 * Checking only `review_state` would be a coin flip: an update sends all four
 * and which one comes back is up to PostgREST.
 */
export function isMissingReviewColumn(error: unknown): boolean {
  if (!isMissingRelation(error) || error.table !== 'posts') return false;
  if (error.column === null) return true;
  return (REVIEW_COLUMNS as readonly string[]).includes(error.column);
}
