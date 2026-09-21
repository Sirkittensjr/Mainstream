import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';

const COOKIE = 'faytarra_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Stored on globalThis: Next.js can load this module more than once in a single
// process (server actions and page renders live in separate bundles), and every
// copy has to agree on the key or sessions stop verifying.
const globalRef = globalThis as typeof globalThis & {
  __fayEphemeralSecret?: string;
  __fayDerivedSecret?: string;
};

/**
 * Session signing key.
 *
 * This must never throw. It runs on every request through `getViewer()`, so a
 * missing variable here would turn a misconfigured deployment into a site
 * where every single page returns 500 — which is exactly the sort of failure
 * that looks like a broken build rather than a missing setting.
 *
 * Order of preference:
 *  1. AUTH_SECRET — what every real deployment should set.
 *  2. A key derived from the Supabase service role key. Already secret,
 *     already deployment-specific, and stable across instances and restarts,
 *     so sessions survive a redeploy even when AUTH_SECRET was forgotten.
 *  3. A per-process random key, for a local demo with no configuration at all.
 *     Sessions then last as long as the process does.
 */
function secret(): string {
  const configured = process.env.AUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') return 'faytarra-development-secret';

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    if (!globalRef.__fayDerivedSecret) {
      globalRef.__fayDerivedSecret = createHash('sha256')
        .update(`faytarra-session:${serviceKey}`)
        .digest('hex');
      console.warn(
        '[faytarra] AUTH_SECRET is not set. Deriving a stable session key from ' +
          'SUPABASE_SERVICE_ROLE_KEY so sessions keep working — set AUTH_SECRET to a long ' +
          'random string to control it yourself.',
      );
    }
    return globalRef.__fayDerivedSecret;
  }

  if (!globalRef.__fayEphemeralSecret) {
    globalRef.__fayEphemeralSecret = randomBytes(32).toString('hex');
    console.warn(
      '[faytarra] AUTH_SECRET is not set and there is no Supabase key to derive one from. ' +
        'Using a temporary key — everyone is signed out whenever the server restarts.',
    );
  }
  return globalRef.__fayEphemeralSecret;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Stateless signed session token: `<base64url payload>.<hmac>`. */
export function createToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ user_id: userId, issued_at: Date.now() }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      user_id: string;
      issued_at: number;
    };
    if (Date.now() - data.issued_at > MAX_AGE * 1000) return null;
    return data.user_id;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, createToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/**
 * The signed-in account for this request.
 *
 * The website sends the session as an HTTP-only cookie. Native clients send
 * the exact same signed token as a bearer header, so the iOS and Android apps
 * can reuse every service in `src/lib/services` without a second auth system.
 */
export async function currentUserId(): Promise<string | null> {
  const store = await cookies();
  const fromCookie = readToken(store.get(COOKIE)?.value);
  if (fromCookie) return fromCookie;

  const header = (await headers()).get('authorization');
  if (header?.startsWith('Bearer ')) return readToken(header.slice(7).trim());
  return null;
}

export const SESSION_COOKIE = COOKIE;
