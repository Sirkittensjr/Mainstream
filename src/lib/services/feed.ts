import 'server-only';
import { db } from '@/lib/db';
import { DAY } from '@/lib/time';
import type { Category, ID, Post, User } from '@/lib/types';
import { engagementFor, hydratePosts, visiblePosts, type PostView } from './posts';
import { interleave, risingScore, shotRotation, trendingScore } from './ranking';
import { followerCounts, followingIds } from './users';

const CATEGORY_FOR_INTEREST: Record<string, Category> = {
  Creator: 'Other',
  Musician: 'Music',
  Gamer: 'Gaming',
  Athlete: 'Sports',
  Artist: 'Art',
  Entrepreneur: 'Business',
  Comedian: 'Comedy',
  Actor: 'Other',
  Photographer: 'Photography',
  Fashion: 'Fashion',
  Food: 'Food',
  Fitness: 'Fitness',
  Education: 'Education',
  Other: 'Other',
};

export function interestCategories(user: Pick<User, 'interests'>): Category[] {
  return [...new Set(user.interests.map((i) => CATEGORY_FOR_INTEREST[i] ?? 'Other'))];
}

/**
 * The home feed.
 *
 * Four streams — people you follow, rising creators, recommended-for-you, and
 * live challenge entries — are ranked separately and then interleaved. That
 * mix is deliberate: no matter how many people you follow, part of every
 * screen is reserved for creators you have never seen.
 */
export async function homeFeed(viewer: User | null, limit = 40): Promise<PostView[]> {
  const now = Date.now();
  const viewerId = viewer?.id ?? null;
  const posts = await visiblePosts(viewerId);
  if (posts.length === 0) return [];

  const following = viewerId ? await followingIds(viewerId) : new Set<ID>();
  const { likes, comments } = await engagementFor(posts.map((p) => p.id));
  const followers = await followerCounts([...new Set(posts.map((p) => p.author_id))]);
  const activeChallengeIds = await activeChallengeIdSet();

  const engagement = (post: Post) => ({
    likes: likes.get(post.id) ?? 0,
    comments: comments.get(post.id) ?? 0,
    views: post.views,
  });

  const mine = viewerId ? posts.filter((p) => p.author_id === viewerId) : [];
  const followed = posts
    .filter((p) => following.has(p.author_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);

  const rising = posts
    .filter((p) => !following.has(p.author_id) && p.author_id !== viewerId)
    .map((post) => ({
      post,
      score: risingScore(post, engagement(post), followers.get(post.author_id) ?? 0, now),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map((entry) => entry.post);

  const interests = viewer ? interestCategories(viewer) : [];
  const recommended = posts
    .filter(
      (p) =>
        !following.has(p.author_id) &&
        p.author_id !== viewerId &&
        (interests.length === 0 || interests.includes(p.category)),
    )
    .map((post) => ({ post, score: trendingScore(post, engagement(post), now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((entry) => entry.post);

  const challengeEntries = posts
    .filter((p) => p.challenge_id && activeChallengeIds.has(p.challenge_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10);

  const shots = shotRotation(
    posts.filter((p) => p.shot && p.author_id !== viewerId && !following.has(p.author_id)),
    now,
    6,
  );

  const freshMine = mine.filter((p) => now - new Date(p.created_at).getTime() < DAY).slice(0, 2);

  const ordered = interleave(
    [freshMine, followed, rising, shots, recommended, challengeEntries],
    (post) => post.id,
  ).slice(0, limit);

  const views = await hydratePosts(ordered, viewerId);
  return views.map((view) => ({
    ...view,
    reason: reasonFor(view, {
      following,
      viewerId,
      risingIds: new Set(rising.map((p) => p.id)),
      shotIds: new Set(shots.map((p) => p.id)),
      challengeIds: new Set(challengeEntries.map((p) => p.id)),
    }),
  }));
}

function reasonFor(
  view: PostView,
  ctx: {
    following: Set<ID>;
    viewerId: ID | null;
    risingIds: Set<ID>;
    shotIds: Set<ID>;
    challengeIds: Set<ID>;
  },
): string | undefined {
  if (view.post.author_id === ctx.viewerId) return 'Your post';
  if (ctx.shotIds.has(view.post.id)) return 'Give me a shot';
  if (ctx.following.has(view.post.author_id)) return undefined;
  if (ctx.risingIds.has(view.post.id)) return 'Rising creator';
  if (ctx.challengeIds.has(view.post.id)) return 'Challenge entry';
  return 'Recommended for you';
}

export async function activeChallengeIdSet(): Promise<Set<ID>> {
  const nowIso = new Date().toISOString();
  const challenges = await db().query('challenges');
  return new Set(
    challenges.filter((c) => c.starts_at <= nowIso && c.ends_at >= nowIso).map((c) => c.id),
  );
}
