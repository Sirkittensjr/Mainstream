import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/config';
import { VERIFIED_USER_HEADER, signVerifiedUser } from '@/lib/supabase/verified-user';
import { VIEW_BROWSER_COOKIE, VIEW_BROWSER_COOKIE_OPTIONS } from '@/lib/video/viewer-cookie';

/**
 * Keeps the Supabase session alive across navigations.
 *
 * Access tokens are short lived. Without this the cookie would silently expire
 * mid-session and people would appear to be logged out for no reason, so this
 * refreshes the token and writes the updated cookies onto the response.
 *
 * It also gates the signed-in-only routes. The pages check again on the server
 * — middleware is the fast path, never the only lock.
 *
 * And it says who it verified. getUser() is a round trip to Supabase Auth, and
 * the page's own getViewer used to make the same one again a moment later; the
 * user id verified here is now handed on in a signed header instead (see
 * lib/supabase/verified-user.ts), so a page view asks Supabase Auth once.
 */
const PROTECTED = ['/create', '/settings', '/notifications', '/admin'];

/** The request's headers, minus anything a browser sent claiming to be a verified user. */
function untrusted(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.delete(VERIFIED_USER_HEADER);
  return headers;
}

export async function middleware(request: NextRequest) {
  // Whatever Supabase refreshes has to end up on the response we actually
  // return, which may be the redirect below rather than the pass-through.
  const refreshed: { name: string; value: string; options: CookieOptions }[] = [];

  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) return NextResponse.next({ request: { headers: untrusted(request) } });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
          refreshed.push(cookie);
        }
      },
    },
  });

  // Next fetches every link that scrolls into view, and each of those
  // prefetches used to cost a round trip to Supabase Auth here — six or more
  // per page on a phone, before anybody had tapped anything. A prefetch only
  // reads the session from its cookie, which is no request at all unless the
  // access token has run out; then it is refreshed and saved as on any other
  // request, so a prefetch can never leave the browser holding a used refresh
  // token. Nothing is verified for a prefetch: the page checks for itself.
  const prefetch = request.headers.has('next-router-prefetch');
  let userId: string | null = null;
  let signedIn: boolean;
  if (prefetch) {
    const { data } = await supabase.auth.getSession();
    signedIn = data.session !== null;
  } else {
    // getUser() revalidates the token with Supabase; getSession() would trust
    // whatever the cookie claims, which is not good enough for a gate.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
    signedIn = userId !== null;
  }

  const path = request.nextUrl.pathname;
  const locked = PROTECTED.some((route) => path === route || path.startsWith(`${route}/`));

  // Built after the session work above, so the refreshed cookies are in it.
  const headers = untrusted(request);
  const signed = userId ? await signVerifiedUser(userId) : null;
  if (signed) headers.set(VERIFIED_USER_HEADER, signed);

  const response =
    !signedIn && locked
      ? NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(path)}`, origin(request)))
      : NextResponse.next({ request: { headers } });

  for (const { name, value, options } of refreshed) {
    response.cookies.set(name, value, options);
  }
  // A visitor's browser id, before their first video plays: then the first
  // view they report — and any retry of it — carries the same id, rather than
  // each attempt that never got its answer back minting a new visitor.
  if (!signedIn && !request.cookies.has(VIEW_BROWSER_COOKIE)) {
    response.cookies.set(VIEW_BROWSER_COOKIE, crypto.randomUUID(), VIEW_BROWSER_COOKIE_OPTIONS);
  }
  return response;
}

/**
 * The origin the browser actually asked for.
 *
 * `request.url` and `request.nextUrl` are normalised to localhost here, so a
 * redirect built from either sends people to a different origin — where their
 * session cookies do not exist. The forwarded headers are what the host in
 * front of us says, and the Host header is what the browser sent.
 */
function origin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return request.nextUrl.origin;
  const proto =
    request.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export const config = {
  matcher: [
    // Pages only. Not static assets, and not /api: every API route checks
    // who is asking itself (getViewer, which refreshes an expired session on
    // its own), so running this first only added a second round trip to
    // Supabase Auth to each one — the view reports, the unread badge every
    // twenty seconds, a video's comments.
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|api/).*)',
  ],
};
