import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { db } from '@/lib/db';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/config';
import { hasAdminVerification } from '@/lib/services/admin-step-up';
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
    const url = supabaseUrl();
    const anonKey = supabaseAnonKey();
    if (!url || !anonKey) return null;
    const client = createClient(url, anonKey, {
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

/**
 * The gate on /admin and on every admin action.
 *
 * Two things have to be true, and the second is new: the account carries
 * `role = 'admin'` in the database, AND this browser has completed the emailed
 * code step. Being an admin is not the same as being an admin RIGHT NOW on
 * THIS machine, which is the whole point of a second factor.
 *
 * Both are checked here rather than at the page, so every caller — the
 * dashboard, each of its tabs, and each admin server action — is covered by
 * the same two questions. A signed-in admin who has not verified is sent to do
 * so; nothing of the dashboard is rendered first.
 *
 * `requireAdminAccount` is the one deliberate exception, below.
 */
export async function requireAdmin(): Promise<User> {
  const viewer = await requireAdminAccount();
  if (!(await hasAdminVerification(viewer.id))) redirect('/admin/verify');
  return viewer;
}

/**
 * An admin account, WITHOUT the code step.
 *
 * Only the verification screen itself may use this — it is the one place that
 * has to know who the admin is before they have proved it, so that it can send
 * a code to their address and check what they type back. It grants access to
 * nothing else.
 */
export async function requireAdminAccount(): Promise<User> {
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
