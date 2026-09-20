import 'server-only';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import type { ID, Notification, NotificationType, PublicUser } from '@/lib/types';
import { toPublicUser } from './users';

interface NotifyInput {
  userId: ID;
  type: NotificationType;
  body: string;
  actorId?: ID | null;
  postId?: ID | null;
  challengeId?: ID | null;
}

export async function notify(input: NotifyInput): Promise<void> {
  // Never notify someone about their own action.
  if (input.actorId && input.actorId === input.userId) return;
  await db().insert('notifications', {
    id: newId(),
    user_id: input.userId,
    type: input.type,
    actor_id: input.actorId ?? null,
    post_id: input.postId ?? null,
    challenge_id: input.challengeId ?? null,
    body: input.body,
    read: false,
    created_at: new Date().toISOString(),
  });
}

export interface NotificationView extends Notification {
  actor: PublicUser | null;
}

export async function listNotifications(userId: ID, limit = 60): Promise<NotificationView[]> {
  const store = db();
  const rows = await store.query('notifications', {
    where: { user_id: userId },
    orderBy: 'created_at',
    desc: true,
    limit,
  });
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as ID[];
  const actors = actorIds.length
    ? await store.query('users', { in: { id: actorIds } })
    : [];
  const byId = new Map(actors.map((a) => [a.id, toPublicUser(a)]));
  return rows.map((row) => ({
    ...row,
    actor: row.actor_id ? byId.get(row.actor_id) ?? null : null,
  }));
}

export async function unreadCount(userId: ID): Promise<number> {
  const rows = await db().query('notifications', { where: { user_id: userId, read: false } });
  return rows.length;
}

export async function markAllRead(userId: ID): Promise<void> {
  const store = db();
  const rows = await store.query('notifications', { where: { user_id: userId, read: false } });
  await Promise.all(rows.map((row) => store.update('notifications', row.id, { read: true })));
}

/** Extracts @mentions from a caption or comment body. */
export function extractMentions(text: string): string[] {
  return [...text.matchAll(/@([a-z0-9_]{2,24})/gi)].map((m) => m[1].toLowerCase());
}

export async function notifyMentions(
  text: string,
  actorId: ID,
  body: string,
  postId: ID | null,
): Promise<void> {
  const usernames = [...new Set(extractMentions(text))];
  if (usernames.length === 0) return;
  const store = db();
  const users = await store.query('users', { in: { username: usernames } });
  await Promise.all(
    users.map((user) =>
      notify({ userId: user.id, type: 'mention', body, actorId, postId }),
    ),
  );
}
