import 'server-only';
import { db } from '@/lib/db';
import { levelFor } from '@/lib/rise';
import { DAY } from '@/lib/time';
import type { Category, ID, PublicUser } from '@/lib/types';
import { followerCounts, toPublicUser } from './users';

export type Board = 'rising' | 'fastest' | 'challengers';

export interface LeaderboardRow {
  rank: number;
  user: PublicUser;
  followers: number;
  level: number;
  levelName: string;
  /** The number the board is ranked on, already formatted for display. */
  metric: number;
  metricLabel: string;
}

interface Options {
  board: Board;
  category?: Category | null;
  limit?: number;
}

/**
 * Leaderboards deliberately rank on *earned momentum*, never on raw follower
 * count — otherwise the same big accounts would sit at the top forever.
 */
export async function leaderboard({
  board,
  category = null,
  limit = 25,
}: Options): Promise<LeaderboardRow[]> {
  const store = db();
  const [users, activity, posts, follows] = await Promise.all([
    store.query('users', { where: { status: 'active' } }),
    store.query('activity'),
    store.query('posts', { where: { removed: false } }),
    store.query('follows'),
  ]);

  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const categoryByUser = new Map<ID, Category>();
  if (category) {
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
  }

  const weeklyPoints = new Map<ID, number>();
  const challengePoints = new Map<ID, number>();
  for (const entry of activity) {
    if (entry.points > 0 && entry.created_at >= weekAgo) {
      weeklyPoints.set(entry.user_id, (weeklyPoints.get(entry.user_id) ?? 0) + entry.points);
    }
    if (entry.type === 'challenge_entry' || (entry.type === 'featured' && entry.challenge_id)) {
      challengePoints.set(entry.user_id, (challengePoints.get(entry.user_id) ?? 0) + 1);
    }
  }

  const newFollowers = new Map<ID, number>();
  for (const follow of follows) {
    if (follow.created_at >= weekAgo) {
      newFollowers.set(follow.following_id, (newFollowers.get(follow.following_id) ?? 0) + 1);
    }
  }

  const candidates = users.filter(
    (user) => !category || categoryByUser.get(user.id) === category,
  );
  const followers = await followerCounts(candidates.map((u) => u.id));

  const scored = candidates.map((user) => {
    const followerCount = followers.get(user.id) ?? 0;
    let metric = 0;
    let metricLabel = '';
    if (board === 'rising') {
      metric = weeklyPoints.get(user.id) ?? 0;
      metricLabel = 'RISE pts this week';
    } else if (board === 'fastest') {
      // Growth relative to existing audience, so small accounts can win.
      const gained = newFollowers.get(user.id) ?? 0;
      metric = Math.round((gained / Math.sqrt(followerCount + 5)) * 100) / 10;
      metricLabel = 'growth score';
    } else {
      metric = challengePoints.get(user.id) ?? 0;
      metricLabel = 'challenge entries';
    }
    const level = levelFor(user.rise_points);
    return {
      user: toPublicUser(user),
      followers: followerCount,
      level: level.level,
      levelName: level.name,
      metric,
      metricLabel,
    };
  });

  return scored
    .filter((row) => row.metric > 0)
    .sort((a, b) => b.metric - a.metric || b.followers - a.followers)
    .slice(0, limit)
    .map((row, index) => ({ rank: index + 1, ...row }));
}
