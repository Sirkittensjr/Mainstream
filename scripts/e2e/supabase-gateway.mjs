/**
 * One origin that answers like a Supabase project, with a REAL PostgREST and a
 * real Postgres behind it — for the failures only production has.
 *
 * postgrest-stub.mjs speaks PostgREST's protocol over an in-memory dataset,
 * which is fast and catches query-shape bugs. It cannot catch what only the
 * database does: unique indexes settling races, triggers, functions called
 * over RPC, row level security, grants, the schema cache. This puts the real
 * thing behind the same three paths a project serves:
 *
 *   /rest/v1/*     → PostgREST (`postgrest` binary, against `supabase/schema.sql`)
 *   /auth/v1/*     → gotrue-stub.mjs
 *   /storage/v1/*  → storage-stub.mjs
 *
 * A real project's signup writes the new account to `auth.users`, and a
 * trigger there creates the FayTarra profile. The GoTrue stub keeps its
 * accounts in memory, so every successful signup through here is copied into
 * `auth.users` as well — the trigger then runs exactly as it does in
 * production, and `public.users` keeps its foreign key.
 *
 *   GATEWAY_LATENCY_MS=40   delay every database and auth request this long,
 *                           to stand in for the network between the app
 *                           server and Supabase (default 0)
 *   GET  /__stats           every /rest/v1 and /auth/v1 request since the last
 *                           reset: method, table, function or auth endpoint,
 *                           status, milliseconds
 *   POST /__stats           reset
 *
 * Setup, with a local Postgres and the PostgREST binary:
 *
 *   createdb faytarra_sb
 *   psql -d faytarra_sb -f scripts/e2e/supabase-roles.sql
 *   psql -d faytarra_sb -f scripts/e2e/supabase-shim.sql
 *   psql -d faytarra_sb -f supabase/schema.sql
 *   postgrest scripts/e2e/postgrest.conf &           # see that file
 *   STUB_PORT=54322 node scripts/e2e/gotrue-stub.mjs &
 *   STORAGE_PORT=54500 node scripts/e2e/storage-stub.mjs &
 *   DATABASE_URL=postgres://postgres:…@127.0.0.1/faytarra_sb \
 *     PORT=54321 node scripts/e2e/supabase-gateway.mjs &
 *
 * and the app with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 and a
 * SUPABASE_SERVICE_ROLE_KEY signed with PostgREST's jwt-secret
 * (`node scripts/e2e/supabase-gateway.mjs --service-key`).
 */
import { createHmac } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';

const PORT = Number(process.env.PORT || 54321);
const POSTGREST = Number(process.env.POSTGREST_PORT || 55301);
const GOTRUE = Number(process.env.GOTRUE_PORT || 54322);
const STORAGE = Number(process.env.STORAGE_PORT || 54500);
const LATENCY = Number(process.env.GATEWAY_LATENCY_MS || 0);
/** The GoTrue stub's secret, which postgrest.conf uses too, so one JWT works for both. */
const JWT_SECRET = process.env.JWT_SECRET || 'stub-jwt-secret-for-local-testing-only';

const sign = (payload) => {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}`;
  return `${body}.${createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`;
};

if (process.argv.includes('--service-key') || process.argv.includes('--anon-key')) {
  const role = process.argv.includes('--service-key') ? 'service_role' : 'anon';
  const now = Math.floor(Date.now() / 1000);
  console.log(sign({ iss: 'supabase-local', role, iat: now, exp: now + 10 * 365 * 24 * 3600 }));
  process.exit(0);
}

const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let log = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A signup the stub accepted, written where Supabase Auth would write it. */
async function mirrorSignup(user) {
  if (!user?.id || !user?.email) return;
  await pool.query(
    `insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
     values ($1, $2, $3, now(), now())
     on conflict (id) do nothing`,
    [user.id, user.email, JSON.stringify(user.user_metadata ?? {})],
  );
}

function forward(req, res, { port, path, onBody }) {
  const started = performance.now();
  const upstream = httpRequest(
    { host: '127.0.0.1', port, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } },
    (answer) => {
      const record = () => {
        if (port !== POSTGREST && port !== GOTRUE) return;
        const [route] = path.split('?');
        log.push({
          method: req.method,
          // A table, `rpc/<function>`, or `auth/<endpoint>`.
          table: port === GOTRUE ? route.replace(/^\/auth\/v1\//, 'auth/') : route.replace(/^\//, ''),
          status: answer.statusCode,
          ms: Math.round(performance.now() - started),
          query: decodeURIComponent(path.split('?')[1] ?? '').slice(0, 300),
        });
      };
      if (!onBody) {
        res.writeHead(answer.statusCode, answer.headers);
        answer.pipe(res);
        answer.on('end', record);
        return;
      }
      const chunks = [];
      answer.on('data', (chunk) => chunks.push(chunk));
      answer.on('end', async () => {
        const body = Buffer.concat(chunks);
        try {
          await onBody(answer.statusCode, body);
        } catch (error) {
          console.error('[gateway] could not mirror the signup into auth.users:', error.message);
        }
        res.writeHead(answer.statusCode, answer.headers);
        res.end(body);
        record();
      });
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: `gateway: ${error.message}` }));
  });
  req.pipe(upstream);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === '/__stats') {
    if (req.method === 'POST') {
      log = [];
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requests: log.length, log }));
    return;
  }

  if (path.startsWith('/rest/v1/') || path === '/rest/v1') {
    if (LATENCY) await wait(LATENCY);
    forward(req, res, { port: POSTGREST, path: req.url.replace(/^\/rest\/v1/, '') || '/' });
    return;
  }
  if (path.startsWith('/auth/v1/')) {
    if (LATENCY) await wait(LATENCY);
    const signup = req.method === 'POST' && path === '/auth/v1/signup';
    forward(req, res, {
      port: GOTRUE,
      path: req.url,
      onBody: signup
        ? async (status, body) => {
            if (status === 200) await mirrorSignup(JSON.parse(body.toString()));
          }
        : undefined,
    });
    return;
  }
  if (path.startsWith('/storage/v1/')) {
    forward(req, res, { port: STORAGE, path: req.url });
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ message: 'not a Supabase path' }));
}).listen(PORT, () => {
  console.log(`[gateway] :${PORT} → PostgREST :${POSTGREST}, GoTrue :${GOTRUE}, Storage :${STORAGE}`);
});
