import 'server-only';
import { db, isMissingRelation } from '@/lib/db';
import type { QueryOptions } from '@/lib/db';
import { newId } from '@/lib/ids';
import type { ID, Message, PublicUser, User } from '@/lib/types';
import { checkLimit } from './rate-limit';
import { isBlockedEitherWay, toPublicUser } from './users';

/**
 * Direct messages.
 *
 * One rule: two people can only message each other while they BOTH follow each
 * other. It is checked here, and independently by a trigger on the messages
 * table (migration 0003), because a rule that lives only in application code is
 * one forgotten call site away from not existing. Hiding the button is not
 * enforcement and is not what this relies on.
 */

export const MESSAGE_MAX = 2000;

export const MESSAGING_UNAVAILABLE =
  'Messaging is not available on this deployment yet.';

/**
 * Whether this database has the messaging table at all.
 *
 * Null until a query has told us. A deployment whose SQL was installed before
 * migration 0003 has no `messages` table, and that has to be survivable: the
 * unread badge is part of the navigation, so every signed-in page would return
 * a server error over a feature none of them are about. Messaging switches
 * itself off until the migration runs; nothing else changes.
 */
let installed: boolean | null = null;
let warned = false;

function noteMissing(error: unknown): void {
  installed = false;
  if (warned) return;
  warned = true;
  console.error(
    '[faytarra] Direct messages are switched off: this database has no `messages` table. ' +
      'Run supabase/migrations/0003_messages_and_username_changes.sql against it to turn ' +
      `messaging on. (${error instanceof Error ? error.message : String(error)})`,
  );
}

/**
 * A read of the messages table that answers "nothing" rather than throwing
 * when the table is not there. Any OTHER failure still throws: a broken query
 * against a table that exists is a real bug and must not be swallowed.
 */
async function read(options: QueryOptions<Message> = {}): Promise<Message[]> {
  if (installed === false) return [];
  try {
    const rows = await db().query('messages', options);
    installed = true;
    return rows;
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    noteMissing(error);
    return [];
  }
}

/** Is messaging usable on this deployment? Cached after the first answer. */
export async function messagingAvailable(): Promise<boolean> {
  if (installed !== null) return installed;
  await read({ limit: 1 });
  return installed ?? false;
}

export type SendResult = { ok: true; message: Message } | { ok: false; error: string };

/** Do these two currently follow each other, with no block either way? */
export async function canMessage(a: ID, b: ID): Promise<boolean> {
  if (a === b) return false;
  const store = db();
  const [aFollowsB, bFollowsA, blocked, available] = await Promise.all([
    store.query('follows', { where: { follower_id: a, following_id: b } }),
    store.query('follows', { where: { follower_id: b, following_id: a } }),
    isBlockedEitherWay(a, b),
    // No table, no messaging — and therefore no Message button pointing at a
    // page that cannot work.
    messagingAvailable(),
  ]);
  return available && aFollowsB.length > 0 && bFollowsA.length > 0 && !blocked;
}

/** Everyone the viewer can currently message: their mutual follows. */
export async function mutualFollowIds(userId: ID): Promise<Set<ID>> {
  const store = db();
  const [following, followers] = await Promise.all([
    store.query('follows', { where: { follower_id: userId } }),
    store.query('follows', { where: { following_id: userId } }),
  ]);
  const theyFollowMe = new Set(followers.map((row) => row.follower_id));
  const mutual = new Set<ID>();
  for (const row of following) {
    if (theyFollowMe.has(row.following_id)) mutual.add(row.following_id);
  }
  return mutual;
}

export interface ConversationSummary {
  person: PublicUser;
  lastMessage: Message;
  unread: number;
  /** False once the follow stopped being mutual: readable, not writable. */
  open: boolean;
}

/** Every thread the viewer is part of, most recent first. */
export async function conversations(viewer: User): Promise<ConversationSummary[]> {
  const store = db();
  const [sent, received, mutual, hidden] = await Promise.all([
    read({ where: { sender_id: viewer.id } }),
    read({ where: { recipient_id: viewer.id } }),
    mutualFollowIds(viewer.id),
    // A blocked account's thread disappears from the list entirely.
    (await import('./users')).hiddenUserIds(viewer.id),
  ]);

  const latest = new Map<ID, Message>();
  const unread = new Map<ID, number>();
  for (const message of [...sent, ...received]) {
    const other = message.sender_id === viewer.id ? message.recipient_id : message.sender_id;
    if (hidden.has(other)) continue;
    const seen = latest.get(other);
    if (!seen || message.created_at > seen.created_at) latest.set(other, message);
    if (message.recipient_id === viewer.id && !message.read_at) {
      unread.set(other, (unread.get(other) ?? 0) + 1);
    }
  }
  if (latest.size === 0) return [];

  const people = await store.query('users', { in: { id: [...latest.keys()] } });
  const byId = new Map(people.map((person) => [person.id, person]));

  return [...latest.entries()]
    .map(([otherId, lastMessage]) => {
      const person = byId.get(otherId);
      if (!person || person.status === 'banned') return null;
      return {
        person: toPublicUser(person),
        lastMessage,
        unread: unread.get(otherId) ?? 0,
        open: mutual.has(otherId),
      } satisfies ConversationSummary;
    })
    .filter((row): row is ConversationSummary => row !== null)
    .sort((a, b) => b.lastMessage.created_at.localeCompare(a.lastMessage.created_at));
}

export interface Thread {
  person: PublicUser;
  messages: Message[];
  /** Whether new messages may be sent right now. */
  open: boolean;
}

/**
 * One conversation.
 *
 * History stays readable to the two people in it after a follow ends — it is
 * theirs — but `open` goes false and nothing new can be sent. It is never
 * readable by anyone else: the query only ever matches rows where the viewer is
 * one of the two participants.
 */
export async function thread(viewer: User, other: User): Promise<Thread | null> {
  if (viewer.id === other.id) return null;
  if (await isBlockedEitherWay(viewer.id, other.id)) return null;

  const [outgoing, incoming, open] = await Promise.all([
    read({ where: { sender_id: viewer.id, recipient_id: other.id } }),
    read({ where: { sender_id: other.id, recipient_id: viewer.id } }),
    canMessage(viewer.id, other.id),
  ]);

  const messages = [...outgoing, ...incoming].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  // Nothing said yet and not mutual: there is no conversation to show.
  if (messages.length === 0 && !open) return null;
  return { person: toPublicUser(other), messages, open };
}

export async function send(senderId: ID, recipientId: ID, body: string): Promise<SendResult> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'Write something first.' };
  if (trimmed.length > MESSAGE_MAX) {
    return { ok: false, error: `Messages are up to ${MESSAGE_MAX} characters.` };
  }

  if (!(await messagingAvailable())) return { ok: false, error: MESSAGING_UNAVAILABLE };

  const store = db();
  const sender = await store.get('users', senderId);
  if (!sender || sender.status !== 'active') {
    return { ok: false, error: 'Your account cannot send messages right now.' };
  }
  const recipient = await store.get('users', recipientId);
  if (!recipient || recipient.status === 'banned') {
    return { ok: false, error: 'That account is not available.' };
  }

  // The authoritative check. The database trigger repeats it, so this cannot be
  // bypassed by calling the action directly with someone else's id.
  if (!(await canMessage(senderId, recipientId))) {
    return {
      ok: false,
      error: 'You can only message people who follow you back.',
    };
  }

  const limit = await checkLimit('messages', senderId);
  if (!limit.ok) return { ok: false, error: limit.error };

  try {
    const message = await store.insert('messages', {
      id: newId(),
      sender_id: senderId,
      recipient_id: recipientId,
      body: trimmed.slice(0, MESSAGE_MAX),
      read_at: null,
      created_at: new Date().toISOString(),
    });
    return { ok: true, message };
  } catch (error) {
    // The trigger refused it — the follow ended between the check above and
    // the insert, or somebody reached the table another way.
    const text = error instanceof Error ? error.message : '';
    if (text.includes('not_mutual_follow')) {
      return { ok: false, error: 'You can only message people who follow you back.' };
    }
    if (text.includes('blocked')) {
      return { ok: false, error: 'That account is not available.' };
    }
    if (isMissingRelation(error)) {
      noteMissing(error);
      return { ok: false, error: MESSAGING_UNAVAILABLE };
    }
    throw error;
  }
}

/** Marks the other person's messages in this thread as read. */
export async function markThreadRead(viewerId: ID, otherId: ID): Promise<void> {
  const store = db();
  const incoming = await read({ where: { sender_id: otherId, recipient_id: viewerId } });
  const now = new Date().toISOString();
  await Promise.all(
    incoming
      .filter((message) => !message.read_at)
      .map((message) => store.update('messages', message.id, { read_at: now })),
  );
}

/** Unread message count for the navigation badge. */
export async function unreadMessageCount(userId: ID): Promise<number> {
  const rows = await read({ where: { recipient_id: userId, read_at: null }, limit: 50 });
  return rows.length;
}
