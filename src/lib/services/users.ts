import 'server-only';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { levelFor, nextFollowerGoal } from '@/lib/rise';
import type { Activity, ID, Interest, PublicUser, User } from '@/lib/types';
import { award } from './points';
import { notify } from './notifications';

export function toPublicUser(user: User): PublicUser {
  const { password_hash: _hash, email: _email, ...rest } = user;
  return rest;
}

export async function getUser(id: ID): Promise<User | null> {
  return db().get('users', id);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const rows = await db().query('users', { where: { username: username.toLowerCase() } });
  return rows[0] ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await db().query('users', { where: { email: email.toLowerCase() } });
  return rows[0] ?? null;
}

export async function getUsers(ids: ID[]): Promise<Map<ID, User>> {
  if (ids.length === 0) return new Map();
  const rows = await db().query('users', { in: { id: [...new Set(ids)] } });
  return new Map(rows.map((row) => [row.id, row]));
}

export interface UserStats {
  followers: number;
  following: number;
  posts: number;
  likesReceived: number;
  views: number;
}

export async function getUserStats(userId: ID): Promise<UserStats> {
  const store = db();
  const [followers, following, posts] = await Promise.all([
    store.query('follows', { where: { following_id: userId } }),
    store.query('follows', { where: { follower_id: userId } }),
    store.query('posts', { where: { author_id: userId, removed: false } }),
  ]);
  const postIds = posts.map((p) => p.id);
  const likes = postIds.length ? await store.query('likes', { in: { post_id: postIds } }) : [];
  return {
    followers: followers.length,
    following: following.length,
    posts: posts.length,
    likesReceived: likes.length,
    views: posts.reduce((sum, post) => sum + post.views, 0),
  };
}

export async function followerCounts(userIds: ID[]): Promise<Map<ID, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await db().query('follows', { in: { following_id: [...new Set(userIds)] } });
  const counts = new Map<ID, number>(userIds.map((id) => [id, 0]));
  for (const row of rows) counts.set(row.following_id, (counts.get(row.following_id) ?? 0) + 1);
  return counts;
}

export async function followingIds(userId: ID): Promise<Set<ID>> {
  const rows = await db().query('follows', { where: { follower_id: userId } });
  return new Set(rows.map((row) => row.following_id));
}

export async function isFollowing(followerId: ID, followingId: ID): Promise<boolean> {
  const rows = await db().query('follows', {
    where: { follower_id: followerId, following_id: followingId },
  });
  return rows.length > 0;
}

export async function follow(followerId: ID, followingId: ID): Promise<boolean> {
  if (followerId === followingId) return false;
  const store = db();
  const existing = await store.query('follows', {
    where: { follower_id: followerId, following_id: followingId },
  });
  if (existing.length > 0) return true;
  // A blocked relationship in either direction prevents following.
  if (await isBlockedEitherWay(followerId, followingId)) return false;

  await store.insert('follows', {
    id: newId(),
    follower_id: followerId,
    following_id: followingId,
    created_at: new Date().toISOString(),
  });
  const actor = await store.get('users', followerId);
  await award(followingId, 'follow_received');
  await award(followerId, 'follow_given');
  await notify({
    userId: followingId,
    type: 'follow',
    actorId: followerId,
    body: `@${actor?.username ?? 'someone'} started following you`,
  });
  return true;
}

export async function unfollow(followerId: ID, followingId: ID): Promise<void> {
  const store = db();
  const rows = await store.query('follows', {
    where: { follower_id: followerId, following_id: followingId },
  });
  for (const row of rows) await store.remove('follows', row.id);
}

export async function isBlockedEitherWay(a: ID, b: ID): Promise<boolean> {
  const store = db();
  const [x, y] = await Promise.all([
    store.query('blocks', { where: { blocker_id: a, blocked_id: b } }),
    store.query('blocks', { where: { blocker_id: b, blocked_id: a } }),
  ]);
  return x.length > 0 || y.length > 0;
}

/** Everyone the viewer has blocked, plus everyone who has blocked the viewer. */
export async function hiddenUserIds(viewerId: ID | null): Promise<Set<ID>> {
  if (!viewerId) return new Set();
  const store = db();
  const [mine, theirs] = await Promise.all([
    store.query('blocks', { where: { blocker_id: viewerId } }),
    store.query('blocks', { where: { blocked_id: viewerId } }),
  ]);
  return new Set([...mine.map((b) => b.blocked_id), ...theirs.map((b) => b.blocker_id)]);
}

export async function blockUser(blockerId: ID, blockedId: ID): Promise<void> {
  if (blockerId === blockedId) return;
  const store = db();
  const existing = await store.query('blocks', {
    where: { blocker_id: blockerId, blocked_id: blockedId },
  });
  if (existing.length === 0) {
    await store.insert('blocks', {
      id: newId(),
      blocker_id: blockerId,
      blocked_id: blockedId,
      created_at: new Date().toISOString(),
    });
  }
  // Blocking severs the follow relationship both ways.
  await unfollow(blockerId, blockedId);
  await unfollow(blockedId, blockerId);
}

export async function unblockUser(blockerId: ID, blockedId: ID): Promise<void> {
  const store = db();
  const rows = await store.query('blocks', {
    where: { blocker_id: blockerId, blocked_id: blockedId },
  });
  for (const row of rows) await store.remove('blocks', row.id);
}

export async function blockedList(userId: ID): Promise<PublicUser[]> {
  const store = db();
  const rows = await store.query('blocks', { where: { blocker_id: userId } });
  if (rows.length === 0) return [];
  const users = await store.query('users', { in: { id: rows.map((r) => r.blocked_id) } });
  return users.map(toPublicUser);
}

export interface JourneyMilestone {
  label: string;
  value: string;
  date: string | null;
  done: boolean;
}

export interface Journey {
  joined: string;
  followers: number;
  followerTrack: { milestone: number; reached: boolean }[];
  nextGoal: number;
  milestones: JourneyMilestone[];
  level: number;
  levelName: string;
  points: number;
}

/**
 * "Tommy's RISE Journey" — a timeline built entirely from real activity so the
 * profile reads as a story rather than a set of counters.
 */
export async function getJourney(user: User): Promise<Journey> {
  const store = db();
  const [stats, posts, activity] = await Promise.all([
    getUserStats(user.id),
    store.query('posts', { where: { author_id: user.id, removed: false } }),
    store.query('activity', { where: { user_id: user.id } }),
  ]);

  const sortedActivity = [...activity].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const first = (type: Activity['type']) => sortedActivity.find((a) => a.type === type) ?? null;

  const firstPost = [...posts].sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
  const featured = posts.filter((p) => p.featured && p.featured_at).sort((a, b) =>
    (a.featured_at ?? '').localeCompare(b.featured_at ?? ''),
  )[0] ?? null;
  const topPost = [...posts].sort((a, b) => b.views - a.views)[0] ?? null;
  const firstChallenge = first('challenge_entry');
  const level = levelFor(user.rise_points);

  return {
    joined: user.created_at,
    followers: stats.followers,
    followerTrack: [0, 10, 100, 1_000, 10_000].map((milestone) => ({
      milestone,
      reached: stats.followers >= milestone,
    })),
    nextGoal: nextFollowerGoal(stats.followers),
    level: level.level,
    levelName: level.name,
    points: user.rise_points,
    milestones: [
      {
        label: 'First post',
        value: firstPost ? 'Posted' : 'Not yet',
        date: firstPost?.created_at ?? null,
        done: Boolean(firstPost),
      },
      {
        label: 'First challenge',
        value: firstChallenge ? 'Entered' : 'Not yet',
        date: firstChallenge?.created_at ?? null,
        done: Boolean(firstChallenge),
      },
      {
        label: 'First featured post',
        value: featured ? 'Featured' : 'Not yet',
        date: featured?.featured_at ?? null,
        done: Boolean(featured),
      },
      {
        label: 'Highest viewed post',
        value: topPost ? `${topPost.views.toLocaleString()} views` : '—',
        date: topPost?.created_at ?? null,
        done: Boolean(topPost && topPost.views > 0),
      },
    ],
  };
}

export interface UpdateProfileInput {
  display_name?: string;
  bio?: string;
  avatar_url?: string | null;
  location?: string | null;
  interests?: Interest[];
  goal?: string;
}

export async function updateProfile(userId: ID, input: UpdateProfileInput): Promise<void> {
  await db().update('users', userId, input);
}
