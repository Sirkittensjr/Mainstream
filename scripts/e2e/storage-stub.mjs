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
/** Resumable uploads in flight: id -> { key, length, contentType, chunks } */
const resumable = new Map();
/**
 * Fail one PATCH that crosses this byte offset, to rehearse a connection that
 * comes and goes. The client is expected to ask what arrived and carry on
 * from there rather than starting the file again.
 */
const FAIL_AT = Number(process.env.STORAGE_FAIL_AT || 0);
const failed = new Set();

/**
 * How many bytes of body actually arrived, by method.
 *
 * The browser's own accounting of a streamed request body is unreliable, so
 * "the video went to Storage" is answered here, by the thing that received
 * it. GET /__stats returns the tally.
 */
const received = { total: 0, byMethod: {} };
function count(method, bytes) {
  received.total += bytes;
  received.byMethod[method] = (received.byMethod[method] ?? 0) + bytes;
}

const json = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

/**
 * Reads a request body, tolerating a client that walks away mid-chunk.
 *
 * Cancelling an upload aborts the PATCH that is in flight, and Node turns
 * that into a rejected async iterator. Left alone it takes the whole stub
 * down — which is exactly what happened the first time the cancel test ran.
 * What arrived before the connection went is returned; the caller is going to
 * be answering a socket nobody is listening to either way.
 */
async function readBody(req) {
  const chunks = [];
  try {
    for await (const chunk of req) chunks.push(chunk);
  } catch {
    // Connection gone. Whatever arrived is what there is.
  }
  return Buffer.concat(chunks);
}

const afterBucket = (pathname, prefix) => {
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf('/');
  return slash === -1 ? '' : rest.slice(slash + 1);
};

/**
 * The browser talks to Storage from a different origin, so the real thing
 * answers with these and so must this. `upload-offset` and `location` have to
 * be exposed explicitly or a resumable upload cannot read its own progress.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,HEAD,DELETE,OPTIONS',
  'access-control-allow-headers':
    'authorization,apikey,content-type,x-upsert,cache-control,tus-resumable,upload-length,upload-metadata,upload-offset,upload-concat,upload-defer-length,x-http-method-override',
  'access-control-expose-headers':
    'location,upload-offset,upload-length,tus-resumable,upload-expires,content-range',
  'access-control-max-age': '86400',
};

const server = createServer(async (req, res) => {
  // An aborted upload is a normal thing for this stub to be asked to survive.
  req.on('error', () => undefined);
  res.on('error', () => undefined);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (p === '/__stats') {
    if (req.method === 'POST') {
      received.total = 0;
      received.byMethod = {};
    }
    return json(res, 200, received);
  }

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
    count('PUT', body.length);
    if (body.length > LIMIT) {
      return json(res, 413, { message: 'The object exceeded the maximum allowed size' });
    }
    objects.set(key, body);
    console.log(`[storage-stub] PUT ${key} (${(body.length / 1024).toFixed(0)}KB)`);
    return json(res, 200, { Key: `faytarra-media/${key}` });
  }

  /* ------------------------------------------------------------ resumable */
  // Storage's TUS endpoint, which is how a video actually arrives: the
  // browser creates an upload, then PATCHes it a chunk at a time, and can ask
  // with HEAD how much of it already landed. Nothing about this goes through
  // the app.
  if (req.method === 'POST' && p === '/storage/v1/upload/resumable') {
    if (!/^Bearer .+/.test(req.headers.authorization ?? '')) {
      return json(res, 401, { message: 'Unauthorized' });
    }
    const meta = Object.fromEntries(
      (req.headers['upload-metadata'] ?? '')
        .split(',')
        .map((pair) => pair.trim().split(' '))
        .filter(([key, value]) => key && value)
        .map(([key, value]) => [key, Buffer.from(value, 'base64').toString('utf8')]),
    );
    const length = Number(req.headers['upload-length'] ?? 0);
    if (!meta.objectName) return json(res, 400, { message: 'objectName is required' });
    // The same ceiling Storage applies, and the same words it uses, so the
    // "Payload too large" path can be exercised rather than imagined.
    if (length > LIMIT) {
      return json(res, 413, { message: 'The object exceeded the maximum allowed size' });
    }
    const id = randomUUID();
    resumable.set(id, {
      key: meta.objectName,
      length,
      contentType: meta.contentType ?? 'application/octet-stream',
      data: Buffer.alloc(0),
    });
    console.log(`[storage-stub] TUS create ${meta.objectName} (${length} bytes)`);
    return res
      .writeHead(201, {
        // Back through whoever asked, so this works behind the proxy that
        // gives auth, data and storage one origin.
        location: `http://${req.headers.host ?? `127.0.0.1:${PORT}`}/storage/v1/upload/resumable/${id}`,
        'tus-resumable': '1.0.0',
        'upload-offset': '0',
      })
      .end();
  }

  if (p.startsWith('/storage/v1/upload/resumable/')) {
    const id = p.slice('/storage/v1/upload/resumable/'.length);
    const upload = resumable.get(id);
    if (!upload) return json(res, 404, { message: 'Upload not found' });

    if (req.method === 'HEAD') {
      return res
        .writeHead(200, {
          'upload-offset': String(upload.data.length),
          'upload-length': String(upload.length),
          'tus-resumable': '1.0.0',
          'cache-control': 'no-store',
        })
        .end();
    }

    if (req.method === 'PATCH') {
      const offset = Number(req.headers['upload-offset'] ?? 0);
      if (offset !== upload.data.length) {
        return res.writeHead(409, { 'upload-offset': String(upload.data.length) }).end();
      }
      const body = await readBody(req);
      count('PATCH', body.length);
      if (FAIL_AT > 0 && !failed.has(id) && offset + body.length > FAIL_AT) {
        // Refuse this one chunk, exactly once, keeping the offset the client
        // has already reached. Everything it sent for this chunk is thrown
        // away — so if it were to start the file over, the bytes counted here
        // would roughly double.
        failed.add(id);
        console.log(`[storage-stub] TUS refusing one chunk at ${offset}`);
        return json(res, 500, { message: 'Transient storage error' });
      }
      upload.data = Buffer.concat([upload.data, body]);
      const done = upload.data.length >= upload.length;
      if (done) {
        objects.set(upload.key, upload.data);
        resumable.delete(id);
        console.log(
          `[storage-stub] TUS complete ${upload.key} (${(upload.data.length / 1024).toFixed(0)}KB)`,
        );
      }
      return res
        .writeHead(204, {
          'upload-offset': String(upload.data.length),
          'tus-resumable': '1.0.0',
        })
        .end();
    }

    if (req.method === 'DELETE') {
      resumable.delete(id);
      return res.writeHead(204).end();
    }
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
});

server.on('clientError', (_error, socket) => socket.destroy());
process.on('uncaughtException', (error) => {
  if ((error && error.code) === 'ECONNRESET') return;
  throw error;
});

server.listen(PORT, '127.0.0.1', () =>
  console.log(`[storage-stub] listening on http://127.0.0.1:${PORT} (limit ${LIMIT} bytes)`),
);
