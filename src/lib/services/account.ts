import 'server-only';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import type { Interest, User } from '@/lib/types';
import { notify } from './notifications';
import { getUserByEmail, getUserByUsername } from './users';

export const USERNAME_RULES = 'letters, numbers and underscores, 3–20 characters';
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set([
  'admin', 'rise', 'home', 'discover', 'create', 'challenges', 'profile', 'login', 'signup',
  'settings', 'search', 'notifications', 'leaderboards', 'api', 'rules', 'post', 'u', 'me',
]);

export interface SignUpInput {
  email: string;
  username: string;
  password: string;
  display_name: string;
  bio?: string;
  location?: string;
  avatar_url?: string | null;
  interests: Interest[];
  goal?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function signUp(input: SignUpInput): Promise<Result<User>> {
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email.' };
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: `Usernames use ${USERNAME_RULES}.` };
  }
  if (RESERVED.has(username)) return { ok: false, error: 'That username is reserved.' };
  if (input.password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  if (!input.display_name.trim()) return { ok: false, error: 'Add a display name.' };
  if (input.interests.length === 0) {
    return { ok: false, error: 'Pick at least one thing you are trying to become.' };
  }
  if (await getUserByEmail(email)) return { ok: false, error: 'That email is already registered.' };
  if (await getUserByUsername(username)) return { ok: false, error: 'That username is taken.' };

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const now = new Date().toISOString();
  const user: User = {
    id: newId(),
    email,
    username,
    display_name: input.display_name.trim().slice(0, 40),
    password_hash: await hashPassword(input.password),
    bio: (input.bio ?? '').trim().slice(0, 240),
    avatar_url: input.avatar_url ?? null,
    location: (input.location ?? '').trim().slice(0, 60) || null,
    interests: input.interests.slice(0, 6),
    goal: (input.goal ?? '100 followers').trim().slice(0, 60),
    role: adminEmails.includes(email) ? 'admin' : 'user',
    status: 'active',
    status_reason: null,
    rise_points: 0,
    created_at: now,
    last_active_at: now,
  };
  await db().insert('users', user);

  await notify({
    userId: user.id,
    type: 'level_up',
    body: 'Welcome to RISE. You are Level 1 — Rookie. Everyone starts at zero.',
  });
  return { ok: true, value: user };
}

export async function signIn(identifier: string, password: string): Promise<Result<User>> {
  const value = identifier.trim().toLowerCase();
  const user = value.includes('@')
    ? await getUserByEmail(value)
    : await getUserByUsername(value.replace(/^@/, ''));
  if (!user) return { ok: false, error: 'No account matches those details.' };
  if (!(await verifyPassword(password, user.password_hash))) {
    return { ok: false, error: 'No account matches those details.' };
  }
  if (user.status === 'banned') {
    return { ok: false, error: 'This account has been banned for breaking the RISE rules.' };
  }
  return { ok: true, value: user };
}

export async function changePassword(
  userId: string,
  current: string,
  next: string,
): Promise<Result<true>> {
  const store = db();
  const user = await store.get('users', userId);
  if (!user) return { ok: false, error: 'Account not found.' };
  if (!(await verifyPassword(current, user.password_hash))) {
    return { ok: false, error: 'Current password is incorrect.' };
  }
  if (next.length < 8) return { ok: false, error: 'New password must be at least 8 characters.' };
  await store.update('users', userId, { password_hash: await hashPassword(next) });
  return { ok: true, value: true };
}

export async function deleteAccount(userId: string): Promise<void> {
  const store = db();
  const [posts, likes, comments, follows, notifications] = await Promise.all([
    store.query('posts', { where: { author_id: userId } }),
    store.query('likes', { where: { user_id: userId } }),
    store.query('comments', { where: { user_id: userId } }),
    store.query('follows', { where: { follower_id: userId } }),
    store.query('notifications', { where: { user_id: userId } }),
  ]);
  await Promise.all([
    ...posts.map((row) => store.remove('posts', row.id)),
    ...likes.map((row) => store.remove('likes', row.id)),
    ...comments.map((row) => store.remove('comments', row.id)),
    ...follows.map((row) => store.remove('follows', row.id)),
    ...notifications.map((row) => store.remove('notifications', row.id)),
  ]);
  const inbound = await store.query('follows', { where: { following_id: userId } });
  await Promise.all(inbound.map((row) => store.remove('follows', row.id)));
  await store.remove('users', userId);
}
