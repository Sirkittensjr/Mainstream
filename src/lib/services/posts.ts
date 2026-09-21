import 'server-only';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { levelFor } from '@/lib/progression';
import type {
  Category,
  Challenge,
  ID,
  Media,
  Post,
  PublicUser,
  User,
} from '@/lib/types';
import { shotProgress, shouldAdvance, type ShotProgress } from '@/lib/shot';
import { award } from './points';
import { notify, notifyMentions } from './notifications';
import { myRatingsForPosts, ratingsIndex, type PostRatingSummary } from './ratings';
import { followingIds, hiddenUserIds, toPublicUser } from './users';

export interface PostView {
  post: Post;
  author: PublicUser;
  authorFollowers: number;
  authorLevel: { level: number; name: string };
  likes: number;
  comments: number;
  liked: boolean;
  following: boolean;
  challenge: Pick<Challenge, 'id' | 'slug' | 'title'> | null;
  /** Community rating for this post, plus the reactions behind it. */
  rating: PostRatingSummary;
  /** What the viewer rated it, if they have. */
  myScore: number | null;
  /** Staged exposure progress for "Give me a shot" posts. */
  shot: ShotProgress | null;
  /** Why this post is in front of you, e.g. "Rising creator". */
  reason?: string;
}

/**
 * Loads everything the post card needs in a handful of batched queries rather
 * than one query per post.
 */
export async function hydratePosts(
  posts: Post[],
  viewerId: ID | null,
): Promise<PostView[]> {
  if (posts.length === 0) return [];
  const store = db();
  const postIds = posts.map((p) => p.id);
  const authorIds = [...new Set(posts.map((p) => p.author_id))];
  const challengeIds = [...new Set(posts.map((p) => p.challenge_id).filter(Boolean))] as ID[];

  const [authors, likes, comments, follows, challenges, viewerFollowing, index, mine] =
    await Promise.all([
      store.query('users', { in: { id: authorIds } }),
      store.query('likes', { in: { post_id: postIds } }),
      store.query('comments', { in: { post_id: postIds } }),
      store.query('follows', { in: { following_id: authorIds } }),
      challengeIds.length ? store.query('challenges', { in: { id: challengeIds } }) : [],
      viewerId ? followingIds(viewerId) : new Set<ID>(),
      ratingsIndex(),
      myRatingsForPosts(viewerId, postIds),
    ]);

  const authorById = new Map(authors.map((a) => [a.id, a]));
  const followerCount = new Map<ID, number>(authorIds.map((id) => [id, 0]));
  for (const f of follows) followerCount.set(f.following_id, (followerCount.get(f.following_id) ?? 0) + 1);

  const likeCount = new Map<ID, number>(postIds.map((id) => [id, 0]));
  const likedByViewer = new Set<ID>();
  for (const like of likes) {
    likeCount.set(like.post_id, (likeCount.get(like.post_id) ?? 0) + 1);
    if (viewerId && like.user_id === viewerId) likedByViewer.add(like.post_id);
  }

  const commentCount = new Map<ID, number>(postIds.map((id) => [id, 0]));
  for (const comment of comments) {
    if (comment.removed) continue;
    commentCount.set(comment.post_id, (commentCount.get(comment.post_id) ?? 0) + 1);
  }

  const challengeById = new Map(challenges.map((c) => [c.id, c]));

  return posts
    .map((post) => {
      const author = authorById.get(post.author_id);
      if (!author) return null;
      const challenge = post.challenge_id ? challengeById.get(post.challenge_id) : null;
      const level = levelFor(author.points);
      const rating = index.posts.get(post.id) ?? { rating: null, count: 0, reactions: [] };
      const likeTotal = likeCount.get(post.id) ?? 0;
      const commentTotal = commentCount.get(post.id) ?? 0;
      const reach = Math.max(post.impressions, post.views, 1);
      return {
        post,
        author: toPublicUser(author),
        authorFollowers: followerCount.get(author.id) ?? 0,
        authorLevel: { level: level.level, name: level.name },
        likes: likeTotal,
        comments: commentTotal,
        liked: likedByViewer.has(post.id),
        following: viewerFollowing.has(author.id),
        challenge: challenge
          ? { id: challenge.id, slug: challenge.slug, title: challenge.title }
          : null,
        rating,
        myScore: mine.get(post.id) ?? null,
        shot: shotProgress(post, rating.rating, (likeTotal + commentTotal * 2) / reach),
      } satisfies PostView;
    })
    .filter((view): view is PostView => view !== null);
}

/** All visible posts, with blocked users and removed content filtered out. */
export async function visiblePosts(viewerId: ID | null): Promise<Post[]> {
  const store = db();
  const [posts, hidden, suspended] = await Promise.all([
    store.query('posts', { where: { removed: false }, orderBy: 'created_at', desc: true }),
    hiddenUserIds(viewerId),
    suspendedUserIds(),
  ]);
  return posts.filter((post) => !hidden.has(post.author_id) && !suspended.has(post.author_id));
}

async function suspendedUserIds(): Promise<Set<ID>> {
  const users = await db().query('users');
  return new Set(users.filter((u) => u.status !== 'active').map((u) => u.id));
}

export interface CreatePostInput {
  authorId: ID;
  caption: string;
  media: Media[];
  category: Category;
  tags: string[];
  challengeId: ID | null;
  shot: boolean;
}

export async function createPost(input: CreatePostInput): Promise<Post> {
  const store = db();
  const post: Post = {
    id: newId(),
    author_id: input.authorId,
    caption: input.caption.trim(),
    media: input.media,
    category: input.category,
    tags: input.tags.map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean).slice(0, 8),
    challenge_id: input.challengeId,
    shot: input.shot,
    shot_stage: 0,
    impressions: 0,
    boosted: false,
    views: 0,
    featured: false,
    featured_at: null,
    removed: false,
    removed_reason: null,
    created_at: new Date().toISOString(),
  };
  await store.insert('posts', post);
  await award(input.authorId, 'post', { postId: post.id });

  if (input.challengeId) {
    await award(input.authorId, 'challenge_entry', {
      postId: post.id,
      challengeId: input.challengeId,
    });
  }

  const author = await store.get('users', input.authorId);
  await notifyMentions(
    post.caption,
    input.authorId,
    `@${author?.username ?? 'someone'} mentioned you in a post`,
    post.id,
  );

  // Tell followers' timelines nothing extra — the feed reads posts directly —
  // but let the author's followers know when it is a challenge entry.
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
  const [likes, comments] = await Promise.all([
    store.query('likes', { where: { post_id: postId } }),
    store.query('comments', { where: { post_id: postId } }),
  ]);
  await Promise.all([
    ...likes.map((like) => store.remove('likes', like.id)),
    ...comments.map((comment) => store.remove('comments', comment.id)),
  ]);
  return true;
}

export async function toggleLike(postId: ID, userId: ID): Promise<{ liked: boolean }> {
  const store = db();
  const existing = await store.query('likes', { where: { post_id: postId, user_id: userId } });
  const post = await store.get('posts', postId);
  if (!post) return { liked: false };

  if (existing.length > 0) {
    for (const like of existing) await store.remove('likes', like.id);
    await award(post.author_id, 'like_received', { postId, points: -2 });
    return { liked: false };
  }

  await store.insert('likes', {
    id: newId(),
    post_id: postId,
    user_id: userId,
    created_at: new Date().toISOString(),
  });
  await award(post.author_id, 'like_received', { postId });
  await award(userId, 'like_given', { postId });
  const actor = await store.get('users', userId);
  await notify({
    userId: post.author_id,
    type: post.challenge_id ? 'challenge_entry' : 'like',
    actorId: userId,
    postId,
    body: post.challenge_id
      ? `@${actor?.username ?? 'someone'} liked your challenge entry`
      : `@${actor?.username ?? 'someone'} liked your post`,
  });
  return { liked: true };
}

export async function addComment(postId: ID, userId: ID, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const store = db();
  const post = await store.get('posts', postId);
  if (!post) return;
  await store.insert('comments', {
    id: newId(),
    post_id: postId,
    user_id: userId,
    body: trimmed.slice(0, 600),
    removed: false,
    created_at: new Date().toISOString(),
  });
  await award(post.author_id, 'comment_received', { postId });
  await award(userId, 'comment_given', { postId });
  const actor = await store.get('users', userId);
  await notify({
    userId: post.author_id,
    type: post.challenge_id ? 'challenge_entry' : 'comment',
    actorId: userId,
    postId,
    body: post.challenge_id
      ? `@${actor?.username ?? 'someone'} commented on your challenge entry`
      : `@${actor?.username ?? 'someone'} commented on your post`,
  });
  await notifyMentions(
    trimmed,
    userId,
    `@${actor?.username ?? 'someone'} mentioned you in a comment`,
    postId,
  );
}

export async function deleteComment(commentId: ID, userId: ID): Promise<void> {
  const store = db();
  const comment = await store.get('comments', commentId);
  if (!comment) return;
  const post = await store.get('posts', comment.post_id);
  const canDelete = comment.user_id === userId || post?.author_id === userId;
  if (!canDelete) return;
  await store.remove('comments', commentId);
}

export interface CommentView {
  comment: { id: ID; body: string; created_at: string };
  author: PublicUser;
  mine: boolean;
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
  return visible
    .map((comment) => {
      const author = byId.get(comment.user_id);
      if (!author) return null;
      return {
        comment: { id: comment.id, body: comment.body, created_at: comment.created_at },
        author: toPublicUser(author),
        mine: viewerId === comment.user_id,
      } satisfies CommentView;
    })
    .filter((c): c is CommentView => c !== null);
}

/**
 * Records that discovery put these posts in front of someone.
 *
 * This is what makes "Give me a shot" real: exposure is metered, and a post
 * only graduates to a larger slice of the audience when the response to the
 * slice it already had was good enough.
 */
export async function recordShotImpressions(views: PostView[]): Promise<void> {
  const store = db();
  const shots = views.filter((view) => view.post.shot).slice(0, 8);
  await Promise.all(
    shots.map(async (view) => {
      const impressions = view.post.impressions + 1;
      const reach = Math.max(impressions, view.post.views, 1);
      const rate = (view.likes + view.comments * 2) / reach;
      const patch: { impressions: number; shot_stage?: number } = { impressions };
      if (
        shouldAdvance({ shot_stage: view.post.shot_stage, impressions }, view.rating.rating, rate)
      ) {
        patch.shot_stage = view.post.shot_stage + 1;
      }
      await store.update('posts', view.post.id, patch);
    }),
  );
}

/** Counted once per opened post detail page. */
export async function registerView(postId: ID, viewerId: ID | null): Promise<void> {
  const store = db();
  const post = await store.get('posts', postId);
  if (!post || post.author_id === viewerId) return;
  await store.update('posts', postId, { views: post.views + 1 });
}

export async function postsByAuthor(authorId: ID): Promise<Post[]> {
  const posts = await db().query('posts', {
    where: { author_id: authorId, removed: false },
    orderBy: 'created_at',
    desc: true,
  });
  return posts;
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
