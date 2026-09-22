import type { Schema, TableName } from '@/lib/db/types';
import type {
  Category,
  Comment,
  Follow,
  Like,
  Notification,
  Post,
  Rating,
  Reaction,
  Report,
  User,
} from '@/lib/types';
import { FILLER_BIOS, FILLER_CAPTIONS, FIRST_NAMES, HANDLE_SUFFIXES, SEED_CREATORS } from './content';

type Store = { [K in TableName]: Schema[K][] };

/**
 * Every sample account shares this password. The seed script hands it to
 * Supabase Auth, which does the hashing — we never store a password here.
 */
export const SEED_PASSWORD = 'faydemo123';
export const DEMO_LOGIN = { email: 'tommy@faytarra.app', password: SEED_PASSWORD };
export const ADMIN_LOGIN = { email: 'admin@faytarra.app', password: SEED_PASSWORD };

const DAY = 86_400_000;
const NOW = Date.now();

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260921);

function uuid(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) out += hex[Math.floor(rand() * 16)];
  return [
    out.slice(0, 8),
    out.slice(8, 12),
    `4${out.slice(13, 16)}`,
    `a${out.slice(17, 20)}`,
    out.slice(20, 32),
  ].join('-');
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function between(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function iso(daysAgo: number, jitterHours = 12): string {
  const offset = daysAgo * DAY + Math.floor(rand() * jitterHours * 3_600_000);
  return new Date(NOW - offset).toISOString();
}

const REPORT_REASONS = ['Spam or scam', 'Harassment', 'Hate speech', 'Impersonation'];

const COMMENT_BODIES = [
  'this is actually so good',
  'how long did this take??',
  'followed. keep going.',
  'the ending got me',
  'ok this deserves more eyes',
  'saved this one',
  'day 1 fan',
  'respect for posting this',
  'do more of these',
  'genuinely made me laugh',
];

const REACTION_POOL: Reaction[] = [
  'Fire',
  'Funny',
  'Creative',
  'Interesting',
  'Love It',
  'Would Collaborate',
];

function coverMedia(seed: string, category: Category) {
  return { kind: 'image' as const, url: `/api/cover/${encodeURIComponent(`${category}-${seed}`)}` };
}

/**
 * Fills an empty store with a believable community: 24 hand written people, a
 * supporting cast of ~140 accounts, their posts, likes, comments, follows and
 * the ratings behind their scores.
 */
export function seedInto(store: Store): Store {
  const users: User[] = [];
  const posts: Post[] = [];
  const likes: Like[] = [];
  const comments: Comment[] = [];
  const follows: Follow[] = [];
  const notifications: Notification[] = [];
  const reports: Report[] = [];
  const ratings: Rating[] = [];

  // --- accounts -----------------------------------------------------------
  const admin: User = {
    id: uuid(),
    email: ADMIN_LOGIN.email,
    username: 'faytarra',
    display_name: 'FayTarra Team',
    bio: 'We keep this place friendly. Post something.',
    avatar_url: null,
    location: 'Everywhere',
    interests: ['Life'],
    role: 'admin',
    status: 'active',
    status_reason: null,
    trusted: true,
    username_changed_at: null,
    created_at: iso(200, 0),
    last_active_at: iso(0, 1),
  };
  users.push(admin);

  const creatorUsers: { user: User; pull: number; category: Category }[] = [];
  for (const creator of SEED_CREATORS) {
    const user: User = {
      id: uuid(),
      email: `${creator.username}@faytarra.app`,
      username: creator.username,
      display_name: creator.display_name,
      bio: creator.bio,
      avatar_url: null,
      location: creator.location,
      interests: creator.interests,
      role: 'user',
      status: 'active',
      status_reason: null,
      trusted: true,
      username_changed_at: null,
      created_at: iso(creator.joinedDaysAgo),
      last_active_at: iso(between(0, 2)),
    };
    users.push(user);
    creatorUsers.push({ user, pull: creator.pull, category: creator.category });

    const addPost = (caption: string, tags: string[], daysAgo: number, index: number) => {
      posts.push({
        id: uuid(),
        author_id: user.id,
        caption,
        media: [coverMedia(`${creator.username}-${index}`, creator.category)],
        category: creator.category,
        tags,
        views: 0,
        removed: false,
        removed_reason: null,
        created_at: iso(daysAgo),
      });
    };

    creator.posts.forEach((postDef, index) => addPost(postDef.caption, postDef.tags, postDef.daysAgo, index));

    // Back catalogue for established accounts, so there is month-over-month
    // history behind their 30-day rating.
    if (creator.joinedDaysAgo > 60) {
      const archive = between(3, 6);
      for (let i = 0; i < archive; i += 1) {
        addPost(
          pick(FILLER_CAPTIONS[creator.category]),
          [creator.category.toLowerCase()],
          between(35, creator.joinedDaysAgo - 5),
          100 + i,
        );
      }
    }
  }

  const categories = Object.keys(FILLER_CAPTIONS) as Category[];
  const usedNames = new Set(users.map((u) => u.username));
  for (let i = 0; i < 140; i += 1) {
    let username = `${pick(FIRST_NAMES)}${pick(HANDLE_SUFFIXES)}`;
    while (usedNames.has(username)) username = `${username}${between(2, 99)}`;
    usedNames.add(username);
    const category = pick(categories);
    const joined = between(1, 90);
    const user: User = {
      id: uuid(),
      email: `${username}@example.com`,
      username,
      display_name: username[0].toUpperCase() + username.slice(1),
      bio: pick(FILLER_BIOS),
      avatar_url: null,
      location: null,
      interests: [category],
      role: 'user',
      status: 'active',
      status_reason: null,
      trusted: true,
      username_changed_at: null,
      created_at: iso(joined),
      last_active_at: iso(between(0, 6)),
    };
    users.push(user);

    for (let p = 0; p < between(0, 3); p += 1) {
      posts.push({
        id: uuid(),
        author_id: user.id,
        caption: pick(FILLER_CAPTIONS[category]),
        media: [coverMedia(`${username}-${p}`, category)],
        category,
        tags: [category.toLowerCase()],
        views: 0,
        removed: false,
        removed_reason: null,
        created_at: iso(between(0, Math.min(joined, 20))),
      });
    }
  }

  // --- follows ------------------------------------------------------------
  const pullOf = new Map<string, number>(users.map((u) => [u.id, 1]));
  for (const entry of creatorUsers) pullOf.set(entry.user.id, entry.pull);
  pullOf.set(admin.id, 14);

  const joinedDaysAgo = (user: User) => (NOW - new Date(user.created_at).getTime()) / DAY;

  for (const target of users) {
    const pull = pullOf.get(target.id) ?? 1;
    const ageFactor = Math.min(1, joinedDaysAgo(target) / 21 + 0.25);
    const wanted = Math.max(
      0,
      Math.round(Math.pow(pull, 1.5) * 3.5 * ageFactor * (0.75 + rand() * 0.5)),
    );
    const chosen = new Set<string>();
    let attempts = 0;
    while (chosen.size < wanted && attempts < wanted * 6) {
      attempts += 1;
      const follower = users[Math.floor(rand() * users.length)];
      if (follower.id === target.id || chosen.has(follower.id)) continue;
      chosen.add(follower.id);
      const window = Math.min(joinedDaysAgo(target), joinedDaysAgo(follower), 30);
      follows.push({
        id: uuid(),
        follower_id: follower.id,
        following_id: target.id,
        created_at: iso(Math.max(0, rand() * window)),
      });
    }
  }

  // --- likes, comments, views ---------------------------------------------
  for (const post of posts) {
    const authorPull = pullOf.get(post.author_id) ?? 1;
    const ageDays = (NOW - new Date(post.created_at).getTime()) / DAY;
    const quality = 0.35 + rand() * 0.65;
    const base = (6 + authorPull * 4) * quality * (1 + Math.min(ageDays, 10) / 6);
    const likeCount = Math.min(users.length - 1, Math.round(base * (0.6 + rand())));
    const likers = new Set<string>();
    for (let i = 0; i < likeCount; i += 1) {
      const liker = users[Math.floor(rand() * users.length)];
      if (liker.id === post.author_id || likers.has(liker.id)) continue;
      likers.add(liker.id);
      likes.push({
        id: uuid(),
        post_id: post.id,
        user_id: liker.id,
        created_at: iso(Math.max(0, ageDays - rand() * 1.5)),
      });
    }

    const commentCount = Math.round(likers.size * (0.06 + rand() * 0.12));
    const threadRoots: string[] = [];
    for (let i = 0; i < commentCount; i += 1) {
      const author = users[Math.floor(rand() * users.length)];
      if (author.id === post.author_id) continue;
      const id = uuid();
      // Roughly one in four comments is a reply to an earlier one, so the
      // threaded view has something real to render.
      const replyTo = threadRoots.length > 0 && rand() < 0.25
        ? threadRoots[Math.floor(rand() * threadRoots.length)]
        : null;
      if (!replyTo) threadRoots.push(id);
      comments.push({
        id,
        post_id: post.id,
        user_id: author.id,
        parent_id: replyTo,
        body: pick(COMMENT_BODIES),
        removed: false,
        created_at: iso(Math.max(0, ageDays - rand())),
      });
    }

    post.views = Math.round(likers.size * between(9, 34) + between(10, 200));
  }

  // --- ratings ------------------------------------------------------------
  // Each post has a hidden "true quality"; raters sample around it with noise,
  // which produces a believable spread instead of everything landing on 8.
  const rate = (
    raterId: string,
    targetType: 'post' | 'user',
    targetId: string,
    ownerId: string,
    score: number,
    at: string,
    weight = 1,
  ) => {
    const reactions: Reaction[] = [];
    if (score >= 8 && rand() < 0.75) reactions.push(pick(REACTION_POOL));
    if (score >= 9 && rand() < 0.4) {
      const second = pick(REACTION_POOL);
      if (!reactions.includes(second)) reactions.push(second);
    }
    ratings.push({
      id: uuid(),
      rater_id: raterId,
      target_type: targetType,
      target_id: targetId,
      owner_id: ownerId,
      score: Math.max(1, Math.min(10, Math.round(score))),
      reactions,
      weight,
      created_at: at,
      updated_at: at,
    });
  };

  const likesByPost = new Map<string, number>();
  for (const like of likes) likesByPost.set(like.post_id, (likesByPost.get(like.post_id) ?? 0) + 1);

  for (const post of posts) {
    const quality = 5.4 + rand() * 4.2;
    const ageDays = (NOW - new Date(post.created_at).getTime()) / DAY;
    const wanted = Math.min(40, Math.round((likesByPost.get(post.id) ?? 0) * 0.35) + between(0, 3));
    const used = new Set<string>();
    for (let i = 0; i < wanted; i += 1) {
      const rater = users[Math.floor(rand() * users.length)];
      if (rater.id === post.author_id || used.has(rater.id)) continue;
      used.add(rater.id);
      const noise = (rand() + rand() + rand() - 1.5) * 1.6;
      const at = iso(rand() < 0.55 ? rand() * Math.min(ageDays, 28) : rand() * Math.min(ageDays, 75));
      rate(rater.id, 'post', post.id, post.author_id, quality + noise, at);
    }
  }

  // Profile ratings for the hand written people.
  for (const entry of creatorUsers) {
    const wanted = between(8, 26);
    const base = 6.6 + Math.min(3, entry.pull * 0.28) + rand();
    const used = new Set<string>();
    for (let i = 0; i < wanted; i += 1) {
      const rater = users[Math.floor(rand() * users.length)];
      if (rater.id === entry.user.id || used.has(rater.id)) continue;
      used.add(rater.id);
      rate(rater.id, 'user', entry.user.id, entry.user.id, base + (rand() - 0.5) * 1.8, iso(rand() * 45));
    }
  }

  // --- a small rating ring, so the integrity queue has something real ------
  const ringTarget = creatorUsers.find((entry) => entry.user.username === 'kitpixels');
  if (ringTarget) {
    const ringPosts = posts.filter((post) => post.author_id === ringTarget.user.id);
    for (let i = 0; i < 3; i += 1) {
      const ringAccount: User = {
        id: uuid(),
        email: `pixelfan${i + 1}@example.com`,
        username: `pixelfan${i + 1}`,
        display_name: `Pixel Fan ${i + 1}`,
        bio: 'big fan',
        avatar_url: null,
        location: null,
        interests: ['Gaming'],
        role: 'user',
        status: 'active',
        status_reason: null,
        trusted: true,
        username_changed_at: null,
        created_at: iso(between(1, 4)),
        last_active_at: iso(0),
      };
      users.push(ringAccount);
      for (const post of ringPosts) {
        // Exactly the pattern the weighting is designed to catch: a brand new
        // account, everything a 10, all aimed at one person.
        rate(ringAccount.id, 'post', post.id, post.author_id, 10, iso(rand() * 2), 0.25);
      }
      rate(ringAccount.id, 'user', ringTarget.user.id, ringTarget.user.id, 10, iso(rand()), 0.25);
      for (let d = 0; d < 2; d += 1) {
        const other = posts[Math.floor(rand() * posts.length)];
        if (other.author_id === ringTarget.user.id) continue;
        rate(ringAccount.id, 'post', other.id, other.author_id, between(7, 9), iso(rand() * 3), 0.25);
      }
    }
  }

  // --- notifications for recent activity ----------------------------------
  const recent = (at: string) => NOW - new Date(at).getTime() < 5 * DAY;
  const userById = new Map(users.map((u) => [u.id, u]));
  const postById = new Map(posts.map((p) => [p.id, p]));
  const perUser = new Map<string, number>();
  const cap = (userId: string) => {
    const count = perUser.get(userId) ?? 0;
    if (count >= 12) return false;
    perUser.set(userId, count + 1);
    return true;
  };

  for (const follow of follows) {
    if (!recent(follow.created_at) || !cap(follow.following_id)) continue;
    notifications.push({
      id: uuid(),
      user_id: follow.following_id,
      type: 'follow',
      actor_id: follow.follower_id,
      post_id: null,
      body: `@${userById.get(follow.follower_id)?.username} started following you`,
      read: rand() < 0.4,
      created_at: follow.created_at,
    });
  }
  for (const like of likes) {
    const post = postById.get(like.post_id);
    if (!post || !recent(like.created_at) || !cap(post.author_id)) continue;
    notifications.push({
      id: uuid(),
      user_id: post.author_id,
      type: 'like',
      actor_id: like.user_id,
      post_id: post.id,
      body: `@${userById.get(like.user_id)?.username} liked your post`,
      read: rand() < 0.5,
      created_at: like.created_at,
    });
  }
  for (const comment of comments) {
    const post = postById.get(comment.post_id);
    if (!post || !recent(comment.created_at) || !cap(post.author_id)) continue;
    notifications.push({
      id: uuid(),
      user_id: post.author_id,
      type: 'comment',
      actor_id: comment.user_id,
      post_id: post.id,
      body: `@${userById.get(comment.user_id)?.username} commented on your post`,
      read: rand() < 0.35,
      created_at: comment.created_at,
    });
  }
  for (const rating of ratings) {
    if (!recent(rating.created_at) || rating.weight < 1 || !cap(rating.owner_id)) continue;
    notifications.push({
      id: uuid(),
      user_id: rating.owner_id,
      type: 'rating',
      actor_id: rating.rater_id,
      post_id: rating.target_type === 'post' ? rating.target_id : null,
      body: `@${userById.get(rating.rater_id)?.username} rated your ${
        rating.target_type === 'post' ? 'post' : 'profile'
      } ${rating.score}/10`,
      read: rand() < 0.4,
      created_at: rating.created_at,
    });
  }

  for (let i = 0; i < 3; i += 1) {
    const post = posts[Math.floor(rand() * posts.length)];
    reports.push({
      id: uuid(),
      reporter_id: users[Math.floor(rand() * users.length)].id,
      target_type: 'post',
      target_id: post.id,
      reason: pick(REPORT_REASONS),
      details: 'Flagged by a community member during onboarding testing.',
      status: 'open',
      resolution: null,
      created_at: iso(between(0, 4)),
    });
  }

  store.users = users;
  store.posts = posts;
  store.likes = likes;
  store.comments = comments;
  store.follows = follows;
  store.ratings = ratings;
  store.notifications = notifications.sort((a, b) => a.created_at.localeCompare(b.created_at));
  store.reports = reports;
  store.blocks = [];
  return store;
}

export function buildSeedStore(): Store {
  const empty: Store = {
    users: [],
    posts: [],
    likes: [],
    comments: [],
    follows: [],
    blocks: [],
    ratings: [],
    notifications: [],
    reports: [],
    messages: [],
  };
  return seedInto(empty);
}
