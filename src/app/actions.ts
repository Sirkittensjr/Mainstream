'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect, RedirectType } from 'next/navigation';
import { CATEGORIES, type Category } from '@/lib/types';
import { bigStyleOf, normaliseTextPost, TEXT_KIND_COPY, textKindOf } from '@/lib/text-posts';
import { isTextPostNotStorable } from '@/lib/services/insert-post';
import { profileCoverUrl, sanitiseAvatarUrl, sanitiseMedia } from '@/lib/media';
import { PROFILE_DEFAULT, isProfileBackgroundKey, isProfileColorKey } from '@/lib/profile-theme';
import { checkLimit } from '@/lib/services/rate-limit';
import { MEDIA_REUSE_ERROR, mediaFiles, mediaReuseProblem } from '@/lib/services/media-reuse';
import { getViewer, requireAdmin, requireViewer } from '@/lib/session';
import { clearAdminVerification } from '@/lib/services/admin-step-up';
import { RESERVED_NAME_ERROR, isReservedDisplayName } from '@/lib/reserved-names';
import { isAdminRole } from '@/lib/admin-badge';
import {
  addComment,
  createPost,
  deleteComment,
  type DeleteCommentRefusal,
  deletePost,
  toggleLike,
  type DeleteRefusal,
} from '@/lib/services/posts';
import { markAllRead } from '@/lib/services/notifications';
import { REPORT_REASONS } from '@/lib/moderation-reasons';
import {
  approvePost,
  denyPost,
  dismissReport,
  hideFromPublic,
  isUserStatus,
  keepUnderReview,
  removeComment,
  removePostPermanently,
  resolveReport,
  setAbuseFlag,
  setUserStatus,
  submitReport,
  warnUser,
} from '@/lib/services/moderation';
import {
  blockUser,
  follow,
  unblockUser,
  unfollow,
  updateProfile,
  updateProfileColours,
  updateProfileCover,
} from '@/lib/services/users';
import { changeUsername, deleteAccount, signOut } from '@/lib/services/account';
import {
  send as sendMessage,
  markAllMessagesRead,
} from '@/lib/services/messages';
import { getUserByUsername } from '@/lib/services/users';
import { submitRating } from '@/lib/services/ratings';
import { saveTopCreators } from '@/lib/services/top-creators';
import { normaliseTags } from '@/lib/video/hashtags';
import { MAX_VIDEO_SECONDS, MAX_VIDEO_SECONDS_ENFORCED } from '@/lib/video/limits';
import { recordVideoView } from '@/lib/services/video-views';
import { VIEW_BROWSER_COOKIE, VIEW_BROWSER_COOKIE_OPTIONS } from '@/lib/video/viewer-cookie';
import { sanitiseSessionKey } from '@/lib/video/views';
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

/**
 * A video was watched — the way pages built before /api/v1/posts/<id>/views
 * reported it.
 *
 * Players now send views to that route (see lib/video/view-reports.ts for why
 * not a server action). This stays so a page opened before the deploy that
 * moved them keeps counting until it is reloaded; it is the same service with
 * the same rules, so nothing can count twice through having two doors.
 */
export async function recordVideoViewAction(postId: string, sessionKey: string) {
  const id = String(postId || '').slice(0, 64);
  if (!id) return { ok: false as const };

  try {
    const viewer = await getViewer();
    const jar = await cookies();
    let browserId = jar.get(VIEW_BROWSER_COOKIE)?.value ?? null;
    if (!viewer && !browserId) {
      browserId = crypto.randomUUID();
      jar.set(VIEW_BROWSER_COOKIE, browserId, VIEW_BROWSER_COOKIE_OPTIONS);
    }
    const result = await recordVideoView({
      postId: id,
      viewerId: viewer?.id ?? null,
      browserId,
      sessionKey: sanitiseSessionKey(sessionKey),
    });
    return { ok: true as const, ...result };
  } catch {
    // recordVideoView has logged why; nothing was stored.
    return { ok: false as const };
  }
}

export async function followAction(userId: string, shouldFollow: boolean) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to follow creators.' };
  if (shouldFollow) {
    // Unfollowing is always allowed; following is something a suspended
    // account does not get to do, like posting, liking and commenting.
    if (viewer.status !== 'active') {
      return { ok: false as const, error: 'Your account is suspended, so you cannot follow people.' };
    }
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
  const added = await addComment(postId, viewer.id, body, parentId);
  if (!added.ok) return { ok: false as const, error: added.error };
  revalidatePath(`/post/${postId}`);
  return { ok: true as const, id: added.id };
}

const DELETE_COMMENT_REFUSED: Record<DeleteCommentRefusal, string> = {
  not_found: 'That comment is no longer here.',
  not_allowed: 'You can only delete your own comments, or comments on your own posts.',
  moderated: 'A moderator removed this comment, so it stays on record.',
};

/**
 * Deletes a comment — the commenter's own, or any on the viewer's own post.
 *
 * Only the comment id is taken from the request. Which post it is on, and so
 * whether this person owns that post, is read from the database; see
 * `deleteComment`.
 */
export async function deleteCommentAction(commentId: string) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to delete comments.' };
  const result = await deleteComment(String(commentId ?? '').slice(0, 64), viewer.id);
  if (!result.ok) return { ok: false as const, error: DELETE_COMMENT_REFUSED[result.reason] };
  revalidatePath(`/post/${result.postId}`);
  return { ok: true as const, removed: result.removed };
}

const DELETE_REFUSED: Record<DeleteRefusal, string> = {
  not_found: 'That post is no longer here.',
  not_yours: 'You can only delete your own posts.',
  moderated: 'A moderator removed this post, so it stays on record and cannot be deleted.',
  under_review:
    'This post is being reviewed by FayTarra moderation, so it cannot be deleted until the review is finished.',
};

/**
 * Deletes one of the signed-in person's own posts.
 *
 * Who is asking comes from the session, never from the request: the only thing
 * the browser supplies is which post, and `deletePost` refuses any post that is
 * not theirs. Every page is then revalidated, so no feed, profile, search or
 * Discover page can be served from before the delete.
 *
 * `then: 'profile'` is for the post's own page, which has nothing left to show:
 * it moves to the author's profile as a client navigation, replacing the post
 * in the history so Back does not lead to a page that no longer exists.
 */
export async function deletePostAction(postId: string, options: { then?: 'profile' } = {}) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to delete your posts.' };
  const result = await deletePost(String(postId ?? ''), viewer.id);
  if (!result.ok) return { ok: false as const, error: DELETE_REFUSED[result.reason] };
  revalidatePath('/', 'layout');
  if (options?.then === 'profile') redirect(`/u/${viewer.username}`, RedirectType.replace);
  return { ok: true as const };
}

export async function reportAction(formData: FormData) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const, error: 'Sign in to report.' };
  const limit = await checkLimit('reports', viewer.id);
  if (!limit.ok) return { ok: false as const, error: limit.error };
  // The form offers a fixed list; a request that did not come from it is held
  // to the same list rather than storing whatever it sent.
  const targetType = String(formData.get('targetType'));
  const targetId = String(formData.get('targetId') || '').slice(0, 64);
  if (!['post', 'user', 'comment'].includes(targetType) || !targetId) {
    return { ok: false as const, error: 'That cannot be reported.' };
  }
  const asked = String(formData.get('reason') || '');
  const filed = await submitReport({
    reporterId: viewer.id,
    targetType: targetType as 'post' | 'user' | 'comment',
    targetId,
    reason: (REPORT_REASONS as readonly string[]).includes(asked) ? asked : 'Something else',
    details: String(formData.get('details') || ''),
  });
  if (!filed.ok) return { ok: false as const, error: filed.error };
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
  /** Hashtags, as a list. A string is still accepted, split on spaces and commas. */
  tags?: string | string[];
  contentWarning?: boolean;
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
  // Not somebody else's upload, and not the file of a post moderation is
  // holding or removed. See services/media-reuse.ts.
  const reuse = await mediaReuseProblem(mediaFiles([media]), viewer.id);
  if (reuse) return { error: MEDIA_REUSE_ERROR[reuse] };

  const categoryInput = String(input.category || 'Life') as Category;
  const post = await createPost({
    authorId: viewer.id,
    caption: String(input.caption || '').trim().slice(0, 1200),
    media: [media],
    category: CATEGORIES.includes(categoryInput) ? categoryInput : 'Life',
    // Structured all the way through: the posting screen collects hashtags as
    // tags and they are stored in the post's `tags` array, which is what search
    // and Discover read. Nothing is appended to the caption, and a string from
    // an older client is still split. See lib/video/hashtags.ts.
    tags: normaliseTags(input.tags),
    contentWarning: input.contentWarning === true,
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

  /**
   * A text post says which of the three shapes it is, and is clamped to that
   * shape's limits HERE as well as in the composer. A `maxLength` on a textarea
   * is a suggestion; this is the rule. A post with no `text_kind` field is an
   * ordinary caption-and-media post and takes the path it always did.
   */
  const askedKind = textKindOf(formData.get('text_kind'));
  if (askedKind) {
    const made = normaliseTextPost(
      askedKind,
      formData.get('text_title'),
      formData.get('caption'),
    );
    if (!made.ok) return { error: made.error };

    const textCategoryInput = String(formData.get('category') || 'Life') as Category;
    let textPost: Awaited<ReturnType<typeof createPost>>;
    try {
      textPost = await createPost({
        authorId: viewer.id,
        caption: made.body,
        media: [],
        category: CATEGORIES.includes(textCategoryInput) ? textCategoryInput : 'Life',
        tags: String(formData.get('tags') || '')
          .split(/[\s,]+/)
          .map((tag) => tag.slice(0, 30))
          .filter(Boolean),
        textKind: made.kind,
        textTitle: made.title,
        // Only a big message carries one, and only ever one of the four.
        textStyle: made.kind === 'big' ? bigStyleOf(formData.get('text_style')) : null,
      });
    } catch (error) {
      // The database is behind the code and could only have stored this as a
      // different-looking post. Say so and keep the draft, rather than posting
      // a big message as a small white bubble. The server log names the
      // migration; see insert-post.ts.
      if (!isTextPostNotStorable(error)) throw error;
      return {
        error: `${TEXT_KIND_COPY[made.kind].label}s can't be posted on FayTarra just yet, so this one hasn't been posted. Your words are still here.`,
      };
    }
    revalidatePath('/home');
    revalidatePath('/discover');
    revalidatePath(`/u/${viewer.username}`);
    redirect(`/post/${textPost.id}`);
  }

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
  const reuse = await mediaReuseProblem(mediaFiles(media), viewer.id);
  if (reuse) return { error: MEDIA_REUSE_ERROR[reuse] };
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

/**
 * Marks every unread notification read. Called when the Notifications page is
 * opened, not when a notification arrives and not from any other page.
 *
 * `revalidatePath('/', 'layout')` is what clears the badge: the count is
 * rendered by the app layout, so revalidating only /notifications would leave
 * the number in the navigation stale until the next full load.
 */
export async function markNotificationsReadAction() {
  const viewer = await getViewer();
  if (!viewer) return;
  await markAllRead(viewer.id);
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}

/**
 * The same, for the message inbox.
 *
 * Only the viewer's own received messages are touched — see
 * `markAllMessagesRead`. Who may message whom is not consulted or changed.
 */
export async function markMessagesReadAction() {
  const viewer = await getViewer();
  if (!viewer) return;
  await markAllMessagesRead(viewer.id);
  revalidatePath('/messages');
  revalidatePath('/', 'layout');
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

  // Reserved names are for official accounts. Checked against the role the
  // DATABASE holds for this session, never against anything the form sent.
  if (isReservedDisplayName(displayName) && !isAdminRole(viewer.role)) {
    return { ok: false as const, error: RESERVED_NAME_ERROR };
  }

  // A profile picture is held to the same rules as a post's media: your own
  // upload, and not the file of a post moderation is holding or removed.
  const avatar = sanitiseAvatarUrl(formData.get('avatar_url'));
  if (avatar && avatar !== viewer.avatar_url) {
    const reuse = await mediaReuseProblem([avatar], viewer.id);
    if (reuse) return { ok: false as const, error: MEDIA_REUSE_ERROR[reuse] };
  }

  await updateProfile(viewer.id, {
    display_name: displayName,
    bio: String(formData.get('bio') || '').slice(0, 240),
    location: String(formData.get('location') || '').slice(0, 60) || null,
    // Same reasoning as post media: only an avatar we stored.
    avatar_url: avatar,
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
  // A background may be one of the gradients too; a box is always one colour.
  if (!isProfileBackgroundKey(background) || !isProfileColorKey(box)) {
    return { ok: false as const, error: 'That is not one of the colours.' };
  }

  // `viewer.id` comes from the session, and this action takes no id of its
  // own, so there is no request anybody can make that paints somebody else's
  // profile.
  const saved = await updateProfileColours(
    viewer.id,
    background === PROFILE_DEFAULT ? null : background,
    box === PROFILE_DEFAULT ? null : box,
  );
  if (!saved.ok) return { ok: false as const, error: saved.error };

  revalidatePath('/settings');
  revalidatePath(`/u/${viewer.username}`);
  return { ok: true as const };
}

/**
 * The photo behind somebody's profile, or null to go back to their colour.
 *
 * Only an IMAGE FayTarra itself stored and checked — the same rule an avatar
 * follows — so nothing a caller sends can point a profile at someone else's
 * server or at a video. Like the colours, it takes no id: it is always the
 * signed-in person's own profile.
 */
export async function updateProfileCoverAction(url: string | null) {
  const viewer = await requireViewer('/settings');
  const cover = url === null ? null : profileCoverUrl(url);
  if (url !== null && !cover) {
    return { ok: false as const, error: 'That is not a picture uploaded here.' };
  }
  if (cover && cover !== viewer.profile_cover_url) {
    const reuse = await mediaReuseProblem([cover], viewer.id);
    if (reuse) return { ok: false as const, error: MEDIA_REUSE_ERROR[reuse] };
  }
  const saved = await updateProfileCover(viewer.id, cover);
  if (!saved.ok) return { ok: false as const, error: saved.error };

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
  // The admin second-factor proof is ours, not Supabase's, so it has to be
  // dropped here. Signing out must not leave a browser one password away from
  // the dashboard.
  await clearAdminVerification();
  // Without this the client router can serve a cached layout from before the
  // sign-out, so the navigation carries on showing the account menu until a
  // hard reload. Busting the whole tree is the point: every page's nav is
  // wrong now, not just this one.
  revalidatePath('/', 'layout');
  redirect('/');
}

// --- admin -----------------------------------------------------------------
//
// Every one of these is an ADMIN action and nothing else. `requireAdmin()` is
// the whole authorisation story: it reads the role off the database row for the
// signed-in session, server-side, on every call, and requires the admin's
// emailed second step. There is no client-supplied user, role or report count
// anywhere in this section. Each returns what happened in words, so the
// dashboard can say why something was refused, and every decision is written
// to the moderation log with the admin who made it.

type AdminResult = { ok: true } | { ok: false; error: string };

function revalidateModeration(postId?: string) {
  revalidatePath('/admin');
  if (postId) revalidatePath(`/post/${postId}`);
}

/** Approve and restore: the post is visible again, with everything it had. */
export async function adminApprovePostAction(postId: string, note = ''): Promise<AdminResult> {
  const admin = await requireAdmin();
  const result = await approvePost(String(postId), admin.id, String(note ?? ''));
  revalidateModeration(String(postId));
  return result;
}

/**
 * Remove from public viewing, pending review — the ••• menu's admin option.
 * The menu item is only drawn for admins, but that is not the lock:
 * `requireAdmin()` is, here, on every call, whoever sends it.
 */
export async function adminHidePostAction(postId: string, reason: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const result = await hideFromPublic(String(postId), admin.id, String(reason ?? ''));
  revalidatePath('/', 'layout');
  return result;
}

/** Deny — keep removed, with a reason the author is told. Not a permanent deletion. */
export async function adminDenyPostAction(postId: string, reason: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const result = await denyPost(String(postId), admin.id, String(reason ?? ''));
  revalidateModeration(String(postId));
  return result;
}

/** Keep under review: hidden while a moderator looks into it. */
export async function adminKeepUnderReviewAction(postId: string, note = ''): Promise<AdminResult> {
  const admin = await requireAdmin();
  const result = await keepUnderReview(String(postId), admin.id, String(note ?? ''));
  revalidateModeration(String(postId));
  return result;
}

/**
 * Remove permanently: off FayTarra, files cleaned up, the record kept.
 *
 * Removing a post is NOT banning its author. A report is one person pressing a
 * button, which is not evidence of anything about a person, and account status
 * is left exactly where it was — that is a separate decision.
 */
export async function adminRemovePostAction(postId: string, reason: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const result = await removePostPermanently(String(postId), admin.id, String(reason ?? ''));
  revalidateModeration(String(postId));
  return result;
}

/** Restores a post removed before removal was permanent. */
export async function adminRestorePostAction(postId: string): Promise<AdminResult> {
  return adminApprovePostAction(postId, 'Removal reversed');
}

/** Dismiss one report as unfounded. Never reveals a post held for another reason. */
export async function adminDismissReportAction(reportId: string, note = ''): Promise<AdminResult> {
  const admin = await requireAdmin();
  const result = await dismissReport(String(reportId), admin.id, String(note ?? ''));
  revalidateModeration();
  return result;
}

export async function adminResolveReportAction(
  reportId: string,
  status: 'resolved' | 'dismissed',
  resolution: string,
): Promise<AdminResult> {
  const admin = await requireAdmin();
  const result = await resolveReport(String(reportId), status, String(resolution ?? ''), admin.id);
  revalidateModeration();
  return result;
}

export async function adminRemoveCommentAction(commentId: string, reason = ''): Promise<AdminResult> {
  const admin = await requireAdmin();
  await removeComment(String(commentId), admin.id, String(reason ?? ''));
  revalidateModeration();
  return { ok: true };
}

/** A warning the person reads as a notification. Nothing about the account changes. */
export async function adminWarnUserAction(userId: string, message: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const result = await warnUser(String(userId), admin.id, String(message ?? ''));
  revalidateModeration();
  return result;
}

/**
 * Suspend (for a number of days, or until reinstated), ban, or reinstate.
 * `days` is only read for a suspension, and must be one of the offered lengths.
 */
export async function adminSetStatusAction(
  userId: string,
  status: 'active' | 'suspended' | 'banned',
  reason: string,
  days: number | null = null,
): Promise<AdminResult> {
  const admin = await requireAdmin();
  if (!isUserStatus(status)) return { ok: false, error: 'Not an account status.' };
  const result = await setUserStatus(String(userId), status, String(reason ?? ''), admin.id, {
    days: status === 'suspended' ? days : null,
  });
  revalidateModeration();
  return result;
}

/** Flag an account for abuse (trusted = false), or clear the flag. Logged. */
export async function adminSetTrustAction(userId: string, trusted: boolean): Promise<AdminResult> {
  const admin = await requireAdmin();
  const result = await setAbuseFlag(String(userId), admin.id, trusted !== true);
  revalidateModeration();
  return result;
}
