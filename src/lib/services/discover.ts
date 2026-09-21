import 'server-only';
import { DAY } from '@/lib/time';
import { levelFor } from '@/lib/progression';
import type { Category, ID, Post, PublicUser, User } from '@/lib/types';
import { db } from '@/lib/db';
import { isResting } from '@/lib/shot';
import {
  engagementFor,
  hydratePosts,
  recordShotImpressions,
  visiblePosts,
  type PostView,
} from './posts';
import { ratingsIndex } from './ratings';
import type { Trend } from '@/lib/ratings';
import { risingScore, shotRotation, trendingScore } from './ranking';
import { followerCounts, hiddenUserIds, toPublicUser } from './users';

export interface DiscoverFeeds {
  rising: PostView[];
  trending: PostView[];
  fresh: PostView[];
  shots: PostView[];
  risingCreators: CreatorCard[];
}

export interface CreatorCard {
  user: PublicUser;
  followers: number;
  level: number;
  levelName: string;
  weeklyPoints: number;
  topCategory: Category | null;
  rating: number | null;
  current: number | null;
  trend: Trend;
}

interface DiscoverOptions {
  category?: Category | null;
  viewer?: User | null;
  perSection?: number;
}

export async function discover(options: DiscoverOptions = {}): Promise<DiscoverFeeds> {
  const { category = null, viewer = null, perSection = 12 } = options;
  const now = Date.now();
  const viewerId = viewer?.id ?? null;
  let posts = await visiblePosts(viewerId);
  if (category) posts = posts.filter((post) => post.category === category);

  const { likes, comments } = await engagementFor(posts.map((p) => p.id));
  const followers = await followerCounts([...new Set(posts.map((p) => p.author_id))]);
  const index = await ratingsIndex();
  const engagement = (post: Post) => ({
    likes: likes.get(post.id) ?? 0,
    comments: comments.get(post.id) ?? 0,
    views: post.views,
  });
  const ratingOf = (post: Post) => index.posts.get(post.id)?.rating ?? null;
  const engagementRate = (post: Post) => {
    const e = engagement(post);
    return (e.likes + e.comments * 2) / Math.max(post.impressions, post.views, 1);
  };

  // Rising deliberately excludes posts from creators with a big audience: this
  // section exists for people who are not already known.
  const risingPool = posts.filter((post) => (followers.get(post.author_id) ?? 0) < 2_000);
  const rising = rank(risingPool, (post) =>
    risingScore(post, engagement(post), followers.get(post.author_id) ?? 0, now, ratingOf(post)),
  ).slice(0, perSection);

  const trending = rank(posts, (post) =>
    trendingScore(post, engagement(post), now, ratingOf(post)),
  ).slice(0, perSection);

  const fresh = [...posts]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, perSection);

  // A shot post that has used up its slice without earning the next one rests,
  // so the rotation keeps moving to creators who have not had their turn yet.
  const shots = shotRotation(
    posts.filter((post) => post.shot && !isResting(post, ratingOf(post), engagementRate(post))),
    now,
    perSection,
  );

  const [risingViews, trendingViews, freshViews, shotViews, risingCreators] = await Promise.all([
    hydratePosts(rising, viewerId),
    hydratePosts(trending, viewerId),
    hydratePosts(fresh, viewerId),
    hydratePosts(shots, viewerId),
    risingCreatorCards(viewerId, category, perSection),
  ]);

  await recordShotImpressions(shotViews);

  return {
    rising: risingViews.map((v) => ({ ...v, reason: 'Rising' })),
    trending: trendingViews,
    fresh: freshViews.map((v) => ({ ...v, reason: 'New' })),
    shots: shotViews.map((v) => ({ ...v, reason: 'Give me a shot' })),
    risingCreators,
  };
}

function rank(posts: Post[], score: (post: Post) => number): Post[] {
  return posts
    .map((post) => ({ post, score: score(post) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.post);
}

/**
 * Creators to follow. Ranked by points earned in the last week rather than
 * total followers, so a consistent newcomer can outrank a dormant big account.
 */
export async function risingCreatorCards(
  viewerId: ID | null,
  category: Category | null = null,
  limit = 12,
): Promise<CreatorCard[]> {
  const store = db();
  const [users, activity, hidden, index] = await Promise.all([
    store.query('users', { where: { status: 'active' } }),
    store.query('activity'),
    hiddenUserIds(viewerId),
    ratingsIndex(),
  ]);
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const weekly = new Map<ID, number>();
  for (const entry of activity) {
    if (entry.created_at < weekAgo || entry.points <= 0) continue;
    weekly.set(entry.user_id, (weekly.get(entry.user_id) ?? 0) + entry.points);
  }

  const posts = await store.query('posts', { where: { removed: false } });
  const categoryByUser = new Map<ID, Category>();
  const counts = new Map<ID, Map<Category, number>>();
  for (const post of posts) {
    const map = counts.get(post.author_id) ?? new Map<Category, number>();
    map.set(post.category, (map.get(post.category) ?? 0) + 1);
    counts.set(post.author_id, map);
  }
  for (const [userId, map] of counts) {
    const top = [...map.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) categoryByUser.set(userId, top[0]);
  }

  const candidates = users.filter((user) => {
    if (user.id === viewerId || hidden.has(user.id)) return false;
    if (category && categoryByUser.get(user.id) !== category) return false;
    return true;
  });
  const followers = await followerCounts(candidates.map((u) => u.id));

  return candidates
    .map((user) => {
      const followerCount = followers.get(user.id) ?? 0;
      const weeklyPoints = weekly.get(user.id) ?? 0;
      // Smaller accounts get lifted; momentum matters more than size.
      const score = weeklyPoints / Math.sqrt(followerCount + 8);
      const level = levelFor(user.points);
      const summary = index.users.get(user.id);
      return {
        score,
        card: {
          user: toPublicUser(user),
          followers: followerCount,
          level: level.level,
          levelName: level.name,
          weeklyPoints,
          topCategory: categoryByUser.get(user.id) ?? null,
          rating: summary && summary.ratingsReceived > 0 ? summary.overall : null,
          current: summary && summary.ratingsReceived > 0 ? summary.current : null,
          trend: summary?.trend ?? 'steady',
        } satisfies CreatorCard,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.card);
}

export async function categoryCounts(): Promise<{ category: Category; posts: number }[]> {
  const posts = await db().query('posts', { where: { removed: false } });
  const counts = new Map<Category, number>();
  for (const post of posts) counts.set(post.category, (counts.get(post.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([category, count]) => ({ category, posts: count }))
    .sort((a, b) => b.posts - a.posts);
}
