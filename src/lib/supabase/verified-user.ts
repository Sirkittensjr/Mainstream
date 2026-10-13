/**
 * "The middleware already checked who this is" — passed to the page securely.
 *
 * Every page request from a signed-in person used to ask Supabase Auth who they
 * were twice: once in the middleware, which has to (it refreshes the session
 * and guards the signed-in-only routes), and again in the page's getViewer.
 * Both calls go over the network to Supabase, and on a phone page load the
 * second one is pure waiting.
 *
 * So the middleware hands the user id it has just verified to the rest of the
 * request in a header, SIGNED: an HMAC over the id and a short expiry, keyed
 * with the service role key, which only the server has. A browser can put a
 * header of the same name on its own request — the middleware removes it, and
 * where the middleware does not run (the API routes) the signature cannot be
 * made without the key — so the only way to get a user id accepted here is for
 * the middleware to have verified it. Anything that does not check out is
 * ignored, and getViewer asks Supabase itself, exactly as before.
 *
 * Web Crypto only, because the middleware runs on the edge.
 */

export const VERIFIED_USER_HEADER = 'x-faytarra-verified-user';

/** How long a signed id is accepted. It is made and used within one request. */
const LIFETIME_MS = 60_000;

const encoder = new TextEncoder();
let cached: { secret: string; key: Promise<CryptoKey> } | null = null;

function signingKey(): Promise<CryptoKey> | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  if (cached?.secret !== secret) {
    cached = {
      secret,
      key: crypto.subtle.importKey(
        'raw',
        encoder.encode(`faytarra:verified-user:${secret}`),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
      ),
    };
  }
  return cached.key;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let text = '';
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<user id>.<expiry ms>.<signature>`, or null when there is no key to sign with. */
export async function signVerifiedUser(userId: string, now: number = Date.now()): Promise<string | null> {
  const key = signingKey();
  if (!key || !USER_ID.test(userId)) return null;
  const payload = `${userId}.${now + LIFETIME_MS}`;
  const signature = await crypto.subtle.sign('HMAC', await key, encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

/** The user id in a header the middleware signed, or null for anything else. */
export async function readVerifiedUser(
  value: string | null | undefined,
  now: number = Date.now(),
): Promise<string | null> {
  if (!value) return null;
  const key = signingKey();
  if (!key) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiry, signature] = parts;
  if (!USER_ID.test(userId) || !/^\d{1,15}$/.test(expiry)) return null;
  const expires = Number(expiry);
  // Expired, or claiming to last longer than the middleware ever signs for.
  if (expires < now || expires > now + LIFETIME_MS) return null;
  const bytes = fromBase64Url(signature);
  if (!bytes) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await key,
    bytes,
    encoder.encode(`${userId}.${expiry}`),
  );
  return valid ? userId : null;
}
