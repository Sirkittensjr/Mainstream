import 'server-only';
import { db } from '@/lib/db';
import { communityCache, refreshCommunity } from './community-cache';
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

/**
 * How many followers everybody has.
 *
 * One number per account, the same for every viewer, so it is counted once and
 * shared rather than re-counted per request. It used to be asked for with the
 * id of every post author on the page, and since a feed touches most of the
 * platform that meant reading the entire follow graph to render one screen —
 * measured at 2,879 rows on a 200-account database, on every page.
 */
const allFollowerCounts = communityCache('follower-counts', async () => {
  const rows = await db().query('follows');
  const counts = new Map<ID, number>();
  for (const row of rows) counts.set(row.following_id, (counts.get(row.following_id) ?? 0) + 1);
  return [...counts.entries()];
});

/**
 * How many visible posts each account has.
 *
 * Another number that is the same for everybody. It was being arrived at by
 * reading every post on the platform — 600 rows to put a "3 posts" label on a
 * dozen suggestion cards.
 */
export const postCountsByAuthor = communityCache('post-counts', async () => {
  const posts = await db().query('posts', { where: { removed: false } });
  const counts = new Map<ID, number>();
  for (const post of posts) counts.set(post.author_id, (counts.get(post.author_id) ?? 0) + 1);
  return [...counts.entries()];
});

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
    // The follower number is one entry in a count the platform already keeps,
    // so it does not need this person's follow rows read to arrive at it.
    allFollowerCounts().then((entries) => new Map(entries).get(userId) ?? 0),
    store.query('follows', { where: { follower_id: userId } }),
    store.query('posts', { where: { author_id: userId, removed: false } }),
  ]);
  const postIds = posts.map((p) => p.id);
  const likes = postIds.length ? await store.query('likes', { in: { post_id: postIds } }) : [];
  return {
    followers,
    following: following.length,
    posts: posts.length,
    likesReceived: likes.length,
    views: posts.reduce((sum, post) => sum + post.views, 0),
  };
}

export async function followerCounts(userIds: ID[]): Promise<Map<ID, number>> {
  if (userIds.length === 0) return new Map();
  const all = new Map(await allFollowerCounts());
  return new Map(userIds.map((id) => [id, all.get(id) ?? 0]));
}

export async function followingIds(userId: ID): Promise<Set<ID>> {
  const rows = await db().query('follows', { where: { follower_id: userId } });
  return new Set(rows.map((row) => row.following_id));
}

export interface PersonSummary {
  user: PublicUser;
  /** Whether the signed-in viewer already follows this person. */
  viewerFollows: boolean;
  /** True for the viewer's own row, which gets no follow button. */
  isViewer: boolean;
}

/**
 * The people behind a set of follow rows.
 *
 * A follow row holds two account ids and nothing else, which is the point:
 * the list is built by looking those ids up, so it stays correct when
 * somebody changes their @handle or their display name. The handle in the
 * link comes off the record the id resolved to rather than from anything
 * stored alongside the follow.
 *
 * Who is left out: banned accounts, and anyone the viewer has blocked or who
 * has blocked the viewer. A block already hides that person everywhere else,
 * and a follower list is not the place it stops applying.
 *
 * Everyone who survives that is returned. The page decides how many to put on
 * screen at once, so "25 followers" can always be counted out to 25 rather
 * than quietly stopping at whatever number this function felt like.
 */
async function peopleFrom(ids: ID[], viewerId: ID | null): Promise<PersonSummary[]> {
  if (ids.length === 0) return [];
  const [records, hidden, viewerFollowing] = await Promise.all([
    getUsers(ids),
    hiddenUserIds(viewerId),
    viewerId ? followingIds(viewerId) : Promise.resolve(new Set<ID>()),
  ]);

  const out: PersonSummary[] = [];
  for (const id of ids) {
    const user = records.get(id);
    if (!user || user.status === 'banned' || hidden.has(id)) continue;
    out.push({
      user: toPublicUser(user),
      viewerFollows: viewerFollowing.has(id),
      isViewer: id === viewerId,
    });
  }
  return out;
}

/** Everyone who follows this person, most recent first. */
export async function followersOf(userId: ID, viewerId: ID | null): Promise<PersonSummary[]> {
  const rows = await db().query('follows', { where: { following_id: userId } });
  const ids = [...rows]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((row) => row.follower_id);
  return peopleFrom(ids, viewerId);
}

/** Everyone this person follows, most recently followed first. */
export async function followingOf(userId: ID, viewerId: ID | null): Promise<PersonSummary[]> {
  const rows = await db().query('follows', { where: { follower_id: userId } });
  const ids = [...rows]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((row) => row.following_id);
  return peopleFrom(ids, viewerId);
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
  refreshCommunity();
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
  refreshCommunity();
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
  refreshCommunity();
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
  // A changed name or picture shows up in the rankings, which are cached.
  refreshCommunity();
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
/**
 * The accounts worth suggesting, and what is known about them.
 *
 * Global: every active account, what each one mostly posts about, and how much
 * they post. Who to actually suggest depends on the viewer, and that part
 * stays per request.
 */
const suggestionPool = communityCache('suggestion-pool', async () => {
  const store = db();
  const [users, posts] = await Promise.all([
    store.query('users', { where: { status: 'active' } }),
    store.query('posts', { where: { removed: false } }),
  ]);

  const counts = new Map<ID, Map<Category, number>>();
  const postCounts = new Map<ID, number>();
  for (const post of posts) {
    const map = counts.get(post.author_id) ?? new Map<Category, number>();
    map.set(post.category, (map.get(post.category) ?? 0) + 1);
    counts.set(post.author_id, map);
    postCounts.set(post.author_id, (postCounts.get(post.author_id) ?? 0) + 1);
  }

  const categoryOf: [ID, Category][] = [];
  for (const [id, map] of counts) {
    const top = [...map.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) categoryOf.push([id, top[0]]);
  }

  return {
    users: users.map(toPublicUser),
    categoryOf,
    postCounts: [...postCounts.entries()],
  };
});

export async function suggestedPeople(
  viewer: User | null,
  limit = 5,
): Promise<SuggestedPerson[]> {
  const { ratingsIndex } = await import('./ratings');
  const [pool, index, following, hidden, followers] = await Promise.all([
    suggestionPool(),
    ratingsIndex(),
    viewer ? followingIds(viewer.id) : new Set<ID>(),
    hiddenUserIds(viewer?.id ?? null),
    allFollowerCounts().then((entries) => new Map(entries)),
  ]);

  const categoryOf = new Map<ID, Category>(pool.categoryOf);
  const postCounts = new Map<ID, number>(pool.postCounts);

  // Everything above is the same for everybody and comes from cache. Only
  // this filtering is personal: who you already follow, and who you cannot see.
  const candidates = pool.users.filter(
    (user) => user.id !== viewer?.id && !following.has(user.id) && !hidden.has(user.id),
  );
  const interests = new Set(viewer?.interests ?? []);

  const scored = candidates.map((user) => {
    const summary = index.users.get(user.id);
    const category = categoryOf.get(user.id) ?? user.interests[0] ?? null;
    const shared = category && interests.has(category) ? 1.2 : 1;
    return {
      score: (summary?.overallScore ?? 0) * shared,
      posts: postCounts.get(user.id) ?? 0,
      joined: user.created_at,
      card: {
        user,
        followers: followers.get(user.id) ?? 0,
        rating: summary && summary.overallVotes > 0 ? summary.overall : null,
        votes: summary?.overallVotes ?? 0,
        category,
      } satisfies SuggestedPerson,
    };
  });

  const rated = scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  if (rated.length >= limit) return rated.slice(0, limit).map((entry) => entry.card);

  /**
   * Cold start. On a new platform nobody has a rating yet, so ranking on
   * rating alone suggests nobody at all and the sidebar is permanently empty —
   * which is exactly when people most need somewhere to go. Top up with
   * accounts that have actually posted, newest first.
   */
  const chosen = new Set(rated.map((entry) => entry.card.user.id));
  const newcomers = scored
    .filter((entry) => !chosen.has(entry.card.user.id) && entry.posts > 0)
    .sort((a, b) => b.posts - a.posts || b.joined.localeCompare(a.joined));

  return [...rated, ...newcomers].slice(0, limit).map((entry) => entry.card);
}
