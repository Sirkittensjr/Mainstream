/**
 * Supabase connection details.
 *
 * Authentication is Supabase Auth — FayTarra never hashes, stores or checks a
 * password itself. If these are not configured, the app runs in read-only
 * browsing mode and the auth screens say so rather than falling back to some
 * imitation of a login.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Auth needs the URL and the anon key; it does not need the service role. */
export function authConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export const AUTH_NOT_CONFIGURED =
  'Sign-in is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.';
