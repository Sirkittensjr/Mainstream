import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { currentUserId } from '@/lib/auth/session';
import { db } from '@/lib/db';
import type { User } from '@/lib/types';
import { db as database } from '@/lib/db';

/**
 * The signed-in user for the current request. Cached per request so a page can
 * call it from several components without re-reading the cookie.
 */
export const getViewer = cache(async (): Promise<User | null> => {
  const id = await currentUserId();
  if (!id) return null;
  const user = await db().get('users', id);
  if (!user || user.status === 'banned') return null;
  return user;
});

export async function requireViewer(next = '/home'): Promise<User> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  return viewer;
}

export async function requireAdmin(): Promise<User> {
  const viewer = await requireViewer('/admin');
  if (viewer.role !== 'admin') redirect('/home');
  return viewer;
}

/** Keeps `last_active_at` fresh, at most once a day. Called from the app shell. */
export async function markActive(viewer: User | null): Promise<void> {
  if (!viewer || viewer.status !== 'active') return;
  const today = new Date().toISOString().slice(0, 10);
  if (viewer.last_active_at.slice(0, 10) === today) return;
  await database().update('users', viewer.id, { last_active_at: new Date().toISOString() });
}
