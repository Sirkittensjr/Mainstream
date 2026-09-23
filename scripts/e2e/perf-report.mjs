/**
 * What each page costs the database.
 *
 * Runs against the instrumented PostgREST stand-in, which counts every query
 * and every row the app asks for. Numbers, not impressions: this is how the
 * performance work found its targets and how it proved they moved.
 *
 *   PORT=55400 GOTRUE_PORT=54321 node scripts/e2e/postgrest-stub.mjs &
 *   node scripts/e2e/seed-perf.mjs 55400          # a realistic dataset
 *   npm start &
 *   STUB=http://127.0.0.1:55400 BASE_URL=http://localhost:3000 \
 *     node scripts/e2e/perf-report.mjs
 *
 * A route is measured twice on purpose. The first visit after a change pays
 * for the shared aggregates; every visit after that does not, and that second
 * number is what a visitor actually experiences.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const STUB = process.env.STUB || 'http://127.0.0.1:55400';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const CHROMIUM = process.env.CHROMIUM_PATH;

const reset = () => fetch(`${STUB}/__stats/reset`, { method: 'POST' }).then((r) => r.json());
const stats = () => fetch(`${STUB}/__stats`).then((r) => r.json());

async function createAccount(browser, handle) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', `${handle}@example.com`);
  await page.fill('#username', handle);
  await page.fill('#password', 'a long enough password');
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]').first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForFunction(() => location.pathname.startsWith('/verify-email'), undefined, {
    timeout: 30000,
  });
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const link = [...rows].reverse().find((m) => m.to === `${handle}@example.com`)?.link;
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  return page;
}

async function measure(page, path) {
  await reset();
  const started = Date.now();
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 15000 })
    .catch(() => undefined);
  const ms = Date.now() - started;
  const { totalQueries, totalRows, byTable } = await stats();
  return { path, ms, totalQueries, totalRows, byTable };
}

const row = (r) =>
  `  ${r.path.padEnd(24)} ${String(r.ms).padStart(5)}ms  ${String(r.totalQueries).padStart(3)} queries ${String(r.totalRows).padStart(7)} rows`;

const run = async () => {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = Date.now().toString(36).slice(-5);
  const page = await createAccount(browser, `perfv${stamp}`);

  // Follow a few people so the Following feed and the rankings have work to do.
  for (const who of ['perf001', 'perf002', 'perf003']) {
    await page.goto(`/u/${who}`, { waitUntil: 'domcontentloaded' });
    const follow = page.locator('button', { hasText: /^Follow$/ });
    if ((await follow.count()) > 0) {
      await follow.first().click();
      await page.waitForTimeout(900);
    }
  }

  const routes = [
    '/', '/home', '/home?tab=recommended', '/discover', '/discover?show=people',
    '/search?q=perf', '/u/perf001', '/u/perf001/followers', '/notifications', '/messages',
  ];

  console.log('FIRST VISIT after a change — pays for the shared aggregates');
  for (const path of routes) console.log(row(await measure(page, path)));

  console.log('\nEVERY VISIT AFTER — what a visitor actually gets');
  const warm = [];
  for (const path of routes) warm.push(await measure(page, path));
  for (const r of warm) console.log(row(r));

  const worst = [...warm].sort((a, b) => b.totalRows - a.totalRows)[0];
  console.log(`\nMost expensive route: ${worst.path} — ${worst.totalRows} rows`);
  for (const [table, v] of Object.entries(worst.byTable).sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`  ${table.padEnd(14)} ${String(v.queries).padStart(2)} queries ${String(v.rows).padStart(6)} rows`);
  }
  console.log(`\nTotal across all routes: ${warm.reduce((s, r) => s + r.totalRows, 0)} rows, ${warm.reduce((s, r) => s + r.totalQueries, 0)} queries`);

  await browser.close();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
