import 'server-only';
import { db } from '@/lib/db';
import { refreshCommunity } from './community-cache';
import {
  clearReportThreshold,
  holdReviewed,
  maybeAutoReview,
  patchReview,
  record as recordModeration,
  restoreReviewed,
  tellAuthorRemoved,
  underReview,
} from './auto-review';
import { newId } from '@/lib/ids';
import type { ID, PublicUser, Report, ReportTarget, UserStatus } from '@/lib/types';
import { toPublicUser } from './users';

export { REPORT_REASONS } from '@/lib/moderation-reasons';

/**
 * Files a report, and hides the content if enough DIFFERENT people have now
 * reported it.
 *
 * One report per account per thing. Reporting the same post twice updates what
 * you said rather than adding to the count — the number that hides a post has
 * to mean "ten people", not "one person clicking ten times". The unique index
 * from migration 0009 is what actually guarantees that; this is the friendly
 * path to the same answer.
 */
export async function submitReport(input: {
  reporterId: ID;
  targetType: ReportTarget;
  targetId: ID;
  reason: string;
  details?: string;
}): Promise<void> {
  const store = db();
  const details = (input.details ?? '').slice(0, 1000);

  const existing = (
    await store.query('reports', {
      where: {
        reporter_id: input.reporterId,
        target_type: input.targetType,
        target_id: input.targetId,
      },
    })
  )[0];

  if (existing) {
    // Already on the record. Take the newer wording, and leave the count alone
    // — one account is one report however many times they press the button.
    //
    // The exception: if an admin CLEARED this report, reporting again is a new
    // complaint and has to count again, or one cleared threshold would make a
    // post permanently unreportable by the people who reported it before. What
    // the admin did is not lost by this — it is in moderation_events, which is
    // where the historical record lives.
    const cleared = Boolean((existing as Report & { cleared_at?: string | null }).cleared_at);
    await store.update('reports', existing.id, {
      reason: input.reason,
      details,
      ...(cleared ? { cleared_at: null, status: 'open', resolution: null } : {}),
    });
  } else {
    await store.insert('reports', {
      id: newId(),
      reporter_id: input.reporterId,
      target_type: input.targetType,
      target_id: input.targetId,
      reason: input.reason,
      details,
      status: 'open',
      resolution: null,
      cleared_at: null,
      created_at: new Date().toISOString(),
    });
  }

  await maybeAutoReview(input.targetType, input.targetId);
}

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
        /** Temporarily hidden by the automatic threshold, or held by an admin. */
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
          reviewState: underReview(post)
            ? (((post as { review_state?: string | null }).review_state ??
                'temporary_review') as 'temporary_review' | 'admin_hold')
            : null,
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
    return {
      report,
      reporter: userById.get(report.reporter_id)
        ? toPublicUser(userById.get(report.reporter_id)!)
        : null,
      target,
    };
  });
}

export async function resolveReport(
  reportId: ID,
  status: 'resolved' | 'dismissed',
  resolution: string,
  adminId?: ID,
): Promise<void> {
  const report = await db().get('reports', reportId);
  await db().update('reports', reportId, { status, resolution });
  if (!report) return;
  await recordModeration({
    targetType: report.target_type,
    targetId: report.target_id,
    action: status === 'resolved' ? 'admin_resolved_report' : 'admin_dismissed_report',
    actorId: adminId ?? null,
    detail: `${report.reason}: ${resolution || 'no note'}`,
  });
}

export async function removePost(postId: ID, reason: string, adminId?: ID): Promise<void> {
  await db().update('posts', postId, { removed: true, removed_reason: reason });
  refreshCommunity();
  await recordModeration({
    targetType: 'post',
    targetId: postId,
    action: 'admin_removed',
    actorId: adminId ?? null,
    detail: reason,
  });
}

/**
 * Removes a post that was under review, and tells its author.
 *
 * The review state goes with it. Leaving a removed post marked
 * `temporary_review` would put it back in the queue every time somebody looked,
 * and would leave it holding a clock it no longer needs.
 */
export async function removeReviewedPost(
  postId: ID,
  adminId: ID,
  reason: string,
): Promise<void> {
  const post = await db().get('posts', postId);
  if (!post) return;
  // The removal is the part that must land; clearing the review state is
  // bookkeeping on top of it. `patchReview` drops the review fields on a
  // database without migration 0009 rather than failing the whole update.
  await patchReview(
    postId,
    { review_state: null, review_expires_at: null },
    { removed: true, removed_reason: reason },
  );
  refreshCommunity();
  await recordModeration({
    targetType: 'post',
    targetId: postId,
    action: 'admin_removed',
    actorId: adminId,
    uniqueReports: (post as { review_reports?: number }).review_reports ?? 0,
    detail: reason,
  });
  const media = Array.isArray(post.media) ? post.media : [];
  const video = media.some((item) => (item as { kind?: string })?.kind === 'video');
  await tellAuthorRemoved(post.author_id, postId, video);
}

export async function restorePost(postId: ID, adminId?: ID): Promise<void> {
  // A removed post that was also under review comes all the way back, not
  // halfway: restoring it and leaving it invisible would be the worse bug of
  // the two, because nothing on screen would explain it. The restore itself
  // still works on a database without migration 0009 — that is what
  // `patchReview` is for.
  await patchReview(
    postId,
    { review_state: null, review_expires_at: null },
    { removed: false, removed_reason: null },
  );
  refreshCommunity();
  await recordModeration({
    targetType: 'post',
    targetId: postId,
    action: 'admin_restored',
    actorId: adminId ?? null,
    detail: 'Restored by an administrator.',
  });
}

/** Re-exported so callers have one moderation entry point, not two. */
export { clearReportThreshold, holdReviewed, restoreReviewed };

export async function removeComment(commentId: ID): Promise<void> {
  await db().update('comments', commentId, { removed: true });
}

export async function setUserStatus(
  userId: ID,
  status: UserStatus,
  reason: string,
): Promise<void> {
  await db().update('users', userId, { status, status_reason: reason || null });
  refreshCommunity();
}
