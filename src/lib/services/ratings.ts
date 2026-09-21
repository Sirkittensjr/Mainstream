import 'server-only';
import { cache } from 'react';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import {
  MIN_VOTES_FOR_RANKING,
  PLATFORM_MEAN,
  PRIOR_VOTES,
  bayesianRating,
  effectiveVotes,
  rankingScore,
  roundRating,
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
} from '@/lib/types';

const WINDOW_DAYS = 30;

export interface PostRatingSummary {
  /** The number shown on the post. Null until somebody has rated it. */
  rating: number | null;
  /** Trustworthy evidence behind it, after integrity weighting. */
  votes: number;
  /** Ordering key — see src/lib/ratings.ts. */
  score: number;
  reactions: ReactionCount[];
}

export interface UserRatingSummary {
  /** Long-term rating across everything this person has ever been rated on. */
  overall: number;
  overallVotes: number;
  /** How the community has rated them over the last 30 days. */
  recent: number;
  recentVotes: number;
  trend: Trend;
  /** Movement of the last 30 days against the 30 before it. */
  delta: number;
  /** Ordering keys for the rankings. */
  overallScore: number;
  recentScore: number;
  rankable: boolean;
  reactions: ReactionCount[];
}

export interface RatingsIndex {
  posts: Map<ID, PostRatingSummary>;
  users: Map<ID, UserRatingSummary>;
  platformMean: number;
}

function countReactions(ratings: Rating[]): ReactionCount[] {
  const counts = new Map<string, number>(REACTIONS.map((reaction) => [reaction, 0]));
  for (const rating of ratings) {
    for (const reaction of rating.reactions) {
      counts.set(reaction, (counts.get(reaction) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([reaction, count]) => ({ reaction, count }));
}

const toSamples = (ratings: Rating[]): WeightedSample[] =>
  ratings.map((rating) => ({ score: rating.score, weight: rating.weight }));

/**
 * Every rating on the platform, aggregated in one pass and cached per request
 * so a page that shows a feed, a sidebar and a ranking computes it once.
 */
export const ratingsIndex = cache(async (): Promise<RatingsIndex> => {
  const store = db();
  const [posts, ratings, users] = await Promise.all([
    store.query('posts'),
    store.query('ratings'),
    store.query('users'),
  ]);

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_DAYS * DAY).toISOString();
  const previousStart = new Date(now - WINDOW_DAYS * 2 * DAY).toISOString();

  /**
   * The prior is the platform's own weighted mean, not a fixed guess. A
   * constant below the real mean would drag every rating down and make the
   * 30-day arrow point up for everyone.
   */
  const allWeight = effectiveVotes(toSamples(ratings));
  const platformMean =
    allWeight >= 20
      ? ratings.reduce((sum, r) => sum + r.score * r.weight, 0) / allWeight
      : PLATFORM_MEAN;

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
    const samples = toSamples(list);
    const votes = effectiveVotes(samples);
    postSummaries.set(post.id, {
      rating: votes >= 0.1 ? roundRating(bayesianRating(samples, PRIOR_VOTES.post, platformMean)) : null,
      votes: Math.round(votes * 10) / 10,
      score: rankingScore(samples, PRIOR_VOTES.post, platformMean),
      reactions: countReactions(list),
    });
  }

  const userSummaries = new Map<ID, UserRatingSummary>();
  for (const user of users) {
    const received = byOwner.get(user.id) ?? [];
    const all = toSamples(received);
    const overallRaw = bayesianRating(all, PRIOR_VOTES.userOverall, platformMean);
    const overall = roundRating(overallRaw);

    // The last 30 days start from the person's own long-term rating and move
    // as new ratings arrive, so a quiet month reads as "no change" rather than
    // a collapse to the platform average.
    const recentRatings = received.filter((rating) => rating.updated_at >= windowStart);
    const recentSamples = toSamples(recentRatings);
    const recentRaw = bayesianRating(recentSamples, PRIOR_VOTES.userRecent, overallRaw);
    const recent = roundRating(recentRaw);

    // Movement is measured window over window. Comparing the recent rating
    // against the overall one would show an arrow up for every above-average
    // person forever, which tells you nothing.
    const previous = received.filter(
      (rating) => rating.updated_at >= previousStart && rating.updated_at < windowStart,
    );
    const baseline =
      previous.length >= 3
        ? bayesianRating(toSamples(previous), PRIOR_VOTES.userRecent, overallRaw)
        : overallRaw;

    userSummaries.set(user.id, {
      overall,
      overallVotes: Math.round(effectiveVotes(all) * 10) / 10,
      recent,
      recentVotes: Math.round(effectiveVotes(recentSamples) * 10) / 10,
      trend: trendFor(recentRaw, baseline),
      delta: Math.round((recentRaw - baseline) * 10) / 10,
      overallScore: rankingScore(all, PRIOR_VOTES.userOverall, platformMean),
      recentScore: rankingScore(recentSamples, PRIOR_VOTES.userRecent, overallRaw),
      rankable: effectiveVotes(all) >= MIN_VOTES_FOR_RANKING,
      reactions: countReactions(received),
    });
  }

  return { posts: postSummaries, users: userSummaries, platformMean };
});

function emptyUser(): UserRatingSummary {
  return {
    overall: PLATFORM_MEAN,
    overallVotes: 0,
    recent: PLATFORM_MEAN,
    recentVotes: 0,
    trend: 'steady',
    delta: 0,
    overallScore: 0,
    recentScore: 0,
    rankable: false,
    reactions: [],
  };
}

export async function postRating(postId: ID): Promise<PostRatingSummary> {
  const index = await ratingsIndex();
  return index.posts.get(postId) ?? { rating: null, votes: 0, score: 0, reactions: [] };
}

export async function userRating(userId: ID): Promise<UserRatingSummary> {
  const index = await ratingsIndex();
  return index.users.get(userId) ?? emptyUser();
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

  let ownerId: ID;
  if (input.targetType === 'post') {
    const post = await store.get('posts', input.targetId);
    if (!post || post.removed) return { ok: false, error: 'That post is no longer available.' };
    ownerId = post.author_id;
  } else {
    const user = await store.get('users', input.targetId);
    if (!user || user.status === 'banned') {
      return { ok: false, error: 'That profile is not available.' };
    }
    ownerId = user.id;
  }

  if (ownerId === rater.id) return { ok: false, error: 'You cannot rate your own work.' };
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
  const [posted, commented] = await Promise.all([
    store.query('posts', { where: { author_id: rater.id } }),
    store.query('comments', { where: { user_id: rater.id } }),
  ]);
  const { weight } = raterWeight(
    { ...rater, contributions: posted.length + commented.length },
    given.filter((rating) => rating.id !== existing?.id),
    ownerId,
  );
  const nowIso = new Date().toISOString();

  if (existing) {
    await store.update('ratings', existing.id, { score, reactions, weight, updated_at: nowIso });
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
