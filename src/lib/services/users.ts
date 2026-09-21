import 'server-only';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import type { Category, ID, PublicUser, User } from '@/lib/types';
import { notify } from './notifications';

export function toPublicUser(user: User): PublicUser {
  const { email: _email, ...rest } = user;
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

export interface UpdateProfileInput {
  display_name?: string;
  bio?: string;
  avatar_url?: string | null;
  location?: string | null;
  interests?: Category[];
}

export async function updateProfile(userId: ID, input: UpdateProfileInput): Promise<void> {
  await db().update('users', userId, input);
}

export interface SuggestedPerson {
  user: PublicUser;
  followers: number;
  rating: number | null;
  votes: number;
  category: Category | null;
}

/**
 * People worth following, for the sidebar and empty states.
 *
 * Ordered by rating confidence among people the viewer does not already
 * follow, with a nudge toward shared interests. Deliberately not "biggest
 * accounts first".
 */
export async function suggestedPeople(
  viewer: User | null,
  limit = 5,
): Promise<SuggestedPerson[]> {
  const store = db();
  const { ratingsIndex } = await import('./ratings');
  const [users, posts, index, following, hidden] = await Promise.all([
    store.query('users', { where: { status: 'active' } }),
    store.query('posts', { where: { removed: false } }),
    ratingsIndex(),
    viewer ? followingIds(viewer.id) : new Set<ID>(),
    hiddenUserIds(viewer?.id ?? null),
  ]);

  const categoryOf = new Map<ID, Category>();
  const counts = new Map<ID, Map<Category, number>>();
  for (const post of posts) {
    const map = counts.get(post.author_id) ?? new Map<Category, number>();
    map.set(post.category, (map.get(post.category) ?? 0) + 1);
    counts.set(post.author_id, map);
  }
  for (const [id, map] of counts) {
    const top = [...map.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) categoryOf.set(id, top[0]);
  }

  const candidates = users.filter(
    (user) => user.id !== viewer?.id && !following.has(user.id) && !hidden.has(user.id),
  );
  const followers = await followerCounts(candidates.map((u) => u.id));
  const interests = new Set(viewer?.interests ?? []);

  return candidates
    .map((user) => {
      const summary = index.users.get(user.id);
      const category = categoryOf.get(user.id) ?? user.interests[0] ?? null;
      const shared = category && interests.has(category) ? 1.2 : 1;
      return {
        score: (summary?.overallScore ?? 0) * shared,
        card: {
          user: toPublicUser(user),
          followers: followers.get(user.id) ?? 0,
          rating: summary && summary.overallVotes > 0 ? summary.overall : null,
          votes: summary?.overallVotes ?? 0,
          category,
        } satisfies SuggestedPerson,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.card);
}
