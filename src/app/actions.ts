'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { CATEGORIES, type Category } from '@/lib/types';
import { sanitiseAvatarUrl, sanitiseMedia } from '@/lib/media';
import { PROFILE_DEFAULT, isProfileColorKey } from '@/lib/profile-theme';
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
import {
  blockUser,
  follow,
  unblockUser,
  unfollow,
  updateProfile,
  updateProfileColours,
} from '@/lib/services/users';
import { changeUsername, deleteAccount, signOut } from '@/lib/services/account';
import { send as sendMessage, markThreadRead } from '@/lib/services/messages';
import { getUserByUsername } from '@/lib/services/users';
import { submitRating } from '@/lib/services/ratings';
import { saveTopCreators } from '@/lib/services/top-creators';
import { MAX_VIDEO_SECONDS, MAX_VIDEO_SECONDS_ENFORCED } from '@/lib/video/limits';
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

export interface CreateVideoPostInput {
  media: unknown;
  caption?: string;
  category?: string;
  tags?: string;
}

/**
 * Posting a finished video.
 *
 * The same post as any other — same table, same feeds, same ratings, likes and
 * comments — reached by a different door because the video editor has a media
 * object rather than a form to submit. Everything the browser sends is treated
 * exactly as the text-and-photo form's input is: the URL has to be one this
 * deployment issued and published (see src/lib/media.ts), and the length has
 * to be one the upload checks already allowed.
 */
export async function createVideoPostAction(input: CreateVideoPostInput) {
  const viewer = await requireViewer('/create');
  if (viewer.status !== 'active') {
    return { error: 'Your account is suspended, so you cannot post right now.' };
  }
  const limit = await checkLimit('posts', viewer.id);
  if (!limit.ok) return { error: limit.error };

  const [media] = sanitiseMedia([input.media], 1);
  if (!media || media.kind !== 'video') {
    return { error: 'That video is no longer available. Try putting it together again.' };
  }
  // The file itself was measured when it was uploaded; this only catches a
  // caller inventing a length in the metadata it sends along with the post.
  if (media.duration != null && media.duration > MAX_VIDEO_SECONDS_ENFORCED) {
    return { error: `FayTarra videos can be up to ${MAX_VIDEO_SECONDS / 60} minutes.` };
  }

  const categoryInput = String(input.category || 'Life') as Category;
  const post = await createPost({
    authorId: viewer.id,
    caption: String(input.caption || '').trim().slice(0, 1200),
    media: [media],
    category: CATEGORIES.includes(categoryInput) ? categoryInput : 'Life',
    tags: String(input.tags || '')
      .split(/[\s,]+/)
      .map((tag) => tag.slice(0, 30))
      .filter(Boolean),
  });

  revalidatePath('/home');
  revalidatePath('/videos');
  revalidatePath('/discover');
  revalidatePath(`/u/${viewer.username}`);
  return { postId: post.id };
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

/**
 * Sends a direct message.
 *
 * The recipient is resolved from a username, and the mutual-follow rule is
 * enforced inside sendMessage() and again by a database trigger — calling this
 * action directly with somebody else's handle gets you nowhere.
 */
export async function sendMessageAction(username: string, body: string) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to send messages.' };
  const recipient = await getUserByUsername(username);
  if (!recipient) return { ok: false as const, error: 'That account does not exist.' };

  const result = await sendMessage(viewer.id, recipient.id, body);
  if (!result.ok) return { ok: false as const, error: result.error };

  revalidatePath(`/messages/${recipient.username}`);
  // The layout, because the recipient's unread badge lives in the navigation.
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

/**
 * Marks a conversation read.
 *
 * Only ever marks messages the signed-in person received — see
 * markThreadRead. The username is resolved server-side, so passing somebody
 * else's handle marks nothing of theirs.
 */
export async function markThreadReadAction(username: string) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, marked: 0 };
  const other = await getUserByUsername(username);
  if (!other) return { ok: false as const, marked: 0 };
  const marked = await markThreadRead(viewer.id, other.id);
  if (marked > 0) revalidatePath('/', 'layout');
  return { ok: true as const, marked };
}

/**
 * Changes the signed-in person's @username.
 *
 * The account id never changes, so everything attached to it stays attached.
 */
export async function changeUsernameAction(_prev: unknown, formData: FormData) {
  const viewer = await requireViewer('/settings');
  const result = await changeUsername(viewer.id, String(formData.get('username') || ''));
  if (!result.ok) return { ok: false as const, error: result.error };

  // The handle appears in the navigation, on every card and in every link, so
  // the whole tree is stale now, not just this page.
  revalidatePath('/', 'layout');
  return {
    ok: true as const,
    message: `You are now @${result.username}.`,
    username: result.username,
  };
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

/**
 * The two colours somebody painted their profile in.
 *
 * Only keys from the palette are stored, so nothing a caller sends can reach a
 * stylesheet — an unknown key is refused here and would resolve to the default
 * on the way out anyway.
 */
export async function updateProfileColoursAction(background: string, box: string) {
  const viewer = await requireViewer('/settings');
  if (!isProfileColorKey(background) || !isProfileColorKey(box)) {
    return { ok: false as const, error: 'That is not one of the colours.' };
  }

  const saved = await updateProfileColours(
    viewer.id,
    background === PROFILE_DEFAULT ? null : background,
    box === PROFILE_DEFAULT ? null : box,
  );
  if (!saved) {
    return {
      ok: false as const,
      error: 'Profile colours are not switched on for this deployment yet.',
    };
  }

  revalidatePath('/settings');
  revalidatePath(`/u/${viewer.username}`);
  return { ok: true as const };
}

/**
 * Somebody's Top 3, in the order they put them in.
 *
 * The only rule is that every id is an account they currently follow — checked
 * in the service, not here, and not trusted from the form. There is no
 * mutual-follow requirement and nothing about ratings or popularity: this is a
 * personal pick.
 */
export async function saveTopCreatorsAction(ids: string[]) {
  const viewer = await requireViewer('/settings');
  const result = await saveTopCreators(
    viewer.id,
    ids.filter((id) => typeof id === 'string').slice(0, 3),
  );
  if (result.ok) revalidatePath(`/u/${viewer.username}`);
  return result;
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
  // Supabase clears its own cookies and revokes the refresh token server-side.
  await signOut();
  // Without this the client router can serve a cached layout from before the
  // sign-out, so the navigation carries on showing the account menu until a
  // hard reload. Busting the whole tree is the point: every page's nav is
  // wrong now, not just this one.
  revalidatePath('/', 'layout');
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
