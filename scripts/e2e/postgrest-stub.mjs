/**
 * Enough of PostgREST to run FayTarra against, for the things the local JSON
 * driver cannot tell us.
 *
 * Every browser suite here runs on the local driver, and production does not:
 * the last two production failures were both Supabase-only, and neither could
 * have been caught by a test that never spoke PostgREST. This speaks the
 * protocol — `eq.`, `is.null`, `in.()`, Range paging, the object Accept
 * header — over an in-memory dataset, and proxies /auth/v1 to the GoTrue stub
 * so the same origin serves both, exactly as a real project does.
 *
 *   STUB_PORT=54321 node scripts/e2e/gotrue-stub.mjs &
 *   PORT=55300 GOTRUE_PORT=54321 node scripts/e2e/postgrest-stub.mjs &
 */
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 55300);
const GOTRUE = Number(process.env.GOTRUE_PORT || 54321);

/** Columns Postgres would refuse to compare against the string "null". */
const TYPED_COLUMNS = new Set([
  'read_at', 'created_at', 'updated_at', 'last_active_at', 'username_changed_at', 'views', 'score',
]);

const TABLES = [
  'users', 'posts', 'likes', 'comments', 'follows',
  'blocks', 'ratings', 'notifications', 'reports', 'messages',
];
const data = Object.fromEntries(TABLES.map((name) => [name, []]));

const json = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

/** PostgREST returns a bare object, not an array, when asked for one. */
const wantsObject = (req) => String(req.headers.accept ?? '').includes('vnd.pgrst.object');

function respond(req, res, rows) {
  if (!wantsObject(req)) return json(res, 200, rows);
  if (rows.length === 1) return json(res, 200, rows[0]);
  if (rows.length === 0) {
    return json(res, 406, { code: 'PGRST116', message: 'JSON object requested, 0 rows returned' });
  }
  return json(res, 406, { code: 'PGRST116', message: 'multiple rows returned' });
}

function filtered(table, params, res) {
  let rows = data[table] ?? [];
  for (const [key, value] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns'].includes(key)) continue;

    if (value === 'eq.null' && TYPED_COLUMNS.has(key)) {
      // What Postgres actually says. `eq` compares against a literal, so this
      // asks it to cast the string "null" to the column's type.
      json(res, 400, {
        code: '22007',
        message: `invalid input syntax for type timestamp with time zone: "null"`,
      });
      return null;
    }
    if (value === 'is.null') {
      rows = rows.filter((row) => row[key] === null || row[key] === undefined);
    } else if (value.startsWith('eq.')) {
      const want = value.slice(3);
      rows = rows.filter((row) => String(row[key]) === want);
    } else if (value.startsWith('neq.')) {
      const want = value.slice(4);
      rows = rows.filter((row) => String(row[key]) !== want);
    } else if (value.startsWith('in.')) {
      const set = new Set(
        value.slice(3).replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')),
      );
      rows = rows.filter((row) => set.has(String(row[key])));
    }
  }

  for (const order of params.getAll('order')) {
    const [column, direction] = order.split('.');
    rows = [...rows].sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')));
    if (direction === 'desc') rows.reverse();
  }
  return rows;
}

function rest(req, res, url) {
  const table = url.pathname.replace('/rest/v1/', '').split('?')[0];
  if (!TABLES.includes(table)) {
    return json(res, 404, {
      code: 'PGRST205',
      message: `Could not find the table 'public.${table}' in the schema cache`,
    });
  }

  if (req.method === 'GET') {
    const rows = filtered(table, url.searchParams, res);
    if (rows === null) return undefined;
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '')
      ?? /^(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    const paged = range ? rows.slice(Number(range[1]), Number(range[2]) + 1) : rows;
    return respond(req, res, paged);
  }

  return body(req).then((payload) => {
    if (req.method === 'POST') {
      const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
        id: row.id ?? randomUUID(),
        ...row,
      }));
      data[table].push(...rows);
      return respond(req, res, rows);
    }
    if (req.method === 'PATCH') {
      const matching = filtered(table, url.searchParams, res);
      if (matching === null) return undefined;
      for (const row of matching) Object.assign(row, payload);
      return respond(req, res, matching);
    }
    if (req.method === 'DELETE') {
      const matching = filtered(table, url.searchParams, res);
      if (matching === null) return undefined;
      data[table] = data[table].filter((row) => !matching.includes(row));
      return respond(req, res, matching);
    }
    return json(res, 405, { message: `no stub route for ${req.method}` });
  });
}

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // A back door for the test harness to seed rows the app has no UI for.
  if (url.pathname === '/__seed' && req.method === 'POST') {
    return body(req).then((payload) => {
      for (const [table, rows] of Object.entries(payload)) data[table].push(...rows);
      json(res, 200, { seeded: Object.keys(payload) });
    });
  }
  if (url.pathname === '/__dump') return json(res, 200, data);

  if (url.pathname.startsWith('/rest/v1/')) return rest(req, res, url);

  const proxy = httpRequest(
    { host: '127.0.0.1', port: GOTRUE, path: req.url, method: req.method, headers: req.headers },
    (upstream) => {
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxy.on('error', () => json(res, 502, { message: 'auth stub unreachable' }));
  req.pipe(proxy);
}).listen(PORT, '127.0.0.1', () => console.log(`[postgrest-stub] listening on :${PORT}`));
