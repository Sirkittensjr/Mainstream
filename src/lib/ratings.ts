/**
 * FayTarra rating maths.
 *
 * Pure functions only — shared by the server (aggregation, ranking) and the
 * client (display).
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 * A raw average is a terrible ranking key. Someone with a 10.0 from three
 * friends is not doing better than someone with a 9.2 from eight hundred
 * strangers, but a naive `ORDER BY avg(score)` says they are. Ratings carry
 * two pieces of information — how high, and how sure — and a ranking has to
 * use both.
 *
 * FayTarra therefore computes two different numbers from the same votes:
 *
 *   1. `bayesianRating` — the number people SEE.
 *      A weighted average pulled toward the platform mean by a prior worth
 *      `priorVotes` imaginary average votes. With few votes you mostly see the
 *      platform mean; evidence moves you off it. This is what stops a single
 *      10/10 from displaying as a perfect 10.0.
 *
 *   2. `rankingScore` — the number used to ORDER people and posts.
 *      The Bayesian rating minus a confidence penalty, `z · σ / √n`, which is
 *      the lower bound of a confidence interval. More votes shrink the penalty
 *      toward zero; few votes pay a large one. Two things with the same
 *      average always order by how much evidence stands behind them.
 *
 * On top of that, `MIN_VOTES_FOR_RANKING` keeps anything with a handful of
 * votes off the rankings altogether. This is the blunt, reliable guarantee
 * that a brand new account cannot land at #1 off six votes, and it holds no
 * matter where the ratings sit on the scale.
 *
 * Worked example (1–10 scale, platform mean 7.0, priorVotes 8, z 1.6):
 *
 *   A: 9.4 average from 1,000 votes
 *      displayed  = (1000·9.4 + 8·7.0) / 1008          = 9.381
 *      ranking    = 9.381 − 1.6·1.4/√1008              = 9.310
 *
 *   B: 10.0 average from 6 votes
 *      displayed  = (6·10.0 + 8·7.0) / 14              = 8.286
 *      ranking    = excluded — 6 votes is below the floor
 *
 * A ranks above B, which is the point. Had B cleared the floor, its ranking
 * score (8.286 − 1.6·1.4/√14 = 7.687) would still sit well below A's.
 *
 * Note on scale: these rules are monotone in the average, so among items that
 * clear the vote floor a genuinely higher-rated item still wins. The floor,
 * not the arithmetic, is what protects the top of the board from tiny samples.
 */

/** Fallback centre of the scale, used until the platform has enough ratings. */
export const PLATFORM_MEAN = 7.0;

/**
 * Prior strength, in "imaginary average votes". Bigger means more evidence is
 * needed before a rating moves away from the platform mean.
 */
export const PRIOR_VOTES = {
  /** A post is a single piece of work; it should settle reasonably quickly. */
  post: 5,
  /** A profile is a bigger claim, so it needs more evidence. */
  userOverall: 8,
  /** The 30-day window starts from the person's own overall rating. */
  userRecent: 4,
};

/** Below this many effective votes, nothing appears in a ranking at all. */
export const MIN_VOTES_FOR_RANKING = 10;

/**
 * The same idea for a single post, set lower: a post collects ratings from one
 * audience over a few days, where a person collects them across everything
 * they have ever posted.
 */
export const MIN_VOTES_FOR_POST_RANKING = 4;

/** ≈90% one-sided confidence. Higher is harsher on small samples. */
export const CONFIDENCE_Z = 1.6;

/**
 * Floor on the spread used by the confidence penalty. Six identical 10s have a
 * true standard deviation of zero, which would claim perfect certainty from
 * almost no data; this stops that.
 */
export const MIN_STDDEV = 1.4;

export interface WeightedSample {
  score: number;
  /** Integrity weight, 0–1. A revoked rater contributes nothing. */
  weight: number;
}

/** Total trustworthy evidence behind a rating — not the raw row count. */
export function effectiveVotes(samples: WeightedSample[]): number {
  let total = 0;
  for (const sample of samples) total += sample.weight;
  return total;
}

/** The plain weighted average, with no prior. */
export function rawAverage(samples: WeightedSample[]): number | null {
  const votes = effectiveVotes(samples);
  if (votes <= 0) return null;
  let weighted = 0;
  for (const sample of samples) weighted += sample.score * sample.weight;
  return weighted / votes;
}

/**
 * A weighted average pulled toward `priorMean` by a prior worth `priorVotes`
 * votes.
 *
 * RANKING ONLY. This is never the number shown to anyone — the displayed
 * rating is `rawAverage`, the plain average of what people actually gave. A
 * single 10 must read 10.0 on the profile, and separately must not vault that
 * person to the top of a leaderboard; those are two different questions and
 * this answers the second one.
 */
export function bayesianRating(
  samples: WeightedSample[],
  priorVotes: number,
  priorMean: number,
): number {
  let weighted = 0;
  let votes = 0;
  for (const sample of samples) {
    weighted += sample.score * sample.weight;
    votes += sample.weight;
  }
  return (weighted + priorVotes * priorMean) / (votes + priorVotes);
}

/** Weighted standard deviation, floored so tiny samples cannot look certain. */
export function weightedStdDev(samples: WeightedSample[], mean: number): number {
  const votes = effectiveVotes(samples);
  if (votes <= 1) return MIN_STDDEV;
  let variance = 0;
  for (const sample of samples) {
    variance += sample.weight * (sample.score - mean) ** 2;
  }
  return Math.max(MIN_STDDEV, Math.sqrt(variance / votes));
}

/**
 * The ordering key: a shrunk rating minus a confidence penalty.
 *
 * This is what every ranking sorts on, and it is never displayed. A ranking
 * has to encode how sure we are; a profile badge has to be the honest average.
 * Keeping them apart is what lets 10.0-from-one-rating show as 10.0 without
 * outranking 9.7-from-nine-hundred.
 */
export function rankingScore(
  samples: WeightedSample[],
  priorVotes: number,
  priorMean: number,
): number {
  const rating = bayesianRating(samples, priorVotes, priorMean);
  const votes = effectiveVotes(samples);
  const spread = weightedStdDev(samples, rating);
  return rating - (CONFIDENCE_Z * spread) / Math.sqrt(votes + priorVotes);
}

/** Whether there is enough evidence for a place on a ranking. */
export function isRankable(samples: WeightedSample[]): boolean {
  return effectiveVotes(samples) >= MIN_VOTES_FOR_RANKING;
}

export function clampRating(value: number): number {
  return Math.max(1, Math.min(10, value));
}

export function roundRating(value: number): number {
  return Math.round(clampRating(value) * 10) / 10;
}

export function formatRating(value: number | null): string {
  return value == null ? '—' : value.toFixed(1);
}

export function formatVotes(votes: number): string {
  const rounded = Math.round(votes);
  if (rounded === 1) return '1 rating';
  if (rounded < 1000) return `${rounded} ratings`;
  return `${(rounded / 1000).toFixed(1).replace(/\.0$/, '')}k ratings`;
}

export type Trend = 'up' | 'down' | 'steady';

/** A tenth of a point either way is noise, not movement. */
export function trendFor(recent: number, baseline: number): Trend {
  const delta = recent - baseline;
  if (delta >= 0.15) return 'up';
  if (delta <= -0.15) return 'down';
  return 'steady';
}

export const TREND_ARROW: Record<Trend, string> = { up: '↑', down: '↓', steady: '→' };

/** Colour band for the rating pill. */
export function ratingTone(value: number | null): 'high' | 'good' | 'mid' | 'low' | 'none' {
  if (value == null) return 'none';
  if (value >= 9) return 'high';
  if (value >= 7.5) return 'good';
  if (value >= 6) return 'mid';
  return 'low';
}

export interface ReactionCount {
  reaction: string;
  count: number;
}

export function topReactions(counts: ReactionCount[], take = 3): ReactionCount[] {
  return [...counts]
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, take);
}
