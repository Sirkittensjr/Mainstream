/**
 * Enough of PostgREST to run FayTarra against, for the things the local JSON
 * driver cannot tell us.
 *
 * Every browser suite here runs on the local driver, and production does not:
 * the last two production failures were both Supabase-only, and neither could
 * have been caught by a test that never spoke PostgREST. This speaks the
 * protocol — `eq.`, `is.null`, `in.()`, Range paging, the object Accept
 * header — over an in-memory dataset, and proxies /auth/v1 and /storage/v1 to
 * the GoTrue and Storage stubs so one origin serves all three, exactly as a
 * real project does.
 *
 *   STUB_PORT=54321 node scripts/e2e/gotrue-stub.mjs &
 *   STORAGE_PORT=54500 node scripts/e2e/storage-stub.mjs &
 *   PORT=55300 GOTRUE_PORT=54321 STORAGE_PORT=54500 node scripts/e2e/postgrest-stub.mjs &
 */
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 55300);
const GOTRUE = Number(process.env.GOTRUE_PORT || 54321);
const STORAGE = Number(process.env.STORAGE_PORT || 54500);

/** Columns Postgres would refuse to compare against the string "null". */
const TYPED_COLUMNS = new Set([
  'read_at', 'created_at', 'updated_at', 'last_active_at', 'username_changed_at', 'views', 'score',
]);

const TABLES = [
  'users', 'posts', 'likes', 'comments', 'follows',
  'blocks', 'ratings', 'notifications', 'reports', 'messages',
];
const data = Object.fromEntries(TABLES.map((name) => [name, []]));

/**
 * What the app asked for, so a page's cost can be counted rather than guessed.
 *
 * Every REST request is recorded with the table, the filters and how many rows
 * came back. `GET /__stats` returns the tally; `POST /__stats/reset` clears it.
 * This is how the performance work found its targets.
 */
let log = [];
let recording = false;

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

/** Columns to pretend this database does not have. See the PATCH branch. */
const MISSING_COLUMNS = new Set(
  (process.env.MISSING_COLUMNS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean),
);

/**
 * Nullable columns later migrations added, per table.
 *
 * A real PostgREST answers with every column of the table, so a row that has
 * never been given one of these still comes back holding null for it — and
 * the app reads exactly that to tell "this column exists and is empty" from
 * "this database is behind the code". A stub that echoed only what was
 * inserted would look permanently un-migrated, so it fills them in here, and
 * leaves out whatever MISSING_COLUMNS says is not there.
 */
const ADDED_COLUMNS = {
  users: ['username_changed_at', 'profile_bg', 'profile_box', 'top_creators'],
};

function withColumns(table, rows) {
  const columns = (ADDED_COLUMNS[table] ?? []).filter(
    (column) => !MISSING_COLUMNS.has(`${table}.${column}`),
  );
  if (columns.length === 0) return rows;
  return rows.map((row) => {
    const filled = { ...row };
    for (const column of columns) if (!(column in filled)) filled[column] = null;
    return filled;
  });
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
    // Paging arrives either as a Range header or as offset/limit parameters,
    // depending on how the client was built. Honour both, or a page that asks
    // for 1000 rows appears to receive the whole table.
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '')
      ?? /^(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = url.searchParams.has('limit')
      ? Number(url.searchParams.get('limit'))
      : null;
    const paged = range
      ? rows.slice(Number(range[1]), Number(range[2]) + 1)
      : limit !== null
        ? rows.slice(offset, offset + limit)
        : rows.slice(offset);
    if (recording) {
      log.push({
        table,
        filters: [...url.searchParams]
          .filter(([k]) => !['select', 'order'].includes(k))
          .map(([k, v]) => `${k}=${v}`)
          .join('&'),
        rows: paged.length,
        scanned: rows.length,
      });
    }
    return respond(req, res, withColumns(table, paged));
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
      // A column this database does not have. PostgREST answers PGRST204 and
      // names it, and the app is expected to tell that apart from a broken
      // query — which is how a deployment running behind a migration keeps
      // working instead of returning 500. Set MISSING_COLUMNS to rehearse it,
      // e.g. MISSING_COLUMNS=users.profile_bg,users.profile_box
      const absent = Object.keys(payload ?? {}).find((column) =>
        MISSING_COLUMNS.has(`${table}.${column}`),
      );
      if (absent) {
        return json(res, 400, {
          code: 'PGRST204',
          message: `Could not find the '${absent}' column of '${table}' in the schema cache`,
        });
      }
      const matching = filtered(table, url.searchParams, res);
      if (matching === null) return undefined;
      for (const row of matching) Object.assign(row, payload);
      return respond(req, res, withColumns(table, matching));
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

  if (url.pathname === '/__stats/reset' && req.method === 'POST') {
    log = [];
    recording = true;
    return json(res, 200, { recording: true });
  }
  if (url.pathname === '/__stats') {
    const byTable = {};
    for (const entry of log) {
      const t = (byTable[entry.table] ??= { queries: 0, rows: 0, scanned: 0, filters: {} });
      t.queries += 1;
      t.rows += entry.rows;
      t.scanned += entry.scanned;
      t.filters[entry.filters || '(whole table)'] =
        (t.filters[entry.filters || '(whole table)'] ?? 0) + 1;
    }
    return json(res, 200, {
      totalQueries: log.length,
      totalRows: log.reduce((sum, e) => sum + e.rows, 0),
      byTable,
    });
  }

  // A back door for the test harness to seed rows the app has no UI for.
  if (url.pathname === '/__seed' && req.method === 'POST') {
    return body(req).then((payload) => {
      for (const [table, rows] of Object.entries(payload)) data[table].push(...rows);
      json(res, 200, { seeded: Object.keys(payload) });
    });
  }
  if (url.pathname === '/__dump') return json(res, 200, data);

  if (url.pathname.startsWith('/rest/v1/')) return rest(req, res, url);

  // One origin serves auth, data and storage, exactly as a real project does:
  // the app and the browser both derive every one of those from a single
  // SUPABASE_URL, so splitting them across ports here would test a shape that
  // does not exist in production.
  const [port, name] = url.pathname.startsWith('/storage/v1/')
    ? [STORAGE, 'storage']
    : [GOTRUE, 'auth'];

  const proxy = httpRequest(
    { host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers },
    (upstream) => {
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxy.on('error', () => json(res, 502, { message: `${name} stub unreachable` }));
  req.pipe(proxy);
}).listen(PORT, '127.0.0.1', () => console.log(`[postgrest-stub] listening on :${PORT}`));
