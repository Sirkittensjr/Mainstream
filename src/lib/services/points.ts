import 'server-only';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { levelFor, POINTS } from '@/lib/progression';
import type { Activity, ActivityType, ID } from '@/lib/types';

interface AwardOptions {
  postId?: ID | null;
  challengeId?: ID | null;
  /** Override the default value for the reason (e.g. removing points). */
  points?: number;
}

/**
 * Awards FayTarra points, logs the activity and fires a level-up notification when
 * a threshold is crossed. This is the only place points ever change.
 */
export async function award(
  userId: ID,
  reason: ActivityType,
  options: AwardOptions = {},
): Promise<void> {
  const store = db();
  const user = await store.get('users', userId);
  if (!user) return;

  const points = options.points ?? (POINTS as Partial<Record<ActivityType, number>>)[reason] ?? 0;
  const before = user.points;
  const after = Math.max(0, before + points);

  await store.update('users', userId, { points: after });
  const activity: Activity = {
    id: newId(),
    user_id: userId,
    type: reason,
    points,
    post_id: options.postId ?? null,
    challenge_id: options.challengeId ?? null,
    created_at: new Date().toISOString(),
  };
  await store.insert('activity', activity);

  const previousLevel = levelFor(before);
  const currentLevel = levelFor(after);
  if (currentLevel.level > previousLevel.level) {
    const { notify } = await import('./notifications');
    await notify({
      userId,
      type: 'level_up',
      body: `You reached Level ${currentLevel.level} — ${currentLevel.name}. ${currentLevel.blurb}`,
    });
    await store.insert('activity', {
      id: newId(),
      user_id: userId,
      type: 'level_up',
      points: 0,
      post_id: null,
      challenge_id: null,
      created_at: new Date().toISOString(),
    });
  }
}

/** Records one "daily active" award per user per calendar day. */
export async function touchDailyActive(userId: ID): Promise<void> {
  const store = db();
  const user = await store.get('users', userId);
  if (!user) return;
  const today = new Date().toISOString().slice(0, 10);
  const last = user.last_active_at?.slice(0, 10);
  if (last === today) return;
  await store.update('users', userId, { last_active_at: new Date().toISOString() });
  await award(userId, 'daily_active');
}
