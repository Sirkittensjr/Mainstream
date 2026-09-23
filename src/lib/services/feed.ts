import 'server-only';
import { firstVideo } from '@/lib/media';
import type { ID, Post, User } from '@/lib/types';
import { engagementFor, hydratePosts, visiblePosts, type PostView } from './posts';
import { interleave, recommendScore } from './ranking';
import { ratingsIndex } from './ratings';
import { followerCounts, followingIds } from './users';

export type FeedTab = 'following' | 'recommended';

/** How many posts a feed page holds, and the ceiling one request will build. */
export const FEED_PAGE = 20;
export const FEED_MAX = 200;

/**
 * How many videos one visit to /videos builds.
 *
 * A vertical feed is scrolled far faster than a page of cards, so it is worth
 * ranking more of them up front — only the clips around the one on screen are
 * ever fetched, so the cost of a longer queue is a little JSON, not bandwidth.
 */
export const VIDEO_PAGE = 30;

export interface FeedPage {
  posts: PostView[];
  /** True when there is at least one more post past what was returned. */
  hasMore: boolean;
}

/**
 * Posts from the people you follow, newest first. No ranking, no mixing —
 * following should be predictable.
 */
export async function followingFeed(viewer: User, limit = FEED_PAGE): Promise<FeedPage> {
  const [posts, following] = await Promise.all([
    visiblePosts(viewer.id),
    followingIds(viewer.id),
  ]);
  const mine = posts.filter(
    (post) => following.has(post.author_id) || post.author_id === viewer.id,
  );
  return {
    posts: await hydratePosts(mine.slice(0, limit), viewer.id),
    hasMore: mine.length > limit,
  };
}

/**
 * Recommended: good posts you would not otherwise see.
 *
 * Ranked on engagement relative to the author's existing audience, community
 * rating, freshness and whether it matches what you are into. Follower count
 * only ever appears as a denominator, so a big account gets no free ride.
 */
export async function recommendedFeed(
  viewer: User | null,
  limit = FEED_PAGE,
): Promise<FeedPage> {
  const now = Date.now();
  const viewerId = viewer?.id ?? null;
  const posts = await visiblePosts(viewerId);
  if (posts.length === 0) return { posts: [], hasMore: false };

  const following = viewerId ? await followingIds(viewerId) : new Set<ID>();
  const { likes, comments } = await engagementFor(posts.map((p) => p.id));
  const followers = await followerCounts([...new Set(posts.map((p) => p.author_id))]);
  const index = await ratingsIndex();
  const interests = new Set(viewer?.interests ?? []);

  const score = (post: Post) =>
    recommendScore(
      post,
      {
        likes: likes.get(post.id) ?? 0,
        comments: comments.get(post.id) ?? 0,
        views: post.views,
      },
      followers.get(post.author_id) ?? 0,
      now,
      index.posts.get(post.id)?.rating ?? null,
      interests.has(post.category),
    );

  const pool = posts.filter((post) => post.author_id !== viewerId);
  const ranked = [...pool].sort((a, b) => score(b) - score(a));

  // A slice of genuinely new posts is reserved so people who just joined are
  // seen by somebody on their first day.
  const fresh = [...pool]
    .filter((post) => !following.has(post.author_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8);

  const ordered = interleave([ranked.slice(0, limit), fresh], (post) => post.id).slice(0, limit);
  const views = await hydratePosts(ordered, viewerId);
  const freshIds = new Set(fresh.slice(0, 4).map((post) => post.id));

  return {
    posts: views.map((view) => ({
      ...view,
      reason: view.following
        ? undefined
        : freshIds.has(view.post.id)
          ? 'Just posted'
          : interests.has(view.post.category)
            ? `Popular in ${view.post.category}`
            : 'Recommended',
    })),
    hasMore: pool.length > limit,
  };
}

/**
 * The Videos feed: the same recommendation as Recommended, narrowed to posts
 * that lead with a clip.
 *
 * Deliberately not a second ranking engine. It reads the same visible posts,
 * the same engagement, the same community ratings and the same follower
 * counts, and scores them with the same recommendScore — so a video does not
 * live by different rules here than it does in the feed, and improving the
 * ranking improves both. The only thing that differs is the pool.
 *
 * `startId` is how a link to one video opens the feed on it: that post leads,
 * the ranking fills in behind it.
 */
export async function videoFeed(
  viewer: User | null,
  limit = VIDEO_PAGE,
  startId: ID | null = null,
): Promise<FeedPage> {
  const now = Date.now();
  const viewerId = viewer?.id ?? null;
  const posts = (await visiblePosts(viewerId)).filter((post) => firstVideo(post.media) !== null);
  if (posts.length === 0) return { posts: [], hasMore: false };

  const following = viewerId ? await followingIds(viewerId) : new Set<ID>();
  const { likes, comments } = await engagementFor(posts.map((p) => p.id));
  const followers = await followerCounts([...new Set(posts.map((p) => p.author_id))]);
  const index = await ratingsIndex();
  const interests = new Set(viewer?.interests ?? []);

  const score = (post: Post) =>
    recommendScore(
      post,
      {
        likes: likes.get(post.id) ?? 0,
        comments: comments.get(post.id) ?? 0,
        views: post.views,
      },
      followers.get(post.author_id) ?? 0,
      now,
      index.posts.get(post.id)?.rating ?? null,
      interests.has(post.category),
    );

  // Opening a link to your own video has to work, even though the feed does
  // not otherwise recommend you back to yourself.
  const opened = startId ? (posts.find((post) => post.id === startId) ?? null) : null;
  const pool = posts.filter((post) => post.author_id !== viewerId && post.id !== opened?.id);
  const ranked = [...pool].sort((a, b) => score(b) - score(a));

  // The same reserved slice of brand-new posts the Recommended feed keeps, so
  // a clip nobody has watched yet still reaches somebody. Without this a
  // ranking built on engagement can only ever show what already has some.
  const fresh = [...pool]
    .filter((post) => !following.has(post.author_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8);

  const room = opened ? limit - 1 : limit;
  const ordered = interleave([ranked.slice(0, room), fresh], (post) => post.id).slice(0, room);
  const views = await hydratePosts(opened ? [opened, ...ordered] : ordered, viewerId);
  const freshIds = new Set(fresh.slice(0, 4).map((post) => post.id));

  return {
    posts: views.map((view) => ({
      ...view,
      reason:
        view.post.id === opened?.id || view.following
          ? undefined
          : freshIds.has(view.post.id)
            ? 'Just posted'
            : interests.has(view.post.category)
              ? `Popular in ${view.post.category}`
              : 'Recommended',
    })),
    hasMore: pool.length > room,
  };
}
