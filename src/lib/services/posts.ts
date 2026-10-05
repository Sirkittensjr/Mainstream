import 'server-only';
import { cookies } from 'next/headers';
import { db, isMissingColumn } from '@/lib/db';
import type { TextKind } from '@/lib/text-posts';
import { underReview } from './auto-review';
import { communityCache, refreshCommunity } from './community-cache';
import { newId } from '@/lib/ids';
import type { Category, ID, Media, Post, PublicUser, User } from '@/lib/types';
import { notify, notifyMentions } from './notifications';
import { myRatingsForPosts, ratingsIndex, type PostRatingSummary } from './ratings';
import { followerCounts, followingIds, hiddenUserIds, toPublicUser } from './users';

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
let warningsStored: boolean | null = null;

/**
 * Whether this database has the text-post columns.
 *
 * Same reasoning as `warningsStored` above, and the same shape: a deployment
 * that has not run migration 0011 has no `text_kind`, and sending it would fail
 * the whole insert — which would mean nobody could post anything at all over
 * which bubble it is. The first insert that meets the missing column drops both
 * columns and tries again. The post still arrives, with its words in `caption`,
 * and is drawn as a short message until the migration is run.
 */
let textKindsStored: boolean | null = null;

/** The same again for `text_style`, which arrived one migration later. */
let stylesStored: boolean | null = null;

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
    text_kind: input.textKind ?? null,
    text_title: input.textTitle ?? null,
    text_style: input.textStyle ?? null,
    removed: false,
    removed_reason: null,
    created_at: new Date().toISOString(),
  };

  if (warningsStored === false) delete post.content_warning;
  if (textKindsStored === false) {
    delete post.text_kind;
    delete post.text_title;
    delete post.text_style;
  }
  if (stylesStored === false) delete post.text_style;
  try {
    await store.insert('posts', post);
    warningsStored ??= true;
    textKindsStored ??= true;
    stylesStored ??= true;
  } catch (error) {
    if (isMissingColumn(error, 'posts', 'text_kind')) {
      textKindsStored = false;
      console.error(
        '[faytarra] Text post kinds are switched off: this database has no `text_kind` column ' +
          'on `posts`. Run supabase/migrations/0011_text_posts.sql against it. Posting works as ' +
          'normal; every text post is drawn as a short message until then.',
      );
      delete post.text_kind;
      delete post.text_title;
      delete post.text_style;
      await store.insert('posts', post);
      return finish(post, store, input);
    }
    if (isMissingColumn(error, 'posts', 'text_style')) {
      // 0011 ran but 0012 did not: kinds work, colours do not. The big message
      // still posts and is drawn in `glow`, which is what null means anyway.
      stylesStored = false;
      delete post.text_style;
      await store.insert('posts', post);
      return finish(post, store, input);
    }
    if (!isMissingColumn(error, 'posts', 'content_warning')) throw error;
    warningsStored = false;
    console.error(
      '[faytarra] Content warnings are switched off: this database has no `content_warning` ' +
        'column on `posts`. Run supabase/migrations/0007_resumable_uploads.sql against it. ' +
        'Posting works as normal; the checkbox does nothing until then.',
    );
    delete post.content_warning;
    await store.insert('posts', post);
  }

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

export async function deletePost(postId: ID, userId: ID): Promise<boolean> {
  const store = db();
  const post = await store.get('posts', postId);
  if (!post || post.author_id !== userId) return false;
  await store.remove('posts', postId);
  const [likes, comments, ratings] = await Promise.all([
    store.query('likes', { where: { post_id: postId } }),
    store.query('comments', { where: { post_id: postId } }),
    store.query('ratings', { where: { target_type: 'post', target_id: postId } }),
  ]);
  await Promise.all([
    ...likes.map((row) => store.remove('likes', row.id)),
    ...comments.map((row) => store.remove('comments', row.id)),
    ...ratings.map((row) => store.remove('ratings', row.id)),
  ]);
  refreshCommunity();
  return true;
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

  await store.insert('likes', {
    id: newId(),
    post_id: postId,
    user_id: userId,
    created_at: new Date().toISOString(),
  });
  const actor = await store.get('users', userId);
  await notify({
    userId: post.author_id,
    type: 'like',
    actorId: userId,
    postId,
    body: `@${actor?.username ?? 'someone'} liked your post`,
  });
  return { liked: true };
}

export async function addComment(
  postId: ID,
  userId: ID,
  body: string,
  parentId: ID | null = null,
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const store = db();
  const post = await store.get('posts', postId);
  if (!post || post.removed) return;

  // Threads stay one level deep: replying to a reply joins the same thread
  // rather than starting a deeper one.
  let parent = parentId ? await store.get('comments', parentId) : null;
  if (parent && (parent.post_id !== postId || parent.removed)) parent = null;
  if (parent?.parent_id) parent = await store.get('comments', parent.parent_id);
  const resolvedParent = parent && !parent.removed ? parent : null;

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
