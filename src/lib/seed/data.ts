import { scryptSync } from 'node:crypto';
import type { Schema, TableName } from '@/lib/db/types';
import { POINTS } from '@/lib/progression';
import { slugify } from '@/lib/ids';
import type {
  Activity,
  ActivityType,
  Category,
  Challenge,
  Comment,
  Follow,
  Like,
  Notification,
  Post,
  RankSnapshot,
  Rating,
  Reaction,
  Report,
  User,
} from '@/lib/types';
import {
  FILLER_BIOS,
  FILLER_CAPTIONS,
  FIRST_NAMES,
  HANDLE_SUFFIXES,
  SEED_CREATORS,
} from './content';

type Store = { [K in TableName]: Schema[K][] };

/** Every sample account shares this password so the demo is easy to explore. */
export const SEED_PASSWORD = 'faydemo123';
export const DEMO_LOGIN = { email: 'tommy@faytarra.app', password: SEED_PASSWORD };
export const ADMIN_LOGIN = { email: 'admin@faytarra.app', password: SEED_PASSWORD };

const DAY = 86_400_000;
/** Fixed clock reference so "days ago" values stay sensible after seeding. */
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

/** Deterministic hash so the seeded dataset is byte-stable across runs. */
const SEED_SALT = Buffer.from('726973657365656473616c7476616c75', 'hex');
const SEED_HASH = `scrypt$${SEED_SALT.toString('hex')}$${scryptSync(
  SEED_PASSWORD,
  SEED_SALT,
  64,
).toString('hex')}`;

const CHALLENGE_DEFS: {
  title: string;
  description: string;
  category: Category | 'Any';
  startsDaysAgo: number;
  endsInDays: number;
}[] = [
  {
    title: '30 Second Talent',
    description:
      'Post a video showing something you are good at. Thirty seconds, no intro, no build up. Just the thing you can do.',
    category: 'Any',
    startsDaysAgo: 3,
    endsInDays: 4,
  },
  {
    title: 'Show Your Setup',
    description:
      'Desk, studio, kitchen, garage, corner of your bedroom. Show us where you actually make things.',
    category: 'Any',
    startsDaysAgo: 10,
    endsInDays: 6,
  },
  {
    title: 'Make Something',
    description: 'Start it and finish it in one day. Post the result, however rough it is.',
    category: 'Art',
    startsDaysAgo: 6,
    endsInDays: 8,
  },
  {
    title: '60 Second Story',
    description: 'One minute. One true story about you. No script required.',
    category: 'Other',
    startsDaysAgo: 1,
    endsInDays: 12,
  },
  {
    title: 'Best Transformation',
    description: 'Before and after. Body, skill, room, business, anything you have changed.',
    category: 'Fitness',
    startsDaysAgo: 24,
    endsInDays: -3,
  },
  {
    title: 'Make Someone Laugh',
    description: 'Thirty seconds to get one laugh out of a stranger. Good luck.',
    category: 'Comedy',
    startsDaysAgo: -2,
    endsInDays: 14,
  },
  {
    title: 'Small Business Challenge',
    description:
      'Show the thing you sell and the story behind it. The community picks who gets featured.',
    category: 'Business',
    startsDaysAgo: -5,
    endsInDays: 18,
  },
];

const REPORT_REASONS = ['Spam or scam', 'Harassment', 'Hate speech', 'Impersonation'];

/**
 * Fills an empty store with a believable community: 24 hand written creators,
 * a supporting cast of ~140 accounts, their posts, likes, comments, follows,
 * challenge entries, notifications and FayTarra point history.
 */
export function seedInto(store: Store): Store {
  const users: User[] = [];
  const posts: Post[] = [];
  const likes: Like[] = [];
  const comments: Comment[] = [];
  const follows: Follow[] = [];
  const notifications: Notification[] = [];
  const activity: Activity[] = [];
  const reports: Report[] = [];
  const ratings: Rating[] = [];
  const snapshots: RankSnapshot[] = [];

  const points = new Map<string, number>();
  const addPoints = (
    userId: string,
    type: ActivityType,
    value: number,
    at: string,
    postId: string | null = null,
    challengeId: string | null = null,
  ) => {
    points.set(userId, (points.get(userId) ?? 0) + value);
    // Only recent history is materialised — it is what drives weekly
    // rankings and the journey timeline.
    if (NOW - new Date(at).getTime() < 21 * DAY || type === 'post' || type === 'challenge_entry') {
      activity.push({
        id: uuid(),
        user_id: userId,
        type,
        points: value,
        post_id: postId,
        challenge_id: challengeId,
        created_at: at,
      });
    }
  };

  // --- challenges ---------------------------------------------------------
  const challenges: Challenge[] = CHALLENGE_DEFS.map((def) => ({
    id: uuid(),
    slug: slugify(def.title),
    title: def.title,
    description: def.description,
    category: def.category,
    starts_at: new Date(NOW - def.startsDaysAgo * DAY).toISOString(),
    ends_at: new Date(NOW + def.endsInDays * DAY).toISOString(),
    featured_post_ids: [],
    created_at: new Date(NOW - (def.startsDaysAgo + 2) * DAY).toISOString(),
  }));
  const liveChallenges = challenges.filter(
    (c) => new Date(c.starts_at).getTime() <= NOW && new Date(c.ends_at).getTime() >= NOW,
  );

  // --- admin account ------------------------------------------------------
  const admin: User = {
    id: uuid(),
    email: ADMIN_LOGIN.email,
    username: 'faytarra',
    display_name: 'FayTarra Team',
    password_hash: SEED_HASH,
    bio: 'We run the challenges and keep this place safe. Everyone starts at zero.',
    avatar_url: null,
    location: 'Everywhere',
    interests: ['Creator'],
    goal: 'Get 1,000 unknown creators discovered',
    role: 'admin',
    status: 'active',
    status_reason: null,
    trusted: true,
    points: 0,
    created_at: iso(120, 0),
    last_active_at: iso(0, 1),
  };
  users.push(admin);

  // --- hand written creators ---------------------------------------------
  const creatorUsers: { user: User; pull: number; category: Category }[] = [];
  for (const creator of SEED_CREATORS) {
    const user: User = {
      id: uuid(),
      email: `${creator.username}@faytarra.app`,
      username: creator.username,
      display_name: creator.display_name,
      password_hash: SEED_HASH,
      bio: creator.bio,
      avatar_url: null,
      location: creator.location,
      interests: creator.interests,
      goal: creator.goal,
      role: 'user',
      status: 'active',
      status_reason: null,
      trusted: true,
      points: 0,
      created_at: iso(creator.joinedDaysAgo),
      last_active_at: iso(between(0, 2)),
    };
    users.push(user);
    creatorUsers.push({ user, pull: creator.pull, category: creator.category });

    creator.posts.forEach((postDef, index) => {
      const challenge =
        index === 0 && liveChallenges.length > 0 && rand() < 0.45 ? pick(liveChallenges) : null;
      const created = iso(postDef.daysAgo);
      const post: Post = {
        id: uuid(),
        author_id: user.id,
        caption: postDef.caption,
        media: [coverMedia(`${creator.username}-${index}`, creator.category)],
        category: creator.category,
        tags: postDef.tags,
        challenge_id: challenge?.id ?? null,
        shot: Boolean(postDef.shot),
        shot_stage: 0,
        impressions: 0,
        boosted: false,
        views: 0,
        featured: false,
        featured_at: null,
        removed: false,
        removed_reason: null,
        created_at: created,
      };
      posts.push(post);
      addPoints(user.id, 'post', POINTS.post, created, post.id);
      if (challenge) {
        addPoints(user.id, 'challenge_entry', POINTS.challenge_entry, created, post.id, challenge.id);
      }
    });

    // Back catalogue for the established accounts. Without older posts there
    // is no month-over-month rating history to compare against.
    if (creator.joinedDaysAgo > 60) {
      const archive = between(3, 6);
      for (let i = 0; i < archive; i += 1) {
        const daysAgo = between(35, creator.joinedDaysAgo - 5);
        const created = iso(daysAgo);
        const post: Post = {
          id: uuid(),
          author_id: user.id,
          caption: pick(FILLER_CAPTIONS[creator.category]),
          media: [coverMedia(`${creator.username}-archive-${i}`, creator.category)],
          category: creator.category,
          tags: [creator.category.toLowerCase()],
          challenge_id: null,
          shot: false,
          shot_stage: 0,
          impressions: 0,
          boosted: false,
          views: 0,
          featured: false,
          featured_at: null,
          removed: false,
          removed_reason: null,
          created_at: created,
        };
        posts.push(post);
        addPoints(user.id, 'post', POINTS.post, created, post.id);
      }
    }
  }

  // --- supporting cast ----------------------------------------------------
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
      password_hash: SEED_HASH,
      bio: pick(FILLER_BIOS),
      avatar_url: null,
      location: null,
      interests: [pick(['Creator', 'Musician', 'Gamer', 'Athlete', 'Artist', 'Comedian'] as const)],
      goal: pick(['100 followers', '1,000 followers', 'Get featured once', 'Finish what I start']),
      role: 'user',
      status: 'active',
      status_reason: null,
      trusted: true,
      points: 0,
      created_at: iso(joined),
      last_active_at: iso(between(0, 6)),
    };
    users.push(user);

    const postCount = between(0, 2);
    for (let p = 0; p < postCount; p += 1) {
      const daysAgo = between(0, Math.min(joined, 20));
      const challenge = liveChallenges.length > 0 && rand() < 0.22 ? pick(liveChallenges) : null;
      const created = iso(daysAgo);
      const post: Post = {
        id: uuid(),
        author_id: user.id,
        caption: pick(FILLER_CAPTIONS[category]),
        media: [coverMedia(`${username}-${p}`, category)],
        category,
        tags: [category.toLowerCase()],
        challenge_id: challenge?.id ?? null,
        shot: rand() < 0.18,
        shot_stage: 0,
        impressions: 0,
        boosted: false,
        views: 0,
        featured: false,
        featured_at: null,
        removed: false,
        removed_reason: null,
        created_at: created,
      };
      posts.push(post);
      addPoints(user.id, 'post', POINTS.post, created, post.id);
      if (challenge) {
        addPoints(user.id, 'challenge_entry', POINTS.challenge_entry, created, post.id, challenge.id);
      }
    }
  }

  // --- follows ------------------------------------------------------------
  const pullOf = new Map<string, number>(users.map((u) => [u.id, 1]));
  for (const entry of creatorUsers) pullOf.set(entry.user.id, entry.pull);
  pullOf.set(admin.id, 14);

  // Follower counts are modelled per creator (audience size x how long they
  // have been here) rather than drawn at random, so the spread looks like a
  // real platform: a few people with a hundred-odd followers, plenty with five.
  const joinedDaysAgo = (user: User) =>
    (NOW - new Date(user.created_at).getTime()) / DAY;

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
      // A follow can only have happened once both accounts existed.
      const window = Math.min(joinedDaysAgo(target), joinedDaysAgo(follower), 30);
      const at = iso(Math.max(0, rand() * window));
      follows.push({
        id: uuid(),
        follower_id: follower.id,
        following_id: target.id,
        created_at: at,
      });
      addPoints(target.id, 'follow_received', POINTS.follow_received, at);
      addPoints(follower.id, 'follow_given', POINTS.follow_given, at);
    }
  }

  // --- likes, comments, views --------------------------------------------
  const COMMENT_BODIES = [
    'this is actually so good',
    'how long did this take??',
    'followed. keep going.',
    'the ending got me',
    'you are going to blow up',
    'ok this deserves more eyes',
    'saved this one',
    'day 1 fan',
    'respect for posting this',
    'do more of these',
  ];

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
      const at = iso(Math.max(0, ageDays - rand() * 1.5));
      likes.push({ id: uuid(), post_id: post.id, user_id: liker.id, created_at: at });
      addPoints(post.author_id, 'like_received', POINTS.like_received, at, post.id);
      addPoints(liker.id, 'like_given', POINTS.like_given, at, post.id);
    }

    const commentCount = Math.round(likers.size * (0.06 + rand() * 0.12));
    for (let i = 0; i < commentCount; i += 1) {
      const author = users[Math.floor(rand() * users.length)];
      if (author.id === post.author_id) continue;
      const at = iso(Math.max(0, ageDays - rand()));
      comments.push({
        id: uuid(),
        post_id: post.id,
        user_id: author.id,
        body: pick(COMMENT_BODIES),
        removed: false,
        created_at: at,
      });
      addPoints(post.author_id, 'comment_received', POINTS.comment_received, at, post.id);
      addPoints(author.id, 'comment_given', POINTS.comment_given, at, post.id);
    }

    post.views = Math.round(likers.size * between(9, 34) + between(10, 200));
  }

  // --- ratings ------------------------------------------------------------
  // Each post gets a hidden "true quality"; raters sample around it with
  // noise, which produces a believable spread instead of everything at 8.
  const REACTION_POOL: Reaction[] = [
    'Fire',
    'Funny',
    'Creative',
    'Interesting',
    'Love It',
    'Would Collaborate',
  ];

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
    addPoints(ownerId, 'rating_received', 2, at, targetType === 'post' ? targetId : null);
    addPoints(raterId, 'rating_given', 1, at);
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
      // Most ratings land in the recent window so Current has something to say.
      // Recent posts are rated soon after posting; older posts keep collecting
      // ratings, which is what gives a creator month-over-month movement.
      const at = iso(rand() < 0.55 ? rand() * Math.min(ageDays, 28) : rand() * Math.min(ageDays, 75));
      rate(rater.id, 'post', post.id, post.author_id, quality + noise, at);
    }
  }

  // A handful of profile ratings for the hand written creators.
  for (const entry of creatorUsers) {
    const wanted = between(2, 9);
    const base = 6.6 + Math.min(3, entry.pull * 0.28) + rand();
    const used = new Set<string>();
    for (let i = 0; i < wanted; i += 1) {
      const rater = users[Math.floor(rand() * users.length)];
      if (rater.id === entry.user.id || used.has(rater.id)) continue;
      used.add(rater.id);
      rate(
        rater.id,
        'user',
        entry.user.id,
        entry.user.id,
        base + (rand() - 0.5) * 1.8,
        iso(rand() * 30),
      );
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
        password_hash: SEED_HASH,
        bio: 'big fan',
        avatar_url: null,
        location: null,
        interests: ['Creator'],
        goal: '100 followers',
        role: 'user',
        status: 'active',
        status_reason: null,
        trusted: true,
        points: 0,
        created_at: iso(between(1, 4)),
        last_active_at: iso(0),
      };
      users.push(ringAccount);
      for (const post of ringPosts) {
        // Deliberately the pattern the weighting is designed to catch:
        // brand new account, everything a 10, all aimed at one creator.
        rate(ringAccount.id, 'post', post.id, post.author_id, 10, iso(rand() * 2), 0.25);
      }
      rate(ringAccount.id, 'user', ringTarget.user.id, ringTarget.user.id, 10, iso(rand()), 0.25);
      // A couple of decoy ratings elsewhere, which is what a real ring does to
      // look ordinary — and what the concentration check sees straight through.
      for (let d = 0; d < 2; d += 1) {
        const other = posts[Math.floor(rand() * posts.length)];
        if (other.author_id === ringTarget.user.id) continue;
        rate(ringAccount.id, 'post', other.id, other.author_id, between(7, 9), iso(rand() * 3), 0.25);
      }
    }
  }

  // --- featured posts -----------------------------------------------------
  const featuredPool = [...posts]
    .filter((post) => post.shot || post.challenge_id)
    .sort((a, b) => b.views - a.views)
    .slice(0, 6);
  for (const post of featuredPool.slice(0, 4)) {
    post.featured = true;
    post.featured_at = iso(between(1, 6));
    addPoints(post.author_id, 'featured', POINTS.featured, post.featured_at, post.id);
    notifications.push({
      id: uuid(),
      user_id: post.author_id,
      type: 'featured',
      actor_id: null,
      post_id: post.id,
      challenge_id: post.challenge_id,
      body: 'Your post was featured on Discover.',
      read: false,
      created_at: post.featured_at,
    });
  }
  for (const challenge of challenges) {
    challenge.featured_post_ids = posts
      .filter((post) => post.challenge_id === challenge.id)
      .sort((a, b) => b.views - a.views)
      .slice(0, 3)
      .map((post) => post.id);
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
      challenge_id: null,
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
      type: post.challenge_id ? 'challenge_entry' : 'like',
      actor_id: like.user_id,
      post_id: post.id,
      challenge_id: post.challenge_id,
      body: `@${userById.get(like.user_id)?.username} liked your ${
        post.challenge_id ? 'challenge entry' : 'post'
      }`,
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
      challenge_id: post.challenge_id,
      body: `@${userById.get(comment.user_id)?.username} commented on your post`,
      read: rand() < 0.35,
      created_at: comment.created_at,
    });
  }
  for (const challenge of liveChallenges.slice(0, 1)) {
    for (const entry of creatorUsers.slice(0, 6)) {
      notifications.push({
        id: uuid(),
        user_id: entry.user.id,
        type: 'challenge_ending',
        actor_id: null,
        post_id: null,
        challenge_id: challenge.id,
        body: `${challenge.title} is ending soon — entries close in a few days.`,
        read: false,
        created_at: iso(1),
      });
    }
  }

  // --- a couple of open reports so moderation has something to show -------
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

  for (const user of users) user.points = Math.max(0, Math.round(points.get(user.id) ?? 0));

  // --- rank history --------------------------------------------------------
  // Real ranks are computed live from ratings; these are the frozen monthly
  // captures that let a profile show the climb it has already made.
  const byPoints = [...users].sort((a, b) => b.points - a.points);
  const finalRank = new Map(byPoints.map((user, index) => [user.id, index + 1]));
  for (let monthsAgo = 4; monthsAgo >= 1; monthsAgo -= 1) {
    const when = new Date(NOW - monthsAgo * 30 * DAY);
    const key = when.toISOString().slice(0, 7);
    for (const user of users) {
      const joinedDays = (NOW - new Date(user.created_at).getTime()) / DAY;
      if (joinedDays < monthsAgo * 30) continue; // did not exist yet
      const target = finalRank.get(user.id) ?? users.length;
      const drift = 1 + monthsAgo * (0.35 + rand() * 0.5);
      const rank = Math.max(1, Math.min(users.length, Math.round(target * drift)));
      snapshots.push({
        id: uuid(),
        user_id: user.id,
        period: key,
        overall_rank: rank,
        current_rank: Math.max(1, Math.round(rank * (0.8 + rand() * 0.5))),
        rising_rank: Math.max(1, Math.round(rank * (0.6 + rand() * 0.8))),
        overall_rating: Math.round((6.4 + (1 - target / users.length) * 2.6) * 10) / 10,
        current_rating: Math.round((6.2 + (1 - target / users.length) * 3) * 10) / 10,
        created_at: when.toISOString(),
      });
    }
  }

  store.users = users;
  store.posts = posts;
  store.likes = likes;
  store.comments = comments;
  store.follows = follows;
  store.challenges = challenges;
  store.ratings = ratings;
  store.rank_snapshots = snapshots;
  store.notifications = notifications.sort((a, b) => a.created_at.localeCompare(b.created_at));
  store.reports = reports;
  store.activity = activity;
  store.blocks = [];
  return store;
}

/**
 * Sample media points at the app's own generated cover art route, so a fresh
 * install looks populated without depending on any external image host.
 */
function coverMedia(seed: string, category: Category) {
  return { kind: 'image' as const, url: `/api/cover/${encodeURIComponent(`${category}-${seed}`)}` };
}

export function buildSeedStore(): Store {
  const empty: Store = {
    users: [],
    posts: [],
    likes: [],
    comments: [],
    follows: [],
    blocks: [],
    challenges: [],
    ratings: [],
    rank_snapshots: [],
    notifications: [],
    reports: [],
    activity: [],
  };
  return seedInto(empty);
}
