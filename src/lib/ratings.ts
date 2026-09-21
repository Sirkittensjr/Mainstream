/**
 * FayTarra rating maths.
 *
 * Pure functions only — shared by the server (aggregation, ranking) and the
 * client (display). The rules here are the product: a rating is not a
 * popularity counter, it is a weighted, shrunk, manipulation-resistant answer
 * to "how well is this doing?".
 */

import type { Reaction } from './types';

/** Where an unrated post or profile sits before the community says otherwise. */
export const PLATFORM_MEAN = 7.2;

/**
 * Bayesian prior weights. A post with one 10/10 should not outrank a post with
 * forty ratings averaging 9.3, so every average is pulled toward a prior until
 * there is enough evidence behind it.
 */
export const PRIOR = {
  post: 3,
  /** Profiles need more evidence than a single post. */
  userOverall: 10,
  /** The 30-day window starts from the creator's own overall rating. */
  userCurrent: 5,
};

export interface WeightedSample {
  score: number;
  weight: number;
}

/** Weighted average pulled toward `priorMean` with `priorWeight` of evidence. */
export function shrunkAverage(
  samples: WeightedSample[],
  priorWeight: number,
  priorMean: number,
): number {
  let weighted = 0;
  let weight = 0;
  for (const sample of samples) {
    weighted += sample.score * sample.weight;
    weight += sample.weight;
  }
  return (weighted + priorWeight * priorMean) / (weight + priorWeight);
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

export type Trend = 'up' | 'down' | 'steady';

/** Current vs overall. A tenth of a point either way is still "steady". */
export function trendFor(current: number, overall: number): Trend {
  const delta = current - overall;
  if (delta >= 0.15) return 'up';
  if (delta <= -0.15) return 'down';
  return 'steady';
}

export const TREND_ARROW: Record<Trend, string> = { up: '↑', down: '↓', steady: '→' };

/** Colour band used by the rating pill. Nothing below 5 is shown in red-alarm. */
export function ratingTone(value: number | null): 'high' | 'good' | 'mid' | 'low' | 'none' {
  if (value == null) return 'none';
  if (value >= 9) return 'high';
  if (value >= 7.5) return 'good';
  if (value >= 6) return 'mid';
  return 'low';
}

export interface ReactionCount {
  reaction: Reaction;
  count: number;
}

export function topReactions(counts: ReactionCount[], take = 3): ReactionCount[] {
  return [...counts]
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, take);
}

/** Maps a 0..∞ signal onto 0–10 with diminishing returns. */
export function scoreSignal(value: number, target: number): number {
  if (value <= 0) return 0;
  return 10 * (1 - Math.exp(-value / Math.max(target, 0.0001)));
}
