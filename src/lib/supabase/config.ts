/**
 * Supabase connection details.
 *
 * Authentication is Supabase Auth — FayTarra never hashes, stores or checks a
 * password itself. Nothing here is a secret: the anon key is designed to be
 * public, and what it is allowed to do is decided by the grants and RLS
 * policies in supabase/schema.sql, not by keeping it hidden. The service role
 * key IS a secret and is read separately, server-side only.
 *
 * Two names are accepted for each value:
 *
 *   NEXT_PUBLIC_SUPABASE_URL      / SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY
 *
 * That is not redundancy for its own sake. Next.js replaces every
 * `NEXT_PUBLIC_*` read with a literal at BUILD time, so on Vercel adding one
 * of those in the dashboard does nothing to a deployment that has already been
 * built — and a redeploy that reuses the build cache can miss it too. The
 * unprefixed names are ordinary environment variables read at RUNTIME, so
 * setting them takes effect on the next deploy without depending on what the
 * build happened to inline.
 *
 * Both names are also exactly what Supabase's own Vercel integration sets, so
 * connecting the project through that integration configures this with no
 * further work.
 *
 * Nothing in the browser uses these: every Supabase call in FayTarra is made
 * from the server (see src/lib/supabase/server.ts), which is why the
 * unprefixed, runtime-only form is enough on its own.
 */

/** Read at call time, never captured at module scope — see above. */
export function supabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(
    /\/$/,
    '',
  );
}

export function supabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
}

/** Auth needs the URL and the anon key; it does not need the service role. */
export function authConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

/** Which of the two required values are missing, for a message worth reading. */
export function missingAuthVars(): string[] {
  const missing: string[] = [];
  if (!supabaseUrl()) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseAnonKey()) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}

export const AUTH_NOT_CONFIGURED =
  'Sign-in is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy.';
