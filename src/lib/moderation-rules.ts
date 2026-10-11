/**
 * The rules of post moderation, as plain functions.
 *
 * Deciding is kept apart from doing, like auto-review-rules.ts beside it: the
 * services that read and write rows live in services/moderation.ts, and every
 * rule that decides whether something is hidden, who may hide it, and when a
 * hide lifts is here, testable without a database.
 *
 * HOW A POST IS RESTRICTED. Three independent things can keep a post off
 * FayTarra, and they are stored in columns that already exist:
 *
 *   review_state 'temporary_review'  — hidden because somebody reported it,
 *                                       until a moderator looks. (The name is
 *                                       from the first version of this, where
 *                                       the hide expired; a hide from a report
 *                                       now records no expiry, and a review
 *                                       with no expiry never lapses.)
 *   review_state 'admin_hold'        — a moderator chose to keep it hidden
 *                                       while they look into it.
 *   removed                          — a moderator removed it.
 *
 * Each is lifted only by what put it there or by a moderator overruling it.
 * Dismissing a report can lift the first and never the other two, which is
 * what stops "this one report was unfounded" from revealing a post that is
 * still restricted for another reason.
 */
import { underReview, type ReviewState } from '@/lib/auto-review-rules';
import type { Media } from '@/lib/types';

/** Hidden because of a report, waiting for a moderator. */
export const REPORT_HOLD: ReviewState = 'temporary_review';
/** Kept hidden by a moderator while they look into it. */
export const ADMIN_HOLD: ReviewState = 'admin_hold';

/**
 * How many VALID reports, from that many different eligible accounts, hide a
 * post pending admin review. See `holdingReports` for what makes one valid.
 */
export const REPORT_THRESHOLD = 10;

interface ReviewedPost {
  removed?: boolean;
  review_state?: string | null;
  review_expires_at?: string | null;
}

/** Hidden right now because it reached the report threshold. */
export function isReportHold(post: ReviewedPost, now: number = Date.now()): boolean {
  return post.review_state === REPORT_HOLD && underReview(post, now);
}

/** Kept hidden by a moderator. */
export function isAdminHold(post: ReviewedPost): boolean {
  return post.review_state === ADMIN_HOLD;
}

/** Waiting for a moderator in either way — the review queue. */
export function awaitingReview(post: ReviewedPost, now: number = Date.now()): boolean {
  return !post.removed && underReview(post, now);
}

interface Reporter {
  status: string;
  /** False once a moderator has flagged the account for abuse. */
  trusted?: boolean | null;
}

/**
 * Whether this account's report may hide a post on its own.
 *
 * Every signed-in account that is not banned can REPORT — a suspended or
 * flagged account's report is still recorded for a moderator to read. Only an
 * active account in good standing can make something disappear by doing so:
 * otherwise suspending somebody would not stop them hiding other people's
 * posts, and revoking an abuser's weight would leave them their biggest lever.
 */
export function canHideByReport(reporter: Reporter): boolean {
  return reporter.status === 'active' && reporter.trusted !== false;
}

interface OpenReport {
  reporter_id: string;
  status: string;
  cleared_at?: string | null;
}

/**
 * The VALID reports — the ones that count toward REPORT_THRESHOLD: open, not
 * cleared by a moderator, and from an account allowed to hide a post. A report
 * from a suspended, banned or flagged account, or one a moderator dismissed or
 * cleared, is still shown to moderators but never counted.
 */
export function holdingReports<T extends OpenReport>(
  reports: T[],
  reporters: Map<string, Reporter>,
): T[] {
  return reports.filter((report) => {
    if (report.status !== 'open' || report.cleared_at) return false;
    const reporter = reporters.get(report.reporter_id);
    return reporter ? canHideByReport(reporter) : false;
  });
}

/** What kind of post this is, in the words the review queue uses. */
export type PostKind = 'photo' | 'video' | 'short' | 'story' | 'big';

export function postKind(post: { media?: Media[] | null; text_kind?: string | null }): PostKind {
  const media = Array.isArray(post.media) ? post.media : [];
  if (media.some((item) => item?.kind === 'video')) return 'video';
  if (media.length > 0) return 'photo';
  if (post.text_kind === 'story' || post.text_kind === 'long') return 'story';
  if (post.text_kind === 'big') return 'big';
  return 'short';
}

// --- accounts ----------------------------------------------------------------

interface Account {
  status: string;
  suspended_until?: string | null;
}

/** A suspension with an end that has passed. Read from the clock, like a review's expiry. */
export function suspensionOver(account: Account, now: number = Date.now()): boolean {
  if (account.status !== 'suspended' || !account.suspended_until) return false;
  const ends = new Date(account.suspended_until).getTime();
  return Number.isFinite(ends) && ends <= now;
}

/**
 * The status that applies right now: a temporary suspension whose time is up
 * reads as active everywhere, whether or not anything has written that down
 * yet — no scheduler, nothing to forget to run.
 */
export function effectiveStatus(account: Account, now: number = Date.now()): string {
  return suspensionOver(account, now) ? 'active' : account.status;
}

/** The suspension lengths a moderator picks from. Null is until reinstated. */
export const SUSPENSION_DAYS = [1, 3, 7, 30] as const;

/** One of the offered lengths, or null for until reinstated. Anything else is refused. */
export function isSuspensionLength(value: unknown): value is number | null {
  return value === null || (SUSPENSION_DAYS as readonly unknown[]).includes(value);
}

/** When a suspension of this many days that starts now ends, or null for open-ended. */
export function suspensionEnd(days: number | null, from: Date = new Date()): string | null {
  return days === null ? null : new Date(from.getTime() + days * 86_400_000).toISOString();
}

// --- the log, in words -------------------------------------------------------

/** How each logged action reads in the dashboard. Unknown actions read as themselves. */
export const ACTION_LABELS: Record<string, string> = {
  auto_review_started: 'Hidden pending admin review (10 reports)',
  auto_review_expired: 'Hide expired (old 24-hour rule)',
  report_hidden: 'Hidden by a report (earlier rule)',
  report_hold_limit: 'Report recorded, not hidden (reporter at limit)',
  report_hold_withdrawn: 'Hide withdrawn (reporter over limit)',
  report_refiled: 'Reported again',
  review_lifted: 'Shown again (reports dismissed, earlier rule)',
  admin_hidden: 'Removed from public viewing',
  admin_denied: 'Denied — kept removed',
  admin_approved: 'Approved and restored',
  admin_restored: 'Restored',
  admin_removed: 'Removed',
  admin_removed_permanently: 'Removed permanently',
  admin_held: 'Kept under review',
  admin_cleared_reports: 'Reports cleared',
  admin_dismissed_report: 'Report dismissed',
  admin_resolved_report: 'Report resolved',
  admin_warned: 'Warned',
  admin_flagged: 'Flagged for abuse',
  admin_unflagged: 'Abuse flag cleared',
  admin_suspended: 'Suspended',
  admin_banned: 'Banned',
  admin_reinstated: 'Reinstated',
  suspension_expired: 'Suspension ended',
  author_deleted: 'Deleted by its author',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}
