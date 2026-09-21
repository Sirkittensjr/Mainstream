import 'server-only';
import { db } from '@/lib/db';
import { DAY } from '@/lib/time';
import type { ID } from '@/lib/types';

/**
 * Spam and abuse limits.
 *
 * Rating already had its own limits; everything else a person can create was
 * unlimited, which is the whole game for a spam script: thousands of posts,
 * comments on every post on the platform, follow-and-unfollow loops, or a
 * report queue buried under noise so real reports never get seen.
 *
 * Counting rows that already exist means no new table and no memory that a
 * restart can lose. The windows are deliberately generous — they should only
 * ever be hit by something automated.
 */
export const LIMITS = {
  posts: { perHour: 15, perDay: 60 },
  comments: { perHour: 60, perDay: 250 },
  follows: { perHour: 80, perDay: 300 },
  reports: { perHour: 12, perDay: 40 },
} as const;

export type LimitKind = keyof typeof LIMITS;

export type LimitResult = { ok: true } | { ok: false; error: string };

const MESSAGES: Record<LimitKind, string> = {
  posts: 'You have posted a lot in a short time. Try again shortly.',
  comments: 'You are commenting very quickly. Take a breath and try again shortly.',
  follows: 'That is a lot of follows in a short time. Try again shortly.',
  reports: 'You have sent a lot of reports. We are looking at them — try again later.',
};

interface Timestamped {
  created_at: string;
}

/** Counts rows in a window without loading the whole table. */
function within(rows: Timestamped[], since: string): number {
  let count = 0;
  for (const row of rows) if (row.created_at >= since) count += 1;
  return count;
}

export async function checkLimit(
  kind: LimitKind,
  userId: ID,
  now: number = Date.now(),
): Promise<LimitResult> {
  const store = db();
  const limits = LIMITS[kind];
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const dayAgo = new Date(now - DAY).toISOString();

  let rows: Timestamped[];
  switch (kind) {
    case 'posts':
      rows = await store.query('posts', { where: { author_id: userId } });
      break;
    case 'comments':
      rows = await store.query('comments', { where: { user_id: userId } });
      break;
    case 'follows':
      rows = await store.query('follows', { where: { follower_id: userId } });
      break;
    case 'reports':
      rows = await store.query('reports', { where: { reporter_id: userId } });
      break;
  }

  if (within(rows, hourAgo) >= limits.perHour) return { ok: false, error: MESSAGES[kind] };
  if (within(rows, dayAgo) >= limits.perDay) return { ok: false, error: MESSAGES[kind] };
  return { ok: true };
}

/**
 * Uploads happen before the post exists, so there is no row to count. This is
 * a per-instance sliding window: best effort, and deliberately paired with the
 * hard per-file size cap in the upload route, which is the limit that actually
 * protects storage.
 */
const uploadWindows = new Map<ID, number[]>();
const UPLOADS_PER_HOUR = 60;

export function checkUploadLimit(userId: ID, now: number = Date.now()): LimitResult {
  const cutoff = now - 3_600_000;
  const recent = (uploadWindows.get(userId) ?? []).filter((at) => at > cutoff);
  if (recent.length >= UPLOADS_PER_HOUR) {
    return { ok: false, error: 'That is a lot of uploads in a short time. Try again shortly.' };
  }
  recent.push(now);
  uploadWindows.set(userId, recent);
  // Stop the map growing without bound on a long-lived instance.
  if (uploadWindows.size > 5000) {
    for (const [id, times] of uploadWindows) {
      if (times.every((at) => at <= cutoff)) uploadWindows.delete(id);
    }
  }
  return { ok: true };
}
