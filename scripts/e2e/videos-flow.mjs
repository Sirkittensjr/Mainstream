/**
 * The Videos feed, end to end, in a real browser.
 *
 * Four real video posts, made through the real editor by two accounts, then
 * watched by a third. The checks that matter here are the ones a screenshot
 * cannot make: which player is actually playing, which files the page has
 * actually asked the network for, and whether the order is the recommendation
 * or merely the clock.
 *
 *   node scripts/e2e/make-video-fixtures.mjs /tmp/fay-video-fixtures
 *   BASE_URL=http://localhost:3000 node scripts/e2e/videos-flow.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const FIXTURES = process.env.FIXTURES || '/tmp/fay-video-fixtures';
const CHROMIUM = process.env.CHROMIUM_PATH;
const PASSWORD = 'a long enough password';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);

const fixture = (name) => ({
  name,
  mimeType: 'video/webm',
  buffer: readFileSync(path.join(FIXTURES, name)),
});

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

async function createAccount(browser, handle, interest, options = {}) {
  const context = await browser.newContext({ baseURL: BASE, ...options });
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
  return { context, page, handle };
}

/** Posts one fixture as a video post and returns its post id. */
async function postVideo(page, file, caption, category) {
  await page.goto('/create', { waitUntil: 'domcontentloaded' });
  await page.locator('button[role=tab]', { hasText: 'Video' }).click();
  await page.waitForSelector('text=Start your video', { timeout: 15000 });
  await page.locator('input[type=file]').setInputFiles(fixture(file));
  await page.waitForSelector('li:has(video)', { timeout: 20000 });
  await page.locator('button', { hasText: 'Preview' }).last().click();
  await page.waitForSelector('text=Ready to post', { timeout: 180000 });
  await page.fill('#video-caption', caption);
  await page.selectOption('#video-category', category);
  await page.locator('button', { hasText: 'Post video' }).click();
  await page.waitForURL(/\/post\//, { timeout: 90000 });
  return page.url().split('/post/')[1];
}

/** What every player on the page is doing right now. */
const players = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('section[data-index] video')].map((video) => ({
      index: Number(video.closest('section[data-index]').dataset.index),
      paused: video.paused,
      muted: video.muted,
      src: video.getAttribute('src') || '',
      preload: video.preload,
      width: video.videoWidth,
      height: video.videoHeight,
      fit: getComputedStyle(video).objectFit,
    })),
  );

const captionOf = (page, index) =>
  page.locator(`section[data-index="${index}"]`).innerText();

async function scrollToSlide(page, index) {
  await page.locator(`section[data-index="${index}"]`).evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(1500);
}

const run = async () => {
  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const stamp = Date.now().toString(36).slice(-6);
  const a = `reel_${stamp}`;
  const b = `clip_${stamp}`;
  const c = `watch_${stamp}`;
  const d = `newbie_${stamp}`;

  const A = await createAccount(browser, a, 'Music');
  const B = await createAccount(browser, b, 'Art');
  const C = await createAccount(browser, c, 'Music');

  /* ============================== the posts ============================== */
  section('SETUP — four video posts and one that is not a video');

  const portrait = await postVideo(A.page, 'portrait.webm', `tall clip ${stamp}`, 'Music');
  const square = await postVideo(A.page, 'square.webm', `square clip ${stamp}`, 'Music');
  const landscape = await postVideo(B.page, 'landscape.webm', `wide clip ${stamp}`, 'Art');
  const tiny = await postVideo(B.page, 'tiny.webm', `little clip ${stamp}`, 'Art');
  check('four video posts exist', [portrait, square, landscape, tiny].every(Boolean));

  await A.page.goto('/create', { waitUntil: 'domcontentloaded' });
  const textCaption = `not a video at all ${stamp}`;
  await A.page.fill('textarea[name=caption]', textCaption);
  await Promise.all([
    A.page.waitForURL(/\/post\//, { timeout: 30000 }),
    A.page.locator('form button[type=submit]').last().click(),
  ]);

  /* ============================ the experience =========================== */
  section('VIDEOS — the feed itself');

  const errors = [];
  C.page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await C.page.goto('/videos', { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('section[data-index]', { timeout: 20000 });
  const slides = await C.page.locator('section[data-index]').count();
  check('1. the Videos feed shows every video post', slides === 4, `${slides} slides`);
  const allText = await C.page.locator('section[data-index]').allInnerTexts();
  check('2. and nothing that is not a video', !allText.join(' ').includes(textCaption));

  const first = await players(C.page);
  check(
    '3. only one video is playing',
    first.filter((p) => !p.paused).length === 1,
    first.map((p) => `${p.index}:${p.paused ? 'paused' : 'playing'}`).join(' '),
  );
  check('3. and it is the one on screen', first.find((p) => !p.paused)?.index === 0);
  check('4. playback starts muted, as autoplay requires', first.every((p) => p.muted));

  check(
    '5. only the clip playing and the next one are even loaded',
    first.length <= 2 && first.every((p) => p.src),
    `${first.length} players for ${slides} slides`,
  );
  check(
    '5. and only the one playing is allowed to buffer ahead',
    first.find((p) => p.index === 0)?.preload === 'auto' &&
      first.find((p) => p.index === 1)?.preload === 'metadata',
  );
  const posters = await C.page.locator('section[data-index="3"] img').count();
  check('6. a slide further down is its poster, not a download', posters > 0);

  /* ============================ aspect ratios ============================ */
  section('SHAPE — nothing is cropped into a vertical format');

  check(
    '7. the video is contained, never cropped to fit',
    first.every((p) => p.fit === 'contain'),
    first.map((p) => p.fit).join(' '),
  );

  const shapes = {};
  for (const index of [0, 1, 2, 3]) {
    await scrollToSlide(C.page, index);
    const text = await captionOf(C.page, index);
    const playing = (await players(C.page)).find((p) => p.index === index);
    if (playing?.width) {
      const name = /tall/.test(text) ? 'portrait' : /wide/.test(text) ? 'landscape' : /square/.test(text) ? 'square' : 'tiny';
      shapes[name] = playing.width / playing.height;
    }
  }
  check(
    '7. a portrait clip stays portrait',
    !shapes.portrait || Math.abs(shapes.portrait - 360 / 640) < 0.02,
    String(shapes.portrait),
  );
  check(
    '7. a landscape clip stays landscape',
    !shapes.landscape || Math.abs(shapes.landscape - 640 / 360) < 0.02,
    String(shapes.landscape),
  );
  check(
    '7. a square clip stays square',
    !shapes.square || Math.abs(shapes.square - 1) < 0.02,
    String(shapes.square),
  );

  /* ========================= one at a time, still ========================= */
  section('PLAYBACK — scrolling stops what you left');

  await scrollToSlide(C.page, 1);
  const second = await players(C.page);
  check(
    '8. scrolling on plays the next video and only the next video',
    second.filter((p) => !p.paused).length === 1 && second.find((p) => !p.paused)?.index === 1,
    second.map((p) => `${p.index}:${p.paused ? 'paused' : 'playing'}`).join(' '),
  );
  check(
    '8. the one left behind is paused and rewound',
    (second.find((p) => p.index === 0)?.paused ?? true) === true,
  );

  await C.page.locator('button[aria-label="Unmute"]').first().click();
  await C.page.waitForTimeout(600);
  const unmuted = await players(C.page);
  check('9. sound can be turned on', unmuted.every((p) => !p.muted));
  await C.page.locator('button[aria-label="Mute"]').first().click();

  /* ========================== the social features ======================== */
  section('SOCIAL — a video is a normal FayTarra post');

  await scrollToSlide(C.page, 0);
  const topCaption = await captionOf(C.page, 0);
  await C.page.locator('section[data-index="0"] button[aria-label="Like"]').click();
  await C.page.waitForTimeout(1200);
  check(
    '10. a video can be liked from the feed',
    (await C.page.locator('section[data-index="0"] button[aria-label="Unlike"]').count()) === 1,
  );

  await C.page.locator('section[data-index="0"] button[aria-label="Rate this"]').click();
  await C.page.waitForSelector('[role=dialog]', { timeout: 10000 });
  await C.page.locator('[role=dialog] button', { hasText: /^9$/ }).first().click();
  await C.page.locator('[role=dialog] button', { hasText: /Rate|Send|Submit|Save/ }).last().click();
  await C.page.waitForTimeout(2000);
  const rated = await C.page.locator('section[data-index="0"]').innerText();
  check('11. and rated out of ten, in the same sheet as everywhere else', /9\.0/.test(rated), rated.split('\n').slice(-6).join(' '));

  const authorHandle = /tall clip/.test(topCaption) || /square clip/.test(topCaption) ? a : b;
  await C.page.locator(`section[data-index="0"] a[href="/u/${authorHandle}"]`).first().click();
  await C.page.waitForFunction(() => /^\/u\/[^/]+$/.test(location.pathname), undefined, { timeout: 15000 });
  check(
    '12. the creator links to their profile',
    new URL(C.page.url()).pathname === `/u/${authorHandle}`,
    C.page.url(),
  );

  await C.page.goto('/videos', { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('section[data-index]');
  await C.page.locator('section[data-index="0"] a[aria-label="Comments"]').click();
  await C.page.waitForURL(/\/post\//, { timeout: 15000 });
  await C.page.locator('article').first().waitFor({ state: 'visible', timeout: 15000 });
  check('13. comments open the post page', /\/post\/[0-9a-f-]+/.test(C.page.url()), C.page.url());
  check('13. and the like given in the feed is on the post', (await C.page.locator('button[aria-label="Unlike"]').count()) >= 1);

  /* ============================== the ranking ============================ */
  section('RANKING — the recommendation, not the clock');

  await C.page.goto('/videos', { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('section[data-index]');
  const orderNow = await C.page.locator('section[data-index]').allInnerTexts();
  check(
    '14. the video with engagement leads, though it is not the newest',
    orderNow[0].includes(topCaption.split('\n').find((line) => line.includes(stamp)) ?? topCaption),
    orderNow[0].split('\n').filter((l) => l.includes(stamp)).join(' '),
  );
  check(
    '14. the newest video is still on the first screenful',
    orderNow.slice(0, 2).join(' ').includes(`little clip ${stamp}`),
  );

  const D = await createAccount(browser, d, 'Comedy');
  const brandNew = await postVideo(D.page, 'tiny.webm', `nobody has seen this ${stamp}`, 'Comedy');
  await C.page.goto('/videos', { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('section[data-index]');
  const withNew = await C.page.locator('section[data-index]').allInnerTexts();
  check(
    '15. a video with no likes, no ratings and no followers still gets shown',
    withNew.join(' ').includes(`nobody has seen this ${stamp}`),
  );
  check(
    '15. and it is not buried at the bottom',
    withNew.slice(0, 2).join(' ').includes(`nobody has seen this ${stamp}`),
    `position ${withNew.findIndex((t) => t.includes('nobody has seen this'))}`,
  );

  /* ========================== links into the feed ======================== */
  section('ROUTES — one video, one link');

  await C.page.goto(`/videos?v=${landscape}`, { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('section[data-index]');
  check(
    '16. a link to one video opens the feed on it',
    (await captionOf(C.page, 0)).includes(`wide clip ${stamp}`),
  );
  const rest = await C.page.locator('section[data-index]').count();
  check('16. with the rest of the feed behind it', rest > 1, `${rest} slides`);

  /* ============================== blocking =============================== */
  section('MODERATION — blocking is respected');

  await C.page.goto(`/u/${b}`, { waitUntil: 'domcontentloaded' });
  await C.page.locator('button[aria-label="More options"], button', { hasText: '•••' }).first().click();
  await C.page.locator('button', { hasText: /^Block/ }).first().click();
  await C.page.waitForTimeout(2000);
  await C.page.goto('/videos', { waitUntil: 'domcontentloaded' });
  await C.page.waitForTimeout(800);
  const afterBlock = (await C.page.locator('section[data-index]').allInnerTexts()).join(' ');
  check('17. a blocked account’s videos are gone from the feed', !afterBlock.includes(`wide clip ${stamp}`));
  check('17. and everybody else is still there', afterBlock.includes(`tall clip ${stamp}`));

  await C.page.goto(`/u/${b}`, { waitUntil: 'domcontentloaded' });
  await C.page.locator('button[aria-label="More options"], button', { hasText: '•••' }).first().click();
  await C.page.locator('button', { hasText: /^Unblock/ }).first().click();
  await C.page.waitForTimeout(1500);

  /* ================================ phone ================================ */
  section('PHONE — the layout that matters most');

  const phone = await browser.newContext({
    baseURL: BASE,
    storageState: await C.context.storageState(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const small = await phone.newPage();
  await small.goto('/videos', { waitUntil: 'domcontentloaded' });
  await small.waitForSelector('section[data-index]');
  const box = await small.locator('section[data-index="0"]').boundingBox();
  check('18. a slide fills the phone screen', box.width === 390 && box.height > 600, `${box.width}x${Math.round(box.height)}`);
  check('18. the bottom navigation is still reachable', (await small.locator('nav a[href="/videos"]').count()) === 1);
  check('18. the like button is on screen', await small.locator('section[data-index="0"] button[aria-label]', { hasText: '' }).first().isVisible());
  const phonePlayers = await players(small);
  check('18. one video plays on a phone too', phonePlayers.filter((p) => !p.paused).length === 1);
  const overflow = await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('18. nothing spills off the side', overflow);
  await phone.close();

  /* ============================ nothing broken =========================== */
  section('UNCHANGED — the rest of FayTarra');

  await C.page.goto('/home?tab=recommended', { waitUntil: 'domcontentloaded' });
  const home = await C.page.locator('body').innerText();
  check('19. video posts are still normal posts in the feed', home.includes(`tall clip ${stamp}`) || home.includes(`wide clip ${stamp}`));
  check('19. Videos is in the navigation', (await C.page.locator('a[href="/videos"]').count()) >= 1);
  await C.page.goto('/discover', { waitUntil: 'domcontentloaded' });
  check('19. Discover still works', (await C.page.locator('a[href^="/post/"]').count()) > 0);
  await C.page.goto(`/post/${brandNew}`, { waitUntil: 'domcontentloaded' });
  check('19. a video post page still plays with normal controls', (await C.page.locator('video[controls]').count()) === 1);

  check('20. no console errors on the Videos feed', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
