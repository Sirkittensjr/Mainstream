/**
 * How much a rater's opinion counts, 0–1.
 *
 * Pure and dependency-free so it can be reasoned about and tested directly —
 * this is the function standing between the rating system and a hundred
 * throwaway accounts handing someone a 10.
 *
 * Nothing here silences anyone. A new account is quiet, not banned, and earns
 * full weight by being a real participant — which is exactly the cost a bot
 * farm cannot pay at scale.
 */

import { DAY } from './time';
import type { ID, Rating, User } from './types';

/** Ratings toward one creator before a rater's weight starts collapsing. */
export const CONCENTRATION_SOFT = 3;
export const CONCENTRATION_HARD = 6;

export interface WeightBreakdown {
  weight: number;
  /** Plain-language reasons, shown to moderators alongside the number. */
  reasons: string[];
}

export interface RaterProfile extends Pick<User, 'status' | 'trusted' | 'created_at'> {
  /** Posts plus comments — evidence this is a participant, not a drive-by. */
  contributions: number;
}

export function raterWeight(
  rater: RaterProfile,
  ratingsGiven: Pick<Rating, 'score' | 'owner_id'>[],
  targetOwnerId: ID,
  now: number = Date.now(),
): WeightBreakdown {
  const reasons: string[] = [];
  if (rater.status !== 'active') return { weight: 0, reasons: ['account not active'] };
  if (!rater.trusted) return { weight: 0, reasons: ['flagged by a moderator'] };

  let weight = 1;
  const ageDays = (now - new Date(rater.created_at).getTime()) / DAY;
  if (ageDays < 1) {
    weight *= 0.25;
    reasons.push('account is less than a day old');
  } else if (ageDays < 7) {
    weight *= 0.6;
    reasons.push('account is less than a week old');
  }

  if (rater.contributions < 2) {
    weight *= 0.7;
    reasons.push('has barely used the account');
  }

  if (ratingsGiven.length >= 10) {
    const high = ratingsGiven.filter((rating) => rating.score >= 9).length / ratingsGiven.length;
    const low = ratingsGiven.filter((rating) => rating.score <= 2).length / ratingsGiven.length;
    if (high > 0.9) {
      weight *= 0.4;
      reasons.push('rates almost everything 9 or 10');
    } else if (low > 0.9) {
      weight *= 0.4;
      reasons.push('rates almost everything 1 or 2');
    }
  }

  const towardOwner = ratingsGiven.filter((rating) => rating.owner_id === targetOwnerId).length;
  if (towardOwner >= CONCENTRATION_HARD) {
    weight *= 0.25;
    reasons.push('has rated this creator many times');
  } else if (towardOwner >= CONCENTRATION_SOFT) {
    weight *= 0.7;
    reasons.push('has rated this creator several times');
  }

  if (ratingsGiven.length >= 8) {
    const perOwner = new Map<ID, number>();
    for (const rating of ratingsGiven) {
      perOwner.set(rating.owner_id, (perOwner.get(rating.owner_id) ?? 0) + 1);
    }
    const share = Math.max(...perOwner.values()) / ratingsGiven.length;
    if (share > 0.5) {
      weight *= 0.35;
      reasons.push('most of their ratings go to one creator');
    }
  }

  return { weight: Math.round(Math.max(0, Math.min(1, weight)) * 100) / 100, reasons };
}
