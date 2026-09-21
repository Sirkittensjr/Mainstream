import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/config';

/**
 * Keeps the Supabase session alive across navigations.
 *
 * Access tokens are short lived. Without this the cookie would silently expire
 * mid-session and people would appear to be logged out for no reason, so this
 * refreshes the token and writes the updated cookies onto the response.
 *
 * It also gates the signed-in-only routes. The pages check again on the server
 * — middleware is the fast path, never the only lock.
 */
const PROTECTED = ['/create', '/settings', '/notifications', '/admin'];

export async function middleware(request: NextRequest) {
  // Whatever Supabase refreshes has to end up on the response we actually
  // return, which may be the redirect below rather than the pass-through.
  const refreshed: { name: string; value: string; options: CookieOptions }[] = [];

  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) return NextResponse.next({ request });

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

  // getUser() revalidates the token with Supabase; getSession() would trust
  // whatever the cookie claims, which is not good enough for a gate.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const locked = PROTECTED.some((route) => path === route || path.startsWith(`${route}/`));

  const response =
    !user && locked
      ? NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(path)}`, origin(request)))
      : NextResponse.next({ request });

  for (const { name, value, options } of refreshed) {
    response.cookies.set(name, value, options);
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
    // Everything except static assets and the app's own media routes.
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|api/cover|api/media).*)',
  ],
};
