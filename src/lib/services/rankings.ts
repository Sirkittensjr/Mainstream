import 'server-only';
import { cache } from 'react';
import { db } from '@/lib/db';
import { MIN_VOTES_FOR_RANKING, type Trend } from '@/lib/ratings';
import type { Category, ID, PublicUser } from '@/lib/types';
import { ratingsIndex } from './ratings';
import { toPublicUser } from './users';

export type RankBoard = 'overall' | 'recent';

export const RANK_BOARDS: { key: RankBoard; label: string; blurb: string }[] = [
  {
    key: 'overall',
    label: 'Overall',
    blurb: 'Long-term ratings, weighted by how many people have actually rated.',
  },
  {
    key: 'recent',
    label: 'Last 30 days',
    blurb: 'How the community has rated people over the past month.',
  },
];

export interface RankedUser {
  rank: number;
  user: PublicUser;
  overall: number;
  overallVotes: number;
  recent: number;
  recentVotes: number;
  trend: Trend;
  followers: number;
  category: Category | null;
  /** The rating shown for the board being viewed. */
  rating: number;
  votes: number;
}

interface Candidate {
  user: PublicUser;
  overall: number;
  overallVotes: number;
  recent: number;
  recentVotes: number;
  trend: Trend;
  overallScore: number;
  recentScore: number;
  rankable: boolean;
  followers: number;
  category: Category | null;
}

/**
 * Everyone eligible for a ranking, scored on both boards.
 *
 * Ordering is by the confidence-adjusted score from src/lib/ratings.ts, never
 * by follower count and never by a raw average — see that file for why.
 */
const candidates = cache(async (): Promise<Candidate[]> => {
  const store = db();
  const [users, posts, follows, index] = await Promise.all([
    store.query('users', { where: { status: 'active' } }),
    store.query('posts', { where: { removed: false } }),
    store.query('follows'),
    ratingsIndex(),
  ]);

  const followerCount = new Map<ID, number>();
  for (const follow of follows) {
    followerCount.set(follow.following_id, (followerCount.get(follow.following_id) ?? 0) + 1);
  }

  // Someone's category is whatever they actually post about, falling back to
  // the interests they picked when they joined.
  const counts = new Map<ID, Map<Category, number>>();
  for (const post of posts) {
    const map = counts.get(post.author_id) ?? new Map<Category, number>();
    map.set(post.category, (map.get(post.category) ?? 0) + 1);
    counts.set(post.author_id, map);
  }

  return users.map((user) => {
    const summary = index.users.get(user.id);
    const posted = counts.get(user.id);
    const topPosted = posted
      ? [...posted.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      : undefined;

    return {
      user: toPublicUser(user),
      overall: summary?.overall ?? 0,
      overallVotes: summary?.overallVotes ?? 0,
      recent: summary?.recent ?? 0,
      recentVotes: summary?.recentVotes ?? 0,
      trend: summary?.trend ?? 'steady',
      overallScore: summary?.overallScore ?? 0,
      recentScore: summary?.recentScore ?? 0,
      rankable: summary?.rankable ?? false,
      followers: followerCount.get(user.id) ?? 0,
      category: topPosted ?? user.interests[0] ?? null,
    };
  });
});

export interface RankingOptions {
  board: RankBoard;
  category?: Category | null;
  limit?: number;
}

export async function rankings({
  board,
  category = null,
  limit = 50,
}: RankingOptions): Promise<RankedUser[]> {
  const list = (await candidates())
    // The vote floor is the guarantee that six votes cannot reach the top.
    .filter((entry) => entry.rankable)
    .filter((entry) => (category ? entry.category === category : true))
    .sort((a, b) =>
      board === 'overall' ? b.overallScore - a.overallScore : b.recentScore - a.recentScore,
    );

  return list.slice(0, limit).map((entry, position) => ({
    rank: position + 1,
    user: entry.user,
    overall: entry.overall,
    overallVotes: entry.overallVotes,
    recent: entry.recent,
    recentVotes: entry.recentVotes,
    trend: entry.trend,
    followers: entry.followers,
    category: entry.category,
    rating: board === 'overall' ? entry.overall : entry.recent,
    votes: board === 'overall' ? entry.overallVotes : entry.recentVotes,
  }));
}

export interface UserRanks {
  overall: number | null;
  recent: number | null;
  category: Category | null;
  categoryRank: number | null;
  total: number;
  /** How many more ratings are needed before this person appears at all. */
  votesNeeded: number;
}

/** The ranks shown on a profile. */
export async function userRanks(userId: ID): Promise<UserRanks> {
  const list = await candidates();
  const me = list.find((entry) => entry.user.id === userId);
  const ranked = list.filter((entry) => entry.rankable);

  const place = (board: RankBoard, pool: Candidate[]) => {
    if (!me?.rankable) return null;
    const index = [...pool]
      .sort((a, b) =>
        board === 'overall' ? b.overallScore - a.overallScore : b.recentScore - a.recentScore,
      )
      .findIndex((entry) => entry.user.id === userId);
    return index === -1 ? null : index + 1;
  };

  const categoryPool = me?.category
    ? ranked.filter((entry) => entry.category === me.category)
    : [];

  return {
    overall: place('overall', ranked),
    recent: place('recent', ranked),
    category: me?.category ?? null,
    categoryRank: me?.category ? place('overall', categoryPool) : null,
    total: ranked.length,
    votesNeeded: me ? Math.max(0, Math.ceil(MIN_VOTES_FOR_RANKING - me.overallVotes)) : MIN_VOTES_FOR_RANKING,
  };
}

/** Categories that actually have ranked people in them, most populated first. */
export async function rankedCategories(): Promise<{ category: Category; people: number }[]> {
  const list = (await candidates()).filter((entry) => entry.rankable && entry.category);
  const counts = new Map<Category, number>();
  for (const entry of list) {
    counts.set(entry.category as Category, (counts.get(entry.category as Category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, people]) => ({ category, people }))
    .sort((a, b) => b.people - a.people);
}
