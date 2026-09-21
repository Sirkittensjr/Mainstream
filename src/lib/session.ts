import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { db } from '@/lib/db';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase/config';
import { createAuthClient } from '@/lib/supabase/server';
import type { User } from '@/lib/types';

/**
 * The signed-in person for this request, as a FayTarra profile.
 *
 * Identity comes from Supabase Auth. `getUser()` verifies the token with
 * Supabase rather than trusting the cookie's contents, so this is safe to gate
 * on. Cached per request so a page can call it from several components without
 * re-checking.
 */
export const getViewer = cache(async (): Promise<User | null> => {
  const authUserId = await authenticatedUserId();
  if (!authUserId) return null;

  const profile = await db().get('users', authUserId);
  if (!profile || profile.status === 'banned') return null;
  return profile;
});

async function authenticatedUserId(): Promise<string | null> {
  // Native clients send the Supabase access token as a bearer header; the
  // website sends the cookies Supabase manages. Same tokens, same verification.
  const authorization = (await headers()).get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    return error ? null : (data.user?.id ?? null);
  }

  const supabase = await createAuthClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  return error ? null : (data.user?.id ?? null);
}

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
  await db().update('users', viewer.id, { last_active_at: new Date().toISOString() });
}
