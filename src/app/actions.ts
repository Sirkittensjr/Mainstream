'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clearSessionCookie } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { CATEGORIES, type Category, type Media } from '@/lib/types';
import { getViewer, requireAdmin, requireViewer } from '@/lib/session';
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  toggleLike,
} from '@/lib/services/posts';
import { markAllRead } from '@/lib/services/notifications';
import {
  removeComment,
  removePost,
  resolveReport,
  restorePost,
  setUserStatus,
  submitReport,
} from '@/lib/services/moderation';
import { blockUser, follow, unblockUser, unfollow, updateProfile } from '@/lib/services/users';
import { deleteAccount } from '@/lib/services/account';
import { submitRating } from '@/lib/services/ratings';
import { setRaterTrust } from '@/lib/services/rating-integrity';
import type { Reaction, RatingTarget } from '@/lib/types';

export async function likeAction(postId: string) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to like posts.' };
  const result = await toggleLike(postId, viewer.id);
  return { ok: true as const, liked: result.liked };
}

export async function followAction(userId: string, shouldFollow: boolean) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to follow creators.' };
  if (shouldFollow) await follow(viewer.id, userId);
  else await unfollow(viewer.id, userId);
  return { ok: true as const, following: shouldFollow };
}

export async function rateAction(
  targetType: RatingTarget,
  targetId: string,
  score: number,
  reactions: Reaction[],
) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to rate.' };
  const result = await submitRating({
    raterId: viewer.id,
    targetType,
    targetId,
    score,
    reactions,
  });
  if (result.ok) {
    revalidatePath(targetType === 'post' ? `/post/${targetId}` : '/home');
  }
  return result;
}

export async function commentAction(postId: string, body: string) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to comment.' };
  await addComment(postId, viewer.id, body);
  revalidatePath(`/post/${postId}`);
  return { ok: true as const };
}

export async function deleteCommentAction(commentId: string, postId: string) {
  const viewer = await requireViewer();
  await deleteComment(commentId, viewer.id);
  revalidatePath(`/post/${postId}`);
}

export async function deletePostAction(postId: string) {
  const viewer = await requireViewer();
  await deletePost(postId, viewer.id);
  revalidatePath('/home');
  revalidatePath(`/u/${viewer.username}`);
  redirect(`/u/${viewer.username}`);
}

export async function reportAction(formData: FormData) {
  const viewer = await getViewer();
  if (!viewer) return;
  await submitReport({
    reporterId: viewer.id,
    targetType: formData.get('targetType') as 'post' | 'user' | 'comment',
    targetId: String(formData.get('targetId')),
    reason: String(formData.get('reason') || 'Something else'),
    details: String(formData.get('details') || ''),
  });
}

export async function blockAction(userId: string, shouldBlock: boolean) {
  const viewer = await requireViewer();
  if (shouldBlock) await blockUser(viewer.id, userId);
  else await unblockUser(viewer.id, userId);
  revalidatePath('/home');
  revalidatePath('/settings');
}

export async function createPostAction(_prev: unknown, formData: FormData) {
  const viewer = await requireViewer('/create');
  if (viewer.status !== 'active') {
    return { error: 'Your account is suspended, so you cannot post right now.' };
  }
  const caption = String(formData.get('caption') || '').trim();
  const mediaRaw = String(formData.get('media') || '[]');
  let media: Media[] = [];
  try {
    media = JSON.parse(mediaRaw) as Media[];
  } catch {
    media = [];
  }
  if (!caption && media.length === 0) {
    return { error: 'Add a caption or some media before posting.' };
  }
  const categoryInput = String(formData.get('category') || 'Life') as Category;
  const category = CATEGORIES.includes(categoryInput) ? categoryInput : 'Life';

  const post = await createPost({
    authorId: viewer.id,
    caption,
    media: media.slice(0, 6),
    category,
    tags: String(formData.get('tags') || '')
      .split(/[\s,]+/)
      .filter(Boolean),
  });
  revalidatePath('/home');
  revalidatePath('/discover');
  revalidatePath(`/u/${viewer.username}`);
  redirect(`/post/${post.id}`);
}

export async function markNotificationsReadAction() {
  const viewer = await getViewer();
  if (!viewer) return;
  await markAllRead(viewer.id);
  revalidatePath('/notifications');
}

export async function updateProfileAction(_prev: unknown, formData: FormData) {
  const viewer = await requireViewer('/settings');
  const interests = formData.getAll('interests').map(String) as Category[];
  await updateProfile(viewer.id, {
    display_name: String(formData.get('display_name') || viewer.display_name).slice(0, 40),
    bio: String(formData.get('bio') || '').slice(0, 240),
    location: String(formData.get('location') || '').slice(0, 60) || null,
    avatar_url: String(formData.get('avatar_url') || '') || null,
    ...(interests.length > 0 ? { interests } : {}),
  });
  revalidatePath('/settings');
  revalidatePath(`/u/${viewer.username}`);
  return { ok: true as const, message: 'Profile updated.' };
}

export async function deleteAccountAction(confirmation: string) {
  const viewer = await requireViewer('/settings');
  // Typing the username is the confirmation — nothing is deleted without it.
  if (confirmation.trim().toLowerCase() !== viewer.username) {
    return { ok: false as const, error: 'Type your username exactly to confirm.' };
  }
  await deleteAccount(viewer.id);
  await clearSessionCookie();
  redirect('/');
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect('/');
}

// --- admin -----------------------------------------------------------------

export async function adminRemovePostAction(postId: string, reason: string) {
  await requireAdmin();
  await removePost(postId, reason || 'Removed by a moderator');
  revalidatePath('/admin');
}

export async function adminRestorePostAction(postId: string) {
  await requireAdmin();
  await restorePost(postId);
  revalidatePath('/admin');
}

export async function adminRemoveCommentAction(commentId: string) {
  await requireAdmin();
  await removeComment(commentId);
  revalidatePath('/admin');
}

export async function adminSetStatusAction(
  userId: string,
  status: 'active' | 'suspended' | 'banned',
  reason: string,
) {
  const admin = await requireAdmin();
  if (admin.id === userId) return;
  await setUserStatus(userId, status, reason);
  revalidatePath('/admin');
}

export async function adminResolveReportAction(
  reportId: string,
  status: 'resolved' | 'dismissed',
  resolution: string,
) {
  await requireAdmin();
  await resolveReport(reportId, status, resolution);
  revalidatePath('/admin');
}

export async function adminSetTrustAction(userId: string, trusted: boolean) {
  await requireAdmin();
  await setRaterTrust(userId, trusted);
  revalidatePath('/admin');
}

/** Used by the admin "view user" panel. */
export async function adminLookupAction(query: string) {
  await requireAdmin();
  const users = await db().query('users');
  const needle = query.trim().toLowerCase();
  return users
    .filter((user) => user.username.includes(needle) || user.email.includes(needle))
    .slice(0, 10)
    .map((user) => ({ id: user.id, username: user.username, status: user.status }));
}
