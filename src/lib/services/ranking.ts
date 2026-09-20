import { DAY } from '@/lib/time';
import type { Post } from '@/lib/types';

export interface Engagement {
  likes: number;
  comments: number;
  views: number;
}

const HALF_LIFE_HOURS = 30;

/** Exponential recency decay — fresh work always has a chance. */
export function recency(createdAt: string, now: number): number {
  const ageHours = Math.max(0, (now - new Date(createdAt).getTime()) / 3_600_000);
  return Math.pow(0.5, ageHours / HALF_LIFE_HOURS);
}

/** Raw popularity. Used by Trending. */
export function trendingScore(post: Post, e: Engagement, now: number): number {
  const raw = e.likes * 3 + e.comments * 5 + e.views * 0.05;
  return raw * recency(post.created_at, now);
}

/**
 * The most important number in RISE.
 *
 * Rising score measures how well a post performs *relative to the size of the
 * audience it already had*. Dividing by sqrt(followers) means 40 likes on a
 * 20-follower account outranks 400 likes on a 200,000-follower account, which
 * is exactly how someone with 10 followers gets discovered here.
 */
export function risingScore(
  post: Post,
  e: Engagement,
  authorFollowers: number,
  now: number,
): number {
  const raw = e.likes * 3 + e.comments * 6 + e.views * 0.05;
  const audience = Math.sqrt(authorFollowers + 8);
  const shotBoost = post.shot ? 1.35 : 1;
  const smallCreatorBoost = authorFollowers < 500 ? 1.25 : 1;
  return (raw / audience) * recency(post.created_at, now) * shotBoost * smallCreatorBoost;
}

/**
 * Rotating exposure for "GIVE ME A SHOT" posts.
 *
 * Instead of promising everyone virality, RISE gives every shot post a
 * deterministic slot in a rotation that advances every few hours. A post that
 * is not on screen right now is simply waiting for its turn, and brand new
 * posts start near the front of the queue.
 */
export function shotRotation<T extends { id: string; created_at: string }>(
  posts: T[],
  now: number,
  take: number,
): T[] {
  if (posts.length === 0) return [];
  const bucket = Math.floor(now / (6 * 3_600_000)); // rotates every 6 hours
  const fresh = posts.filter((p) => now - new Date(p.created_at).getTime() < DAY);
  const rest = posts.filter((p) => !fresh.includes(p));
  const ordered = [
    ...fresh.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    ...rotate(
      [...rest].sort((a, b) => a.id.localeCompare(b.id)),
      bucket,
    ),
  ];
  return ordered.slice(0, take);
}

function rotate<T>(items: T[], by: number): T[] {
  if (items.length === 0) return items;
  const offset = ((by % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/** Interleaves several ranked lists so the feed never shows ten of one thing. */
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
