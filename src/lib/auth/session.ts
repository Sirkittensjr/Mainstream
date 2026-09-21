import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { supabaseConfigured } from '@/lib/db/supabase';

const COOKIE = 'faytarra_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Stored on globalThis: Next.js can load this module more than once in a single
// process (server actions and page renders live in separate bundles), and every
// copy has to agree on the key or sessions stop verifying.
const globalRef = globalThis as typeof globalThis & { __fayEphemeralSecret?: string };

/**
 * Session signing key.
 *
 * A real deployment (one pointed at Supabase) must set AUTH_SECRET — we refuse
 * to start a session without it. A local demo running on the bundled JSON
 * driver falls back to a per-process random key instead of a shared constant:
 * sessions then survive as long as the server does, and restarting signs
 * everyone out, which is the right trade for a demo.
 */
function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV !== 'production') return 'faytarra-development-secret';
  if (supabaseConfigured()) {
    throw new Error('AUTH_SECRET must be set in production.');
  }
  if (!globalRef.__fayEphemeralSecret) {
    globalRef.__fayEphemeralSecret = randomBytes(32).toString('hex');
    console.warn(
      '[faytarra] AUTH_SECRET is not set. Using a temporary key — sessions will end when the server restarts.',
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
