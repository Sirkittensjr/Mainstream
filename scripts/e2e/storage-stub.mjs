/**
 * Enough of Supabase Storage to exercise the production upload path.
 *
 * Direct-to-storage uploads are the only way a 250MB video can reach a
 * serverless deployment at all, so the sign → PUT → commit round trip needs
 * testing against something. Docker image pulls are blocked in this container,
 * so this speaks the same HTTP protocol instead: everything above it — the
 * app, @supabase/storage-js, the signed URL, the ranged reads, the move — is
 * the real thing.
 *
 * Objects live in memory. Start it beside the GoTrue stub and point
 * SUPABASE_URL at it.
 *
 *   STORAGE_PORT=54500 node scripts/e2e/storage-stub.mjs
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.STORAGE_PORT || 54500);
/** Mirrors a bucket's own file_size_limit, so the stub refuses what Storage would. */
const LIMIT = Number(process.env.STORAGE_LIMIT || 250 * 1024 * 1024);

/** path -> Buffer */
const objects = new Map();
/** token -> path */
const tickets = new Map();

const json = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const afterBucket = (pathname, prefix) => {
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf('/');
  return slash === -1 ? '' : rest.slice(slash + 1);
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  // Ask for a signed upload URL.
  if (req.method === 'POST' && p.startsWith('/storage/v1/object/upload/sign/')) {
    const key = afterBucket(p, '/storage/v1/object/upload/sign/');
    const token = randomUUID();
    tickets.set(token, key);
    return json(res, 200, { url: `/object/upload/sign/faytarra-media/${key}?token=${token}` });
  }

  // The upload itself.
  if (req.method === 'PUT' && p.startsWith('/storage/v1/object/upload/sign/')) {
    const token = url.searchParams.get('token');
    const key = tickets.get(token);
    if (!key) return json(res, 400, { message: 'Invalid token' });
    const body = await readBody(req);
    if (body.length > LIMIT) {
      return json(res, 413, { message: 'The object exceeded the maximum allowed size' });
    }
    objects.set(key, body);
    console.log(`[storage-stub] PUT ${key} (${(body.length / 1024).toFixed(0)}KB)`);
    return json(res, 200, { Key: `faytarra-media/${key}` });
  }

  // Listing, which is how the app learns an object's size.
  if (req.method === 'POST' && p.startsWith('/storage/v1/object/list/')) {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const prefix = body.prefix ? `${body.prefix}/` : '';
    const found = [...objects.entries()]
      .filter(([key]) => key.startsWith(prefix) && (!body.search || key.endsWith(body.search)))
      .map(([key, data]) => ({
        name: key.slice(prefix.length),
        id: randomUUID(),
        metadata: { size: data.length, mimetype: 'application/octet-stream' },
      }));
    return json(res, 200, found);
  }

  // A signed read URL, used for the ranged probe.
  if (req.method === 'POST' && p.startsWith('/storage/v1/object/sign/')) {
    const key = afterBucket(p, '/storage/v1/object/sign/');
    const token = randomUUID();
    tickets.set(token, key);
    return json(res, 200, { signedURL: `/object/sign/faytarra-media/${key}?token=${token}` });
  }

  if (req.method === 'POST' && p === '/storage/v1/object/move') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const data = objects.get(body.sourceKey);
    if (!data) return json(res, 404, { message: 'Object not found' });
    objects.delete(body.sourceKey);
    objects.set(body.destinationKey, data);
    console.log(`[storage-stub] MOVE ${body.sourceKey} -> ${body.destinationKey}`);
    return json(res, 200, { message: 'Successfully moved' });
  }

  if (req.method === 'DELETE' && p.startsWith('/storage/v1/object/')) {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    for (const key of body.prefixes ?? []) objects.delete(key);
    return json(res, 200, {});
  }

  // Reads: the signed one the probe uses, and the public one a post renders.
  const readKey = p.startsWith('/storage/v1/object/sign/')
    ? tickets.get(url.searchParams.get('token'))
    : p.startsWith('/storage/v1/object/public/')
      ? afterBucket(p, '/storage/v1/object/public/')
      : null;

  if (req.method === 'GET' && readKey) {
    const data = objects.get(readKey);
    if (!data) return json(res, 404, { message: 'Object not found' });
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
    if (range) {
      const from = Number(range[1]);
      const to = Math.min(Number(range[2]), data.length - 1);
      const slice = data.subarray(from, to + 1);
      return res
        .writeHead(206, {
          'content-type': 'application/octet-stream',
          'content-range': `bytes ${from}-${to}/${data.length}`,
          'content-length': String(slice.length),
        })
        .end(slice);
    }
    return res
      .writeHead(200, { 'content-type': 'video/webm', 'content-length': String(data.length) })
      .end(data);
  }

  json(res, 404, { message: `no stub route for ${req.method} ${p}` });
}).listen(PORT, '127.0.0.1', () =>
  console.log(`[storage-stub] listening on http://127.0.0.1:${PORT} (limit ${LIMIT} bytes)`),
);
