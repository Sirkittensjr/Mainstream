import { type NextRequest } from 'next/server';
import { profileForAuthUser } from '@/lib/services/account';
import { createAuthClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * Where every Supabase email link lands: confirming an address, changing one,
 * and the password reset link.
 *
 * TWO shapes arrive here, and both have to work.
 *
 *   token_hash + type — what FayTarra's templates now send. The hash is
 *     handed straight back to Supabase with verifyOtp, which is the call that
 *     confirms the address AND returns the session. It is stateless: nothing
 *     about it depends on this browser having been the one that signed up.
 *
 *   code — Supabase's default {{ .ConfirmationURL }}, and what every link
 *     already sitting in somebody's inbox carries. Still accepted so those
 *     keep working, but it is the fragile one: @supabase/ssr pins the client
 *     to the PKCE flow, so exchangeCodeForSession needs the code-verifier
 *     cookie that was written in the browser that signed up. Open the email on
 *     a different device, in a mail app's in-app browser, or after the cookie
 *     has gone, and the exchange fails even though the link was perfectly
 *     good — which is how somebody ends up back on the login page wondering
 *     why confirming did nothing.
 *
 * Nothing about the person's identity is taken from the URL. Only Supabase can
 * turn a hash or a code into a session, and this route never mints either.
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

const OTP_TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change'];

const otpType = (raw: string | null): EmailOtpType | null =>
  OTP_TYPES.find((candidate) => candidate === raw) ?? null;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = otpType(url.searchParams.get('type'));
  const next = safePath(url.searchParams.get('next'), '/home');
  const errorDescription = url.searchParams.get('error_description');

  if (errorDescription) {
    return redirect(`/login?error=${encodeURIComponent(errorDescription)}`);
  }
  if (!code && !tokenHash) {
    return redirect('/login?error=That%20link%20is%20no%20longer%20valid.');
  }

  const supabase = await createAuthClient();
  if (!supabase) return redirect('/login?error=Sign-in+is+not+configured.');

  const result =
    tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : await supabase.auth.exchangeCodeForSession(code as string);

  if (result.error || !result.data.user) {
    return redirect('/login?error=That%20link%20has%20expired.%20Try%20again.');
  }

  // The authoritative read, not what the exchange happened to hand back:
  // getUser re-asks Supabase rather than trusting the token we just received.
  // If a confirmation link somehow left the address unconfirmed, this is where
  // that shows up — rather than at the next sign-in, as a loop back to "check
  // your email" that nobody can explain.
  const { data: current } = await supabase.auth.getUser();
  const user = current.user ?? result.data.user;

  if (type !== 'recovery' && !user.email_confirmed_at) {
    await supabase.auth.signOut().catch(() => undefined);
    return redirect(
      `/verify-email?email=${encodeURIComponent(user.email ?? '')}&error=${encodeURIComponent(
        'That link did not confirm your address. Send a new one and try again.',
      )}`,
    );
  }

  // Belt and braces: if the database trigger is not installed, the confirmed
  // account would otherwise have no profile to sign in to.
  await profileForAuthUser(user);

  return redirect(next);
}
