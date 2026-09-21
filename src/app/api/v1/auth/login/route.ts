import { createClient } from '@supabase/supabase-js';
import { apiError, json, serialiseUser } from '@/lib/api';
import { profileForAuthUser } from '@/lib/services/account';
import { SUPABASE_ANON_KEY, SUPABASE_URL, authConfigured } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

/**
 * Exchanges credentials for a Supabase session.
 *
 * A native client stores the returned access token and sends it as
 * `Authorization: Bearer <token>` — the same token the website holds in its
 * cookies, verified the same way. Passwords are handled entirely by Supabase.
 */
export async function POST(request: Request) {
  if (!authConfigured()) return apiError('Authentication is not configured', 503);

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;
  if (!body?.email || !body?.password) {
    return apiError('email and password are required', 422);
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: body.email.trim().toLowerCase(),
    password: body.password,
  });
  if (error || !data.session || !data.user) return apiError('Invalid credentials', 401);

  const profile = await profileForAuthUser(data.user);
  if (!profile || profile.status === 'banned') return apiError('Account unavailable', 403);

  return json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    user: serialiseUser(profile),
  });
}
