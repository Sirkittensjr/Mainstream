/**
 * Video views in the full-screen feed, on a phone, against the real database.
 *
 * The other view flows watch one video. This one scrolls a feed of several, the
 * way somebody does on an iPhone: autoplay with the sound refused, a swipe to
 * the next clip, a swipe back to one whose player was taken down while it was
 * two slides away, a glance of under a second, a refresh, the creator watching
 * their own. After every step it reads the count from the DATABASE — not from
 * the page — and then checks that the eye on the slide shows that number.
 *
 * Chromium with iPhone 13 emulation: the WebKit build is not available here.
 * Its autoplay rule is the one that matters and is the same as Safari's — a
 * muted clip may start on its own, a clip with sound may not — so no autoplay
 * flag is passed.
 *
 *   BASE_URL=http://localhost:3000 \
 *   DATABASE_URL=postgres://…/faytarra_sb \
 *   node scripts/e2e/views-feed-iphone-flow.mjs
 *
 * Needs the Supabase stand-in (see supabase-gateway.mjs) for DATABASE_URL to
 * mean anything; without it the counts are read from the API instead.
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const FIXTURES = process.env.FIXTURES || '/tmp/fay-video-fixtures';
const CHROMIUM = process.env.CHROMIUM_PATH;
const DATABASE_URL = process.env.DATABASE_URL || '';
const PASSWORD = 'a long enough password';
const IPHONE = devices['iPhone 13'];

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pool = null;
if (DATABASE_URL) {
  const { default: pg } = await import('pg');
  pool = new pg.Pool({ connectionString: DATABASE_URL });
}

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

async function createAccount(browser, handle, interest, device = {}) {
  const context = await browser.newContext({ ...device, baseURL: BASE });
  const page = await context.newPage();
  const email = `${handle}@example.com`;
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]', { hasText: interest }).first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForFunction(() => location.pathname.startsWith('/verify-email'), undefined, {
    timeout: 30000,
  });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

async function postVideo(page, { title, description }) {
  await page.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Post a video', { timeout: 15000 });
  await page.locator('input[type=file]').setInputFiles({
    name: 'landscape.webm',
    mimeType: 'video/webm',
    buffer: readFileSync(path.join(FIXTURES, 'landscape.webm')),
  });
  await page.waitForSelector('#video-title', { timeout: 30000 });
  await page.fill('#video-title', title);
  await page.fill('#video-caption', description);
  await page.selectOption('#video-category', 'Gaming');
  await page.locator('button', { hasText: /^Post video$/ }).click();
  await page.waitForURL(/\/post\//, { timeout: 180000 });
  return page.url().split('/post/')[1];
}

/** What the database holds: the total, and how many view rows stand behind it. */
async function stored(context, postId) {
  if (pool) {
    const { rows } = await pool.query(
      `select p.video_views as total,
              (select count(*)::int from public.video_views v where v.post_id = p.id) as rows
         from public.posts p where p.id = $1`,
      [postId],
    );
    return { total: rows[0]?.total ?? null, rows: rows[0]?.rows ?? null };
  }
  const response = await context.request.get(`/api/v1/posts/${postId}`);
  const body = await response.json();
  return { total: body.post?.counts?.videoViews ?? null, rows: null };
}

/** Waits for the database's total to reach `want`; returns what it is either way. */
async function totalReaches(context, postId, want, timeout = 10000) {
  const end = Date.now() + timeout;
  let now = await stored(context, postId);
  while ((now.total ?? 0) < want && Date.now() < end) {
    await sleep(250);
    now = await stored(context, postId);
  }
  return now;
}

/** The slide whose player is on screen, by its index. */
async function activeIndex(page) {
  return page.evaluate(() => {
    const y = window.innerHeight / 2;
    const x = window.innerWidth / 2;
    for (const section of document.querySelectorAll('section[data-index]')) {
      const box = section.getBoundingClientRect();
      if (box.top <= y && box.bottom >= y && box.left <= x && box.right >= x) {
        return Number(section.getAttribute('data-index'));
      }
    }
    return -1;
  });
}

/** The number the eye on slide `index` shows. */
async function eyeOn(page, index) {
  const value = await page
    .locator(`section[data-index="${index}"] [data-video-views]`)
    .getAttribute('data-video-views', { timeout: 2000 })
    .catch(() => null);
  return value === null ? null : Number(value);
}

/**
 * A finger dragged up (next clip) or down (the one before) across the feed,
 * as raw touch events, so the browser's own scrolling and snapping move it.
 */
async function swipe(page, cdp, direction) {
  const { width, height } = page.viewportSize();
  const before = await activeIndex(page);
  const x = Math.round(width / 2);
  const from = Math.round(height * (direction === 'next' ? 0.75 : 0.25));
  const distance = (direction === 'next' ? -1 : 1) * Math.round(height * 0.5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
  for (let step = 1; step <= 12; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: from + (distance * step) / 12 }],
    });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const want = before + (direction === 'next' ? 1 : -1);
  for (let i = 0; i < 60 && (await activeIndex(page)) !== want; i += 1) await sleep(50);
  // Snapping settles after the finger lifts; give the observer its frame.
  await sleep(150);
  return activeIndex(page);
}

/**
 * Safari's autoplay rule, which headless Chromium does not apply: until the
 * page has been touched, play() with the sound on is refused with
 * NotAllowedError and nothing starts. Muted playback is allowed.
 */
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

/** Which post each slide of the feed is: index → post id. */
async function slideIds(page) {
  const slides = await page.locator('section[data-index]').evaluateAll((sections) =>
    sections.map((section) => [Number(section.getAttribute('data-index')), section.getAttribute('data-post-id')]),
  );
  return new Map(slides);
}

/** Milliseconds until the clip on slide `index` is actually moving, or null. */
async function startsWithin(page, index, timeout = 10000) {
  const began = Date.now();
  return page
    .waitForFunction(
      (at) => {
        const video = document.querySelector(`section[data-index="${at}"] video`);
        return video && !video.paused && video.currentTime > 0 ? true : null;
      },
      index,
      { timeout, polling: 25 },
    )
    .then(() => Date.now() - began)
    .catch(() => null);
}

/**
 * The eye on slide `index` against the database, until they agree. A looping
 * clip keeps adding views while this runs, so "agree" is checked as a pair of
 * reads either side of the eye's.
 */
async function eyeMatches(page, context, index, id, timeout = 8000) {
  const end = Date.now() + timeout;
  let last = '';
  do {
    const low = (await stored(context, id)).total;
    const eye = await eyeOn(page, index);
    const high = (await stored(context, id)).total;
    last = `eye ${eye}, database ${low === high ? low : `${low}…${high}`}`;
    if (eye !== null && eye >= low && eye <= high) return { ok: true, detail: last };
    await sleep(150);
  } while (Date.now() < end);
  return { ok: false, detail: last };
}

const run = async () => {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = Date.now().toString(36).slice(-5);
  const A = await createAccount(browser, `clips_${stamp}`, 'Gaming');
  const C = await createAccount(browser, `phone_${stamp}`, 'Gaming', IPHONE);
  await C.context.addInitScript(safariAutoplay);
  // A fresh tab, as opening a link to FayTarra is: the taps that signed up in
  // the old one would count, to the browser, as already having touched the page.
  await C.page.close();
  C.page = await C.context.newPage();

  const errors = [];
  const reports = [];
  for (const who of [A, C]) {
    who.page.on('pageerror', (error) => errors.push(`${who.handle}: ${error.message}`));
    who.page.on('console', (message) => {
      if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
        errors.push(`${who.handle}: ${message.text()}`);
      }
    });
  }
  // Every view report the phone sends, and what became of it.
  const isReport = (request) => request.method() === 'POST' && /\/api\/v1\/posts\/[^/]+\/views$/.test(request.url());
  C.page.on('requestfinished', async (request) => {
    if (!isReport(request)) return;
    const response = await request.response();
    reports.push({
      status: response?.status(),
      ms: Math.round(request.timing().responseEnd),
      answer: (await response?.text().catch(() => ''))?.slice(0, 90),
    });
  });
  C.page.on('requestfailed', (request) => {
    if (isReport(request)) reports.push({ status: 'failed', error: request.failure()?.errorText });
  });

  section('SETUP — three videos from one creator');
  const ids = [];
  for (const n of [1, 2, 3]) {
    ids.push(await postVideo(A.page, { title: `clip ${n} ${stamp}`, description: `feed clip ${n} ${stamp}` }));
  }
  check('three videos published', ids.length === 3 && ids.every(Boolean), ids.join(' '));
  for (const id of ids) {
    const now = await stored(C.context, id);
    check(`  ${id.slice(0, 8)} starts at zero`, now.total === 0 && (now.rows ?? 0) === 0, JSON.stringify(now));
  }

  section('FEED — autoplay on an iPhone');
  const cdp = await C.context.newCDPSession(C.page);
  const opened = Date.now();
  // Opened on the first of them, as a link to a video does; whatever the
  // ranking puts after it is what the swipes land on.
  await C.page.goto(`/videos?v=${ids[0]}`, { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('section[data-index="0"] video', { timeout: 15000 });
  const order = await slideIds(C.page);
  const [first, second, third] = [0, 1, 2].map((index) => order.get(index));
  check('the feed opens on the linked video', first === ids[0], JSON.stringify([...order].slice(0, 3)));
  if (!second || !third) throw new Error(`the feed has fewer than three videos: ${JSON.stringify([...order])}`);
  const firstPlay = (await startsWithin(C.page, 0)) === null ? null : Date.now() - opened;
  check('the first clip starts on its own', firstPlay !== null, `moving ${firstPlay} ms after navigation`);
  check(
    '  muted, as Safari insists without a tap',
    await C.page.locator('section[data-index="0"] video').evaluate((v) => v.muted),
  );
  let now = await totalReaches(C.context, first, 1);
  check('autoplay is one view, in the database', now.total === 1, JSON.stringify(now));
  let eye = await eyeMatches(C.page, C.context, 0, first);
  check('  and the eye shows it', eye.ok, eye.detail);

  /** Swipes, then checks the clip landed on is one more view, saved and shown. */
  async function arrive(direction, index, id, label) {
    const before = (await stored(C.context, id)).total;
    const landed = await swipe(C.page, cdp, direction);
    check(`${direction === 'next' ? 'swipe on' : 'swipe back'} to slide ${index}`, landed === index, `on ${landed}`);
    const moving = await startsWithin(C.page, index);
    console.log(`      slide ${index} moving ${moving} ms after the swipe`);
    const after = await totalReaches(C.context, id, before + 1);
    check(label, after.total === before + 1, `${before} → ${after.total} (rows ${after.rows})`);
    const shown = await eyeMatches(C.page, C.context, index, id);
    check('  and its eye shows the database', shown.ok, shown.detail);
  }

  section('FEED — swiping on, and a glance of under a second');
  await sleep(1500);
  await arrive('next', 1, second, 'the next clip is one view');
  await sleep(700);
  await arrive('next', 2, third, 'a clip left after 0.7 s is still one view');
  check(
    // The element itself stays (Safari readies each one for sound once); what
    // it held is let go of, so it fetches and decodes nothing.
    'the first clip is two slides away: its player has let go of the video',
    await C.page
      .locator('section[data-index="0"] video')
      // No source, nothing loaded (HAVE_NOTHING), no network (NETWORK_EMPTY).
      .evaluate((video) => !video.getAttribute('src') && video.readyState === 0 && video.networkState === 0 && video.paused),
  );

  section('FEED — swiping back');
  await sleep(1200);
  await arrive('previous', 1, second, 'coming back to a clip is another view');
  await sleep(1200);
  await arrive('previous', 0, first, 'coming back to one whose player was taken down is another view');

  section('FEED — after a refresh');
  await C.page.reload({ waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('section[data-index="0"] video', { timeout: 15000 });
  const afterReload = await slideIds(C.page);
  for (const [index, id] of afterReload) {
    if (index > 1 || !id) continue;
    eye = await eyeMatches(C.page, C.context, index, id);
    check(`  slide ${index} shows the database's count`, eye.ok, eye.detail);
  }

  // Off the feed, so the clip on screen stops adding views while the other
  // pages are compared with the database.
  await C.page.goto('/home', { waitUntil: 'domcontentloaded' });

  section('ELSEWHERE — the post page and the profile');
  for (const id of ids) {
    const total = (await stored(C.context, id)).total;
    const html = await (await C.context.request.get(`/post/${id}`)).text();
    const shown = /data-video-views="(\d+)"/.exec(html)?.[1];
    check(`  post page of ${id.slice(0, 8)} is rendered with ${total}`, Number(shown) === total, String(shown));
  }
  // The page is rendered between two reads of the database, which a clip still
  // looping on the phone can move; compare against both.
  const totalsBefore = [];
  for (const id of ids) totalsBefore.push((await stored(C.context, id)).total);
  const profile = await (await C.context.request.get(`/u/${A.handle}?tab=videos`)).text();
  const totalsAfter = [];
  for (const id of ids) totalsAfter.push((await stored(C.context, id)).total);
  const onProfile = [...profile.matchAll(/data-video-views="(\d+)"/g)].map((m) => Number(m[1]));
  const sorted = (list) => JSON.stringify([...list].sort((a, b) => a - b));
  check(
    '  the profile is rendered with the same numbers',
    sorted(onProfile) === sorted(totalsBefore) || sorted(onProfile) === sorted(totalsAfter),
    `${onProfile} vs ${totalsBefore}`,
  );

  section('THE CREATOR — watching their own, on a phone');
  const own = await browser.newContext({ ...IPHONE, baseURL: BASE, storageState: await A.context.storageState() });
  await own.addInitScript(safariAutoplay);
  const ownPage = await own.newPage();
  const before = (await stored(own, first)).total;
  await ownPage.goto(`/videos?v=${first}`, { waitUntil: 'domcontentloaded' });
  now = await totalReaches(own, first, before + 1);
  check("the creator's own play counts", now.total === before + 1, `${before} → ${now.total}`);
  eye = await eyeMatches(ownPage, own, 0, first);
  check('  and their eye shows it', eye.ok, eye.detail);
  await ownPage.goto('/home', { waitUntil: 'domcontentloaded' });

  section('A VISITOR — not signed in, on a phone');
  const visitor = await browser.newContext({ ...IPHONE, baseURL: BASE });
  await visitor.addInitScript(safariAutoplay);
  const visitorPage = await visitor.newPage();
  const visitorBefore = (await stored(visitor, first)).total;
  await visitorPage.goto(`/videos?v=${first}`, { waitUntil: 'domcontentloaded' });
  now = await totalReaches(visitor, first, visitorBefore + 1);
  check('a visitor watching counts', now.total === visitorBefore + 1, `${visitorBefore} → ${now.total}`);
  eye = await eyeMatches(visitorPage, visitor, 0, first);
  check('  and their eye shows it', eye.ok, eye.detail);
  await visitorPage.goto('/home', { waitUntil: 'domcontentloaded' });

  section('BOOKKEEPING');
  await sleep(1000);
  for (const id of ids) {
    const { total, rows } = await stored(C.context, id);
    if (rows !== null) {
      check(`  ${id.slice(0, 8)}: every stored view is in the total`, rows === total, `rows ${rows}, total ${total}`);
    }
  }
  const lost = reports.filter((entry) => entry.status !== 200);
  check('every view report got an answer', lost.length === 0, JSON.stringify(lost.slice(0, 6)));
  const times = reports.filter((entry) => typeof entry.ms === 'number').map((entry) => entry.ms).sort((a, b) => a - b);
  if (times.length) {
    console.log(`      view reports: ${times.length}, median ${times[Math.floor(times.length / 2)]} ms, max ${times.at(-1)} ms`);
  }
  check('no errors in any page', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  await pool?.end();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (error) => {
  console.error(error);
  await pool?.end().catch(() => undefined);
  process.exit(1);
});
