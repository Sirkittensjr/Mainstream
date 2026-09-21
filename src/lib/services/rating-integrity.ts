import 'server-only';
import { db } from '@/lib/db';
import { DAY } from '@/lib/time';
import type { ID, Rating, User } from '@/lib/types';

/**
 * Rating integrity.
 *
 * The whole system is worthless if a hundred throwaway accounts can hand
 * someone a 10. Nothing here is a silver bullet on its own — it is layered:
 * one rating per rater per target, weight based on how real the rater looks,
 * hard rate limits, and flags a moderator can act on.
 */

export const RATE_LIMITS = { perHour: 25, perDay: 80 };

/** Ratings toward one creator before a rater's weight starts collapsing. */
const CONCENTRATION_SOFT = 3;
const CONCENTRATION_HARD = 6;

export interface WeightBreakdown {
  weight: number;
  reasons: string[];
}

/**
 * How much a rater's opinion counts, 0–1.
 *
 * A brand new account with no activity is not silenced — it is quiet. It earns
 * full weight by being a real participant, which is exactly the cost a bot
 * farm cannot pay at scale.
 */
export function raterWeight(
  rater: User,
  ratingsGiven: Rating[],
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

  if (rater.points < 20) {
    weight *= 0.7;
    reasons.push('little activity on the account');
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

export type LimitResult = { ok: true } | { ok: false; error: string };

export async function checkRateLimit(raterId: ID, now: number = Date.now()): Promise<LimitResult> {
  const given = await db().query('ratings', { where: { rater_id: raterId } });
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const dayAgo = new Date(now - DAY).toISOString();
  const lastHour = given.filter((rating) => rating.updated_at >= hourAgo).length;
  const lastDay = given.filter((rating) => rating.updated_at >= dayAgo).length;
  if (lastHour >= RATE_LIMITS.perHour) {
    return { ok: false, error: 'You have rated a lot in the last hour. Try again shortly.' };
  }
  if (lastDay >= RATE_LIMITS.perDay) {
    return { ok: false, error: "That's today's rating limit. It resets in a few hours." };
  }
  return { ok: true };
}

export interface SuspiciousRater {
  user: { id: ID; username: string; display_name: string; trusted: boolean };
  ratingsGiven: number;
  averageScore: number;
  averageWeight: number;
  topTargetShare: number;
  topTargetUsername: string | null;
  burst24h: number;
  flags: string[];
}

/**
 * Accounts whose rating behaviour does not look human, surfaced for the admin
 * queue. Detection is deliberately explainable — a moderator sees the same
 * numbers the weighting used.
 */
export async function suspiciousRaters(limit = 25): Promise<SuspiciousRater[]> {
  const store = db();
  const [ratings, users] = await Promise.all([store.query('ratings'), store.query('users')]);
  const byId = new Map(users.map((user) => [user.id, user]));
  const byRater = new Map<ID, Rating[]>();
  for (const rating of ratings) {
    const list = byRater.get(rating.rater_id) ?? [];
    list.push(rating);
    byRater.set(rating.rater_id, list);
  }

  const dayAgo = new Date(Date.now() - DAY).toISOString();
  const rows: SuspiciousRater[] = [];

  for (const [raterId, given] of byRater) {
    const rater = byId.get(raterId);
    if (!rater || given.length < 4) continue;

    const perOwner = new Map<ID, number>();
    for (const rating of given) perOwner.set(rating.owner_id, (perOwner.get(rating.owner_id) ?? 0) + 1);
    const [topOwner, topCount] = [...perOwner.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = topCount / given.length;
    const average = given.reduce((sum, r) => sum + r.score, 0) / given.length;
    const averageWeight = given.reduce((sum, r) => sum + r.weight, 0) / given.length;
    const burst = given.filter((rating) => rating.updated_at >= dayAgo).length;

    const flags: string[] = [];
    if (share > 0.5 && given.length >= 5) flags.push('concentrated on one creator');
    if (average >= 9.5) flags.push('rates everything near 10');
    if (average <= 2.5) flags.push('rates everything near 1');
    if (burst >= 25) flags.push('high volume in 24 hours');
    if (averageWeight <= 0.4) flags.push('low trust weight');
    if (!rater.trusted) flags.push('weight already revoked');
    if (flags.length === 0) continue;

    rows.push({
      user: {
        id: rater.id,
        username: rater.username,
        display_name: rater.display_name,
        trusted: rater.trusted,
      },
      ratingsGiven: given.length,
      averageScore: Math.round(average * 10) / 10,
      averageWeight: Math.round(averageWeight * 100) / 100,
      topTargetShare: Math.round(share * 100),
      topTargetUsername: byId.get(topOwner)?.username ?? null,
      burst24h: burst,
      flags,
    });
  }

  return rows
    .sort((a, b) => b.flags.length - a.flags.length || b.topTargetShare - a.topTargetShare)
    .slice(0, limit);
}

/** Moderator switch: revoke (or restore) the weight an account's ratings carry. */
export async function setRaterTrust(userId: ID, trusted: boolean): Promise<void> {
  const store = db();
  await store.update('users', userId, { trusted });
  // Existing ratings are re-weighted so the change is retroactive.
  const given = await store.query('ratings', { where: { rater_id: userId } });
  await Promise.all(
    given.map((rating) =>
      store.update('ratings', rating.id, { weight: trusted ? Math.max(rating.weight, 0.5) : 0 }),
    ),
  );
}
