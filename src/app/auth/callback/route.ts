import { type NextRequest } from 'next/server';
import { profileForAuthUser } from '@/lib/services/account';
import { createAuthClient } from '@/lib/supabase/server';

/**
 * Where every Supabase email link lands: confirming an address, and the
 * password-reset link.
 *
 * Supabase sends a one-time code; exchanging it here is what creates the
 * session cookies. Nothing about the person's identity is taken from the URL —
 * only Supabase can turn the code into a session.
 */

/**
 * Redirects with a RELATIVE Location, which the browser resolves against the
 * address it actually asked for.
 *
 * `request.url` is normalised to localhost inside a route handler, so building
 * an absolute URL from it sends people to the wrong origin — and the session
 * cookies, which were set on the origin they came from, do not travel with
 * them. That looks exactly like "the confirmation link didn't log me in".
 */
function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}

/** Only our own paths, never an absolute URL someone put in the query string. */
function safePath(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safePath(url.searchParams.get('next'), '/home');
  const errorDescription = url.searchParams.get('error_description');

  if (errorDescription) {
    return redirect(`/login?error=${encodeURIComponent(errorDescription)}`);
  }
  if (!code) {
    return redirect('/login?error=That%20link%20is%20no%20longer%20valid.');
  }

  const supabase = await createAuthClient();
  if (!supabase) return redirect('/login?error=Sign-in+is+not+configured.');

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return redirect('/login?error=That%20link%20has%20expired.%20Try%20again.');
  }

  // Belt and braces: if the database trigger is not installed, the confirmed
  // account would otherwise have no profile to sign in to.
  await profileForAuthUser(data.user);

  return redirect(next);
}
