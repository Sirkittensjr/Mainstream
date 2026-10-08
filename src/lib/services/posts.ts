import 'server-only';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import type { TextKind } from '@/lib/text-posts';
import { record as recordModeration, underReview } from './auto-review';
import { countUniqueReporters } from '@/lib/auto-review-rules';
import { releasePostMedia, type MediaRelease } from '@/lib/media/cleanup';
import { isMissingRelation } from '@/lib/db/errors';
import type { Row } from '@/lib/db/types';
import { insertPost, type InsertMemo } from './insert-post';
import { communityCache, refreshCommunity } from './community-cache';
import { newId } from '@/lib/ids';
import type { Category, ID, Media, Post, PublicUser, User } from '@/lib/types';
import { notify, notifyMentions, notifyOnce } from './notifications';
import { myRatingsForPosts, ratingsIndex, type PostRatingSummary } from './ratings';
import {
  followerCounts,
  followingIds,
  hiddenUserIds,
  isBlockedEitherWay,
  toPublicUser,
} from './users';

/** Recently viewed posts, so a reload does not count twice. */
const VIEW_COOKIE = 'fay_seen';
const VIEW_COOKIE_KEYS = 120;

export interface PostView {
  post: Post;
  author: PublicUser;
  authorFollowers: number;
  /** The author's long-term rating, shown on the card. */
  authorRating: number | null;
  likes: number;
  comments: number;
  liked: boolean;
  following: boolean;
  rating: PostRatingSummary;
  /** What the viewer rated it, if they have. */
  myScore: number | null;
  /** Why this is in front of you, e.g. "Popular in Music". Never shown for follows. */
  reason?: string;
}

/**
 * Loads everything a post card needs in a handful of batched queries rather
 * than one query per post.
 */
export async function hydratePosts(posts: Post[], viewerId: ID | null): Promise<PostView[]> {
  if (posts.length === 0) return [];
  const store = db();
  const postIds = posts.map((p) => p.id);
  const authorIds = [...new Set(posts.map((p) => p.author_id))];

  const [authors, likes, comments, followerCount, viewerFollowing, index, mine] =
    await Promise.all([
      store.query('users', { in: { id: authorIds } }),
      store.query('likes', { in: { post_id: postIds } }),
      store.query('comments', { in: { post_id: postIds } }),
      // Counted once for the whole platform and shared, rather than reading a
      // slice of the follow graph for the authors on every page of every feed.
      followerCounts(authorIds),
      viewerId ? followingIds(viewerId) : new Set<ID>(),
      ratingsIndex(),
      myRatingsForPosts(viewerId, postIds),
    ]);

  const authorById = new Map(authors.map((a) => [a.id, a]));

  const likeCount = new Map<ID, number>(postIds.map((id) => [id, 0]));
  const likedByViewer = new Set<ID>();
  for (const like of likes) {
    likeCount.set(like.post_id, (likeCount.get(like.post_id) ?? 0) + 1);
    if (viewerId && like.user_id === viewerId) likedByViewer.add(like.post_id);
  }

  const commentCount = new Map<ID, number>(postIds.map((id) => [id, 0]));
  for (const comment of comments) {
    if (!comment.removed) {
      commentCount.set(comment.post_id, (commentCount.get(comment.post_id) ?? 0) + 1);
    }
  }

  return posts
    .map((post) => {
      const author = authorById.get(post.author_id);
      if (!author) return null;
      return {
        post,
        author: toPublicUser(author),
        authorFollowers: followerCount.get(author.id) ?? 0,
        authorRating: index.users.get(author.id)?.overallVotes
          ? (index.users.get(author.id)?.overall ?? null)
          : null,
        likes: likeCount.get(post.id) ?? 0,
        comments: commentCount.get(post.id) ?? 0,
        liked: likedByViewer.has(post.id),
        following: viewerFollowing.has(author.id),
        rating:
          index.posts.get(post.id) ??
          { rating: null, votes: 0, weightedVotes: 0, score: 0, reactions: [] },
        myScore: mine.get(post.id) ?? null,
      } satisfies PostView;
    })
    .filter((view): view is PostView => view !== null);
}

/**
 * Every post that is public at all, newest first, and the accounts that are
 * not in a state to be shown.
 *
 * Neither half depends on who is asking, so both are shared across requests
 * rather than re-read for every visitor. The viewer's own blocks are applied
 * on top, per request, because those ARE personal — see community-cache.ts
 * for the line this draws.
 */
const publicPosts = communityCache('public-posts', async () => {
  const store = db();
  const [posts, users] = await Promise.all([
    store.query('posts', { where: { removed: false }, orderBy: 'created_at', desc: true }),
    store.query('users'),
  ]);
  return {
    posts,
    inactive: users.filter((user) => user.status !== 'active').map((user) => user.id),
  };
});

/** All visible posts, with blocked and suspended accounts filtered out. */
export async function visiblePosts(viewerId: ID | null): Promise<Post[]> {
  const [{ posts, inactive }, hidden] = await Promise.all([
    publicPosts(),
    hiddenUserIds(viewerId),
  ]);
  const notShown = new Set(inactive);
  return posts.filter(
    (post) =>
      !hidden.has(post.author_id) &&
      !notShown.has(post.author_id) &&
      // Temporarily hidden while it is reviewed. Not removed — it comes back
      // on its own if nobody looks at it within 24 hours.
      !underReview(post),
  );
}

export interface CreatePostInput {
  authorId: ID;
  caption: string;
  media: Media[];
  category: Category;
  tags: string[];
  contentWarning?: boolean;
  /** Which of the three shapes a text post is. See lib/text-posts.ts. */
  textKind?: TextKind | null;
  /** A story's title. Only ever set alongside `textKind: 'story'`. */
  textTitle?: string | null;
  /** How a big message is coloured. Only ever set alongside `textKind: 'big'`. */
  textStyle?: string | null;
}

/**
 * Whether this database has the content warning column.
 *
 * Null until an insert has told us. A deployment that has not run migration
 * 0007 has no `content_warning`, and sending it would fail the whole insert —
 * which would mean nobody could post anything at all over a checkbox. So the
 * first insert that meets the missing column drops it and tries again, and
 * everything after that goes straight to the second form.
 */
const memo: InsertMemo = { warningsStored: null };

export async function createPost(input: CreatePostInput): Promise<Post> {
  const store = db();
  const post: Post = {
    id: newId(),
    author_id: input.authorId,
    caption: input.caption.trim(),
    media: input.media,
    category: input.category,
    tags: input.tags.map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean).slice(0, 8),
    views: 0,
    content_warning: input.contentWarning === true,
    removed: false,
    removed_reason: null,
    created_at: new Date().toISOString(),
  };
  // Only a text post sends these. A photo or a video has no use for them, and
  // leaving them out means posting media never depends on 0011 having run.
  if (input.textKind) post.text_kind = input.textKind;
  if (input.textTitle) post.text_title = input.textTitle;
  if (input.textStyle) post.text_style = input.textStyle;

  await insertPost(post, (row) => store.insert('posts', row), memo);
  return finish(post, store, input);
}

/** Everything that happens once a post is in the table, however it got there. */
async function finish(
  post: Post,
  store: ReturnType<typeof db>,
  input: CreatePostInput,
): Promise<Post> {
  const author = await store.get('users', input.authorId);
  await notifyMentions(
    post.caption,
    input.authorId,
    `@${author?.username ?? 'someone'} mentioned you in a post`,
    post.id,
  );
  refreshCommunity();
  return post;
}

export async function getPost(id: ID): Promise<Post | null> {
  return db().get('posts', id);
}

/** Why a delete was refused. Nothing was changed in any of these cases. */
export type DeleteRefusal = 'not_found' | 'not_yours' | 'moderated';

export type DeletePostResult =
  | { ok: true; media: MediaRelease }
  | { ok: false; reason: DeleteRefusal };

/**
 * Permanently deletes a post, for its author. The one way a post is deleted —
 * every kind (photo, video, Short, Story, Big) and every place it is offered
 * goes through here.
 *
 * Ownership is enforced twice, and neither depends on anything the browser
 * sent beyond the post's id: `userId` is the signed-in account, read from the
 * session by the caller. The row is then deleted with ONE statement whose
 * condition is "this id AND this author AND not removed by a moderator", so
 * there is no gap between checking and deleting in which the row could be
 * somebody else's. Somebody else's post, an id that does not exist, and a post
 * a moderator removed all come back refused, with nothing touched.
 *
 * A post a moderator removed stays: it is the record of that decision, the
 * moderator can still restore it, and the author deleting it would be a way to
 * erase it. Moderators keep their own tools exactly as they were.
 *
 * Then what hung off the post:
 *   likes, comments (replies too), notifications and video views — deleted.
 *     Supabase also cascades these from the foreign keys; deleting them here
 *     as well is what makes the local store, which has no foreign keys, agree.
 *   ratings of the post — deleted. They point at the post by id with no
 *     foreign key, so nothing else would.
 *   reports of the post — kept, because they are the moderation record, and
 *     any still open are resolved with a note that the author deleted it, so
 *     the queue is not left asking a moderator to act on nothing.
 *   the moderation log — kept. A line is added when the post had been
 *     reported or was under review, saying the author deleted it.
 *   its files — deleted when nothing else uses them; see `releasePostMedia`.
 */
export async function deletePost(postId: ID, userId: ID): Promise<DeletePostResult> {
  if (typeof postId !== 'string' || !postId || typeof userId !== 'string' || !userId) {
    return { ok: false, reason: 'not_found' };
  }
  const store = db();
  const post = await store.get('posts', postId).catch(() => null);
  if (!post) return { ok: false, reason: 'not_found' };
  if (post.author_id !== userId) return { ok: false, reason: 'not_yours' };
  if (post.removed) return { ok: false, reason: 'moderated' };

  const reports = await store.query('reports', {
    where: { target_type: 'post', target_id: postId },
  });
  const reviewed = underReview(post);

  const deleted = await store.removeWhere('posts', {
    id: postId,
    author_id: userId,
    removed: false,
  });
  if (deleted === 0) {
    // Changed between the read and the delete: gone already, or a moderator
    // removed it in the meantime. Either way nothing was deleted.
    const now = await store.get('posts', postId).catch(() => null);
    return { ok: false, reason: !now ? 'not_found' : now.author_id !== userId ? 'not_yours' : 'moderated' };
  }

  await Promise.all([
    dropWhere('likes', { post_id: postId }),
    dropWhere('comments', { post_id: postId }),
    dropWhere('notifications', { post_id: postId }),
    dropWhere('video_views', { post_id: postId }),
    dropWhere('ratings', { target_type: 'post', target_id: postId }),
  ]);

  const open = reports.filter((report) => report.status === 'open');
  await Promise.all(
    open.map((report) =>
      store.update('reports', report.id, {
        status: 'resolved',
        resolution: 'The author deleted this post.',
      }),
    ),
  );
  if (reports.length > 0 || reviewed) {
    await recordModeration({
      targetType: 'post',
      targetId: postId,
      action: 'author_deleted',
      actorId: userId,
      uniqueReports: countUniqueReporters(reports),
      detail: reviewed ? 'Deleted by its author while under review.' : 'Deleted by its author.',
    }).catch(() => undefined);
  }

  refreshCommunity();
  const media = await releasePostMedia(post.media, userId);
  return { ok: true, media };
}

/** Deletes rows hanging off a deleted post, tolerating a table this database does not have. */
async function dropWhere<T extends 'likes' | 'comments' | 'notifications' | 'video_views' | 'ratings'>(
  table: T,
  where: Partial<Row<T>>,
): Promise<void> {
  try {
    await db().removeWhere(table, where);
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
  }
}

export async function toggleLike(postId: ID, userId: ID): Promise<{ liked: boolean }> {
  const store = db();
  const post = await store.get('posts', postId);
  if (!post) return { liked: false };
  const existing = await store.query('likes', { where: { post_id: postId, user_id: userId } });

  if (existing.length > 0) {
    for (const like of existing) await store.remove('likes', like.id);
    return { liked: false };
  }

  // Taking a like back is always allowed; giving one is not, on a post that has
  // been removed or between two people where either has blocked the other. The
  // UI never offers it, but a request does not have to come from the UI.
  if (post.removed || (await isBlockedEitherWay(userId, post.author_id))) {
    return { liked: false };
  }

  await store.insert('likes', {
    id: newId(),
    post_id: postId,
    user_id: userId,
    created_at: new Date().toISOString(),
  });
  const actor = await store.get('users', userId);
  await notifyOnce({
    userId: post.author_id,
    type: 'like',
    actorId: userId,
    postId,
    body: `@${actor?.username ?? 'someone'} liked your post`,
  });
  return { liked: true };
}

/**
 * Adds a comment, or answers why it could not.
 *
 * A block in either direction stops it — with the post's author, and with the
 * author of the comment being replied to. The comment box is not shown to
 * somebody who is blocked, but a server action can be called without it.
 */
export async function addComment(
  postId: ID,
  userId: ID,
  body: string,
  parentId: ID | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'Write something first.' };
  const store = db();
  const post = await store.get('posts', postId);
  if (!post || post.removed) return { ok: false, error: 'That post is no longer available.' };
  if (await isBlockedEitherWay(userId, post.author_id)) {
    return { ok: false, error: 'You cannot comment on this post.' };
  }

  // Threads stay one level deep: replying to a reply joins the same thread
  // rather than starting a deeper one.
  let parent = parentId ? await store.get('comments', parentId) : null;
  if (parent && (parent.post_id !== postId || parent.removed)) parent = null;
  if (parent?.parent_id) parent = await store.get('comments', parent.parent_id);
  const resolvedParent = parent && !parent.removed ? parent : null;
  if (resolvedParent && (await isBlockedEitherWay(userId, resolvedParent.user_id))) {
    return { ok: false, error: 'You cannot reply to this comment.' };
  }

  await store.insert('comments', {
    id: newId(),
    post_id: postId,
    user_id: userId,
    parent_id: resolvedParent?.id ?? null,
    body: trimmed.slice(0, 600),
    removed: false,
    created_at: new Date().toISOString(),
  });

  const actor = await store.get('users', userId);
  const who = `@${actor?.username ?? 'someone'}`;

  if (resolvedParent) {
    // The person being replied to hears about it; the post author only hears
    // about it if it is not already their own thread.
    await notify({
      userId: resolvedParent.user_id,
      type: 'reply',
      actorId: userId,
      postId,
      body: `${who} replied to your comment`,
    });
    if (post.author_id !== resolvedParent.user_id) {
      await notify({
        userId: post.author_id,
        type: 'comment',
        actorId: userId,
        postId,
        body: `${who} replied in the comments on your post`,
      });
    }
  } else {
    await notify({
      userId: post.author_id,
      type: 'comment',
      actorId: userId,
      postId,
      body: `${who} commented on your post`,
    });
  }

  await notifyMentions(trimmed, userId, `${who} mentioned you in a comment`, postId);
  return { ok: true };
}

export async function deleteComment(commentId: ID, userId: ID): Promise<void> {
  const store = db();
  const comment = await store.get('comments', commentId);
  if (!comment) return;
  const post = await store.get('posts', comment.post_id);
  if (comment.user_id !== userId && post?.author_id !== userId) return;
  await store.remove('comments', commentId);
}

export interface CommentView {
  comment: { id: ID; body: string; created_at: string; parent_id: ID | null };
  author: PublicUser;
  mine: boolean;
  /** Replies to this comment, oldest first. Only top-level comments carry them. */
  replies: CommentView[];
}

export async function listComments(postId: ID, viewerId: ID | null): Promise<CommentView[]> {
  const store = db();
  const [comments, hidden] = await Promise.all([
    store.query('comments', { where: { post_id: postId, removed: false }, orderBy: 'created_at' }),
    hiddenUserIds(viewerId),
  ]);
  const visible = comments.filter((c) => !hidden.has(c.user_id));
  if (visible.length === 0) return [];
  const users = await store.query('users', { in: { id: visible.map((c) => c.user_id) } });
  const byId = new Map(users.map((u) => [u.id, u]));

  const toView = (comment: (typeof visible)[number]): CommentView | null => {
    const author = byId.get(comment.user_id);
    if (!author) return null;
    return {
      comment: {
        id: comment.id,
        body: comment.body,
        created_at: comment.created_at,
        parent_id: comment.parent_id ?? null,
      },
      author: toPublicUser(author),
      mine: viewerId === comment.user_id,
      replies: [],
    };
  };

  const byCommentId = new Map<ID, CommentView>();
  const roots: CommentView[] = [];
  // Two passes: parents can only be attached once every view exists.
  for (const comment of visible) {
    const view = toView(comment);
    if (view) byCommentId.set(comment.id, view);
  }
  for (const comment of visible) {
    const view = byCommentId.get(comment.id);
    if (!view) continue;
    const parent = comment.parent_id ? byCommentId.get(comment.parent_id) : null;
    // A reply whose parent was hidden or removed is shown at the top level
    // rather than disappearing with it.
    if (parent) parent.replies.push(view);
    else roots.push(view);
  }
  return roots;
}

/**
 * Counts a view, at most once per browser per post per day.
 *
 * Views feed the Recommended ranking, so counting every render meant anyone
 * could push their own post up the feed by holding F5 — and it meant a
 * database write on every page load of every post. The cookie is the dedupe
 * key: it costs nothing, it is per browser, and the worst case is an
 * undercount, which is the right way to be wrong for a ranking signal.
 */
export async function registerView(postId: ID, viewerId: ID | null): Promise<void> {
  const store = db();
  const post = await store.get('posts', postId);
  if (!post || post.author_id === viewerId) return;

  const jar = await cookies();
  const seen = (jar.get(VIEW_COOKIE)?.value ?? '').split('.').filter(Boolean);
  const key = postId.slice(0, 8);
  if (seen.includes(key)) return;

  try {
    // Server Components cannot write cookies; the post page is dynamic, so
    // this runs where they can. If it ever cannot, the view simply is not
    // deduped rather than the page failing.
    jar.set(VIEW_COOKIE, [key, ...seen].slice(0, VIEW_COOKIE_KEYS).join('.'), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24,
    });
  } catch {
    return;
  }

  await store.update('posts', postId, { views: post.views + 1 });
}

/**
 * One person's posts, as a given viewer may see them.
 *
 * A post under temporary review has to disappear from its author's public
 * profile too, or the hide is undone by anybody who clicks through to them. The
 * author themselves still sees it — they were told it is under review, and a
 * profile that silently drops it would contradict that — and so does an
 * administrator, who cannot review what they cannot see.
 *
 * `viewer` defaults to null, which is the cautious reading: a caller that does
 * not say who is looking gets the version everybody may see.
 */
export async function postsByAuthor(
  authorId: ID,
  viewer: { id: ID; role?: string | null } | null = null,
): Promise<Post[]> {
  const posts = await db().query('posts', {
    where: { author_id: authorId, removed: false },
    orderBy: 'created_at',
    desc: true,
  });
  if (viewer && (viewer.id === authorId || viewer.role === 'admin')) return posts;
  return posts.filter((post) => !underReview(post));
}

export async function engagementFor(postIds: ID[]) {
  const store = db();
  if (postIds.length === 0) {
    return { likes: new Map<ID, number>(), comments: new Map<ID, number>() };
  }
  const [likes, comments] = await Promise.all([
    store.query('likes', { in: { post_id: postIds } }),
    store.query('comments', { in: { post_id: postIds } }),
  ]);
  const likeCount = new Map<ID, number>(postIds.map((id) => [id, 0]));
  const commentCount = new Map<ID, number>(postIds.map((id) => [id, 0]));
  for (const like of likes) likeCount.set(like.post_id, (likeCount.get(like.post_id) ?? 0) + 1);
  for (const comment of comments) {
    if (!comment.removed) {
      commentCount.set(comment.post_id, (commentCount.get(comment.post_id) ?? 0) + 1);
    }
  }
  return { likes: likeCount, comments: commentCount };
}

export type { User };
