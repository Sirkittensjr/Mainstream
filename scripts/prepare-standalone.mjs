/**
 * Completes the standalone build.
 *
 * `next build` traces a self-contained server into .next/standalone, but it
 * deliberately does not copy the static assets — every host is expected to do
 * that itself. Skipping it produces a server that returns HTML with 404s for
 * every stylesheet and script, which looks like a broken deploy rather than a
 * missing copy step. Running it here means `npm run build` always produces a
 * complete, runnable output regardless of the platform.
 */
import { cp, access } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(standalone))) {
  console.log('[faytarra] no standalone output to prepare (output mode not set) — skipping');
  process.exit(0);
}

await cp(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), {
  recursive: true,
});
console.log('[faytarra] copied .next/static into the standalone bundle');

// `public/` is optional — the app generates its imagery at runtime.
if (await exists(path.join(root, 'public'))) {
  await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
  console.log('[faytarra] copied public/ into the standalone bundle');
}

console.log('[faytarra] standalone server ready: node .next/standalone/server.js');
