/**
 * The eye: 0 → 1 once a play is stored, and never back to 0.
 *
 * The live symptom this guards: open a video, and its eye went 0 → 1 → 0. The
 * player put each play on the eye the moment it started, ahead of the server's
 * answer, and took it off again when the answer said it had not been stored —
 * which, against a database with no view storage, was every play. The eye now
 * shows only totals the database holds.
 *
 * In a real browser, against the real database (Postgres and PostgREST, with
 * migration 0017, behind the Supabase stand-in). Every value every eye takes,
 * on every page, is recorded with the time — and set against the plays the
 * database had stored by that moment (`video_views.created_at`):
 *
 *   never ahead    no eye ever shows more than the database held at that moment
 *   never back     within one page, an eye never shows less than it already has
 *                  for that video — not after the request, a background
 *                  refresh, scrolling away and back, a remount, back and forward
 *   settles on it  after each step the eye equals a fresh read of the database,
 *                  directly and through the app's own API
 *
 * and the database moves by exactly the playback starts the pages saw: one per
 * start, a viewer's repeat plays included; nothing for a pause and resume, a
 * duplicate event, a refresh or a navigation.
 *
 *   1  stored       a video opened in the Videos tab: 0 → 1 once the request is
 *                   answered; still 1 after a background refresh (a real
 *                   router.refresh, fired by UnreadWatch when a notification
 *                   arrives)
 *   2  repeat plays pause and resume (not a view), duplicate events (not a
 *                   view), rewind and play (a view), scroll away and back (a view)
 *   3  navigation   away inside the app and back; a full reload; the post page
 *                   (played to the end and played again); the Home feed card
 *   4  not stored   what the live site answered: view storage missing, every
 *                   play "unavailable". The eye stays at 0 — the build this
 *                   fixes showed 0 → 1 → 0. Then storage comes back, without a
 *                   restart, and the next play takes the eye 0 → 1 to stay.
 *                   (Renames public.video_views for the length of the step and
 *                   puts it back, so DATABASE_URL must be allowed to.)
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=postgres://…/faytarra_sb \
 *   node scripts/e2e/views-eye-flow.mjs
 *
 * Needs the Supabase stand-in (supabase-gateway.mjs: real Postgres and a real
 * PostgREST) with migration 0017, the GoTrue stub's outbox, and the video
 * fixtures (make-video-fixtures.mjs).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const FIXTURES = process.env.FIXTURES || '/tmp/fay-video-fixtures';
const CHROMIUM = process.env.CHROMIUM_PATH;
const DATABASE_URL = process.env.DATABASE_URL || '';
const PASSWORD = 'a long enough password';
const DESKTOP = { viewport: { width: 1280, height: 860 } };
/** How long the server keeps counting off after it finds no storage (STORAGE_RECHECK_MS). */
const STORAGE_RECHECK_MS = 30_000;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required: this flow checks every eye against the database.');
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

/* ------------------------------------------------------------------ setup -- */

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

/** Every eye value and every playback start, from every page, as they happen. */
const eyes = [];
const plays = [];

/**
 * In the page, before anything else runs: every value any eye takes, and every
 * playback start, sent out at once with the time and which page it was.
 */
function recordInPage() {
  const page = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queue = [];
  const send = (kind, entry) => {
    queue.push([kind, { ...entry, page, t: Date.now() }]);
    if (typeof window.__eyeOut !== 'function') return;
    while (queue.length) window.__eyeOut(...queue.shift());
  };
  // A video's post: the Videos feed marks its slides; a card links to its comments.
  const postOf = (node) =>
    node.closest('[data-post-id]')?.getAttribute('data-post-id') ??
    node
      .closest('article')
      ?.querySelector('a[href*="#comments"]')
      ?.getAttribute('href')
      ?.match(/\/post\/([^#?/]+)/)?.[1] ??
    null;

  // The eye. One entry per change of any eye element, including its first value.
  const shown = new WeakMap();
  const note = (element) => {
    const id = postOf(element);
    const value = Number(element.getAttribute('data-video-views'));
    if (!id || shown.get(element) === value) return;
    shown.set(element, value);
    send('eye', { id, v: value });
  };
  const scan = () => document.querySelectorAll('[data-video-views]').forEach(note);
  new MutationObserver(scan).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-video-views'],
  });
  document.addEventListener('DOMContentLoaded', scan);

  // Playback starts, from the raw media events: a fresh start (first play, or
  // after an end, or after a rewind while stopped) and a loop coming round.
  // A pause and resume, a stall, a seek mid-video are not starts.
  const state = new WeakMap();
  const of = (video) => {
    let entry = state.get(video);
    if (!entry) state.set(video, (entry = { fresh: true, furthest: 0 }));
    return entry;
  };
  const on = (type, handle) =>
    document.addEventListener(
      type,
      (event) => {
        if (event.target instanceof HTMLVideoElement && event.isTrusted) handle(event.target, of(event.target));
      },
      true,
    );
  on('playing', (video, entry) => {
    if (video.paused || !entry.fresh) return;
    entry.fresh = false;
    entry.furthest = video.currentTime;
    send('play', { id: postOf(video), how: 'start' });
  });
  on('timeupdate', (video, entry) => {
    if (!video.paused && video.currentTime > entry.furthest) entry.furthest = video.currentTime;
  });
  on('seeked', (video, entry) => {
    if (video.paused) {
      if (video.currentTime <= 0.5) entry.fresh = true;
      return;
    }
    if (video.loop && video.currentTime <= 0.5 && entry.furthest >= 1) {
      entry.furthest = video.currentTime;
      send('play', { id: postOf(video), how: 'loop' });
    }
  });
  on('ended', (_video, entry) => {
    entry.fresh = true;
  });
  on('emptied', (_video, entry) => {
    entry.fresh = true;
    entry.furthest = 0;
  });
}

async function createAccount(browser, handle) {
  const context = await browser.newContext({ ...DESKTOP, baseURL: BASE });
  await context.exposeBinding('__eyeOut', (_source, kind, entry) => {
    (kind === 'eye' ? eyes : plays).push(entry);
  });
  await context.addInitScript(recordInPage);
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

async function postVideo(page, title) {
  await page.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Post a video', { timeout: 15000 });
  await page.locator('input[type=file]').setInputFiles({
    name: 'landscape.webm',
    mimeType: 'video/webm',
    buffer: readFileSync(path.join(FIXTURES, 'landscape.webm')),
  });
  await page.waitForSelector('#video-title', { timeout: 30000 });
  await page.fill('#video-title', title);
  await page.fill('#video-caption', `${title}, for the eye`);
  await page.selectOption('#video-category', 'Gaming');
  await page.locator('button', { hasText: /^Post video$/ }).click();
  await page.waitForURL(/\/post\//, { timeout: 180000 });
  const id = page.url().split('/post/')[1];
  // Nothing of the creator's plays here: the post page does not autoplay, and
  // the page is left at once.
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  return id;
}

/* --------------------------------------------------------------- database -- */

/** Where the plays are, normally and while step 4 has parked them. */
let playsTable = 'video_views';

/** What the database holds: the total, and when each play behind it was stored (ms). */
async function stored(id) {
  const { rows } = await pool.query(
    `select p.video_views as total,
            coalesce((select array_agg((extract(epoch from v.created_at) * 1000)::bigint order by v.created_at)
                        from public.${playsTable} v where v.post_id = p.id), '{}') as at
       from public.posts p where p.id = $1`,
    [id],
  );
  return { total: rows[0]?.total ?? null, at: (rows[0]?.at ?? []).map(Number) };
}

const totalOf = async (id) => (await stored(id)).total;

/** The total through the app's own API: the read a page's next render makes. */
async function apiTotal(context, id) {
  const response = await context.request.get(`/api/v1/posts/${id}`);
  const body = await response.json().catch(() => null);
  return body?.post?.counts?.videoViews ?? null;
}

/** Waits for the total to reach `want`; returns what it is either way. */
async function totalReaches(id, want, timeout = 10000) {
  const end = Date.now() + timeout;
  let now = await totalOf(id);
  while ((now ?? 0) < want && Date.now() < end) {
    await sleep(100);
    now = await totalOf(id);
  }
  return now;
}

/** Starts the pages saw for this post: starts and loops, from every page. */
const startsOf = (id) => plays.filter((play) => play.id === id).length;

/** The eye's latest value for this post on the page now showing it. */
async function eyeNow(page, selector) {
  const value = await page.locator(selector).first().getAttribute('data-video-views', { timeout: 3000 }).catch(() => null);
  return value === null ? null : Number(value);
}

/**
 * The three rules, for one post over everything recorded so far.
 * `base` is what the database held before any play was recorded here.
 */
async function rules(label, id, base = 0) {
  const { total, at } = await stored(id);
  const mine = eyes.filter((entry) => entry.id === id).sort((a, b) => a.t - b.t);

  // Never ahead: at the moment a value was shown, the database held at least that.
  const ahead = mine.filter((entry) => entry.v > base + at.filter((when) => when <= entry.t).length);
  check(
    `${label}: the eye never showed a number before the database stored it`,
    ahead.length === 0,
    ahead.length
      ? ahead
          .slice(0, 4)
          .map((entry) => `${entry.v} shown when ${base + at.filter((when) => when <= entry.t).length} stored`)
          .join('; ')
      : `${mine.length} values, ${at.length} stored plays`,
  );

  // Never back: on one page, a value never below one already shown for it.
  const back = [];
  const highest = new Map();
  for (const entry of mine) {
    const high = highest.get(entry.page) ?? -1;
    if (entry.v < high) back.push(`${high} → ${entry.v}`);
    highest.set(entry.page, Math.max(high, entry.v));
  }
  check(`${label}: the eye never went back down`, back.length === 0, back.length ? back.join('; ') : '');

  // What a person watching would have seen, in order: repeats from one page to
  // the next (each page starts from what it rendered) collapsed.
  const values = mine.map((entry) => entry.v).filter((value, i, all) => i === 0 || value !== all[i - 1]);
  return { total, at, values };
}

/** The eye, the database and the API agree; the database holds one view per start. */
async function settlesOn(label, page, context, selector, id, { base = 0, expect } = {}) {
  const want = expect ?? base + startsOf(id);
  const total = await totalReaches(id, want);
  await sleep(400);
  const after = await totalOf(id);
  check(`${label}: the database holds one view per playback start`, after === want, `starts ${want - base}, stored ${after - base}`);
  let eye = null;
  for (let i = 0; i < 40; i += 1) {
    eye = await eyeNow(page, selector);
    if (eye === after) break;
    await sleep(150);
  }
  const api = await apiTotal(context, id);
  check(`${label}: eye = database = API`, eye === after && api === after, `eye ${eye}, database ${after}, API ${api}`);
  return { total: total ?? after, eye };
}

/** Every view report a page sends, and its answer. */
function trackReports(page) {
  const reports = [];
  page.on('response', async (response) => {
    const request = response.request();
    if (request.method() !== 'POST' || !/\/api\/v1\/posts\/[^/]+\/views$/.test(request.url())) return;
    const entry = { id: request.url().split('/').at(-2), status: response.status(), t: Date.now() };
    reports.push(entry);
    entry.answer = await response.json().catch(() => null);
  });
  return reports;
}

async function answered(reports, id, count, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const mine = reports.filter((report) => report.id === id && report.answer);
    if (mine.length >= count) return mine;
    await sleep(100);
  }
  return reports.filter((report) => report.id === id && report.answer);
}

const slide = (id) => `section[data-post-id="${id}"]`;
const slideEye = (id) => `${slide(id)} [data-video-views]`;
const card = (id) => `article:has(a[href="/post/${id}#comments"])`;
const cardEye = (id) => `${card(id)} [data-video-views]`;

async function startOf(id, already, timeout = 10000) {
  const end = Date.now() + timeout;
  while (startsOf(id) <= already && Date.now() < end) await sleep(50);
  return startsOf(id) > already;
}

async function activeSlide(page) {
  return page.evaluate(() => {
    const y = window.innerHeight / 2;
    for (const section of document.querySelectorAll('section[data-index]')) {
      const box = section.getBoundingClientRect();
      if (box.top <= y && box.bottom >= y) return section.getAttribute('data-post-id');
    }
    return null;
  });
}

async function wheel(page, direction) {
  const before = await activeSlide(page);
  await page.mouse.move(640, 430);
  await page.mouse.wheel(0, direction === 'next' ? 700 : -700);
  for (let i = 0; i < 60 && (await activeSlide(page)) === before; i += 1) await sleep(50);
  await sleep(400);
  return activeSlide(page);
}

/** The slide's own play/pause control: the whole frame, as a viewer taps it. */
async function tapVideo(page, id, want) {
  const button = page.locator(`${slide(id)} button[aria-label="${want === 'pause' ? 'Pause video' : 'Play video'}"]`);
  await button.click({ timeout: 5000 });
  await page.waitForFunction(
    ([at, paused]) => document.querySelector(`section[data-post-id="${at}"] video`)?.paused === paused,
    [id, want === 'pause'],
    { timeout: 5000 },
  );
}

/**
 * Follows `handle` from their profile, with the profile's own button — the
 * large one; the small ones beside it are suggestions of other people — and
 * says whether the database has the follow.
 */
async function follow(page, handle, by) {
  await page.goto(`/u/${handle}`, { waitUntil: 'domcontentloaded' });
  // Hydrated first: a press on the server-rendered button before then does nothing.
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].filter((button) => button.textContent?.trim() === 'Follow');
    const area = (button) => button.getBoundingClientRect().width * button.getBoundingClientRect().height;
    buttons.sort((a, b) => area(b) - area(a))[0]?.setAttribute('data-e2e-follow', '');
  });
  await page.locator('[data-e2e-follow]').click();
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const { rowCount } = await pool.query(
      `select 1 from public.follows f
         join public.users a on a.id = f.follower_id
         join public.users b on b.id = f.following_id
        where a.username = $1 and b.username = $2`,
      [by, handle],
    );
    if (rowCount > 0) return true;
    await sleep(200);
  }
  return false;
}

/**
 * Back to the start while stopped, as a viewer dragging the playhead back does
 * — and only once the seek has landed, so its `seeked` is not mistaken for a
 * loop coming round after play is pressed.
 */
async function rewind(video) {
  await video.evaluate(
    (element) =>
      new Promise((resolve) => {
        element.addEventListener('seeked', resolve, { once: true });
        element.currentTime = 0;
      }),
  );
}

/* ------------------------------------------------------------------- run -- */

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
const stamp = Date.now().toString(36).slice(-5);
let parked = false;

try {
  const creator = await createAccount(browser, `eyec_${stamp}`);
  const visitor = await createAccount(browser, `eyev_${stamp}`);
  const other = await postVideo(creator.page, `eye other ${stamp}`);
  const video = await postVideo(creator.page, `eye ${stamp}`);
  const page = visitor.page;
  // Following the creator, so the video is in their Home feed too.
  check('the visitor follows the creator', await follow(page, creator.handle, visitor.handle));
  const reports = trackReports(page);
  const errors = [];
  page.on('pageerror', (error) => {
    if (!/Minified React error #418/.test(error.message)) errors.push(error.message);
  });
  console.log(`posts: ${video} (opened), ${other} (the next slide)`);
  check('setup: a new video starts at 0 in the database', (await totalOf(video)) === 0);

  /* ---------------------------------------------------------------- 1 -- */
  section('1  open a video: 0 → 1 once the request is answered, and still 1 after a background refresh');
  await page.goto(`/videos?v=${video}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`${slide(video)} video[src]`, { timeout: 15000 });
  check('the Videos tab opens on it', (await activeSlide(page)) === video);
  check('playback starts', await startOf(video, 0));
  const first = await answered(reports, video, 1);
  // Paused by the viewer once the answer is in, so nothing else plays it.
  await tapVideo(page, video, 'pause');
  check(
    'the server answered: counted, total 1',
    first[0]?.status === 200 && first[0]?.answer?.counted === true && first[0]?.answer?.count === 1,
    JSON.stringify(first[0]?.answer),
  );
  const opened = await settlesOn('after the request', page, visitor.context, slideEye(video), video);
  const one = await rules('opening', video);
  check('the eye went 0 → 1, and only that', JSON.stringify(one.values) === '[0,1]', `eye ${one.values.join(' → ')}`);
  check('a fresh database read says 1', opened.total === 1, `database ${opened.total}`);

  // A background refresh, the way the live site has one: a notification
  // arrives, UnreadWatch notices within its 20 s poll and refreshes the route,
  // and the server renders the feed again.
  const refreshed = page.waitForResponse(
    (response) => response.request().headers().rsc === '1' && new URL(response.url()).pathname === '/videos',
    { timeout: 45000 },
  );
  check('the creator follows the visitor', await follow(creator.page, visitor.handle, creator.handle));
  await creator.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  const refresh = await refreshed.then((response) => response.status()).catch(() => null);
  check('a background refresh re-rendered the feed from the server', refresh === 200, `RSC refresh ${refresh}`);
  await sleep(1500);
  await settlesOn('after the background refresh', page, visitor.context, slideEye(video), video);
  const still = await rules('through the refresh', video);
  check('still 1 after the request and the refresh', still.values.at(-1) === 1 && still.total === 1, `eye ${still.values.join(' → ')}, database ${still.total}`);

  /* ---------------------------------------------------------------- 2 -- */
  section('2  the same viewer again: pause and resume, duplicate events, rewind, scroll away and back');
  let before = await totalOf(video);
  let seen = startsOf(video);
  await tapVideo(page, video, 'play');
  // Far enough in that taking it back to the start later is watching it again
  // (REWATCH_AFTER_SECONDS), not a nudge of the scrubber.
  await sleep(1300);
  // The same playback, announced again while it plays: what a flaky browser or
  // a re-render might do.
  await page.locator(`${slide(video)} video`).evaluate((element) => {
    for (let i = 0; i < 3; i += 1) element.dispatchEvent(new Event('playing'));
  });
  await sleep(300);
  await tapVideo(page, video, 'pause');
  await sleep(2000);
  check('resumed mid-video: not a playback start', startsOf(video) === seen);
  check('pause, resume and duplicate events add nothing', (await totalOf(video)) === before, `database ${before} → ${await totalOf(video)}`);

  seen = startsOf(video);
  await rewind(page.locator(`${slide(video)} video`));
  await tapVideo(page, video, 'play');
  check('rewound and played again: a playback start', await startOf(video, seen));
  await answered(reports, video, 2);
  await tapVideo(page, video, 'pause');
  await settlesOn('rewind and play', page, visitor.context, slideEye(video), video);

  seen = startsOf(video);
  const away = await wheel(page, 'next');
  check('scrolled to the next video', away !== video && away !== null, String(away));
  await sleep(1200);
  const back = await wheel(page, 'previous');
  check('and back', back === video, String(back));
  check('scrolled back: a playback start', await startOf(video, seen));
  await answered(reports, video, 3);
  await tapVideo(page, video, 'pause');
  await settlesOn('scroll away and back', page, visitor.context, slideEye(video), video);
  if (away) await settlesOn('the video scrolled past', page, visitor.context, slideEye(away), away);
  await rules('repeat plays', video);

  /* ---------------------------------------------------------------- 3 -- */
  section('3  away and back inside the app, a full reload, the post page, the Home feed');
  before = await totalOf(video);
  seen = startsOf(video);
  await page.locator(`a[href="/home"]:visible`).first().click();
  await page.waitForURL(/\/home/, { timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(slideEye(video), { timeout: 15000 });
  await sleep(1500);
  await tapVideo(page, video, 'pause').catch(() => undefined);
  const returned = startsOf(video) - seen;
  if (returned > 0) await answered(reports, video, 3 + returned);
  await settlesOn('back from Home', page, visitor.context, slideEye(video), video);
  await rules('away and back', video);

  before = await totalOf(video);
  const pagesBefore = new Set(eyes.map((entry) => entry.page));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(slideEye(video), { timeout: 15000 });
  const firstAfterReload = eyes.find((entry) => entry.id === video && !pagesBefore.has(entry.page));
  check(
    'a full reload renders the stored total, not an older one',
    firstAfterReload?.v === before,
    `rendered ${firstAfterReload?.v}, database ${before}`,
  );
  await sleep(1500);
  await tapVideo(page, video, 'pause').catch(() => undefined);
  await settlesOn('after the reload', page, visitor.context, slideEye(video), video);
  await rules('the reload', video);

  before = await totalOf(video);
  await page.goto(`/post/${video}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(cardEye(video), { timeout: 15000 });
  check('the post page renders the stored total', (await eyeNow(page, cardEye(video))) === before, `eye ${await eyeNow(page, cardEye(video))}, database ${before}`);
  seen = startsOf(video);
  const player = page.locator(`${card(video)} video`).first();
  await player.evaluate((element) => element.play());
  check('played on the post page: a playback start', await startOf(video, seen));
  await settlesOn('the post page, played', page, visitor.context, cardEye(video), video);
  // To the end, and again: a repeat play by the same viewer is a view.
  seen = startsOf(video);
  await page.waitForFunction((selector) => document.querySelector(selector)?.ended === true, `${card(video)} video`, { timeout: 30000 });
  await player.evaluate((element) => element.play());
  check('played again after the end: a playback start', await startOf(video, seen));
  await player.evaluate((element) => element.pause());
  await settlesOn('the post page, played again', page, visitor.context, cardEye(video), video);

  await page.locator(`a[href="/home"]:visible`).first().click();
  await page.waitForURL(/\/home/, { timeout: 15000 });
  const onHome = await page.waitForSelector(cardEye(video), { timeout: 15000 }).then(() => true).catch(() => false);
  check('the Home feed shows the video', onHome);
  if (onHome) await settlesOn('the Home feed card', page, visitor.context, cardEye(video), video);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(cardEye(video), { timeout: 15000 });
  await sleep(1000);
  await settlesOn('back to the post page', page, visitor.context, cardEye(video), video);
  await rules('the post page and Home', video);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ---------------------------------------------------------------- 4 -- */
  section('4  view storage missing — every play "unavailable", as on the live site');
  const fresh = await postVideo(creator.page, `eye unstored ${stamp}`);
  try {
    await pool.query('alter table public.video_views rename to video_views_parked_e2e');
    await pool.query(`notify pgrst, 'reload schema'`);
    parked = true;
    playsTable = 'video_views_parked_e2e';
    await sleep(1500);
  } catch (error) {
    console.log(`SKIP  cannot park public.video_views here (${error.message}); step 4 needs a database owner`);
  }
  if (parked) {
    const missing = await browser.newContext({ ...DESKTOP, baseURL: BASE });
    await missing.exposeBinding('__eyeOut', (_source, kind, entry) => {
      (kind === 'eye' ? eyes : plays).push(entry);
    });
    await missing.addInitScript(recordInPage);
    const glance = await missing.newPage();
    const unstored = trackReports(glance);
    await glance.goto(`/videos?v=${fresh}`, { waitUntil: 'domcontentloaded' });
    await glance.waitForSelector(`${slide(fresh)} video[src]`, { timeout: 15000 });
    check('playback starts', await startOf(fresh, 0));
    const refused = await answered(unstored, fresh, 1);
    await sleep(1500);
    await tapVideo(glance, fresh, 'pause').catch(() => undefined);
    check(
      'the server answered "unavailable", total 0 — what the live site answered',
      refused[0]?.answer?.reason === 'unavailable' && refused[0]?.answer?.count === 0,
      JSON.stringify(refused[0]?.answer),
    );
    const unavailable = await rules('storage missing', fresh);
    check(
      'the eye stayed at 0: never 0 → 1 → 0',
      unavailable.values.every((value) => value === 0),
      `eye ${unavailable.values.join(' → ')}`,
    );
    check('nothing stored', unavailable.total === 0 && unavailable.at.length === 0, `database ${unavailable.total}`);

    // Storage back — what applying migration 0017 does on the live site — with
    // no restart. The server looks again within STORAGE_RECHECK_MS.
    await pool.query('alter table public.video_views_parked_e2e rename to video_views');
    await pool.query(`notify pgrst, 'reload schema'`);
    parked = false;
    playsTable = 'video_views';
    const refusedAt = refused[0]?.t ?? Date.now();
    await sleep(Math.max(0, refusedAt + STORAGE_RECHECK_MS + 1500 - Date.now()));
    const seenFresh = startsOf(fresh);
    await rewind(glance.locator(`${slide(fresh)} video`));
    await tapVideo(glance, fresh, 'play');
    check('played again: a playback start', await startOf(fresh, seenFresh));
    const counted = await answered(unstored, fresh, refused.length + 1);
    await tapVideo(glance, fresh, 'pause').catch(() => undefined);
    check('storage back without a restart: counted, total 1', counted.at(-1)?.answer?.counted === true && counted.at(-1)?.answer?.count === 1, JSON.stringify(counted.at(-1)?.answer));
    // The plays from the minute storage was missing were never stored, and are not owed.
    await settlesOn('storage back', glance, missing, slideEye(fresh), fresh, { expect: 1 });
    const recovered = await rules('storage back', fresh);
    check('the eye went 0 → 1, and stays', JSON.stringify(recovered.values) === '[0,1]', `eye ${recovered.values.join(' → ')}`);
    await glance.reload({ waitUntil: 'domcontentloaded' });
    await glance.waitForSelector(slideEye(fresh), { timeout: 15000 });
    const later = eyes.filter((entry) => entry.id === fresh).at(-1);
    check('and a reload still shows it', (later?.v ?? 0) >= 1, `eye ${later?.v}`);
    await missing.close();
  }
} catch (error) {
  failures += 1;
  console.log(`FAIL  the flow stopped: ${error.stack ?? error}`);
} finally {
  if (parked) {
    await pool.query('alter table public.video_views_parked_e2e rename to video_views').catch(() => undefined);
    await pool.query(`notify pgrst, 'reload schema'`).catch(() => undefined);
  }
  await browser.close();
  await pool.end();
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
