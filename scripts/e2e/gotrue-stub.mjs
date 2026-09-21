/**
 * A stand-in for Supabase Auth (GoTrue), speaking the same HTTP protocol.
 *
 * Docker image pulls are blocked in this container, so the real GoTrue binary
 * cannot be run. Everything above it is real: the app talks to this through
 * @supabase/ssr and @supabase/supabase-js, with real cookies, real PKCE and
 * real JWTs, so what is under test is FayTarra's integration.
 *
 * Emails are appended to outbox.jsonl instead of being sent.
 */
import { createServer } from 'node:http';
import { createHmac, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.STUB_PORT || 54321);
const OUTBOX = process.env.STUB_OUTBOX || '/tmp/fay-outbox.jsonl';
const JWT_SECRET = 'stub-jwt-secret-for-local-testing-only';
writeFileSync(OUTBOX, '');

/** email -> user record */
const users = new Map();

/**
 * Adopt the accounts the seed already wrote to the local JSON store, keeping
 * their ids so the profiles they own still belong to them. Without this the
 * sample community exists but nobody can sign in to it.
 */
function adoptSeededUsers(path, password) {
  let store;
  try {
    store = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return 0;
  }
  const now = new Date().toISOString();
  for (const user of store.users ?? []) {
    if (!user?.email || users.has(user.email.toLowerCase())) continue;
    users.set(user.email.toLowerCase(), {
      id: user.id,
      email: user.email.toLowerCase(),
      password,
      email_confirmed_at: now,
      user_metadata: {
        username: user.username,
        display_name: user.display_name,
        bio: user.bio ?? '',
        location: user.location ?? '',
        avatar_url: user.avatar_url ?? '',
        interests: user.interests ?? [],
      },
      created_at: user.created_at ?? now,
      updated_at: now,
      last_sign_in_at: null,
    });
  }
  return users.size;
}
/** one-time code -> { userId, challenge, type } */
const codes = new Map();
/** refresh token -> userId */
const refreshTokens = new Map();
/** revoked access tokens (logout) */
const revoked = new Set();

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${mac}`;
}

function verify(token) {
  const [header, body, mac] = String(token).split('.');
  if (!header || !body || !mac) return null;
  const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

function publicUser(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.email_confirmed_at,
    confirmed_at: user.email_confirmed_at,
    phone: '',
    last_sign_in_at: user.last_sign_in_at,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: user.user_metadata,
    identities: [],
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = sign({
    sub: user.id,
    email: user.email,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 3600,
    session_id: randomUUID(),
  });
  const refreshToken = randomUUID().replace(/-/g, '');
  refreshTokens.set(refreshToken, user.id);
  user.last_sign_in_at = new Date().toISOString();
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: refreshToken,
    user: publicUser(user),
  };
}

function issueCode(user, challenge, type, redirectTo) {
  const code = randomUUID();
  codes.set(code, { userId: user.id, challenge, type });
  const url = new URL(redirectTo || 'http://localhost:3000/auth/callback');
  url.searchParams.set('code', code);
  appendFileSync(OUTBOX, `${JSON.stringify({ to: user.email, type, link: url.toString() })}\n`);
  return code;
}

function bearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  if (revoked.has(token)) return null;
  const payload = verify(token);
  if (!payload) return null;
  return { token, user: [...users.values()].find((candidate) => candidate.id === payload.sub) };
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}

const fail = (res, status, code, message) =>
  send(res, status, { code: status, error_code: code, msg: message, message, error: code });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/^\/auth\/v1/, '');
  let body = {};
  if (req.method !== 'GET') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = {};
      }
    }
  }

  // --- sign up -------------------------------------------------------------
  if (req.method === 'POST' && path === '/signup') {
    const email = String(body.email || '').toLowerCase();
    const password = String(body.password || '');
    if (password.length < 6) return fail(res, 422, 'weak_password', 'Password should be at least 6 characters.');
    if (users.has(email)) return fail(res, 422, 'user_already_exists', 'User already registered');
    const now = new Date().toISOString();
    const user = {
      id: randomUUID(),
      email,
      password,
      email_confirmed_at: null,
      user_metadata: body.data ?? {},
      created_at: now,
      updated_at: now,
      last_sign_in_at: null,
    };
    users.set(email, user);
    // Confirmation on, as in a default Supabase project: no session yet.
    issueCode(user, body.code_challenge, 'signup', url.searchParams.get('redirect_to'));
    return send(res, 200, publicUser(user));
  }

  // --- tokens --------------------------------------------------------------
  if (req.method === 'POST' && path === '/token') {
    const grant = url.searchParams.get('grant_type');

    if (grant === 'password') {
      const user = users.get(String(body.email || '').toLowerCase());
      if (!user || user.password !== String(body.password || '')) {
        return fail(res, 400, 'invalid_credentials', 'Invalid login credentials');
      }
      if (!user.email_confirmed_at) {
        return fail(res, 400, 'email_not_confirmed', 'Email not confirmed');
      }
      return send(res, 200, session(user));
    }

    if (grant === 'pkce') {
      const entry = codes.get(String(body.auth_code || ''));
      if (!entry) return fail(res, 403, 'flow_state_not_found', 'invalid flow state');
      // Real PKCE: the challenge in the email link must match the verifier the
      // browser kept in its cookie.
      const verifier = String(body.code_verifier || '');
      const derived = createHash('sha256').update(verifier).digest('base64url');
      if (entry.challenge && entry.challenge !== derived) {
        return fail(res, 403, 'bad_code_verifier', 'code challenge does not match');
      }
      codes.delete(body.auth_code);
      const user = [...users.values()].find((candidate) => candidate.id === entry.userId);
      if (!user) return fail(res, 404, 'user_not_found', 'User not found');
      if (entry.type === 'signup') user.email_confirmed_at = new Date().toISOString();
      return send(res, 200, session(user));
    }

    if (grant === 'refresh_token') {
      const userId = refreshTokens.get(String(body.refresh_token || ''));
      const user = userId && [...users.values()].find((candidate) => candidate.id === userId);
      if (!user) return fail(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token');
      refreshTokens.delete(body.refresh_token);
      return send(res, 200, session(user));
    }

    return fail(res, 400, 'unsupported_grant_type', `unsupported grant ${grant}`);
  }

  // --- the signed-in user --------------------------------------------------
  if (path === '/user') {
    const holder = bearer(req);
    if (!holder?.user) return fail(res, 401, 'bad_jwt', 'invalid claim: missing sub claim');
    if (req.method === 'GET') return send(res, 200, publicUser(holder.user));
    if (req.method === 'PUT') {
      if (body.password) holder.user.password = String(body.password);
      if (body.email) {
        users.delete(holder.user.email);
        holder.user.email = String(body.email).toLowerCase();
        users.set(holder.user.email, holder.user);
      }
      if (body.data) holder.user.user_metadata = { ...holder.user.user_metadata, ...body.data };
      holder.user.updated_at = new Date().toISOString();
      return send(res, 200, publicUser(holder.user));
    }
  }

  if (req.method === 'POST' && path === '/logout') {
    const holder = bearer(req);
    if (holder) revoked.add(holder.token);
    res.writeHead(204).end();
    return;
  }

  // --- password reset ------------------------------------------------------
  if (req.method === 'POST' && path === '/recover') {
    const user = users.get(String(body.email || '').toLowerCase());
    // Always 200, the way GoTrue does, so addresses cannot be enumerated.
    if (user) issueCode(user, body.code_challenge, 'recovery', url.searchParams.get('redirect_to'));
    return send(res, 200, {});
  }

  if (req.method === 'POST' && path === '/resend') {
    const user = users.get(String(body.email || '').toLowerCase());
    if (user) issueCode(user, body.code_challenge, 'signup', url.searchParams.get('redirect_to'));
    return send(res, 200, {});
  }

  if (path === '/settings') {
    return send(res, 200, { external: {}, disable_signup: false, mailer_autoconfirm: false });
  }

  if (path === '/health') return send(res, 200, { name: 'GoTrue stub', version: 'stub' });

  return fail(res, 404, 'not_found', `no route for ${req.method} ${path}`);
});

if (process.env.STUB_SEED_FROM) {
  const adopted = adoptSeededUsers(
    process.env.STUB_SEED_FROM,
    process.env.STUB_SEED_PASSWORD || 'faydemo123',
  );
  console.log(`[gotrue-stub] adopted ${adopted} seeded accounts`);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[gotrue-stub] listening on http://127.0.0.1:${PORT}`);
});
