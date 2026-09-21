import 'server-only';
import { cache } from 'react';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { levelFor } from '@/lib/progression';
import type { Trend } from '@/lib/ratings';
import { DAY } from '@/lib/time';
import type { Category, ID, PublicUser } from '@/lib/types';
import { ratingsIndex } from './ratings';
import { toPublicUser } from './users';

export type RankBoard = 'overall' | 'current' | 'rising';
export type RankPeriod = 'today' | 'week' | 'month' | 'all';

export const RANK_BOARDS: { key: RankBoard; label: string; blurb: string }[] = [
  {
    key: 'overall',
    label: 'Overall',
    blurb: 'Long-term reputation. Slow to move, hard to fake, impossible to buy.',
  },
  {
    key: 'current',
    label: 'Current',
    blurb: 'How people are doing right now, from the last 30 days of response.',
  },
  {
    key: 'rising',
    label: 'Rising',
    blurb: 'Climbing fastest relative to the audience they already had.',
  },
];

export const RANK_PERIODS: { key: RankPeriod; label: string; days: number | null }[] = [
  { key: 'today', label: 'Today', days: 1 },
  { key: 'week', label: 'This week', days: 7 },
  { key: 'month', label: 'This month', days: 30 },
  { key: 'all', label: 'All time', days: null },
];

export interface RankedUser {
  rank: number;
  user: PublicUser;
  overall: number;
  current: number;
  trend: Trend;
  delta: number;
  followers: number;
  level: number;
  levelName: string;
  category: Category | null;
  ratings: number;
  metric: number;
  metricLabel: string;
}

interface Candidate {
  user: PublicUser;
  overall: number;
  current: number;
  trend: Trend;
  delta: number;
  followers: number;
  level: number;
  levelName: string;
  category: Category | null;
  ratings: number;
  rising: number;
  lastActivity: string;
}

/**
 * Every active account scored on all three boards.
 *
 * Ranking is explicitly not follower count. A 500-follower creator rated 9.4
 * with strong recent response outranks a 50,000-follower account rated 8.1
 * that has gone quiet — that ordering is the product.
 */
const candidates = cache(async (): Promise<Candidate[]> => {
  const store = db();
  const [users, posts, follows, activity, index] = await Promise.all([
    store.query('users', { where: { status: 'active' } }),
    store.query('posts', { where: { removed: false } }),
    store.query('follows'),
    store.query('activity'),
    ratingsIndex(),
  ]);

  const now = Date.now();
  const monthAgo = new Date(now - 30 * DAY).toISOString();
  const weekAgo = new Date(now - 7 * DAY).toISOString();

  const followerCount = new Map<ID, number>();
  const gained = new Map<ID, number>();
  for (const follow of follows) {
    followerCount.set(follow.following_id, (followerCount.get(follow.following_id) ?? 0) + 1);
    if (follow.created_at >= monthAgo) {
      gained.set(follow.following_id, (gained.get(follow.following_id) ?? 0) + 1);
    }
  }

  const categoryOf = new Map<ID, Category>();
  const counts = new Map<ID, Map<Category, number>>();
  const lastPost = new Map<ID, string>();
  for (const post of posts) {
    const map = counts.get(post.author_id) ?? new Map<Category, number>();
    map.set(post.category, (map.get(post.category) ?? 0) + 1);
    counts.set(post.author_id, map);
    const previous = lastPost.get(post.author_id);
    if (!previous || post.created_at > previous) lastPost.set(post.author_id, post.created_at);
  }
  for (const [userId, map] of counts) {
    const top = [...map.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) categoryOf.set(userId, top[0]);
  }

  const weeklyPoints = new Map<ID, number>();
  const lastActivity = new Map<ID, string>();
  for (const entry of activity) {
    if (entry.points > 0 && entry.created_at >= weekAgo) {
      weeklyPoints.set(entry.user_id, (weeklyPoints.get(entry.user_id) ?? 0) + entry.points);
    }
    const previous = lastActivity.get(entry.user_id);
    if (!previous || entry.created_at > previous) lastActivity.set(entry.user_id, entry.created_at);
  }

  return users.map((user) => {
    const summary = index.users.get(user.id);
    const followers = followerCount.get(user.id) ?? 0;
    const level = levelFor(user.points);

    // Momentum: improving against your own baseline, growing relative to the
    // audience you already had, and actually showing up.
    const rising =
      Math.max(0, (summary?.delta ?? 0) + 0.4) * 2.4 +
      ((gained.get(user.id) ?? 0) / Math.sqrt(followers + 8)) * 3 +
      (weeklyPoints.get(user.id) ?? 0) / 40 +
      (summary?.recentRatings ?? 0) * 0.12;

    const stamps = [
      lastActivity.get(user.id) ?? '',
      lastPost.get(user.id) ?? '',
      user.last_active_at,
    ].sort();

    return {
      user: toPublicUser(user),
      overall: summary?.overall ?? 0,
      current: summary?.current ?? 0,
      trend: summary?.trend ?? 'steady',
      delta: summary?.delta ?? 0,
      followers,
      level: level.level,
      levelName: level.name,
      category: categoryOf.get(user.id) ?? null,
      ratings: summary?.ratingsReceived ?? 0,
      rising: Math.round(rising * 100) / 100,
      lastActivity: stamps[stamps.length - 1],
    };
  });
});

function withinPeriod(candidate: Candidate, period: RankPeriod, now: number): boolean {
  const days = RANK_PERIODS.find((entry) => entry.key === period)?.days;
  if (!days) return true;
  return candidate.lastActivity >= new Date(now - days * DAY).toISOString();
}

function sortFor(board: RankBoard) {
  return (a: Candidate, b: Candidate) => {
    if (board === 'overall') return b.overall - a.overall || b.ratings - a.ratings;
    if (board === 'current') return b.current - a.current || b.ratings - a.ratings;
    return b.rising - a.rising || b.current - a.current;
  };
}

function metricFor(board: RankBoard, candidate: Candidate): { metric: number; label: string } {
  if (board === 'overall') return { metric: candidate.overall, label: 'overall' };
  if (board === 'current') return { metric: candidate.current, label: 'current' };
  return { metric: candidate.rising, label: 'momentum' };
}

export interface RankingOptions {
  board: RankBoard;
  period?: RankPeriod;
  category?: Category | null;
  limit?: number;
}

export async function rankings({
  board,
  period = 'all',
  category = null,
  limit = 50,
}: RankingOptions): Promise<RankedUser[]> {
  const now = Date.now();
  const list = (await candidates())
    .filter((candidate) => (category ? candidate.category === category : true))
    .filter((candidate) => withinPeriod(candidate, period, now))
    .sort(sortFor(board));

  return list.slice(0, limit).map((candidate, position) => {
    const { metric, label } = metricFor(board, candidate);
    return {
      rank: position + 1,
      user: candidate.user,
      overall: candidate.overall,
      current: candidate.current,
      trend: candidate.trend,
      delta: candidate.delta,
      followers: candidate.followers,
      level: candidate.level,
      levelName: candidate.levelName,
      category: candidate.category,
      ratings: candidate.ratings,
      metric,
      metricLabel: label,
    };
  });
}

export interface UserRanks {
  overall: number | null;
  current: number | null;
  rising: number | null;
  total: number;
  categoryRank: number | null;
  category: Category | null;
}

/** The three numbers shown on a profile. */
export async function userRanks(userId: ID): Promise<UserRanks> {
  const list = await candidates();
  const position = (board: RankBoard, pool = list) => {
    const index = [...pool].sort(sortFor(board)).findIndex((entry) => entry.user.id === userId);
    return index === -1 ? null : index + 1;
  };
  const me = list.find((entry) => entry.user.id === userId);
  const categoryPool = me?.category ? list.filter((entry) => entry.category === me.category) : [];

  return {
    overall: position('overall'),
    current: position('current'),
    rising: position('rising'),
    total: list.length,
    categoryRank: me?.category ? position('overall', categoryPool) : null,
    category: me?.category ?? null,
  };
}

/**
 * Freezes this month's ranks so a profile can show its climb. Safe to run
 * repeatedly — the current month is replaced rather than duplicated.
 */
export async function captureRankSnapshot(period?: string): Promise<number> {
  const store = db();
  const key = period ?? new Date().toISOString().slice(0, 7);
  const list = await candidates();
  const overall = [...list].sort(sortFor('overall'));
  const current = [...list].sort(sortFor('current'));
  const rising = [...list].sort(sortFor('rising'));
  const rankOf = (pool: Candidate[], id: ID) => pool.findIndex((entry) => entry.user.id === id) + 1;

  const existing = await store.query('rank_snapshots', { where: { period: key } });
  await Promise.all(existing.map((row) => store.remove('rank_snapshots', row.id)));

  const rows = list.map((candidate) => ({
    id: newId(),
    user_id: candidate.user.id,
    period: key,
    overall_rank: rankOf(overall, candidate.user.id),
    current_rank: rankOf(current, candidate.user.id),
    rising_rank: rankOf(rising, candidate.user.id),
    overall_rating: candidate.overall,
    current_rating: candidate.current,
    created_at: new Date().toISOString(),
  }));
  await store.insertMany('rank_snapshots', rows);
  return rows.length;
}

export interface RankHistoryEntry {
  period: string;
  label: string;
  overallRank: number;
  currentRank: number;
  risingRank: number;
  overallRating: number;
}

export async function rankHistory(userId: ID): Promise<RankHistoryEntry[]> {
  const rows = await db().query('rank_snapshots', {
    where: { user_id: userId },
    orderBy: 'period',
  });
  return rows.map((row) => ({
    period: row.period,
    label: new Date(`${row.period}-01T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'long',
      timeZone: 'UTC',
    }),
    overallRank: row.overall_rank,
    currentRank: row.current_rank,
    risingRank: row.rising_rank,
    overallRating: row.overall_rating,
  }));
}
