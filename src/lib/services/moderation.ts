import 'server-only';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import type { ID, PublicUser, Report, ReportTarget, UserStatus } from '@/lib/types';
import { toPublicUser } from './users';

export { REPORT_REASONS } from '@/lib/moderation-reasons';

export async function submitReport(input: {
  reporterId: ID;
  targetType: ReportTarget;
  targetId: ID;
  reason: string;
  details?: string;
}): Promise<void> {
  await db().insert('reports', {
    id: newId(),
    reporter_id: input.reporterId,
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
    details: (input.details ?? '').slice(0, 1000),
    status: 'open',
    resolution: null,
    created_at: new Date().toISOString(),
  });
}

export interface ReportView {
  report: Report;
  reporter: PublicUser | null;
  target:
    | { type: 'post'; id: ID; caption: string; authorUsername: string; removed: boolean }
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
): Promise<void> {
  await db().update('reports', reportId, { status, resolution });
}

export async function removePost(postId: ID, reason: string): Promise<void> {
  await db().update('posts', postId, { removed: true, removed_reason: reason });
}

export async function restorePost(postId: ID): Promise<void> {
  await db().update('posts', postId, { removed: false, removed_reason: null });
}

export async function removeComment(commentId: ID): Promise<void> {
  await db().update('comments', commentId, { removed: true });
}

export async function setUserStatus(
  userId: ID,
  status: UserStatus,
  reason: string,
): Promise<void> {
  await db().update('users', userId, { status, status_reason: reason || null });
}

/** Admins can feature a post, which is also a FayTarra point award for the author. */
export async function setFeatured(postId: ID, featured: boolean): Promise<void> {
  const store = db();
  const post = await store.get('posts', postId);
  if (!post || post.featured === featured) return;
  await store.update('posts', postId, {
    featured,
    featured_at: featured ? new Date().toISOString() : null,
  });
  const { award } = await import('./points');
  const { notify } = await import('./notifications');
  await award(post.author_id, 'featured', { postId, points: featured ? 100 : -100 });
  if (featured) {
    await notify({
      userId: post.author_id,
      type: 'featured',
      postId,
      body: 'Your post was featured on Discover.',
    });
  }
}
