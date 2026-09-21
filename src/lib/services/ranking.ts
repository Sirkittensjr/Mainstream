import { DAY } from '@/lib/time';
import type { Post } from '@/lib/types';

export interface Engagement {
  likes: number;
  comments: number;
  views: number;
}

const HALF_LIFE_HOURS = 30;

/** Exponential recency decay — fresh posts always have a chance. */
export function recency(createdAt: string, now: number): number {
  const ageHours = Math.max(0, (now - new Date(createdAt).getTime()) / 3_600_000);
  return Math.pow(0.5, ageHours / HALF_LIFE_HOURS);
}

/**
 * How much a community rating moves a post in the Recommended feed.
 *
 * A 10/10 is worth about 30% more reach than an unrated post and a 4/10 about
 * 30% less — enough to matter, not enough to bury everything new. Unrated
 * posts sit at 1.0 so nothing is penalised for simply being new.
 */
export function ratingMultiplier(rating: number | null): number {
  if (rating == null) return 1;
  return 0.7 + (rating / 10) * 0.6;
}

/**
 * The Recommended feed score.
 *
 * Engagement is measured relative to the audience the author already has, so a
 * post doing well for a small account can outrank a post doing averagely for a
 * big one. Follower count is a denominator here, never a bonus.
 */
export function recommendScore(
  post: Post,
  e: Engagement,
  authorFollowers: number,
  now: number,
  rating: number | null = null,
  interestMatch = false,
): number {
  const raw = e.likes * 3 + e.comments * 6 + e.views * 0.05;
  const audience = Math.sqrt(authorFollowers + 8);
  return (
    (raw / audience) *
    recency(post.created_at, now) *
    ratingMultiplier(rating) *
    (interestMatch ? 1.25 : 1)
  );
}

/** Interleaves several ranked lists so one source cannot fill the screen. */
export function interleave<T>(lists: T[][], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const cursors = lists.map(() => 0);
  let exhausted = false;
  while (!exhausted) {
    exhausted = true;
    for (let i = 0; i < lists.length; i += 1) {
      const list = lists[i];
      while (cursors[i] < list.length) {
        const item = list[cursors[i]];
        cursors[i] += 1;
        const key = keyOf(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
        exhausted = false;
        break;
      }
    }
  }
  return out;
}

export { DAY };
