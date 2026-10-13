import 'server-only';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import type { TextKind } from '@/lib/text-posts';
import { record as recordModeration, underReview } from './auto-review';
import { countUniqueReporters } from '@/lib/auto-review-rules';
import { effectiveStatus } from '@/lib/moderation-rules';
import { releasePostMedia, type MediaRelease } from '@/lib/media/cleanup';
import { isMissingRelation } from '@/lib/db/errors';
import type { Row } from '@/lib/db/types';
import { insertPost, type InsertMemo } from './insert-post';
import { indexPost } from './hashtag-index';
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

  const [authors, likes, comments, followerCount, viewerFollowing, index, mine, current] =
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
      // The rows themselves, read now. The posts handed in usually come from
      // the shared community cache, which is up to a minute old — fine for what
      // a post IS, wrong for its counters: a video watched a moment ago would
      // come back after a refresh showing the count from before it was watched.
      store.query('posts', { in: { id: postIds } }),
    ]);

  const authorById = new Map(authors.map((a) => [a.id, a]));
  const counters = new Map(current.map((row) => [row.id, row]));

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
      const now = counters.get(post.id);
      return {
        post: now
          ? { ...post, views: now.views, video_views: now.video_views ?? post.video_views }
          : post,
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
    // A temporary suspension whose time is up counts as active from that
    // moment, whether or not anything has written that down yet.
    inactive: users.filter((user) => effectiveStatus(user) !== 'active').map((user) => user.id),
  };
});

/**
 * Whether a post belongs in a public list, given whose posts are not shown.
 *
 * The one rule every list applies — the feeds, search, hashtag pages: not
 * removed, not hidden while it is reviewed, not by an account that is not
 * active, and not by anybody the viewer has blocked or been blocked by.
 */
export function shownIn(hidden: ReadonlySet<ID>, inactive: ReadonlySet<ID>) {
  return (post: Post): boolean =>
    !post.removed &&
    !hidden.has(post.author_id) &&
    !inactive.has(post.author_id) &&
    // Temporarily hidden while it is reviewed. Not removed — it comes back
    // on its own if nobody looks at it within 24 hours.
    !underReview(post);
}

/** All visible posts, with blocked and suspended accounts filtered out. */
export async function visiblePosts(viewerId: ID | null): Promise<Post[]> {
  const [{ posts, inactive }, hidden] = await Promise.all([
    publicPosts(),
    hiddenUserIds(viewerId),
  ]);
  return posts.filter(shownIn(hidden, new Set(inactive)));
}

/** How many ids go into one `in (…)`, so the request stays a sensible size. */
const ID_CHUNK = 100;

/**
 * The posts among these ids that `viewerId` would see in a list, newest first.
 *
 * The same rule as `visiblePosts`, read for a known set of posts — a page of a
 * hashtag's index, say — rather than for everything.
 */
export async function visibleAmong(ids: readonly ID[], viewerId: ID | null): Promise<Post[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const store = db();
  const chunks: ID[][] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) chunks.push(unique.slice(i, i + ID_CHUNK));
  const [rows, hidden] = await Promise.all([
    Promise.all(
      chunks.map((chunk) => store.query('posts', { where: { removed: false }, in: { id: chunk } })),
    ).then((pages) => pages.flat()),
    hiddenUserIds(viewerId),
  ]);
  const authorIds = [...new Set(rows.map((post) => post.author_id))];
  const authors = (
    await Promise.all(
      Array.from({ length: Math.ceil(authorIds.length / ID_CHUNK) }, (_, i) =>
        store.query('users', { in: { id: authorIds.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK) } }),
      ),
    )
  ).flat();
  const inactive = new Set(
    authors.filter((user) => effectiveStatus(user) !== 'active').map((user) => user.id),
  );
  const known = new Set(authors.map((user) => user.id));
  return rows
    .filter((post) => known.has(post.author_id))
    .filter(shownIn(hidden, inactive))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
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
  // Published, so its hashtags exist now — and not a moment before: nothing
  // is filed under a hashtag while it is still being typed. A failure here
  // costs the hashtag pages this post, never the post itself.
  await indexPost(post).catch((error) => {
    console.error('[faytarra] a post could not be filed under its hashtags', error);
  });
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
export type DeleteRefusal = 'not_found' | 'not_yours' | 'moderated' | 'under_review';

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
 *   likes, comments (replies too), notifications, video views and its place
 *     on every hashtag page — deleted.
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
  // Hidden while a moderator reviews it: the post and its files are what the
  // report is about, so they stay until the review is decided. Once approved
  // it is the author's to delete again.
  if (underReview(post)) return { ok: false, reason: 'under_review' };

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
    // Off every hashtag page. Supabase cascades this from the foreign key too.
    dropWhere('post_hashtags', { post_id: postId }),
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
async function dropWhere<
  T extends 'likes' | 'comments' | 'notifications' | 'video_views' | 'ratings' | 'post_hashtags',
>(
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
  // been removed or is hidden for review, or between two people where either
  // has blocked the other. The UI never offers it, but a request does not have
  // to come from the UI.
  if (post.removed || underReview(post) || (await isBlockedEitherWay(userId, post.author_id))) {
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
): Promise<{ ok: true; id: ID } | { ok: false; error: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'Write something first.' };
  const store = db();
  const post = await store.get('posts', postId);
  if (!post || post.removed) return { ok: false, error: 'That post is no longer available.' };
  // Hidden while moderation looks at it: nobody adds to it in the meantime.
  if (underReview(post)) return { ok: false, error: 'This post is being reviewed, so it cannot take comments right now.' };
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

  const id = newId();
  await store.insert('comments', {
    id,
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
  return { ok: true, id };
}

/**
 * Who may delete a comment: whoever wrote it, and whoever owns the post it is
 * on — their photo, their video, their words. Nobody else, however visible the
 * post is to them. The one rule both the comment lists (to decide whether to
 * offer Delete) and `deleteComment` (to decide whether to do it) read.
 */
export function canDeleteComment(
  comment: { user_id: ID },
  post: { author_id: ID } | null | undefined,
  userId: ID | null | undefined,
): boolean {
  if (!userId) return false;
  return comment.user_id === userId || post?.author_id === userId;
}

export type DeleteCommentRefusal = 'not_found' | 'not_allowed' | 'moderated';

export type DeleteCommentResult =
  | { ok: true; postId: ID; removed: number }
  | { ok: false; reason: DeleteCommentRefusal };

/**
 * Deletes a comment, if this person may.
 *
 * Decided here from the stored comment and post, never from anything a
 * request says about them: the comment id is the only input, the post is the
 * one the comment really belongs to, and a forged post id changes nothing.
 *
 * A comment with replies takes them with it. That is what the database's
 * `parent_id … on delete cascade` does in production; doing it here as well
 * means every driver agrees and nothing is left replying to a comment that is
 * gone. A comment a moderator removed stays on record, like a moderated post.
 */
export async function deleteComment(commentId: ID, userId: ID): Promise<DeleteCommentResult> {
  if (typeof commentId !== 'string' || !commentId || typeof userId !== 'string' || !userId) {
    return { ok: false, reason: 'not_found' };
  }
  const store = db();
  const comment = await store.get('comments', commentId);
  if (!comment) return { ok: false, reason: 'not_found' };
  const post = await store.get('posts', comment.post_id);
  if (!canDeleteComment(comment, post, userId)) return { ok: false, reason: 'not_allowed' };
  if (comment.removed) return { ok: false, reason: 'moderated' };

  const replies = await store.query('comments', { where: { parent_id: comment.id } });
  for (const reply of replies) await store.remove('comments', reply.id);
  await store.remove('comments', comment.id);
  return {
    ok: true,
    postId: comment.post_id,
    // What disappears from view: the comment and its replies still showing.
    removed: 1 + replies.filter((reply) => !reply.removed).length,
  };
}

export interface CommentView {
  comment: { id: ID; body: string; created_at: string; parent_id: ID | null };
  author: PublicUser;
  mine: boolean;
  /** The viewer wrote it, or owns the post it is on. */
  canDelete: boolean;
  /** Replies to this comment, oldest first. Only top-level comments carry them. */
  replies: CommentView[];
}

export async function listComments(postId: ID, viewerId: ID | null): Promise<CommentView[]> {
  const store = db();
  const [comments, hidden, post] = await Promise.all([
    store.query('comments', { where: { post_id: postId, removed: false }, orderBy: 'created_at' }),
    hiddenUserIds(viewerId),
    store.get('posts', postId),
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
      canDelete: canDeleteComment(comment, post, viewerId),
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
