/**
 * How fast FayTarra is on a phone: pages, and video startup.
 *
 * Against the Supabase stand-in (supabase-gateway.mjs, with a real PostgREST)
 * and the dataset from supabase-perf-seed.mjs. Every page is opened the way a
 * phone opens it — iPhone 13 screen and user agent, a mid-range phone's CPU
 * (4× slower than this machine) and a good 4G connection — first once to warm
 * the server's caches, then MEASURE times, and the median is reported:
 *
 *   ttfb        the server: navigation start → first byte of the page
 *   dcl / load  DOMContentLoaded and load, from navigation start
 *   lcp         largest contentful paint
 *   db / auth   requests the server made to the database and to Supabase Auth
 *               for that one page, and the time they took added up
 *   js          JavaScript transferred, kB
 *
 * and for the Videos feed: navigation → the first clip actually moving, a
 * swipe → the next clip moving, and how many megabytes of video were fetched
 * in the first ten seconds (the whole queue must not be downloaded).
 *
 *   GATEWAY_LATENCY_MS=25 node scripts/e2e/supabase-gateway.mjs &   (see there)
 *   BASE_URL=http://localhost:3000 GATEWAY=http://127.0.0.1:54321 \
 *     node scripts/e2e/perf-mobile.mjs > before.json
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const GATEWAY = process.env.GATEWAY || 'http://127.0.0.1:54321';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const MEASURE = Number(process.env.MEASURE || 3);
const PROFILE = process.env.PROFILE_USER || 'perf001';
const TAG = process.env.TAG || 'fyp';
const IPHONE = devices['iPhone 13'];
/** A good 4G connection: 12 Mbps down, 4 up, 40 ms round trip. */
const NETWORK = { offline: false, latency: 40, downloadThroughput: (12e6 / 8) | 0, uploadThroughput: (4e6 / 8) | 0 };
const CPU_SLOWDOWN = Number(process.env.CPU_SLOWDOWN || 4);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

async function stats(reset = false) {
  const response = await fetch(`${GATEWAY}/__stats`, { method: reset ? 'POST' : 'GET' });
  return reset ? null : response.json();
}

/** Safari's autoplay rule (see views-feed-iphone-flow.mjs). */
function safariAutoplay() {
  // A tap or a key press, as Safari counts them. Not `navigator.userActivation`:
  // Playwright runs its own page checks as if they were gestures, which would
  // make every page look touched. A swipe is not a gesture here either, as it
  // is not on an iPhone.
  let touched = false;
  for (const type of ['click', 'keydown']) {
    addEventListener(type, () => (touched = true), { capture: true });
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function playLikeSafari() {
    if (!this.muted && !touched) {
      return Promise.reject(new DOMException('play() needs a tap first', 'NotAllowedError'));
    }
    return play.call(this);
  };
}

/** Largest contentful paint, as the page saw it. */
function observeLcp() {
  window.__lcp = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* not supported */
  }
}

async function phone(browser, storageState) {
  const context = await browser.newContext({ ...IPHONE, baseURL: BASE, ...(storageState ? { storageState } : {}) });
  await context.addInitScript(safariAutoplay);
  await context.addInitScript(observeLcp);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  const media = new Map();
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    if (/\/storage\/v1\/object\/public\/.*\.(webm|mp4)/.test(response.url)) media.set(requestId, 0);
  });
  cdp.on('Network.dataReceived', ({ requestId, encodedDataLength, dataLength }) => {
    if (media.has(requestId)) media.set(requestId, media.get(requestId) + (encodedDataLength || dataLength));
  });
  return { context, page, cdp, media };
}

async function signUp(browser, handle) {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', `${handle}@example.com`);
  await page.fill('#username', handle);
  await page.fill('#password', 'a long enough password');
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]', { hasText: 'Gaming' }).first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForFunction(() => location.pathname.startsWith('/verify-email'), undefined, { timeout: 30000 });
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const link = [...rows].reverse().find((m) => m.type === 'signup' && m.to === `${handle}@example.com`)?.link;
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const state = await context.storageState();
  await context.close();
  return state;
}

async function visit(page, path) {
  await stats(true);
  await page.goto(path, { waitUntil: 'load', timeout: 60000 });
  await sleep(400);
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const js = performance
      .getEntriesByType('resource')
      .filter((entry) => entry.initiatorType === 'script' || entry.name.endsWith('.js'))
      .reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    return {
      ttfb: Math.round(nav.responseStart),
      dcl: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      lcp: Math.round(window.__lcp || 0),
      js: Math.round(js / 1024),
    };
  });
  const { log } = await stats();
  const db = log.filter((entry) => !entry.table.startsWith('auth/'));
  const auth = log.filter((entry) => entry.table.startsWith('auth/'));
  return {
    ...timing,
    db: db.length,
    dbMs: db.reduce((sum, entry) => sum + entry.ms, 0),
    auth: auth.length,
    tables: Object.entries(
      db.reduce((count, entry) => ({ ...count, [entry.table]: (count[entry.table] ?? 0) + 1 }), {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([table, n]) => `${table}×${n}`)
      .join(' '),
  };
}

async function pages(browser, label, storageState) {
  const { page, context } = await phone(browser, storageState);
  const rows = [];
  for (const path of ['/home', '/videos', `/u/${PROFILE}`, '/discover', `/tag/${TAG}`]) {
    await visit(page, path); // warm the server's shared caches, as a visitor after the first would find them
    const runs = [];
    for (let i = 0; i < MEASURE; i += 1) runs.push(await visit(page, path));
    const pick = (key) => median(runs.map((run) => run[key]));
    rows.push({
      who: label,
      path,
      ttfb: pick('ttfb'),
      dcl: pick('dcl'),
      load: pick('load'),
      lcp: pick('lcp'),
      db: pick('db'),
      dbMs: pick('dbMs'),
      auth: pick('auth'),
      js: pick('js'),
      tables: runs.at(-1).tables,
    });
  }
  await context.close();
  return rows;
}

/** Navigation → first clip moving; swipe → next clip moving; video bytes in 10 s. */
async function videoStartup(browser, storageState) {
  const results = [];
  for (let run = 0; run < MEASURE; run += 1) {
    const { page, context, cdp, media } = await phone(browser, storageState);
    const started = Date.now();
    await page.goto('/videos', { waitUntil: 'commit' });
    const moving = (index) =>
      page
        .waitForFunction(
          (at) => {
            const video = document.querySelector(`section[data-index="${at}"] video`);
            return video && !video.paused && video.currentTime > 0 ? true : null;
          },
          index,
          { timeout: 30000, polling: 20 },
        )
        .then(() => true)
        .catch(() => false);
    const first = (await moving(0)) ? Date.now() - started : null;
    await sleep(2500);
    // A finger dragged up the screen: the browser scrolls and snaps.
    const swipeStart = Date.now();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 500 }] });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 500 - step * 33 }] });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const next = (await moving(1)) ? Date.now() - swipeStart : null;
    await sleep(Math.max(0, 10000 - (Date.now() - started)));
    const bytes = [...media.values()].reduce((sum, n) => sum + n, 0);
    const files = [...media.values()].filter((n) => n > 0).length;
    results.push({ first, next, mb: Number((bytes / 1e6).toFixed(1)), files });
    await context.close();
  }
  return {
    firstClipMs: median(results.map((r) => r.first)),
    nextClipMs: median(results.map((r) => r.next)),
    videoMbIn10s: median(results.map((r) => r.mb)),
    videoFilesIn10s: median(results.map((r) => r.files)),
    runs: results,
  };
}

const browser = await chromium.launch();
const signedIn = await signUp(browser, `perfphone${Date.now().toString(36).slice(-5)}`);
const report = {
  setup: { network: '12 Mbps / 40 ms', cpu: `${CPU_SLOWDOWN}x`, measure: MEASURE },
  pages: [...(await pages(browser, 'visitor')), ...(await pages(browser, 'signed in', signedIn))],
  video: await videoStartup(browser, signedIn),
};
await browser.close();
console.log(JSON.stringify(report, null, 1));
console.error('\nwho        path            ttfb   dcl  load   lcp  db(ms)    auth  js(kB)');
for (const row of report.pages) {
  console.error(
    `${row.who.padEnd(10)} ${row.path.padEnd(14)} ${String(row.ttfb).padStart(5)} ${String(row.dcl).padStart(5)} ` +
      `${String(row.load).padStart(5)} ${String(row.lcp).padStart(5)} ${String(row.db).padStart(3)}(${String(row.dbMs).padStart(4)}) ` +
      `${String(row.auth).padStart(4)} ${String(row.js).padStart(6)}`,
  );
}
console.error(
  `\nvideos: first clip moving ${report.video.firstClipMs} ms after navigation; next clip ${report.video.nextClipMs} ms ` +
    `after a swipe; ${report.video.videoMbIn10s} MB of video from ${report.video.videoFilesIn10s} files in 10 s`,
);
