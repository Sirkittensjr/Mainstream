'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { CATEGORIES, type Category } from '@/lib/types';
import { sanitiseAvatarUrl, sanitiseMedia } from '@/lib/media';
import { checkLimit } from '@/lib/services/rate-limit';
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
import { deleteAccount, signOut } from '@/lib/services/account';
import { submitRating } from '@/lib/services/ratings';
import { setRaterTrust } from '@/lib/services/rating-integrity';
import type { Reaction, RatingTarget } from '@/lib/types';

export async function likeAction(postId: string) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to like posts.' };
  if (viewer.status !== 'active') {
    return { ok: false as const, error: 'Your account is suspended.' };
  }
  const result = await toggleLike(postId, viewer.id);
  return { ok: true as const, liked: result.liked };
}

export async function followAction(userId: string, shouldFollow: boolean) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to follow creators.' };
  if (shouldFollow) {
    const limit = await checkLimit('follows', viewer.id);
    if (!limit.ok) return { ok: false as const, error: limit.error };
    await follow(viewer.id, userId);
  } else {
    await unfollow(viewer.id, userId);
  }
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

export async function commentAction(
  postId: string,
  body: string,
  parentId: string | null = null,
) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to comment.' };
  if (viewer.status !== 'active') {
    return { ok: false as const, error: 'Your account is suspended, so you cannot comment.' };
  }
  if (!body.trim()) return { ok: false as const, error: 'Write something first.' };
  const limit = await checkLimit('comments', viewer.id);
  if (!limit.ok) return { ok: false as const, error: limit.error };
  await addComment(postId, viewer.id, body, parentId);
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
  if (!viewer) return { ok: false as const, error: 'Sign in to report.' };
  const limit = await checkLimit('reports', viewer.id);
  if (!limit.ok) return { ok: false as const, error: limit.error };
  await submitReport({
    reporterId: viewer.id,
    targetType: formData.get('targetType') as 'post' | 'user' | 'comment',
    targetId: String(formData.get('targetId')),
    reason: String(formData.get('reason') || 'Something else'),
    details: String(formData.get('details') || ''),
  });
  return { ok: true as const };
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
  const limit = await checkLimit('posts', viewer.id);
  if (!limit.ok) return { error: limit.error };

  const caption = String(formData.get('caption') || '').trim().slice(0, 1200);
  // Media arrives as a hidden field, so it is untrusted: keep only the URLs
  // this deployment issued. See src/lib/media.ts.
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(String(formData.get('media') || '[]'));
  } catch {
    parsed = [];
  }
  const media = sanitiseMedia(parsed, 6);
  if (!caption && media.length === 0) {
    return { error: 'Add a caption or some media before posting.' };
  }
  const categoryInput = String(formData.get('category') || 'Life') as Category;
  const category = CATEGORIES.includes(categoryInput) ? categoryInput : 'Life';

  const post = await createPost({
    authorId: viewer.id,
    caption,
    media,
    category,
    tags: String(formData.get('tags') || '')
      .split(/[\s,]+/)
      .map((tag) => tag.slice(0, 30))
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
  // Interests drive the category rankings, so only real categories go in.
  const interests = formData
    .getAll('interests')
    .map(String)
    .filter((value): value is Category => (CATEGORIES as readonly string[]).includes(value))
    .slice(0, 6);
  const displayName = String(formData.get('display_name') || '').trim().slice(0, 40);
  if (!displayName) return { ok: false as const, error: 'Add a display name.' };

  await updateProfile(viewer.id, {
    display_name: displayName,
    bio: String(formData.get('bio') || '').slice(0, 240),
    location: String(formData.get('location') || '').slice(0, 60) || null,
    // Same reasoning as post media: only an avatar we stored.
    avatar_url: sanitiseAvatarUrl(formData.get('avatar_url')),
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
  // deleteAccount removes the profile, the content and the Supabase Auth user,
  // and signs this browser out on the way.
  await deleteAccount(viewer.id);
  redirect('/');
}

export async function logoutAction() {
  // Supabase clears its own cookies and revokes the refresh token.
  await signOut();
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
