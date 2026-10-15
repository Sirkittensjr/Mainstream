/**
 * HTTPS in front of the Supabase stand-in (supabase-gateway.mjs), so its
 * storage URLs are https:// as a real project's are.
 *
 * It matters for pictures: next.config.mjs lets the image optimiser fetch only
 * https:// remote images, so behind plain http every optimised picture from
 * the bucket is refused ("url" parameter is not allowed) — a failure production
 * never has, which hides the ones it does. See README section 4h-2 for making
 * the certificate and trusting it.
 *
 *   TLS_DIR=/tmp/fay-tls HTTPS_PORT=54443 TARGET_PORT=54321 \
 *     node scripts/e2e/https-front.mjs
 */
import { request } from 'node:http';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = process.env.TLS_DIR || '/tmp/fay-tls';
const PORT = Number(process.env.HTTPS_PORT || 54443);
const TARGET = Number(process.env.TARGET_PORT || 54321);

const tls = {
  key: readFileSync(path.join(DIR, 'server.key')),
  cert: readFileSync(path.join(DIR, 'server.pem')),
};

createServer(tls, (req, res) => {
  const upstream = request(
    { host: '127.0.0.1', port: TARGET, path: req.url, method: req.method, headers: req.headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502);
    res.end(String(error));
  });
  req.pipe(upstream);
}).listen(PORT, '127.0.0.1', () =>
  console.log(`[https-front] https://127.0.0.1:${PORT} -> http://127.0.0.1:${TARGET}`),
);
