import 'server-only';
import { db, isMissingColumn, isMissingRelation } from '@/lib/db';
import { refreshCommunity } from './community-cache';
import {
  autoReviewAvailable,
  isVideoPost,
  patchReview,
  record as recordModeration,
  tellAuthorHidden,
  tellAuthorHiddenByAdmin,
  tellAuthorRemoved,
  tellAuthorRestored,
  underReview,
} from './auto-review';
import { countUniqueReporters, type ModerationAction } from '@/lib/auto-review-rules';
import {
  ADMIN_HOLD,
  REPORT_HOLD,
  REPORT_THRESHOLD,
  canHideByReport,
  holdingReports,
  isSuspensionLength,
  postKind,
  suspensionEnd,
  suspensionOver,
  type PostKind,
} from '@/lib/moderation-rules';
import { releasePostMedia } from '@/lib/media/cleanup';
import { newId } from '@/lib/ids';
import type {
  ID,
  Media,
  ModerationEvent,
  Post,
  PublicUser,
  Report,
  ReportTarget,
  User,
  UserStatus,
} from '@/lib/types';
import { notify } from './notifications';
import { setRaterTrust } from './rating-integrity';
import { serially } from './serial';
import { toPublicUser } from './users';

export { REPORT_REASONS } from '@/lib/moderation-reasons';

/** What every moderator decision returns: done, or why not, in words for the admin. */
export type Decision = { ok: true } | { ok: false; error: string };

// --- reporting ---------------------------------------------------------------

export type ReportResult = { ok: true; hidden: boolean } | { ok: false; error: string };

/**
 * Files a report — and, when the reporter is allowed to, hides the post at
 * once until a moderator looks.
 *
 * The rules, all enforced here whatever the request sends:
 *
 *   - Any signed-in account that is not banned may report something that
 *     exists and is not its own. Every report is recorded.
 *   - One report per account per thing (a unique index in the database; this
 *     function's lookup is the friendly path to the same answer). Reporting
 *     again updates the wording and writes the earlier wording to the
 *     moderation log, so nothing said is lost.
 *   - Reports show in the moderation dashboard straight away, whatever their
 *     number. A post is hidden pending admin review when it reaches
 *     REPORT_THRESHOLD VALID reports: open, not cleared by a moderator, from
 *     that many DISTINCT accounts that are active and not flagged for abuse
 *     (`canHideByReport`). Reports from anybody else are recorded and shown to
 *     moderators but never counted.
 *   - A report a moderator already dealt with (by restoring the post or
 *     dismissing it) is cleared and stops counting, and reporting again does
 *     not un-clear it — so the same people cannot hide a restored post again.
 *   - Hiding is a conditional update ("only if nothing has hidden it"), and
 *     every report counts AFTER its own row is written, so of ten reports
 *     arriving together at least the last to count sees all ten, and the post
 *     is hidden exactly once.
 *   - It stays hidden until an administrator decides. Nothing expires.

 * Nothing is deleted, nobody is suspended, and the author is told without
 * being told who.
 */
export async function submitReport(input: {
  reporterId: ID;
  targetType: ReportTarget;
  targetId: ID;
  reason: string;
  details?: string;
}): Promise<ReportResult> {
  // One account's reports one at a time in this process: the limit is a count
  // followed by an action, and two of those interleaved would both pass.
  return serially(`report:${input.reporterId}`, () => fileReport(input));
}

async function fileReport(input: {
  reporterId: ID;
  targetType: ReportTarget;
  targetId: ID;
  reason: string;
  details?: string;
}): Promise<ReportResult> {
  const store = db();
  const reason = String(input.reason ?? '').slice(0, 120) || 'Something else';
  const details = String(input.details ?? '').slice(0, 1000);

  const reporter = await store.get('users', input.reporterId);
  if (!reporter || reporter.status === 'banned') {
    return { ok: false, error: 'Your account cannot send reports right now.' };
  }
  const refusal = await reportRefusal(input.reporterId, input.targetType, input.targetId);
  if (refusal) return { ok: false, error: refusal };

  const existing = await findReport(input.reporterId, input.targetType, input.targetId);
  if (existing) {
    await refile(existing, reason, details);
    return { ok: true, hidden: false };
  }

  try {
    await store.insert('reports', {
      id: newId(),
      reporter_id: input.reporterId,
      target_type: input.targetType,
      target_id: input.targetId,
      reason,
      details,
      status: 'open',
      resolution: null,
      cleared_at: null,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    // The unique index: another request from this account about the same thing
    // got there first. Theirs was the first report; this is a second.
    const raced = await findReport(input.reporterId, input.targetType, input.targetId);
    if (!raced) throw error;
    await refile(raced, reason, details);
    return { ok: true, hidden: false };
  }

  if (input.targetType !== 'post') return { ok: true, hidden: false };
  return { ok: true, hidden: await hideAtThreshold(input.targetId) };
}

async function findReport(reporterId: ID, targetType: ReportTarget, targetId: ID) {
  const rows = await db().query('reports', {
    where: { reporter_id: reporterId, target_type: targetType, target_id: targetId },
  });
  return rows[0] ?? null;
}

/**
 * The same account reporting the same thing again.
 *
 * The newer wording is kept on the report and the older one goes to the log.
 * A report a moderator had closed is opened again so a person reads it — but
 * its `cleared_at` stays, so it cannot hide the post or keep it hidden.
 */
async function refile(existing: Report, reason: string, details: string): Promise<void> {
  const reopened = existing.status !== 'open';
  const changed = reopened || existing.reason !== reason || (existing.details ?? '') !== details;
  if (!changed) return;
  await db().update('reports', existing.id, {
    reason,
    details,
    ...(reopened ? { status: 'open' as const, resolution: null } : {}),
  });
  await recordModeration({
    targetType: existing.target_type,
    targetId: existing.target_id,
    action: 'report_refiled',
    actorId: existing.reporter_id,
    detail:
      `Reported again: ${reason}. Earlier: ${existing.reason}` +
      (existing.details ? ` — “${existing.details.slice(0, 200)}”` : '') +
      (reopened ? ` (was ${existing.status})` : ''),
  });
}

/** Why this cannot be reported by this person, or null when it can. */
async function reportRefusal(
  reporterId: ID,
  targetType: ReportTarget,
  targetId: ID,
): Promise<string | null> {
  const store = db();
  if (targetType === 'post') {
    const post = await store.get('posts', targetId).catch(() => null);
    if (!post || post.removed) return 'That post is no longer available.';
    if (post.author_id === reporterId) return 'You cannot report your own post. You can delete it instead.';
    return null;
  }
  if (targetType === 'comment') {
    const comment = await store.get('comments', targetId).catch(() => null);
    if (!comment || comment.removed) return 'That comment is no longer available.';
    if (comment.user_id === reporterId) return 'You cannot report your own comment.';
    return null;
  }
  const user = await store.get('users', targetId).catch(() => null);
  if (!user) return 'That account does not exist.';
  if (user.id === reporterId) return 'You cannot report your own account.';
  return null;
}

/**
 * The VALID reports about a post: open, not cleared by a moderator, from an
 * account that is active and not flagged for abuse — one per account.
 */
export async function validReportCount(postId: ID): Promise<number> {
  const reports = await db().query('reports', { where: { target_type: 'post', target_id: postId } });
  const reporters = await usersById(reports.map((report) => report.reporter_id));
  return countUniqueReporters(holdingReports(reports, reporters));
}

/**
 * Hides a post pending admin review once it has REPORT_THRESHOLD valid reports.
 *
 * Returns whether THIS call hid it. A post already hidden, removed or held by a
 * moderator is left alone — the conditional update only matches a post nothing
 * has restricted — so a report beyond the tenth never hides it twice.
 */
async function hideAtThreshold(postId: ID): Promise<boolean> {
  if (!(await autoReviewAvailable())) return false;
  const store = db();
  const post = await store.get('posts', postId);
  if (!post || post.removed || underReview(post)) return false;

  const valid = await validReportCount(postId);
  if (valid < REPORT_THRESHOLD) return false;

  const hidden = await store.updateWhere(
    'posts',
    { id: postId, removed: false, review_state: null },
    {
      review_state: REPORT_HOLD,
      review_started_at: new Date().toISOString(),
      review_expires_at: null,
      review_reports: valid,
    },
  );
  if (hidden === 0) return false;

  refreshCommunity();
  await recordModeration({
    targetType: 'post',
    targetId: postId,
    action: 'auto_review_started',
    actorId: null,
    uniqueReports: valid,
    detail: `Hidden pending admin review: ${valid} valid reports from different accounts.`,
  });
  await tellAuthorHidden(post.author_id, postId, isVideoPost(post));
  return true;
}

// --- a moderator's decisions about a post -------------------------------------

/**
 * Approve and restore: the post comes back, everywhere, with everything it had.
 *
 * Every restriction on it is lifted — a report's hide, a moderator's hold, an
 * earlier removal — because a moderator deciding it is fine is the decision
 * all of those were waiting for. Likes, comments and ratings were never
 * touched while it was hidden, so they are all still there. Its open reports
 * are resolved and cleared: those reporters cannot hide it again.
 *
 * Refused for a post removed permanently: its files are gone.
 */
export async function approvePost(postId: ID, adminId: ID | null, note = ''): Promise<Decision> {
  const post = await db().get('posts', postId);
  if (!post) return { ok: false, error: 'That post no longer exists.' };
  if (await wasPurged(postId)) {
    return { ok: false, error: 'This post was removed permanently and its files deleted, so it cannot be restored.' };
  }
  const wasHidden = post.removed || underReview(post);

  await patchReview(
    postId,
    { review_state: null, review_expires_at: null },
    { removed: false, removed_reason: null },
  );
  const closed = await closeReportsAbout('post', postId, 'resolved', withNote('Reviewed and restored', note));
  refreshCommunity();
  await recordModeration({
    targetType: 'post',
    targetId: postId,
    action: 'admin_approved',
    actorId: adminId,
    uniqueReports: closed.uniqueReporters,
    detail: withNote('Reviewed and restored', note),
  });
  if (wasHidden) await tellAuthorRestored(post.author_id, postId, isVideoPost(post));
  return { ok: true };
}

/**
 * Keep under review: hidden while a moderator looks into it.
 *
 * Works on a post a report hid and on one that is still visible, which is how a
 * moderator hides something nobody eligible has reported. Only a moderator's
 * approval or removal takes it out of this state: dismissing reports does not.
 */
export async function keepUnderReview(postId: ID, adminId: ID, note = ''): Promise<Decision> {
  const store = db();
  const post = await store.get('posts', postId);
  if (!post) return { ok: false, error: 'That post no longer exists.' };
  if (post.removed) return { ok: false, error: 'That post has already been removed.' };
  if (post.review_state === ADMIN_HOLD) return { ok: true };
  if (!(await autoReviewAvailable())) {
    return { ok: false, error: 'Holding posts needs migration 0009 on this database.' };
  }

  const held = await store.updateWhere(
    'posts',
    {
      id: postId,
      removed: false,
      review_state: post.review_state ?? null,
      ...(post.review_state ? { review_expires_at: post.review_expires_at ?? null } : {}),
    },
    {
      review_state: ADMIN_HOLD,
      review_expires_at: null,
      review_started_at: post.review_started_at ?? new Date().toISOString(),
    },
  );
  if (held === 0) return { ok: false, error: 'It changed while you were looking. Reload and try again.' };

  refreshCommunity();
  await recordModeration({
    targetType: 'post',
    targetId: postId,
    action: 'admin_held',
    actorId: adminId,
    detail: withNote('Kept under review', note),
  });
  return { ok: true };
}

/**
 * Remove from public viewing, pending review — the admin action on a post's
 * ••• menu.
 *
 * The post is held by a moderator (the same state as Keep under review), so
 * it is gone from every public surface at once while the post, its files, its
 * likes, comments, ratings, reports and history all stay. The author is told,
 * with the reason. It is in the moderation queue, where Approve and restore
 * brings it back and Deny or Remove permanently ends it.
 */
export async function hideFromPublic(postId: ID, adminId: ID, reason: string): Promise<Decision> {
  const why = String(reason ?? '').trim().slice(0, 300);
  if (!why) return { ok: false, error: 'Give a reason for removing it from public viewing.' };
  const store = db();
  const post = await store.get('posts', postId);
  if (!post) return { ok: false, error: 'That post no longer exists.' };
  if (post.removed) return { ok: false, error: 'That post has already been removed.' };
  if (post.review_state === ADMIN_HOLD) return { ok: false, error: 'That post is already removed from public viewing.' };
  if (!(await autoReviewAvailable())) {
    return { ok: false, error: 'Removing posts from public viewing needs migration 0009 on this database.' };
  }

  const held = await store.updateWhere(
    'posts',
    { id: postId, removed: false, review_state: post.review_state ?? null },
    {
      review_state: ADMIN_HOLD,
      review_expires_at: null,
      review_started_at: post.review_started_at ?? new Date().toISOString(),
    },
  );
  if (held === 0) return { ok: false, error: 'It changed while you were looking. Reload and try again.' };

  refreshCommunity();
  const author = await store.get('users', post.author_id);
  await recordModeration({
    targetType: 'post',
    targetId: postId,
    action: 'admin_hidden',
    actorId: adminId,
    detail:
      `${why} · post by @${author?.username ?? 'unknown'}: ` +
      `“${(post.text_title || post.caption || 'media only').slice(0, 80)}”`,
  });
  await tellAuthorHiddenByAdmin(post.author_id, postId, isVideoPost(post), why);
  return { ok: true };
}

/**
 * Deny — keep removed: a moderator reviewed a hidden post and it stays off
 * FayTarra. Removed, not deleted: its files and records stay, and Approve
 * and restore can still reverse it. The author is told, with the reason.
 * Permanent deletion is a separate, explicit choice (`removePostPermanently`).
 */
export async function denyPost(postId: ID, adminId: ID, reason: string): Promise<Decision> {
  const why = String(reason ?? '').trim().slice(0, 300);
  if (!why) return { ok: false, error: 'Give a reason for keeping it removed.' };
  const store = db();
  const post = await store.get('posts', postId);
  if (!post) return { ok: false, error: 'That post no longer exists.' };
  if (post.removed) return { ok: false, error: 'That post has already been removed.' };

  const removed = await store.updateWhere('posts', { id: postId, removed: false }, { removed: true, removed_reason: why });
  if (removed === 0) return { ok: false, error: 'It changed while you were looking. Reload and try again.' };
  await patchReview(postId, { review_state: null, review_expires_at: null });
  const closed = await closeReportsAbout('post', postId, 'resolved', `Kept removed: ${why}`);

  refreshCommunity();
  await recordModeration({
    targetType: 'post',
    targetId: postId,
    action: 'admin_denied',
    actorId: adminId,
    uniqueReports: closed.uniqueReporters,
    detail: why,
  });
  await tellAuthorRemoved(post.author_id, postId, isVideoPost(post), why);
  return { ok: true };
}

/**
 * Remove permanently: off FayTarra for good.
 *
 * The post row stays as the record — its caption, who wrote it, why it was
 * removed — and so do its reports and its moderation history. Its files are
 * deleted unless something else still uses them (another post, a profile
 * picture), checked the same way deleting a post checks. The author is told.
 * Removing a post never changes its author's account: that is a separate,
 * deliberate decision.
 */
export async function removePostPermanently(postId: ID, adminId: ID, reason: string): Promise<Decision> {
  const why = String(reason ?? '').trim().slice(0, 300);
  if (!why) return { ok: false, error: 'Give a reason for removing it.' };
  const store = db();
  const post = await store.get('posts', postId);
  if (!post) return { ok: false, error: 'That post no longer exists.' };
  if (await wasPurged(postId)) return { ok: true };

  const media: Media[] = Array.isArray(post.media) ? post.media : [];
  await store.updateWhere('posts', { id: postId }, { removed: true, removed_reason: why });
  // The post no longer lists its files, so the in-use check below can tell
  // whether anything ELSE still needs them.
  await patchReview(postId, { review_state: null, review_expires_at: null }, { media: [] });
  const files = await releasePostMedia(media, post.author_id);
  const closed = await closeReportsAbout('post', postId, 'resolved', `Post removed: ${why}`);

  refreshCommunity();
  await recordModeration({
    targetType: 'post',
    targetId: postId,
    action: 'admin_removed_permanently',
    actorId: adminId,
    uniqueReports: closed.uniqueReporters,
    detail:
      `${why} · ${files.removed.length} file${files.removed.length === 1 ? '' : 's'} deleted` +
      (files.kept.length ? `, ${files.kept.length} kept because something else uses them` : ''),
  });
  await tellAuthorRemoved(post.author_id, postId, media.some((item) => item?.kind === 'video'), why);
  return { ok: true };
}

/** Whether a moderator removed this post permanently. */
async function wasPurged(postId: ID): Promise<boolean> {
  try {
    const events = await db().query('moderation_events', {
      where: { target_type: 'post', target_id: postId, action: 'admin_removed_permanently' },
      limit: 1,
    });
    return events.length > 0;
  } catch (error) {
    if (isMissingRelation(error)) return false;
    throw error;
  }
}

/**
 * Dismiss a report that was unfounded.
 *
 * The report is closed and cleared, and the rest is worked out from what is
 * left: a post hidden by reports is shown again only when no report that could
 * hide it remains open. A post a moderator is holding, or removed, stays
 * exactly as it is — dismissing one report is not a decision about the post.
 */
export async function dismissReport(reportId: ID, adminId: ID, note = ''): Promise<Decision> {
  return closeReport(reportId, adminId, 'dismissed', note);
}

/** Close a report as dealt with — for a profile or a comment, after acting on it. */
export async function resolveReport(
  reportId: ID,
  status: 'resolved' | 'dismissed',
  resolution: string,
  adminId?: ID,
): Promise<Decision> {
  if (status !== 'resolved' && status !== 'dismissed') return { ok: false, error: 'Not a report outcome.' };
  return closeReport(reportId, adminId ?? null, status, resolution);
}

async function closeReport(
  reportId: ID,
  adminId: ID | null,
  status: 'resolved' | 'dismissed',
  note: string,
): Promise<Decision> {
  const store = db();
  const report = await store.get('reports', reportId);
  if (!report) return { ok: false, error: 'That report no longer exists.' };
  const resolution = String(note ?? '').trim().slice(0, 500) || (status === 'dismissed' ? 'Dismissed' : 'Resolved');

  const closed = await updateReports(
    { id: reportId, status: 'open' },
    { status, resolution, cleared_at: new Date().toISOString() },
  );
  if (closed === 0) return { ok: false, error: 'Somebody already dealt with that report.' };

  const reporter = await store.get('users', report.reporter_id);
  await recordModeration({
    targetType: report.target_type,
    targetId: report.target_id,
    action: status === 'dismissed' ? 'admin_dismissed_report' : 'admin_resolved_report',
    actorId: adminId,
    detail: `${report.reason} from @${reporter?.username ?? 'unknown'}: ${resolution}`,
  });

  // Not a decision about the post: a hidden post stays hidden until an
  // administrator approves or denies it.
  return { ok: true };
}

/** Closes every open report about something, and clears every report about it. */
async function closeReportsAbout(
  targetType: ReportTarget,
  targetId: ID,
  status: 'resolved' | 'dismissed',
  resolution: string,
): Promise<{ uniqueReporters: number }> {
  const store = db();
  const reports = await store.query('reports', { where: { target_type: targetType, target_id: targetId } });
  const now = new Date().toISOString();
  await updateReports(
    { target_type: targetType, target_id: targetId, status: 'open' },
    { status, resolution: resolution.slice(0, 500), cleared_at: now },
  );
  // Reports already closed but never cleared (from before clearing existed)
  // are history now too: none of them can hide the post again.
  await updateReports({ target_type: targetType, target_id: targetId, cleared_at: null }, { cleared_at: now });
  return { uniqueReporters: countUniqueReporters(reports.filter((report) => report.status === 'open')) };
}

/** `updateWhere` on reports, for a database that has no `cleared_at` (before migration 0009). */
async function updateReports(where: Partial<Report>, patch: Partial<Report>): Promise<number> {
  try {
    return await db().updateWhere('reports', where, patch);
  } catch (error) {
    if (!isMissingColumn(error, 'reports', 'cleared_at')) throw error;
    if ('cleared_at' in where) return 0;
    const { cleared_at: _cleared, ...rest } = patch;
    return Object.keys(rest).length ? db().updateWhere('reports', where, rest) : 0;
  }
}

/** Restores a post a moderator removed before removal was permanent. */
export async function restorePost(postId: ID, adminId?: ID): Promise<Decision> {
  return approvePost(postId, adminId ?? null, 'Removal reversed');
}

/** Hides a comment. Its row stays, so the decision can be read later. */
export async function removeComment(commentId: ID, adminId?: ID, reason = ''): Promise<void> {
  const comment = await db().get('comments', commentId);
  if (!comment) return;
  await db().update('comments', commentId, { removed: true });
  await closeReportsAbout('comment', commentId, 'resolved', withNote('Comment removed', reason));
  await recordModeration({
    targetType: 'comment',
    targetId: commentId,
    action: 'admin_removed',
    actorId: adminId ?? null,
    detail: withNote('Comment removed', reason),
  });
}

// --- accounts --------------------------------------------------------------------

/** The three states an account can be put in, and what each is logged as. */
const STATUS_ACTIONS = {
  active: 'admin_reinstated',
  suspended: 'admin_suspended',
  banned: 'admin_banned',
} as const satisfies Record<UserStatus, ModerationAction>;

export const isUserStatus = (value: unknown): value is UserStatus =>
  typeof value === 'string' && Object.hasOwn(STATUS_ACTIONS, value);

/**
 * Suspends, bans or reinstates an account, and writes it to the moderation log.
 *
 * A suspension can be for a number of days (`days`) or until reinstated. A ban
 * is permanent until reversed. Both need a reason, which the person is shown.
 * Nobody can do either to themselves or to another administrator from here:
 * those are not moderation decisions, and an admin account taken over must not
 * be able to lock the other admins out.
 */
export async function setUserStatus(
  userId: ID,
  status: UserStatus,
  reason: string,
  adminId?: ID,
  options: { days?: number | null } = {},
): Promise<Decision> {
  if (!isUserStatus(status)) return { ok: false, error: 'Not an account status.' };
  const store = db();
  const user = await store.get('users', userId);
  if (!user) return { ok: false, error: 'That account does not exist.' };
  if (adminId && user.id === adminId) return { ok: false, error: 'You cannot change your own account here.' };
  if (status !== 'active' && user.role === 'admin') {
    return { ok: false, error: 'Administrators cannot be suspended or banned from the dashboard.' };
  }
  const note = String(reason ?? '').trim().slice(0, 300);
  if (status !== 'active' && !note) return { ok: false, error: 'Give a reason. The person is shown it.' };

  const days = options.days ?? null;
  if (status === 'suspended' && !isSuspensionLength(days)) {
    return { ok: false, error: 'Pick one of the suspension lengths.' };
  }
  const until = status === 'suspended' ? suspensionEnd(days) : null;

  const patch: Partial<User> = { status, status_reason: note || null, suspended_until: until };
  let openEnded = false;
  try {
    await store.update('users', userId, patch);
  } catch (error) {
    if (!isMissingColumn(error, 'users', 'suspended_until')) throw error;
    // Before migration 0014 there is nowhere to keep an end date: the
    // suspension still happens, and lasts until somebody reinstates them.
    const { suspended_until: _until, ...rest } = patch;
    await store.update('users', userId, rest);
    openEnded = until !== null;
  }
  refreshCommunity();
  await recordModeration({
    targetType: 'user',
    targetId: userId,
    action: STATUS_ACTIONS[status],
    actorId: adminId ?? null,
    detail:
      `@${user.username}: ${note || 'no note'}` +
      (until && !openEnded ? ` · until ${until}` : '') +
      (openEnded ? ' · until reinstated (temporary suspensions need migration 0014)' : ''),
  });
  return { ok: true };
}

/**
 * A warning: a notification from FayTarra moderation, and a line in the log.
 * Nothing about the account changes.
 */
export async function warnUser(userId: ID, adminId: ID, message: string): Promise<Decision> {
  const text = String(message ?? '').trim().slice(0, 500);
  if (!text) return { ok: false, error: 'Write the warning the person will read.' };
  const user = await db().get('users', userId);
  if (!user) return { ok: false, error: 'That account does not exist.' };
  if (user.id === adminId) return { ok: false, error: 'You cannot warn yourself.' };
  await notify({ userId, type: 'system', body: `A warning from FayTarra moderation: ${text}` });
  await recordModeration({
    targetType: 'user',
    targetId: userId,
    action: 'admin_warned',
    actorId: adminId,
    detail: `@${user.username}: ${text}`,
  });
  return { ok: true };
}

/**
 * Flags an account for abuse, or clears the flag. The flag is the rating
 * integrity switch that already existed: a flagged account's ratings carry no
 * weight, and now its reports are recorded without hiding anything. Logged like
 * every other decision; never for yourself or another administrator.
 */
export async function setAbuseFlag(userId: ID, adminId: ID, flagged: boolean): Promise<Decision> {
  const user = await db().get('users', userId);
  if (!user) return { ok: false, error: 'That account does not exist.' };
  if (user.id === adminId) return { ok: false, error: 'You cannot flag your own account.' };
  if (flagged && user.role === 'admin') return { ok: false, error: 'Administrators cannot be flagged.' };
  await setRaterTrust(userId, !flagged);
  refreshCommunity();
  await recordModeration({
    targetType: 'user',
    targetId: userId,
    action: flagged ? 'admin_flagged' : 'admin_unflagged',
    actorId: adminId,
    detail: `@${user.username}: ${flagged ? 'ratings carry no weight; reports hide nothing' : 'flag cleared'}`,
  });
  return { ok: true };
}

/**
 * Writes down that a temporary suspension ran out, the next time the person
 * is seen. Everything already treats it as over (`effectiveStatus`); this makes
 * the row agree. Conditional, so it cannot undo a suspension made since.
 */
export async function liftExpiredSuspension(user: User): Promise<User> {
  if (!suspensionOver(user)) return user;
  const lifted = await db().updateWhere(
    'users',
    { id: user.id, status: 'suspended', suspended_until: user.suspended_until ?? null },
    { status: 'active', status_reason: null, suspended_until: null },
  );
  if (lifted === 0) return user;
  await recordModeration({
    targetType: 'user',
    targetId: user.id,
    action: 'suspension_expired',
    actorId: null,
    detail: `@${user.username}: the suspension that ended ${user.suspended_until} is over.`,
  });
  return { ...user, status: 'active', status_reason: null, suspended_until: null };
}

// --- what moderators read ----------------------------------------------------------

export interface ReportView {
  report: Report;
  reporter: PublicUser | null;
  target:
    | {
        type: 'post';
        id: ID;
        caption: string;
        authorUsername: string;
        removed: boolean;
        reviewState: 'temporary_review' | 'admin_hold' | null;
      }
    | { type: 'user'; id: ID; username: string; status: UserStatus }
    | { type: 'comment'; id: ID; body: string; authorUsername: string }
    | null;
}

export async function listReports(status: Report['status'] | 'all' = 'open'): Promise<ReportView[]> {
  const store = db();
  const reports = await store.query('reports', {
    ...(status === 'all' ? {} : { where: { status } }),
    orderBy: 'created_at',
    desc: true,
  });
  if (reports.length === 0) return [];

  const [users, posts, comments] = await Promise.all([
    store.query('users'),
    store.query('posts'),
    store.query('comments'),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const postById = new Map(posts.map((p) => [p.id, p]));
  const commentById = new Map(comments.map((c) => [c.id, c]));

  return reports.map((report) => {
    let target: ReportView['target'] = null;
    if (report.target_type === 'post') {
      const post = postById.get(report.target_id);
      if (post) {
        target = {
          type: 'post',
          id: post.id,
          caption: post.caption,
          authorUsername: userById.get(post.author_id)?.username ?? 'unknown',
          removed: post.removed,
          reviewState: underReview(post) ? (post.review_state ?? REPORT_HOLD) : null,
        };
      }
    } else if (report.target_type === 'user') {
      const user = userById.get(report.target_id);
      if (user) target = { type: 'user', id: user.id, username: user.username, status: user.status };
    } else {
      const comment = commentById.get(report.target_id);
      if (comment) {
        target = {
          type: 'comment',
          id: comment.id,
          body: comment.body,
          authorUsername: userById.get(comment.user_id)?.username ?? 'unknown',
        };
      }
    }
    const reporter = userById.get(report.reporter_id);
    return { report, reporter: reporter ? toPublicUser(reporter) : null, target };
  });
}

/** What a moderator needs to know about the person behind a report. */
export interface ReporterHistory {
  id: ID;
  username: string;
  status: UserStatus;
  /** False when a moderator has flagged them for abuse. */
  trusted: boolean;
  /** Whether their report can hide a post right now. */
  canHide: boolean;
  filed: number;
  dismissed: number;
}

export interface QueueReport {
  id: ID;
  reason: string;
  details: string;
  status: Report['status'];
  createdAt: string;
  /** Closed or cleared by a moderator: it cannot hide or hold the post. */
  cleared: boolean;
  /** One of the reports keeping a report-hidden post hidden. */
  holding: boolean;
  reporter: ReporterHistory | null;
}

export interface QueueEvent {
  id: ID;
  action: string;
  actor: string | null;
  detail: string;
  createdAt: string;
}

export interface QueueItem {
  post: {
    id: ID;
    caption: string;
    textTitle: string | null;
    kind: PostKind;
    media: Media[];
    createdAt: string;
    contentWarning: boolean;
  };
  author: { id: ID; username: string; displayName: string; status: string };
  /** Why it is hidden, or that it is still visible with open reports. */
  state: 'report_hold' | 'admin_hold' | 'visible';
  hiddenAt: string | null;
  /** The reporter whose report hid it, for a report hold. */
  hiddenBy: string | null;
  reports: QueueReport[];
  openReports: number;
  uniqueReporters: number;
  /** Distinct eligible accounts whose report counts toward REPORT_THRESHOLD. */
  validReports: number;
  reasons: { reason: string; count: number }[];
  history: QueueEvent[];
}

/**
 * The moderation queue: posts waiting for a decision.
 *
 *   hidden   — hidden by a report or kept under review, oldest first
 *   reported — still visible, with open reports that could not hide it (from
 *              suspended or flagged accounts, over the limit, or filed again
 *              after a moderator restored it)
 *
 * For moderators only: it names reporters, shows what they wrote and how their
 * past reports went. Nothing here reaches anybody else — the page that reads it
 * is behind `requireAdmin`, and no API returns any of it.
 */
export async function moderationQueue(): Promise<{ hidden: QueueItem[]; reported: QueueItem[] }> {
  const store = db();
  let held: Post[] = [];
  if (await autoReviewAvailable()) {
    held = (await store.query('posts', { in: { review_state: [REPORT_HOLD, ADMIN_HOLD] } })).filter(
      (post) => !post.removed && underReview(post),
    );
  }
  const openPostReports = await store.query('reports', { where: { target_type: 'post', status: 'open' } });
  const heldIds = new Set(held.map((post) => post.id));
  const reportedIds = [...new Set(openPostReports.map((report) => report.target_id))].filter(
    (id) => !heldIds.has(id),
  );
  const reportedPosts = reportedIds.length
    ? (await store.query('posts', { in: { id: reportedIds } })).filter((post) => !post.removed)
    : [];
  const posts = [...held, ...reportedPosts];
  if (posts.length === 0) return { hidden: [], reported: [] };

  const postIds = posts.map((post) => post.id);
  const [reports, events] = await Promise.all([
    store.query('reports', { where: { target_type: 'post' }, in: { target_id: postIds } }),
    store
      .query('moderation_events', {
        where: { target_type: 'post' },
        in: { target_id: postIds },
        orderBy: 'created_at',
        desc: true,
      })
      .catch((error) => (isMissingRelation(error) ? [] : Promise.reject(error))),
  ]);
  const reporterIds = [...new Set(reports.map((report) => report.reporter_id))];
  const [people, reporterReports] = await Promise.all([
    usersById([
      ...posts.map((post) => post.author_id),
      ...reporterIds,
      ...events.map((event) => event.actor_id).filter((id): id is ID => Boolean(id)),
    ]),
    reporterIds.length ? store.query('reports', { in: { reporter_id: reporterIds } }) : Promise.resolve([]),
  ]);

  const history = new Map<ID, ReporterHistory>();
  for (const id of reporterIds) {
    const person = people.get(id);
    if (!person) continue;
    const theirs = reporterReports.filter((report) => report.reporter_id === id);
    history.set(id, {
      id,
      username: person.username,
      status: person.status,
      trusted: person.trusted !== false,
      canHide: canHideByReport(person),
      filed: theirs.length,
      dismissed: theirs.filter((report) => report.status === 'dismissed').length,
    });
  }

  const reportsByPost = group(reports);
  const eventsByPost = group(events);
  const toItem = (post: Post): QueueItem => {
    const theirs = (reportsByPost.get(post.id) ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const holding = new Set(holdingReports(theirs, people).map((report) => report.id));
    const open = theirs.filter((report) => report.status === 'open');
    const byReason = new Map<string, number>();
    for (const report of open) byReason.set(report.reason, (byReason.get(report.reason) ?? 0) + 1);
    const postEvents = eventsByPost.get(post.id) ?? [];
    const hide = postEvents.find((event) => event.action === 'report_hidden');
    const author = people.get(post.author_id);
    const state: QueueItem['state'] = !underReview(post)
      ? 'visible'
      : post.review_state === ADMIN_HOLD
        ? 'admin_hold'
        : 'report_hold';
    return {
      post: {
        id: post.id,
        caption: post.caption,
        textTitle: post.text_title ?? null,
        kind: postKind(post),
        media: Array.isArray(post.media) ? post.media : [],
        createdAt: post.created_at,
        contentWarning: post.content_warning === true,
      },
      author: {
        id: post.author_id,
        username: author?.username ?? 'unknown',
        displayName: author?.display_name ?? 'unknown',
        status: author?.status ?? 'active',
      },
      state,
      hiddenAt: state === 'visible' ? null : (post.review_started_at ?? null),
      hiddenBy:
        state === 'report_hold' && hide?.actor_id ? (people.get(hide.actor_id)?.username ?? null) : null,
      reports: theirs.map((report) => ({
        id: report.id,
        reason: report.reason,
        details: report.details ?? '',
        status: report.status,
        createdAt: report.created_at,
        cleared: Boolean(report.cleared_at) || report.status !== 'open',
        holding: holding.has(report.id),
        reporter: history.get(report.reporter_id) ?? null,
      })),
      openReports: open.length,
      uniqueReporters: countUniqueReporters(open),
      validReports: countUniqueReporters(holdingReports(theirs, people)),
      reasons: [...byReason.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      history: postEvents.map((event) => ({
        id: event.id,
        action: event.action,
        actor: event.actor_id ? (people.get(event.actor_id)?.username ?? 'unknown') : null,
        detail: event.detail,
        createdAt: event.created_at,
      })),
    };
  };

  const byAge = (a: QueueItem, b: QueueItem) =>
    (a.hiddenAt ?? a.post.createdAt).localeCompare(b.hiddenAt ?? b.post.createdAt);
  return {
    hidden: held.map(toItem).sort(byAge),
    reported: reportedPosts.map(toItem).sort((a, b) => b.openReports - a.openReports || byAge(a, b)),
  };
}

export interface LogEntry {
  id: ID;
  action: string;
  actor: string | null;
  targetType: ReportTarget;
  targetId: ID;
  /** A few words naming what it was about: @someone, or the start of a post. */
  target: string;
  /** Where to look at it, when there is somewhere. */
  href: string | null;
  detail: string;
  createdAt: string;
}

/**
 * The audit log: every moderation decision, who made it, about what, when and
 * why. Newest first. With `username`, only what concerns that account — done
 * to it, to its posts, or by it.
 */
export async function moderationLog(options: { username?: string; limit?: number } = {}): Promise<LogEntry[]> {
  const store = db();
  const limit = Math.min(Math.max(options.limit ?? 150, 1), 500);
  let events: ModerationEvent[];
  try {
    if (options.username) {
      const [user] = await store.query('users', { where: { username: options.username.toLowerCase() } });
      if (!user) return [];
      const theirPosts = await store.query('posts', { where: { author_id: user.id } });
      const [toThem, toPosts, byThem] = await Promise.all([
        store.query('moderation_events', { where: { target_type: 'user', target_id: user.id } }),
        theirPosts.length
          ? store.query('moderation_events', {
              where: { target_type: 'post' },
              in: { target_id: theirPosts.map((post) => post.id) },
            })
          : Promise.resolve([] as ModerationEvent[]),
        store.query('moderation_events', { where: { actor_id: user.id } }),
      ]);
      const seen = new Map<ID, ModerationEvent>();
      for (const event of [...toThem, ...toPosts, ...byThem]) seen.set(event.id, event);
      events = [...seen.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
    } else {
      events = await store.query('moderation_events', { orderBy: 'created_at', desc: true, limit });
    }
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  if (events.length === 0) return [];

  const postIds = events.filter((event) => event.target_type === 'post').map((event) => event.target_id);
  const commentIds = events.filter((event) => event.target_type === 'comment').map((event) => event.target_id);
  const [posts, comments] = await Promise.all([
    postIds.length ? store.query('posts', { in: { id: [...new Set(postIds)] } }) : Promise.resolve([] as Post[]),
    commentIds.length ? store.query('comments', { in: { id: [...new Set(commentIds)] } }) : Promise.resolve([]),
  ]);
  const postById = new Map(posts.map((post) => [post.id, post]));
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  const people = await usersById([
    ...events.map((event) => event.actor_id).filter((id): id is ID => Boolean(id)),
    ...events.filter((event) => event.target_type === 'user').map((event) => event.target_id),
    ...posts.map((post) => post.author_id),
    ...comments.map((comment) => comment.user_id),
  ]);

  return events.map((event) => {
    let target = 'something since deleted';
    let href: string | null = null;
    if (event.target_type === 'user') {
      const person = people.get(event.target_id);
      if (person) {
        target = `@${person.username}`;
        href = `/u/${person.username}`;
      }
    } else if (event.target_type === 'post') {
      const post = postById.get(event.target_id);
      if (post) {
        const author = people.get(post.author_id)?.username ?? 'unknown';
        target = `post by @${author}: “${(post.text_title || post.caption || 'media only').slice(0, 60)}”`;
        href = `/post/${post.id}`;
      }
    } else {
      const comment = commentById.get(event.target_id);
      if (comment) {
        const author = people.get(comment.user_id)?.username ?? 'unknown';
        target = `comment by @${author}: “${comment.body.slice(0, 60)}”`;
        href = `/post/${comment.post_id}`;
      }
    }
    return {
      id: event.id,
      action: event.action,
      actor: event.actor_id ? (people.get(event.actor_id)?.username ?? 'unknown') : null,
      targetType: event.target_type,
      targetId: event.target_id,
      target,
      href,
      detail: event.detail,
      createdAt: event.created_at,
    };
  });
}

// --- small helpers ----------------------------------------------------------------

async function usersById(ids: ID[]): Promise<Map<ID, User>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const users = await db().query('users', { in: { id: unique } });
  return new Map(users.map((user) => [user.id, user]));
}

function group<T extends { target_id: ID }>(rows: T[]): Map<ID, T[]> {
  const out = new Map<ID, T[]>();
  for (const row of rows) {
    const bucket = out.get(row.target_id);
    if (bucket) bucket.push(row);
    else out.set(row.target_id, [row]);
  }
  return out;
}

function withNote(what: string, note: string): string {
  const text = String(note ?? '').trim().slice(0, 300);
  return text ? `${what}: ${text}` : `${what}.`;
}
