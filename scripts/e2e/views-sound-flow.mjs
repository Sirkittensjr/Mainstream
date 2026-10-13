/**
 * Every play counts, and the Videos tab starts with sound where the browser
 * allows it — in real browsers, against the real database.
 *
 * After every step this reads the DATABASE (not the page) and checks that it
 * moved by exactly what happened: one view per playback start, nothing for a
 * pause and resume, a duplicate event, a retry or a refused autoplay — and
 * then that the eye shows that number.
 *
 *   A  an iPhone, signed out, under Safari's rule: sound needs a tap on EACH
 *      video element (simulated per element — WebKit itself is not available
 *      here). Refused autoplay → muted + "Tap for sound" → sound that stays on
 *      through the feed; muting that stays muted; rapid swipes; short plays;
 *      duplicate events; loops; a refresh.
 *   B  Chrome's rule: one interaction with the PAGE allows sound everywhere
 *      on it (simulated too: headless Chromium allows sound regardless, and
 *      ignores --autoplay-policy).
 *   C  autoplay with sound allowed: the feed starts with sound.
 *   D  every other place a video plays (post page, home, profile, hashtag
 *      page): plays, replays, pause and resume, scroll away and back, one
 *      video heard at a time, signed in and out.
 *   E  delivery: a lost answer, a failed attempt, a page closed mid-report,
 *      concurrent duplicates — none lost, none counted twice.
 *   F  security: other sites, malformed reports, photos, the public API key.
 *
 *   BASE_URL=http://localhost:3000 \
 *   DATABASE_URL=postgres://…/faytarra_sb \
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=… \
 *   node scripts/e2e/views-sound-flow.mjs
 *
 * Needs the Supabase stand-in (supabase-gateway.mjs: real Postgres and a real
 * PostgREST) with migration 0017, the GoTrue stub's outbox, and the video
 * fixtures (make-video-fixtures.mjs).
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const FIXTURES = process.env.FIXTURES || '/tmp/fay-video-fixtures';
const CHROMIUM = process.env.CHROMIUM_PATH;
const DATABASE_URL = process.env.DATABASE_URL || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const PASSWORD = 'a long enough password';
const IPHONE = devices['iPhone 13'];
const DESKTOP = { viewport: { width: 1280, height: 860 } };

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required: this flow checks the database after every step.');
  process.exit(2);
}
const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: DATABASE_URL });

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const launch = () => chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});

/* ------------------------------------------------------------------ setup -- */

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

async function createAccount(browser, handle, device = DESKTOP) {
  const context = await browser.newContext({ ...device, baseURL: BASE });
  const page = await context.newPage();
  const email = `${handle}@example.com`;
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]', { hasText: 'Gaming' }).first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForFunction(() => location.pathname.startsWith('/verify-email'), undefined, { timeout: 30000 });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

async function postVideo(page, { title, description, fixture = 'landscape.webm' }) {
  await page.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Post a video', { timeout: 15000 });
  await page.locator('input[type=file]').setInputFiles({
    name: fixture,
    mimeType: 'video/webm',
    buffer: readFileSync(path.join(FIXTURES, fixture)),
  });
  await page.waitForSelector('#video-title', { timeout: 30000 });
  await page.fill('#video-title', title);
  await page.fill('#video-caption', description);
  await page.selectOption('#video-category', 'Gaming');
  await page.locator('button', { hasText: /^Post video$/ }).click();
  await page.waitForURL(/\/post\//, { timeout: 180000 });
  return page.url().split('/post/')[1];
}

/* --------------------------------------------------------------- database -- */

/** What the database holds: the total, and how many play rows stand behind it. */
async function stored(postId) {
  const { rows } = await pool.query(
    `select p.video_views as total,
            (select count(*)::int from public.video_views v where v.post_id = p.id) as rows
       from public.posts p where p.id = $1`,
    [postId],
  );
  return { total: rows[0]?.total ?? null, rows: rows[0]?.rows ?? null };
}

async function totalOf(postId) {
  return (await stored(postId)).total;
}

/** Waits for the total to reach `want`; returns what it is either way. */
async function totalReaches(postId, want, timeout = 10000) {
  const end = Date.now() + timeout;
  let now = await totalOf(postId);
  while ((now ?? 0) < want && Date.now() < end) {
    await sleep(100);
    now = await totalOf(postId);
  }
  return now;
}

/** The total after a pause, for "nothing more was counted". */
async function totalSettles(postId, wait = 1800) {
  await sleep(wait);
  return totalOf(postId);
}

/* ----------------------------------------------------------- browser rules -- */

/**
 * Safari's rule for media with sound, as WebKit applies it — per ELEMENT.
 *
 * A video element may play with sound once a user gesture has played or
 * unmuted THAT element; play() with sound is otherwise refused with
 * NotAllowedError; unmuting a playing element without that pauses it. Muted
 * playback is always allowed. A gesture is a click or a key press: a swipe is
 * not one, as it is not on an iPhone.
 */
function webkitMediaRules() {
  let gesture = false;
  for (const type of ['click', 'keydown']) {
    addEventListener(
      type,
      () => {
        gesture = true;
        setTimeout(() => (gesture = false), 0);
      },
      { capture: true },
    );
  }
  const unlocked = new WeakSet();
  const proto = HTMLMediaElement.prototype;
  const play = proto.play;
  const pause = proto.pause;
  const muted = Object.getOwnPropertyDescriptor(proto, 'muted');
  proto.play = function playLikeWebKit() {
    if (gesture) unlocked.add(this);
    if (!muted.get.call(this) && !unlocked.has(this)) {
      return Promise.reject(new DOMException('play() with sound needs a tap on this element', 'NotAllowedError'));
    }
    return play.call(this);
  };
  Object.defineProperty(proto, 'muted', {
    configurable: true,
    enumerable: true,
    get() {
      return muted.get.call(this);
    },
    set(value) {
      if (gesture) unlocked.add(this);
      muted.set.call(this, value);
      if (!value && !this.paused && !unlocked.has(this)) pause.call(this);
    },
  });
  window.__soundUnlocked = (element) => unlocked.has(element);
}

/**
 * Chrome's rule for media with sound: once the PAGE has had an interaction (a
 * click or a key press), any element may play with sound; before that play()
 * with sound is refused with NotAllowedError, and unmuting a playing element
 * pauses it instead. Muted playback is always allowed.
 */
function chromeMediaRules() {
  let activated = false;
  for (const type of ['click', 'keydown']) addEventListener(type, () => (activated = true), { capture: true });
  const proto = HTMLMediaElement.prototype;
  const play = proto.play;
  const pause = proto.pause;
  const muted = Object.getOwnPropertyDescriptor(proto, 'muted');
  proto.play = function playLikeChrome() {
    if (!muted.get.call(this) && !activated) {
      return Promise.reject(new DOMException("play() failed because the user didn't interact with the document first.", 'NotAllowedError'));
    }
    return play.call(this);
  };
  Object.defineProperty(proto, 'muted', {
    configurable: true,
    enumerable: true,
    get() {
      return muted.get.call(this);
    },
    set(value) {
      muted.set.call(this, value);
      if (!value && !this.paused && !activated) pause.call(this);
    },
  });
}

/**
 * What actually happened in the page, per post: every real playback start
 * (`playing` on an element that is playing), and every time a looping clip
 * came round (its seek back to the start while playing).
 */
function countStarts() {
  window.__starts = {};
  window.__loops = {};
  const postOf = (video) => video.closest('[data-post-id]')?.getAttribute('data-post-id');
  document.addEventListener(
    'playing',
    (event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || video.paused) return;
      const id = postOf(video);
      if (id) window.__starts[id] = (window.__starts[id] ?? 0) + 1;
    },
    true,
  );
  document.addEventListener(
    'seeked',
    (event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || !video.loop || video.paused || video.currentTime > 0.5) return;
      const id = postOf(video);
      if (id) window.__loops[id] = (window.__loops[id] ?? 0) + 1;
    },
    true,
  );
}

/** The page's own record of starts and loops, for "exactly what happened". */
async function happened(page) {
  return page.evaluate(() => ({ starts: { ...window.__starts }, loops: { ...window.__loops } }));
}
const delta = (after, before, kind, id) => (after[kind][id] ?? 0) - (before[kind][id] ?? 0);

/** Every view report a page sends, and what became of it. */
function trackReports(page) {
  const reports = [];
  const isReport = (request) => request.method() === 'POST' && /\/api\/v1\/posts\/[^/]+\/views$/.test(request.url());
  page.on('request', (request) => {
    if (isReport(request)) reports.push({ id: request.url().split('/').at(-2), status: 'sent' });
  });
  page.on('requestfinished', async (request) => {
    if (!isReport(request)) return;
    const response = await request.response();
    const entry = [...reports].reverse().find((each) => each.status === 'sent' && request.url().includes(each.id));
    if (entry) {
      entry.status = response?.status();
      entry.answer = (await response?.text().catch(() => ''))?.slice(0, 120);
    }
  });
  page.on('requestfailed', (request) => {
    if (!isReport(request)) return;
    const entry = [...reports].reverse().find((each) => each.status === 'sent' && request.url().includes(each.id));
    if (entry) entry.status = `failed ${request.failure()?.errorText}`;
  });
  return reports;
}

/**
 * Page errors, apart from one that is reported on its own: React #418, the
 * relative time ("now" → "1m") changing between the server's render and the
 * browser's. It predates this work — timeAgo in a server-rendered slide — and
 * only fires when a minute boundary falls between the two, which videos posted
 * seconds before this flow runs make likely.
 */
const knownHydration = [];
function watchErrors(page, label, errors) {
  const note = (text) => {
    if (/Minified React error #418/.test(text)) knownHydration.push(`${label}: #418`);
    else errors.push(`${label}: ${text}`);
  };
  page.on('pageerror', (error) => note(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource|ERR_ABORTED|net::/.test(message.text())) {
      note(message.text());
    }
  });
}

/* --------------------------------------------------------------- the feed -- */

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

async function slideIds(page) {
  const slides = await page.locator('section[data-index]').evaluateAll((sections) =>
    sections.map((section) => [Number(section.getAttribute('data-index')), section.getAttribute('data-post-id')]),
  );
  return new Map(slides);
}

/** A finger dragged across the feed, as raw touch events. `settle` waits for the snap. */
async function swipe(page, cdp, direction, settle = true) {
  const { width, height } = page.viewportSize();
  const before = await activeIndex(page);
  const x = Math.round(width / 2);
  const from = Math.round(height * (direction === 'next' ? 0.75 : 0.25));
  const distance = (direction === 'next' ? -1 : 1) * Math.round(height * 0.5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: from + (distance * step) / 8 }],
    });
    await sleep(12);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  if (!settle) return null;
  const want = before + (direction === 'next' ? 1 : -1);
  for (let i = 0; i < 60 && (await activeIndex(page)) !== want; i += 1) await sleep(50);
  await sleep(150);
  return activeIndex(page);
}

/** On a desktop: the wheel, which the scroll snapping turns into one slide. */
async function wheel(page, direction) {
  const before = await activeIndex(page);
  await page.mouse.move(640, 430);
  await page.mouse.wheel(0, direction === 'next' ? 700 : -700);
  const want = before + (direction === 'next' ? 1 : -1);
  for (let i = 0; i < 60 && (await activeIndex(page)) !== want; i += 1) await sleep(50);
  await sleep(200);
  return activeIndex(page);
}

/** Milliseconds until the clip on slide `index` is moving, or null. */
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

/** What the player on slide `index` is doing, and what the feed says about sound. */
async function sound(page, index) {
  return page.evaluate((at) => {
    const video = document.querySelector(`section[data-index="${at}"] video`);
    const speaker = document.querySelector('button[aria-label="Mute"], button[aria-label="Unmute"]');
    return {
      muted: video?.muted,
      paused: video?.paused,
      prompt: Boolean(document.querySelector(`section[data-index="${at}"] [data-tap-for-sound]`)),
      speaker: speaker?.getAttribute('aria-label'),
    };
  }, index);
}

async function eyeOn(page, selector) {
  const value = await page.locator(selector).first().getAttribute('data-video-views', { timeout: 2000 }).catch(() => null);
  return value === null ? null : Number(value);
}

/** The eye against the database, until they agree (a looping clip keeps adding). */
async function eyeMatches(page, selector, id, timeout = 8000) {
  const end = Date.now() + timeout;
  let last = '';
  do {
    const low = await totalOf(id);
    const eye = await eyeOn(page, selector);
    const high = await totalOf(id);
    last = `eye ${eye}, database ${low === high ? low : `${low}…${high}`}`;
    if (eye !== null && eye >= low && eye <= high) return { ok: true, detail: last };
    await sleep(150);
  } while (Date.now() < end);
  return { ok: false, detail: last };
}

const slideEye = (index) => `section[data-index="${index}"] [data-video-views]`;
const cardFor = (id) => `article:has(a[href="/post/${id}#comments"])`;

/* ------------------------------------------------------------------- run -- */

const run = async () => {
  const browser = await launch();
  const stamp = Date.now().toString(36).slice(-5);
  const tag = `playcount${stamp}`;
  const errors = [];

  section('SETUP — a creator posts four videos; a second account will watch');
  const A = await createAccount(browser, `maker_${stamp}`);
  const W = await createAccount(browser, `watch_${stamp}`);
  const ids = [];
  for (const n of [1, 2, 3]) {
    ids.push(await postVideo(A.page, { title: `clip ${n} ${stamp}`, description: `feed clip ${n} ${stamp}` }));
  }
  const tagged = await postVideo(A.page, {
    title: `tagged ${stamp}`,
    description: `a short one #${tag}`,
    fixture: 'tiny.webm',
  });
  check('four videos published', [...ids, tagged].every(Boolean), [...ids, tagged].join(' '));
  for (const id of [...ids, tagged]) {
    const now = await stored(id);
    check(`  ${id.slice(0, 8)} starts at zero`, now.total === 0 && now.rows === 0, JSON.stringify(now));
  }
  // The watcher follows the creator, so the creator's videos are on their home feed.
  await pool.query(
    `insert into public.follows (follower_id, following_id)
     select w.id, a.id from public.users w, public.users a where w.username = $1 and a.username = $2`,
    [W.handle, A.handle],
  );
  const health = await (await W.context.request.get('/api/health')).json();
  check('/api/health: plays are counted, in one step in the database', health.views?.counting === true && health.views?.oneStep === true, JSON.stringify(health.views));

  /* ----------------------------------------------------------------------- */
  section('A. AN IPHONE, SIGNED OUT — Safari asks for a tap per video element');
  const phone = await browser.newContext({ ...IPHONE, baseURL: BASE });
  await phone.addInitScript(webkitMediaRules);
  await phone.addInitScript(countStarts);
  const p = await phone.newPage();
  watchErrors(p, 'iphone', errors);
  const phoneReports = trackReports(p);
  const cdp = await phone.newCDPSession(p);

  await p.goto(`/videos?v=${ids[0]}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('section[data-index="0"] video[src]', { timeout: 15000 });
  const order = await slideIds(p);
  check('the feed opens on the linked video', order.get(0) === ids[0]);
  check('the first clip starts on its own', (await startsWithin(p, 0)) !== null);
  let s = await sound(p, 0);
  check('  muted: Safari refused it with sound, and it played anyway', s.muted === true && s.paused === false, JSON.stringify(s));
  check('  "Tap for sound" is offered', s.prompt === true);
  check('  and the speaker says the sound is off', s.speaker === 'Unmute');
  let total = await totalReaches(ids[0], 1);
  check('autoplay, muted, is one view in the database', total === 1, String(total));
  let eye = await eyeMatches(p, slideEye(0), ids[0]);
  check('  and the eye shows it', eye.ok, eye.detail);

  await p.locator('section[data-index="0"] [data-tap-for-sound]').click();
  await sleep(500);
  s = await sound(p, 0);
  check('"Tap for sound": the clip carries on, with sound', s.muted === false && s.paused === false, JSON.stringify(s));
  check('  the prompt is gone, and the speaker says sound is on', !s.prompt && s.speaker === 'Mute', JSON.stringify(s));
  check(
    '  every player in the feed is ready for sound',
    await p.evaluate(() => [...document.querySelectorAll('section[data-index] video')].every((v) => window.__soundUnlocked(v))),
  );
  check('  the same play: no new view', (await totalSettles(ids[0], 1000)) === 1);

  for (const [direction, index] of [
    ['next', 1],
    ['next', 2],
    ['previous', 1],
    ['previous', 0],
  ]) {
    const id = order.get(index);
    const was = await totalOf(id);
    const landed = await swipe(p, cdp, direction);
    const moving = await startsWithin(p, index);
    s = await sound(p, index);
    check(
      `swipe ${direction} to slide ${index}: it plays WITH sound, no tap needed`,
      landed === index && moving !== null && s.muted === false && s.paused === false && !s.prompt,
      `${moving} ms; ${JSON.stringify(s)}`,
    );
    total = await totalReaches(id, was + 1);
    check('  one more view, in the database', total === was + 1, `${was} → ${total}`);
    eye = await eyeMatches(p, slideEye(index), id);
    check('  and the eye shows it', eye.ok, eye.detail);
    await sleep(700);
  }

  // Rapid swipes, and a glance of a fraction of a second: whatever actually
  // started playing is a view — exactly once — and nothing else is.
  const before = {};
  for (const id of order.values()) if (id) before[id] = await totalOf(id);
  const marked = await happened(p);
  await swipe(p, cdp, 'next', false);
  await sleep(120);
  await swipe(p, cdp, 'previous', false);
  await sleep(250);
  await swipe(p, cdp, 'next', false);
  await sleep(300); // a glance: under a second
  await swipe(p, cdp, 'next', false);
  await sleep(300);
  await swipe(p, cdp, 'previous', false);
  await sleep(250);
  await swipe(p, cdp, 'previous', false);
  for (let i = 0; i < 60 && (await activeIndex(p)) !== 0; i += 1) await sleep(50);
  await sleep(2500);
  const now = await happened(p);
  let deltaOk = true;
  const deltas = [];
  for (const id of Object.keys(before)) {
    const started = delta(now, marked, 'starts', id) + delta(now, marked, 'loops', id);
    const counted = (await totalOf(id)) - before[id];
    deltas.push(`${id.slice(0, 6)}: ${started} started, ${counted} counted`);
    if (started !== counted) deltaOk = false;
  }
  check('rapid swipes and sub-second glances: every playback start counted once, nothing else', deltaOk, deltas.join('; '));
  check('  something did start during them', deltas.some((line) => !line.includes(' 0 started')), deltas.join('; '));

  // Duplicate events for one playback start: no report, no view. A looping
  // clip may come round meanwhile — a real new play — so what is expected is
  // exactly the loops the page saw, and nothing for the events.
  const id0 = order.get(0);
  let mark = await happened(p);
  const reportsBefore = phoneReports.length;
  let steady = await totalOf(id0);
  await p.evaluate(() => {
    const video = document.querySelector('section[data-index="0"] video');
    for (let i = 0; i < 5; i += 1) {
      video.dispatchEvent(new Event('play'));
      video.dispatchEvent(new Event('playing'));
      video.dispatchEvent(new Event('timeupdate'));
    }
  });
  await sleep(1200);
  let loops = delta(await happened(p), mark, 'loops', id0);
  check('duplicate play/playing/timeupdate events send no report', phoneReports.length - reportsBefore === loops, `${phoneReports.length - reportsBefore} sent, ${loops} loop(s)`);
  total = await totalOf(id0);
  check('  and count nothing', total - steady === loops, `${steady} → ${total}, ${loops} loop(s)`);

  // Pause and resume the same play: not a new view.
  mark = await happened(p);
  steady = await totalOf(id0);
  await p.locator('section[data-index="0"] button[aria-label="Pause video"]').click();
  await sleep(400);
  check('a tap pauses it', (await sound(p, 0)).paused === true);
  await p.locator('section[data-index="0"] button[aria-label="Play video"]').click();
  await sleep(600);
  s = await sound(p, 0);
  check('  another resumes it, still with sound', s.paused === false && s.muted === false, JSON.stringify(s));
  total = await totalSettles(id0, 1200);
  loops = delta(await happened(p), mark, 'loops', id0);
  check('  and it is the same play: no new view', total - steady === loops, `${steady} → ${total}, ${loops} loop(s)`);

  // The loop coming round is the video starting again: a view.
  mark = await happened(p);
  const looped = await totalOf(id0);
  const duration = await p.evaluate(() => document.querySelector('section[data-index="0"] video').duration);
  const playedFrom = await p.evaluate(() => document.querySelector('section[data-index="0"] video').currentTime);
  await sleep(Math.max(0, (duration - playedFrom) * 1000) + 1500);
  loops = delta(await happened(p), mark, 'loops', id0);
  total = await totalOf(id0);
  check('the loop coming round is another view, each time', loops >= 1 && total - looped === loops, `${looped} → ${total}, ${loops} loop(s) of a ${duration.toFixed(1)} s clip`);

  // Muting is the viewer's choice, and stays made.
  await p.locator('button[aria-label="Mute"]').click();
  await sleep(300);
  s = await sound(p, 0);
  check('the speaker mutes it', s.muted === true && s.paused === false && s.speaker === 'Unmute', JSON.stringify(s));
  check('  without offering "Tap for sound" — nothing was refused', !s.prompt);
  let was = await totalOf(order.get(1));
  await swipe(p, cdp, 'next');
  await startsWithin(p, 1);
  s = await sound(p, 1);
  check('  the next clip stays muted: sound is not forced back on', s.muted === true && s.paused === false && !s.prompt, JSON.stringify(s));
  total = await totalReaches(order.get(1), was + 1);
  check('  and a muted play is still a view', total === was + 1, `${was} → ${total}`);

  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('section[data-index="0"] video[src]', { timeout: 15000 });
  const afterReload = await slideIds(p);
  was = await totalOf(afterReload.get(0));
  check('after a refresh the clip starts on its own', (await startsWithin(p, 0)) !== null);
  s = await sound(p, 0);
  check('  still muted, as the viewer left it — and not asked about sound', s.muted === true && !s.prompt && s.speaker === 'Unmute', JSON.stringify(s));
  total = await totalReaches(afterReload.get(0), was + 1);
  check('  one view for it', total === was + 1, `${was} → ${total}`);
  for (const [index, id] of afterReload) {
    if (index > 1 || !id) continue;
    eye = await eyeMatches(p, slideEye(index), id);
    check(`  slide ${index} shows the database's count`, eye.ok, eye.detail);
  }

  await p.locator('button[aria-label="Unmute"]').click();
  await sleep(400);
  s = await sound(p, 0);
  check('the speaker turns sound back on, from inside the tap', s.muted === false && s.paused === false, JSON.stringify(s));
  await swipe(p, cdp, 'next');
  await startsWithin(p, 1);
  s = await sound(p, 1);
  check('  and the next clip plays with it', s.muted === false && s.paused === false, JSON.stringify(s));
  const audible = await p.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused && !v.muted).length);
  check('  one video heard at a time', audible === 1, `${audible} playing with sound`);
  await p.goto('/home', { waitUntil: 'domcontentloaded' });

  /* ----------------------------------------------------------------------- */
  section("B. CHROME'S RULE, SIGNED IN — one interaction with the page allows sound");
  const chrome = await browser.newContext({ ...DESKTOP, baseURL: BASE, storageState: await W.context.storageState() });
  await chrome.addInitScript(chromeMediaRules);
  const c = await chrome.newPage();
  watchErrors(c, 'chrome', errors);
  await c.goto(`/videos?v=${ids[2]}`, { waitUntil: 'domcontentloaded' });
  await c.waitForSelector('section[data-index="0"] video[src]', { timeout: 15000 });
  check('opened straight from a link, before any interaction: it plays', (await startsWithin(c, 0)) !== null);
  s = await sound(c, 0);
  check('  muted, with "Tap for sound" — Chrome refused sound', s.muted === true && s.prompt === true, JSON.stringify(s));
  await c.locator('section[data-index="0"] [data-tap-for-sound]').click();
  await sleep(400);
  s = await sound(c, 0);
  check('"Tap for sound" turns it on', s.muted === false && s.paused === false, JSON.stringify(s));
  const chromeOrder = await slideIds(c);
  was = await totalOf(chromeOrder.get(1));
  await wheel(c, 'next');
  await startsWithin(c, 1);
  s = await sound(c, 1);
  check('  the next clip plays with sound', s.muted === false && s.paused === false, JSON.stringify(s));
  total = await totalReaches(chromeOrder.get(1), was + 1);
  check('  and is one view (signed in)', total === was + 1, `${was} → ${total}`);
  await c.goto('/home', { waitUntil: 'domcontentloaded' });
  await c.locator('a[href="/videos"]:visible').first().click();
  await c.waitForURL(/\/videos/);
  await c.waitForSelector('section[data-index="0"] video[src]', { timeout: 15000 });
  await startsWithin(c, 0);
  s = await sound(c, 0);
  check('reaching Videos with a tap: it starts with sound, nothing to ask', s.muted === false && s.paused === false && !s.prompt, JSON.stringify(s));
  await c.goto('/home', { waitUntil: 'domcontentloaded' });
  await chrome.close();

  /* ----------------------------------------------------------------------- */
  section('C. AUTOPLAY WITH SOUND ALLOWED — the creator, watching their own');
  const a = await A.context.newPage();
  watchErrors(a, 'creator', errors);
  was = await totalOf(ids[1]);
  await a.goto(`/videos?v=${ids[1]}`, { waitUntil: 'domcontentloaded' });
  await a.waitForSelector('section[data-index="0"] video[src]', { timeout: 15000 });
  await startsWithin(a, 0);
  s = await sound(a, 0);
  check('the feed starts with sound, and asks nothing', s.muted === false && s.paused === false && !s.prompt, JSON.stringify(s));
  total = await totalReaches(ids[1], was + 1);
  check("  the creator's own play counts", total === was + 1, `${was} → ${total}`);
  eye = await eyeMatches(a, slideEye(0), ids[1]);
  check('  and their eye shows it', eye.ok, eye.detail);
  await a.goto('/home', { waitUntil: 'domcontentloaded' });

  /* ----------------------------------------------------------------------- */
  section('D. EVERY OTHER PLACE A VIDEO PLAYS');
  const w = await W.context.newPage();
  watchErrors(w, 'watcher', errors);

  async function play(page, id) {
    const video = page.locator(`${cardFor(id)} video`).first();
    await video.scrollIntoViewIfNeeded();
    await video.evaluate((v) => v.play());
    return video;
  }
  /**
   * Plays the card's video and measures, in the page, from the moment playback
   * actually starts (`playing`) to the eye showing the play.
   */
  function playAndTime(page, id, want) {
    return page.evaluate(
      async ({ card, want }) => {
        const root = document.querySelector(card);
        const video = root.querySelector('video');
        const eye = root.querySelector('[data-video-views]');
        video.scrollIntoView({ block: 'center' });
        let started = null;
        video.addEventListener('playing', () => (started ??= performance.now()), { once: true });
        video.play().catch(() => undefined);
        const deadline = performance.now() + 10000;
        while (performance.now() < deadline) {
          if (started !== null && Number(eye.getAttribute('data-video-views')) >= want) {
            return Math.round(performance.now() - started);
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return null;
      },
      { card: cardFor(id), want },
    );
  }

  async function onCard(page, id, label) {
    // Hydrated first: a play pressed before the page's script has run is still
    // counted — by the first timeupdate once it has — but is not "at once".
    await page.waitForLoadState('networkidle');
    const was = await totalOf(id);
    const shownAfter = await playAndTime(page, id, was + 1);
    const total = await totalReaches(id, was + 1);
    check(`${label}: playing it is one view`, total === was + 1, `${was} → ${total}`);
    check('  the eye shows it as playback starts, before any answer', shownAfter !== null && shownAfter < 250, `${shownAfter} ms after it started`);
    const matched = await eyeMatches(page, `${cardFor(id)} [data-video-views]`, id, 3000);
    check('  and then the stored number', matched.ok, matched.detail);
  }

  await w.goto(`/post/${ids[0]}`, { waitUntil: 'domcontentloaded' });
  await onCard(w, ids[0], 'the post page');
  const video = w.locator(`${cardFor(ids[0])} video`).first();
  // Straight after it started, well inside the clip: nothing ends or loops here.
  const playing = await totalOf(ids[0]);
  await video.evaluate((v) => v.pause());
  await sleep(300);
  await video.evaluate((v) => v.play());
  const resumed = await totalSettles(ids[0], 1000);
  check(
    '  pause and play: the same view',
    resumed === playing && !(await video.evaluate((v) => v.ended)),
    `${playing} → ${resumed}`,
  );
  const atPause = await totalOf(ids[0]);
  await video.evaluate((v) => v.pause());
  await video.evaluate((v) => (v.currentTime = 2.5));
  await video.evaluate((v) => v.play());
  check('  seeking forward: the same view', (await totalSettles(ids[0], 1200)) === atPause);
  await w.waitForFunction((selector) => document.querySelector(selector)?.ended, `${cardFor(ids[0])} video`, { timeout: 10000 });
  await video.evaluate((v) => v.play());
  total = await totalReaches(ids[0], atPause + 1);
  check('  played to the end and played again: another view', total === atPause + 1, `${atPause} → ${total}`);
  await sleep(1600);
  await video.evaluate((v) => {
    v.pause();
    v.currentTime = 0;
    return v.play();
  });
  total = await totalReaches(ids[0], atPause + 2);
  check('  taken back to the start and played: another view', total === atPause + 2, `${atPause + 1} → ${total}`);
  await video.evaluate((v) => v.pause());

  await w.goto('/home?tab=following', { waitUntil: 'domcontentloaded' });
  await w.waitForSelector(cardFor(ids[1]), { timeout: 15000 });
  await onCard(w, ids[1], 'the home feed');
  await w.locator(`${cardFor(ids[1])} video`).first().evaluate((el) => el.pause());

  await w.goto(`/u/${A.handle}`, { waitUntil: 'domcontentloaded' });
  await w.waitForSelector(cardFor(ids[2]), { timeout: 15000 });
  await onCard(w, ids[2], 'the profile');

  await w.goto(`/tag/${tag}`, { waitUntil: 'domcontentloaded' });
  await w.waitForSelector(cardFor(tagged), { timeout: 15000 });
  await onCard(w, tagged, 'the hashtag page');

  // Scrolled away while stopped, and back: a new playback start.
  await w.setViewportSize({ width: 1280, height: 420 });
  await w.goto(`/u/${A.handle}`, { waitUntil: 'domcontentloaded' });
  await w.waitForSelector(cardFor(ids[1]), { timeout: 15000 });
  const awayStart = await totalOf(ids[1]);
  const away = await play(w, ids[1]);
  await totalReaches(ids[1], awayStart + 1);
  await sleep(800);
  await away.evaluate((v) => v.pause());
  const paused = await totalOf(ids[1]);
  await w.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(700);
  check(
    'the profile scrolls the stopped video right off the screen',
    await away.evaluate((v) => {
      const box = v.getBoundingClientRect();
      return box.bottom < 0 || box.top > window.innerHeight;
    }),
  );
  await away.scrollIntoViewIfNeeded();
  await sleep(400);
  await away.evaluate((v) => v.play());
  total = await totalReaches(ids[1], paused + 1);
  check('  coming back and playing it again is another view', total === paused + 1, `${awayStart} → ${paused} → ${total}`);
  await away.evaluate((v) => v.pause());
  await w.setViewportSize(DESKTOP.viewport);

  // One video heard at a time, on a page of players.
  await w.goto(`/u/${A.handle}`, { waitUntil: 'domcontentloaded' });
  await w.waitForSelector(cardFor(ids[0]), { timeout: 15000 });
  const first = await play(w, ids[0]);
  await sleep(500);
  const second = await play(w, ids[2]);
  await sleep(500);
  check(
    'starting a second video with sound stops the first',
    (await first.evaluate((v) => v.paused)) && !(await second.evaluate((v) => v.paused)),
  );
  await second.evaluate((v) => v.pause());

  // Signed out.
  const visitor = await browser.newContext({ ...DESKTOP, baseURL: BASE });
  const v = await visitor.newPage();
  watchErrors(v, 'visitor', errors);
  await v.goto(`/post/${ids[2]}`, { waitUntil: 'domcontentloaded' });
  await onCard(v, ids[2], 'a visitor, signed out, on the post page');

  await w.goto(`/post/${ids[0]}`, { waitUntil: 'domcontentloaded' });
  eye = await eyeMatches(w, `${cardFor(ids[0])} [data-video-views]`, ids[0]);
  check('after a refresh the post page shows the stored count', eye.ok, eye.detail);
  await w.goto(`/u/${A.handle}`, { waitUntil: 'domcontentloaded' });
  for (const id of ids) {
    eye = await eyeMatches(w, `${cardFor(id)} [data-video-views]`, id);
    check(`  and the profile, for ${id.slice(0, 8)}`, eye.ok, eye.detail);
  }

  /* ----------------------------------------------------------------------- */
  section('E. DELIVERY — nothing lost, nothing counted twice');
  const reportRoute = '**/api/v1/posts/*/views';

  // The server counted it, and the answer never arrived.
  await w.goto(`/post/${ids[1]}`, { waitUntil: 'domcontentloaded' });
  was = await totalOf(ids[1]);
  let lost = 0;
  await w.route(reportRoute, async (route) => {
    lost += 1;
    await route.fetch(); // it reached the server…
    await route.abort('connectionreset'); // …and the answer was lost
  }, { times: 1 });
  await play(w, ids[1]);
  await sleep(4000); // the first retry is a second later
  total = await totalOf(ids[1]);
  check('an answer lost on the way back: counted once, not again on the retry', lost === 1 && total === was + 1, `${was} → ${total}`);
  check('  and nothing is left owed', (await w.evaluate(() => localStorage.getItem('fay:view-reports'))) === null);
  await w.locator(`${cardFor(ids[1])} video`).first().evaluate((el) => el.pause());

  // The first attempt never got there.
  await w.goto(`/post/${ids[2]}`, { waitUntil: 'domcontentloaded' });
  was = await totalOf(ids[2]);
  await w.route(reportRoute, (route) => route.abort('internetdisconnected'), { times: 1 });
  await play(w, ids[2]);
  total = await totalReaches(ids[2], was + 1, 8000);
  check('a failed attempt is retried and counted once', total === was + 1 && (await totalSettles(ids[2], 1500)) === was + 1, `${was} → ${total}`);
  await w.locator(`${cardFor(ids[2])} video`).first().evaluate((el) => el.pause());

  // The page was closed before the report could be answered.
  const closing = await W.context.newPage();
  await closing.goto(`/post/${tagged}`, { waitUntil: 'domcontentloaded' });
  was = await totalOf(tagged);
  await closing.route(reportRoute, () => undefined); // never answered
  await play(closing, tagged);
  await sleep(500);
  await closing.close();
  check('  (the page closed with the report unanswered)', (await totalOf(tagged)) === was);
  const next = await W.context.newPage();
  await next.goto('/home', { waitUntil: 'domcontentloaded' });
  total = await totalReaches(tagged, was + 1, 12000);
  check('a report from a page that closed is sent by the next one, and counted once', total === was + 1 && (await totalSettles(tagged, 1500)) === was + 1, `${was} → ${total}`);
  await next.close();

  // Concurrent copies of one report, and many plays.
  await w.goto('/home', { waitUntil: 'domcontentloaded' });
  was = await totalOf(ids[0]);
  const burst = await w.evaluate(async (id) => {
    const send = (key) =>
      fetch(`/api/v1/posts/${id}/views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionKey: key }),
      }).then((r) => r.json());
    const same = await Promise.all(Array.from({ length: 10 }, () => send('the-same-session-key')));
    const many = await Promise.all(Array.from({ length: 10 }, (_, i) => send(`many-plays-${i}-xxxx`)));
    const flood = [];
    for (let i = 0; i < 60; i += 1) flood.push(await send(`flood-play-${i}-xxxx`));
    return {
      same: same.filter((r) => r.counted).length,
      many: many.filter((r) => r.counted).length,
      flood: flood.filter((r) => r.counted).length,
      refused: flood.filter((r) => r.reason === 'too-fast').length,
    };
  }, ids[0]);
  check('ten copies of one report at once: one view', burst.same === 1, JSON.stringify(burst));
  check('ten different plays at once: ten views', burst.many === 10);
  // Seventy-one plays of one video by one viewer inside ten seconds: up to the
  // ceiling no person reaches (fifty), then refused.
  check(
    'a flood of plays in a moment by one viewer: counted up to the ceiling, the rest refused',
    burst.same + burst.many + burst.flood === 50 && burst.refused === 21,
    JSON.stringify(burst),
  );
  total = await totalOf(ids[0]);
  check('  the database agrees', total === was + burst.same + burst.many + burst.flood, `${was} → ${total}`);

  /* ----------------------------------------------------------------------- */
  section('F. SECURITY');
  const report = (id, options = {}) =>
    W.context.request.post(`/api/v1/posts/${id}/views`, {
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      data: options.raw ?? JSON.stringify({ sessionKey: options.key ?? `security-${Math.random().toString(36).slice(2, 10)}` }),
    });
  was = await totalOf(ids[2]);
  check('another site cannot report a view', (await report(ids[2], { headers: { 'sec-fetch-site': 'cross-site' } })).status() === 403);
  check('nor a same-site page on another origin', (await report(ids[2], { headers: { 'sec-fetch-site': 'same-site' } })).status() === 403);
  check('a post id that is not one is refused', (await report('not-a-post')).status() === 404);
  check('a report without a session key is refused', (await report(ids[2], { raw: '{}' })).status() === 400);
  check('a report that is not JSON is refused', (await report(ids[2], { raw: 'sessionKey=abc' })).status() === 400);
  check('an oversized report is refused', (await report(ids[2], { raw: JSON.stringify({ sessionKey: 'x'.repeat(4000) }) })).status() === 413);
  check('  and none of them counted', (await totalOf(ids[2])) === was);

  const photo = crypto.randomUUID();
  await pool.query(
    `insert into public.posts (id, author_id, caption, media, tags)
     select $1, id, 'a photo', '[{"kind":"image","url":"/p.jpg"}]', '{}' from public.users where username = $2`,
    [photo, A.handle],
  );
  const photoAnswer = await (await report(photo)).json();
  check('a photo gets no video view', photoAnswer.counted === false && photoAnswer.reason === 'not-a-video', JSON.stringify(photoAnswer));
  check('  in the database either', (await stored(photo)).total === 0 && (await stored(photo)).rows === 0);
  await pool.query('delete from public.posts where id = $1', [photo]);

  if (SUPABASE_URL && ANON_KEY) {
    const api = (pathname, body, method = 'POST') =>
      fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
        method,
        headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    was = await totalOf(ids[2]);
    const direct = await api('rpc/record_video_play', {
      play_id: crypto.randomUUID(),
      target_post: ids[2],
      viewer: null,
      viewer_identity: 'anon:forged',
      play_key: 'forged-key',
    });
    const counter = await api('rpc/increment_counter', {
      target_table: 'posts',
      target_id: ids[2],
      target_column: 'video_views',
      amount: 1000,
    });
    const read = await api('video_views?select=*', null, 'GET');
    const readBody = await read.text();
    check('the public API key cannot count a play', direct.status >= 400, `HTTP ${direct.status}`);
    check('  nor move the counter', counter.status >= 400, `HTTP ${counter.status}`);
    check('  nor read who watched what', read.status >= 400 || readBody === '[]', `HTTP ${read.status} ${readBody.slice(0, 60)}`);
    check('  and the total did not move', (await totalOf(ids[2])) === was);
  } else {
    console.log('      (SUPABASE_URL / SUPABASE_ANON_KEY not set: the direct API checks were skipped)');
  }

  /* ----------------------------------------------------------------------- */
  section('BOOKKEEPING');
  for (const id of [...ids, tagged]) {
    const { total: t, rows } = await stored(id);
    check(`  ${id.slice(0, 8)}: every stored play is in the total, once`, rows === t, `rows ${rows}, total ${t}`);
  }
  const answered = phoneReports.filter((each) => each.status !== 200);
  check('every view report from the phone got an answer', answered.length === 0, JSON.stringify(answered.slice(0, 3)));
  check('no errors in any page', errors.length === 0, errors.slice(0, 5).join(' | '));
  if (knownHydration.length > 0) {
    console.log(`NOTE  the known relative-time hydration mismatch (React #418) fired: ${knownHydration.join(', ')}`);
  }

  await browser.close();
  await pool.end();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
