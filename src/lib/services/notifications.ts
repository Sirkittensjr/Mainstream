import 'server-only';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import type { ID, Notification, NotificationType, PublicUser } from '@/lib/types';
import { hiddenUserIds, toPublicUser } from './users';

interface NotifyInput {
  userId: ID;
  type: NotificationType;
  body: string;
  actorId?: ID | null;
  postId?: ID | null;
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
    body: input.body,
    read: false,
    created_at: new Date().toISOString(),
  });
}

export interface NotificationView extends Notification {
  actor: PublicUser | null;
}

/**
 * Somebody's notifications, with the person behind each one attached.
 *
 * The actor is resolved from `actor_id`, so the handle shown and linked to is
 * whatever that account is called now rather than whatever it was called when
 * the notification was written.
 *
 * Notifications from an account the viewer has blocked — or that has blocked
 * the viewer — are left out, the same way that account's posts, profile and
 * messages already are. Offering a tappable link to somebody you have blocked
 * would be the one place the block did not hold.
 */
export async function listNotifications(userId: ID, limit = 60): Promise<NotificationView[]> {
  const store = db();
  const rows = await store.query('notifications', {
    where: { user_id: userId },
    orderBy: 'created_at',
    desc: true,
    limit,
  });

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as ID[];
  const [actors, hidden] = await Promise.all([
    actorIds.length ? store.query('users', { in: { id: actorIds } }) : Promise.resolve([]),
    hiddenUserIds(userId),
  ]);
  const byId = new Map(actors.map((a) => [a.id, a]));

  return rows
    .filter((row) => {
      if (!row.actor_id) return true;
      if (hidden.has(row.actor_id)) return false;
      // A banned account's profile is not reachable, so a link to it is not
      // worth offering either.
      return byId.get(row.actor_id)?.status !== 'banned';
    })
    .map((row) => {
      const actor = row.actor_id ? byId.get(row.actor_id) : undefined;
      return { ...row, actor: actor ? toPublicUser(actor) : null };
    });
}

/**
 * The badge number. Capped, because the exact count stops meaning anything
 * past a couple of screens and the badge only ever shows "9+" anyway — this
 * keeps a busy account from reading thousands of rows on every page load.
 */
export const UNREAD_CAP = 50;

export async function unreadCount(userId: ID): Promise<number> {
  const rows = await db().query('notifications', {
    where: { user_id: userId, read: false },
    limit: UNREAD_CAP,
  });
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
