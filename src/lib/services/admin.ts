import 'server-only';
import { db } from '@/lib/db';
import { DAY } from '@/lib/time';
import type { Category, ID, PublicUser } from '@/lib/types';
import { ratingsIndex } from './ratings';
import { followerCounts, toPublicUser } from './users';

export interface AdminStats {
  totals: {
    users: number;
    posts: number;
    comments: number;
    likes: number;
    follows: number;
    ratings: number;
    ratedPosts: number;
    untrusted: number;
    openReports: number;
  };
  active: { dau: number; wau: number; mau: number };
  newUsers: { today: number; week: number; month: number };
  categories: { category: Category; posts: number }[];
  topPosts: { id: ID; caption: string; views: number; author: string }[];
  topRated: { user: PublicUser; rating: number; votes: number; followers: number }[];
  recentUsers: { user: PublicUser; joined: string; status: string }[];
}

/** Everything the admin dashboard needs, in one pass over the tables. */
export async function adminStats(): Promise<AdminStats> {
  const store = db();
  const [users, posts, comments, likes, follows, reports, ratings, index] = await Promise.all([
    store.query('users'),
    store.query('posts'),
    store.query('comments'),
    store.query('likes'),
    store.query('follows'),
    store.query('reports'),
    store.query('ratings'),
    ratingsIndex(),
  ]);

  const now = Date.now();
  const since = (days: number) => new Date(now - days * DAY).toISOString();
  const activeSince = (days: number) =>
    users.filter((user) => user.last_active_at >= since(days)).length;

  const categoryCounts = new Map<Category, number>();
  for (const post of posts) {
    if (post.removed) continue;
    categoryCounts.set(post.category, (categoryCounts.get(post.category) ?? 0) + 1);
  }

  const usernameById = new Map(users.map((u) => [u.id, u.username]));
  const activeUsers = users.filter((u) => u.status === 'active');
  const followers = await followerCounts(activeUsers.map((u) => u.id));

  return {
    totals: {
      users: users.length,
      posts: posts.filter((p) => !p.removed).length,
      comments: comments.filter((c) => !c.removed).length,
      likes: likes.length,
      follows: follows.length,
      ratings: ratings.length,
      ratedPosts: new Set(
        ratings.filter((r) => r.target_type === 'post').map((r) => r.target_id),
      ).size,
      untrusted: users.filter((u) => !u.trusted).length,
      openReports: reports.filter((r) => r.status === 'open').length,
    },
    active: { dau: activeSince(1), wau: activeSince(7), mau: activeSince(30) },
    newUsers: {
      today: users.filter((u) => u.created_at >= since(1)).length,
      week: users.filter((u) => u.created_at >= since(7)).length,
      month: users.filter((u) => u.created_at >= since(30)).length,
    },
    categories: [...categoryCounts.entries()]
      .map(([category, count]) => ({ category, posts: count }))
      .sort((a, b) => b.posts - a.posts),
    topPosts: [...posts]
      .filter((p) => !p.removed)
      .sort((a, b) => b.views - a.views)
      .slice(0, 8)
      .map((post) => ({
        id: post.id,
        caption: post.caption,
        views: post.views,
        author: usernameById.get(post.author_id) ?? 'unknown',
      })),
    topRated: activeUsers
      .map((user) => ({
        user: toPublicUser(user),
        rating: index.users.get(user.id)?.overall ?? 0,
        votes: index.users.get(user.id)?.overallVotes ?? 0,
        score: index.users.get(user.id)?.overallScore ?? 0,
        rankable: index.users.get(user.id)?.rankable ?? false,
        followers: followers.get(user.id) ?? 0,
      }))
      .filter((row) => row.rankable)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ user, rating, votes, followers: f }) => ({
        user,
        rating,
        votes,
        followers: f,
      })),
    recentUsers: [...users]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 12)
      .map((user) => ({ user: toPublicUser(user), joined: user.created_at, status: user.status })),
  };
}

export interface AdminUserRow {
  user: PublicUser;
  email: string;
  followers: number;
  posts: number;
  rating: number | null;
  votes: number;
}

export async function adminUsers(query: string, limit = 40): Promise<AdminUserRow[]> {
  const store = db();
  const [users, posts, index] = await Promise.all([
    store.query('users'),
    store.query('posts'),
    ratingsIndex(),
  ]);
  const needle = query.trim().toLowerCase();
  const matched = users
    .filter(
      (user) =>
        !needle ||
        user.username.includes(needle) ||
        user.display_name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
  const followers = await followerCounts(matched.map((u) => u.id));
  const postCounts = new Map<ID, number>();
  for (const post of posts) postCounts.set(post.author_id, (postCounts.get(post.author_id) ?? 0) + 1);

  return matched.map((user) => {
    const summary = index.users.get(user.id);
    return {
      user: toPublicUser(user),
      email: user.email,
      followers: followers.get(user.id) ?? 0,
      posts: postCounts.get(user.id) ?? 0,
      rating: summary && summary.overallVotes > 0 ? summary.overall : null,
      votes: summary?.overallVotes ?? 0,
    };
  });
}
