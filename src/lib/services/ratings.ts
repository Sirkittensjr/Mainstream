import 'server-only';
import { cache } from 'react';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import {
  PLATFORM_MEAN,
  PRIOR,
  clampRating,
  roundRating,
  scoreSignal,
  shrunkAverage,
  trendFor,
  type ReactionCount,
  type Trend,
  type WeightedSample,
} from '@/lib/ratings';
import { DAY } from '@/lib/time';
import {
  REACTIONS,
  type ID,
  type Rating,
  type RatingTarget,
  type Reaction,
  type User,
} from '@/lib/types';

const WINDOW_DAYS = 30;

/** Ratings a single account may cast before we stop counting them. */
export const RATE_LIMITS = { perHour: 25, perDay: 80 };

export interface PostRatingSummary {
  rating: number | null;
  count: number;
  reactions: ReactionCount[];
}

export interface RatingSignals {
  consistency: number;
  engagement: number;
  growth: number;
  participation: number;
  history: number;
}

export interface UserRatingSummary {
  overall: number;
  current: number;
  trend: Trend;
  delta: number;
  ratingsReceived: number;
  recentRatings: number;
  raters: number;
  reactions: ReactionCount[];
  signals: RatingSignals;
}

export interface RatingsIndex {
  posts: Map<ID, PostRatingSummary>;
  users: Map<ID, UserRatingSummary>;
}

function emptyUserSummary(): UserRatingSummary {
  return {
    overall: PLATFORM_MEAN,
    current: PLATFORM_MEAN,
    trend: 'steady',
    delta: 0,
    ratingsReceived: 0,
    recentRatings: 0,
    raters: 0,
    reactions: [],
    signals: { consistency: 0, engagement: 0, growth: 0, participation: 0, history: 0 },
  };
}

function countReactions(ratings: Rating[]): ReactionCount[] {
  const counts = new Map<Reaction, number>(REACTIONS.map((reaction) => [reaction, 0]));
  for (const rating of ratings) {
    for (const reaction of rating.reactions) {
      counts.set(reaction, (counts.get(reaction) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([reaction, count]) => ({ reaction, count }));
}

/**
 * Every rating on the platform, aggregated in one pass.
 *
 * Cached per request, so a page that shows a feed, a sidebar and a rank all
 * reads the same computation once. At this scale that is a few milliseconds;
 * the shape is deliberately the same one a materialised view would have.
 */
export const ratingsIndex = cache(async (): Promise<RatingsIndex> => {
  const store = db();
  const [users, posts, ratings, follows, comments, likes, activity] = await Promise.all([
    store.query('users'),
    store.query('posts'),
    store.query('ratings'),
    store.query('follows'),
    store.query('comments'),
    store.query('likes'),
    store.query('activity'),
  ]);

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_DAYS * DAY).toISOString();
  const previousWindowStart = new Date(now - WINDOW_DAYS * 2 * DAY).toISOString();

  /**
   * The prior every average is pulled toward is the platform's own weighted
   * mean, not a fixed guess. Using a constant below the real mean would drag
   * every overall rating down and make the current-vs-overall arrow point up
   * for everyone.
   */
  const totalWeight = ratings.reduce((sum, rating) => sum + rating.weight, 0);
  const platformMean =
    totalWeight >= 20
      ? ratings.reduce((sum, rating) => sum + rating.score * rating.weight, 0) / totalWeight
      : PLATFORM_MEAN;

  // --- posts ---------------------------------------------------------------
  const byPost = new Map<ID, Rating[]>();
  const byOwner = new Map<ID, Rating[]>();
  for (const rating of ratings) {
    if (rating.target_type === 'post') {
      const list = byPost.get(rating.target_id) ?? [];
      list.push(rating);
      byPost.set(rating.target_id, list);
    }
    const owned = byOwner.get(rating.owner_id) ?? [];
    owned.push(rating);
    byOwner.set(rating.owner_id, owned);
  }

  const postSummaries = new Map<ID, PostRatingSummary>();
  for (const post of posts) {
    const list = byPost.get(post.id) ?? [];
    const samples: WeightedSample[] = list.map((r) => ({ score: r.score, weight: r.weight }));
    const effective = samples.reduce((sum, s) => sum + s.weight, 0);
    postSummaries.set(post.id, {
      // Under a tenth of one full-weight rating there is nothing to show yet.
      rating:
        effective >= 0.1 ? roundRating(shrunkAverage(samples, PRIOR.post, platformMean)) : null,
      count: list.length,
      reactions: countReactions(list),
    });
  }

  // --- per-creator signals -------------------------------------------------
  const postsByAuthor = new Map<ID, typeof posts>();
  for (const post of posts) {
    if (post.removed) continue;
    const list = postsByAuthor.get(post.author_id) ?? [];
    list.push(post);
    postsByAuthor.set(post.author_id, list);
  }
  const postOwner = new Map<ID, ID>(posts.map((post) => [post.id, post.author_id]));

  const recentLikes = new Map<ID, number>();
  for (const like of likes) {
    if (like.created_at < windowStart) continue;
    const owner = postOwner.get(like.post_id);
    if (owner) recentLikes.set(owner, (recentLikes.get(owner) ?? 0) + 1);
  }
  const recentComments = new Map<ID, number>();
  for (const comment of comments) {
    if (comment.created_at < windowStart || comment.removed) continue;
    const owner = postOwner.get(comment.post_id);
    if (owner) recentComments.set(owner, (recentComments.get(owner) ?? 0) + 1);
  }
  const commentsGiven = new Map<ID, number>();
  for (const comment of comments) {
    commentsGiven.set(comment.user_id, (commentsGiven.get(comment.user_id) ?? 0) + 1);
  }

  const followerTotal = new Map<ID, number>();
  const followersGained = new Map<ID, number>();
  for (const follow of follows) {
    followerTotal.set(follow.following_id, (followerTotal.get(follow.following_id) ?? 0) + 1);
    if (follow.created_at >= windowStart) {
      followersGained.set(follow.following_id, (followersGained.get(follow.following_id) ?? 0) + 1);
    }
  }

  const challengeEntries = new Map<ID, number>();
  for (const entry of activity) {
    if (entry.type !== 'challenge_entry') continue;
    challengeEntries.set(entry.user_id, (challengeEntries.get(entry.user_id) ?? 0) + 1);
  }

  const userSummaries = new Map<ID, UserRatingSummary>();
  for (const user of users) {
    userSummaries.set(user.id, summarise(user));
  }

  function summarise(user: User): UserRatingSummary {
    const received = byOwner.get(user.id) ?? [];
    const samples: WeightedSample[] = received.map((r) => ({ score: r.score, weight: r.weight }));
    const authored = postsByAuthor.get(user.id) ?? [];
    const ageDays = Math.max(0, (now - new Date(user.created_at).getTime()) / DAY);

    const postsInWindow = authored.filter((post) => post.created_at >= windowStart).length;
    const followers = followerTotal.get(user.id) ?? 0;
    const engagementInWindow =
      (recentLikes.get(user.id) ?? 0) + (recentComments.get(user.id) ?? 0) * 2;

    const signals: RatingSignals = {
      // Showing up: roughly one post a week is a healthy cadence.
      consistency: scoreSignal(postsInWindow, 4),
      // Response per post, relative to how many people already follow you.
      engagement: scoreSignal(
        authored.length > 0 ? engagementInWindow / authored.length / Math.sqrt(followers + 6) : 0,
        1.6,
      ),
      growth: scoreSignal((followersGained.get(user.id) ?? 0) / Math.sqrt(followers + 6), 1.2),
      participation: scoreSignal(
        (challengeEntries.get(user.id) ?? 0) * 3 + (commentsGiven.get(user.id) ?? 0),
        14,
      ),
      history: scoreSignal(ageDays, 45),
    };

    const signalScore =
      signals.consistency * 0.24 +
      signals.engagement * 0.3 +
      signals.growth * 0.18 +
      signals.participation * 0.16 +
      signals.history * 0.12;

    // Overall is anchored to what people actually said. The behavioural
    // signals adjust it around a neutral midpoint rather than averaging into
    // it — otherwise every small account would sit below its own ratings.
    const allTimeAverage = shrunkAverage(samples, PRIOR.userOverall, platformMean);
    const adjustment = Math.max(-0.8, Math.min(0.8, (signalScore - 5.5) * 0.14));
    const overall = clampRating(allTimeAverage + adjustment);

    // Current starts from overall and is moved by the last 30 days only, so it
    // reacts fast without inventing a number out of nothing.
    const recent = received.filter((rating) => rating.updated_at >= windowStart);
    const recentSamples: WeightedSample[] = recent.map((r) => ({
      score: r.score,
      weight: r.weight,
    }));
    // The same adjustment is applied to both numbers, so the gap between them
    // is purely "what people have said lately vs what they have said overall".
    const recentAverage = shrunkAverage(recentSamples, PRIOR.userCurrent, allTimeAverage);
    let current = recentAverage + adjustment;

    // Current is driven by what people said recently. Activity only nudges it,
    // so the gap between current and overall stays meaningful.
    if (postsInWindow === 0 && recent.length === 0 && engagementInWindow === 0) {
      // Gone quiet: current drifts down while overall stays put.
      const lastPost = authored[0]?.created_at ?? user.created_at;
      const quietDays = Math.max(0, (now - new Date(lastPost).getTime()) / DAY - WINDOW_DAYS);
      current -= Math.min(1.5, 0.35 + quietDays * 0.03);
    } else if (postsInWindow >= 2) {
      current += Math.min(0.25, (postsInWindow - 1) * 0.08);
    }

    // Movement is measured window over window — the last 30 days against the
    // 30 before that. Comparing current against overall would show an arrow up
    // for every above-average creator forever, which says nothing.
    const previous = received.filter(
      (rating) => rating.updated_at >= previousWindowStart && rating.updated_at < windowStart,
    );
    const previousAverage = shrunkAverage(
      previous.map((r) => ({ score: r.score, weight: r.weight })),
      PRIOR.userCurrent,
      allTimeAverage,
    );
    const baseline = previous.length >= 3 ? previousAverage : allTimeAverage;
    const movement = Math.round((recentAverage - baseline) * 10) / 10;

    const overallRounded = roundRating(overall);
    const currentRounded = roundRating(current);
    return {
      overall: overallRounded,
      current: currentRounded,
      trend: trendFor(recentAverage, baseline),
      delta: movement,
      ratingsReceived: received.length,
      recentRatings: recent.length,
      raters: new Set(received.map((rating) => rating.rater_id)).size,
      reactions: countReactions(received),
      signals,
    };
  }

  return { posts: postSummaries, users: userSummaries };
});

export async function postRating(postId: ID): Promise<PostRatingSummary> {
  const index = await ratingsIndex();
  return index.posts.get(postId) ?? { rating: null, count: 0, reactions: [] };
}

export async function userRating(userId: ID): Promise<UserRatingSummary> {
  const index = await ratingsIndex();
  return index.users.get(userId) ?? emptyUserSummary();
}

/** What the signed-in viewer already gave this target, if anything. */
export async function myRating(
  raterId: ID | null,
  targetType: RatingTarget,
  targetId: ID,
): Promise<{ score: number; reactions: Reaction[] } | null> {
  if (!raterId) return null;
  const rows = await db().query('ratings', {
    where: { rater_id: raterId, target_type: targetType, target_id: targetId },
  });
  const rating = rows[0];
  return rating ? { score: rating.score, reactions: rating.reactions } : null;
}

export async function myRatingsForPosts(
  raterId: ID | null,
  postIds: ID[],
): Promise<Map<ID, number>> {
  if (!raterId || postIds.length === 0) return new Map();
  const rows = await db().query('ratings', {
    where: { rater_id: raterId, target_type: 'post' },
    in: { target_id: postIds },
  });
  return new Map(rows.map((row) => [row.target_id, row.score]));
}

// ---------------------------------------------------------------------------
// Casting a rating
// ---------------------------------------------------------------------------

import { checkRateLimit, raterWeight } from './rating-integrity';
import { award } from './points';
import { notify } from './notifications';
import { isBlockedEitherWay } from './users';

export interface SubmitRatingInput {
  raterId: ID;
  targetType: RatingTarget;
  targetId: ID;
  score: number;
  reactions: Reaction[];
}

export type SubmitResult =
  | { ok: true; score: number; updated: boolean }
  | { ok: false; error: string };

/**
 * One rating per person per target. Rating again updates what you said rather
 * than stacking, and the integrity weight is recomputed every time.
 */
export async function submitRating(input: SubmitRatingInput): Promise<SubmitResult> {
  const score = Math.round(input.score);
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    return { ok: false, error: 'Pick a score between 1 and 10.' };
  }
  const reactions = input.reactions.filter((reaction) => REACTIONS.includes(reaction)).slice(0, 6);

  const store = db();
  const rater = await store.get('users', input.raterId);
  if (!rater) return { ok: false, error: 'Sign in to rate.' };
  if (rater.status !== 'active') {
    return { ok: false, error: 'Your account cannot rate right now.' };
  }

  // Who owns the thing being rated?
  let ownerId: ID;
  if (input.targetType === 'post') {
    const post = await store.get('posts', input.targetId);
    if (!post || post.removed) return { ok: false, error: 'That post is no longer available.' };
    ownerId = post.author_id;
  } else {
    const user = await store.get('users', input.targetId);
    if (!user || user.status === 'banned') return { ok: false, error: 'That profile is not available.' };
    ownerId = user.id;
  }

  if (ownerId === rater.id) {
    return { ok: false, error: 'You cannot rate your own work.' };
  }
  if (await isBlockedEitherWay(rater.id, ownerId)) {
    return { ok: false, error: 'You cannot rate this account.' };
  }

  const existing = (
    await store.query('ratings', {
      where: { rater_id: rater.id, target_type: input.targetType, target_id: input.targetId },
    })
  )[0];

  if (!existing) {
    const limit = await checkRateLimit(rater.id);
    if (!limit.ok) return { ok: false, error: limit.error };
  }

  const given = await store.query('ratings', { where: { rater_id: rater.id } });
  const { weight } = raterWeight(
    rater,
    given.filter((rating) => rating.id !== existing?.id),
    ownerId,
  );
  const nowIso = new Date().toISOString();

  if (existing) {
    await store.update('ratings', existing.id, {
      score,
      reactions,
      weight,
      updated_at: nowIso,
    });
    return { ok: true, score, updated: true };
  }

  await store.insert('ratings', {
    id: newId(),
    rater_id: rater.id,
    target_type: input.targetType,
    target_id: input.targetId,
    owner_id: ownerId,
    score,
    reactions,
    weight,
    created_at: nowIso,
    updated_at: nowIso,
  });

  await award(rater.id, 'rating_given', { points: 1 });
  await award(ownerId, 'rating_received', {
    points: 2,
    postId: input.targetType === 'post' ? input.targetId : null,
  });
  await notify({
    userId: ownerId,
    type: 'rating',
    actorId: rater.id,
    postId: input.targetType === 'post' ? input.targetId : null,
    body:
      input.targetType === 'post'
        ? `@${rater.username} rated your post ${score}/10`
        : `@${rater.username} rated your profile ${score}/10`,
  });

  return { ok: true, score, updated: false };
}
