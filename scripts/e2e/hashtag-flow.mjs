/**
 * Hashtags, end to end, through the real UI.
 *
 *   1. Hashtags a post or video was published with are shown on it, as
 *      written, on the post page, in the feed and in the Videos feed — and so
 *      are hashtags written into a caption.
 *   2. Each one is a link; every spelling of one hashtag opens the same page.
 *   3. A hashtag's page is the Videos feed — same player, one video playing —
 *      holding every public video with that hashtag, whatever its case.
 *   4. A video with several hashtags is on each of their pages.
 *   5. Search finds hashtags with or without the #, and leads to their pages.
 *   6. A deleted video leaves the page at once.
 *   7. All of it works on a phone and on a desktop, signed in or out.
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     FIXTURES=/tmp/fay-video-fixtures node scripts/e2e/hashtag-flow.mjs
 *
 * Needs the GoTrue stub, a built app, an EMPTY store, and the fixtures from
 * make-video-fixtures.mjs.
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const STORE = process.env.FAY_STORE || '.data/faytarra.json';
const CHROMIUM = process.env.CHROMIUM_PATH;
const FIXTURES = process.env.FIXTURES || '/tmp/fay-video-fixtures';
const PASSWORD = 'a long enough password';
const SHOTS = process.env.SHOTS_DIR;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const store = () => JSON.parse(readFileSync(STORE, 'utf8'));
async function settle(predicate, timeout = 8000) {
  const until = Date.now() + timeout;
  for (;;) {
    let snapshot = null;
    try {
      snapshot = store();
    } catch {
      /* mid-write */
    }
    if (snapshot && predicate(snapshot)) return snapshot;
    if (Date.now() >= until) return snapshot;
    await wait(250);
  }
}

async function signUp(browser, email, handle) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]').first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/verify-email/, { timeout: 25000 });
  const link = [...mails()].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

/** Posts a video the way a person does: hashtags typed one at a time, each finished with Enter. */
async function postVideo(actor, title, { tags = [], description = '', file = 'square.webm' } = {}) {
  const { page } = actor;
  await page.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Post a video', { timeout: 15000 });
  await page.locator('input[type=file]').setInputFiles({
    name: file,
    mimeType: 'video/webm',
    buffer: readFileSync(`${FIXTURES}/${file}`),
  });
  await page.waitForSelector('#video-title', { timeout: 30000 });
  await page.fill('#video-title', title);
  if (description) await page.fill('#video-caption', description);
  for (const tag of tags) {
    await page.locator('#video-tags').pressSequentially(tag);
    await page.locator('#video-tags').press('Enter');
  }
  await page.selectOption('#video-category', 'Gaming');
  await page.locator('button', { hasText: /^Post video$/ }).click();
  await page.waitForURL(/\/post\//, { timeout: 180000 });
  return page.url().split('/post/')[1].split(/[?#]/)[0];
}

async function postPhoto(actor, caption, tags) {
  const { page } = actor;
  await page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  const jpeg = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 400;
    const g = c.getContext('2d');
    g.fillStyle = '#7c5cff';
    g.fillRect(0, 0, 600, 400);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
  await page.waitForSelector('form img', { timeout: 20000 });
  await page.fill('textarea[name=caption]', caption);
  await page.fill('#tags', tags);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
  return page.url().split('/post/')[1].split(/[?#]/)[0];
}

/** The hashtag links a post shows, as [text, href]. */
async function hashtagsOn(scope) {
  await scope.locator('[data-hashtags]').first().waitFor({ timeout: 10000 }).catch(() => {});
  return scope
    .locator('[data-hashtags] a[data-hashtag]')
    .evaluateAll((links) => links.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
}

const players = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('section[data-index] video')].map((video) => ({
      index: Number(video.closest('section[data-index]').dataset.index),
      paused: video.paused,
    })),
  );

async function run() {
  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`.slice(-7);
  const A = await signUp(browser, `ta${stamp}@example.com`, `ta${stamp}`);
  const B = await signUp(browser, `tb${stamp}@example.com`, `tb${stamp}`);
  const V = await signUp(browser, `tv${stamp}@example.com`, `tv${stamp}`);
  // Unique per run, so a hashtag page here holds only this run's videos.
  const game = `Gaming${stamp}`;
  const gameKey = game.toLowerCase();
  const speed = `Speedrun${stamp}`;
  const speedKey = speed.toLowerCase();

  /* ==================================================================== */
  section('POSTING WITH HASHTAGS');
  const v1 = await postVideo(A, `first clip ${stamp}`, { tags: [game, speed] });
  const v2 = await postVideo(B, `second clip ${stamp}`, { tags: [gameKey] });
  const v3 = await postVideo(A, `third clip ${stamp}`, { description: `caption only #${game.toUpperCase()}` });
  const p1 = await postPhoto(A, `a photo ${stamp}`, `${game}, photo${stamp}`);
  const rows = (await settle((s) => [v1, v2, v3, p1].every((id) => s.posts.some((p) => p.id === id)))).posts;
  const row = (id) => rows.find((p) => p.id === id);
  check('the hashtags are stored as typed, in the order typed', JSON.stringify(row(v1).tags) === JSON.stringify([game, speed]) && JSON.stringify(row(v2).tags) === JSON.stringify([gameKey]), JSON.stringify(row(v1).tags));
  check('and the caption is left as it was', row(v3).caption.includes(`#${game.toUpperCase()}`));

  /* ==================================================================== */
  section('SHOWN, AND LINKED');
  await V.page.goto(`/post/${v1}`, { waitUntil: 'networkidle' });
  const onV1 = await hashtagsOn(V.page.locator('article').first());
  check('a video’s post page shows both its hashtags, as written', onV1.map(([text]) => text).join(' ') === `#${game} #${speed}`, JSON.stringify(onV1));
  check('each links to its own page, by the shared lower-case form', onV1[0]?.[1] === `/tag/${gameKey}` && onV1[1]?.[1] === `/tag/${speedKey}`, JSON.stringify(onV1));
  await V.page.goto(`/post/${v3}`, { waitUntil: 'networkidle' });
  const onV3 = await hashtagsOn(V.page.locator('article').first());
  check('a hashtag written in a caption is a link too', onV3.some(([text, href]) => text === `#${game.toUpperCase()}` && href === `/tag/${gameKey}`), JSON.stringify(onV3));
  await V.page.goto(`/post/${p1}`, { waitUntil: 'networkidle' });
  const onP1 = await hashtagsOn(V.page.locator('article').first());
  check('a photo post shows its tags too', onP1.map(([text]) => text).join(' ') === `#${game} #photo${stamp}`, JSON.stringify(onP1));
  await V.page.goto('/home?tab=recommended', { waitUntil: 'networkidle' });
  const card = V.page.locator('article', { has: V.page.locator(`a[href="/post/${p1}"]`) }).first();
  check('and so does its card in the feed', (await hashtagsOn(card)).length === 2);

  await V.page.goto(`/videos?v=${v1}`, { waitUntil: 'networkidle' });
  const slide = V.page.locator('section[data-index="0"]');
  const onSlide = await hashtagsOn(slide);
  check('the Videos feed shows them over the video', onSlide.map(([text]) => text).join(' ') === `#${game} #${speed}`, JSON.stringify(onSlide));
  await slide.locator(`[data-hashtags] a[href="/tag/${gameKey}"]`).click();
  await V.page.waitForURL(new RegExp(`/tag/${gameKey}$`), { timeout: 15000 }).catch(() => {});
  await V.page.waitForSelector('section[data-index="2"]', { timeout: 20000 }).catch(() => {});
  check('tapping one opens its page', V.page.url().endsWith(`/tag/${gameKey}`), V.page.url());

  /* ==================================================================== */
  section('A HASHTAG’S PAGE IS THE VIDEOS FEED');
  await V.page.waitForLoadState('networkidle');
  check('titled with the hashtag', (await V.page.locator('h1').first().innerText()).trim() === `#${gameKey}`);
  const slides = await V.page.locator('section[data-index]').allInnerTexts();
  check('every video with it — as a tag in any case, or in the caption — and no photo', slides.length === 3 && [`third clip ${stamp}`, `second clip ${stamp}`, `first clip ${stamp}`].every((t, i) => slides[i]?.includes(t)), slides.map((s) => s.split('\n').find((l) => l.includes(stamp))).join(' | '));
  await V.page.waitForTimeout(1500);
  const first = await players(V.page);
  check('one video playing: the one on screen', first.filter((p) => !p.paused).length === 1 && first.find((p) => !p.paused)?.index === 0, JSON.stringify(first));
  await V.page.locator('section[data-index="1"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await V.page.waitForTimeout(1500);
  const second = await players(V.page);
  check('scrolling moves playback to the next one', second.filter((p) => !p.paused).length === 1 && second.find((p) => !p.paused)?.index === 1, JSON.stringify(second));
  const end = V.page.locator('section[data-index="2"] a', { hasText: /That is every video/ });
  check('the last video says it is the last, and points to the photo with it too', (await end.count()) === 1 && (await end.getAttribute('href')) === `/search?q=${encodeURIComponent(`#${gameKey}`)}`);

  for (const spelling of [game.toUpperCase(), `%23${game}`]) {
    await V.page.goto(`/tag/${spelling}`, { waitUntil: 'networkidle' });
    check(`/tag/${spelling} is the same page`, V.page.url().endsWith(`/tag/${gameKey}`), V.page.url());
  }
  await V.page.goto(`/tag/${speedKey}`, { waitUntil: 'networkidle' });
  const speedSlides = await V.page.locator('section[data-index]').allInnerTexts();
  check('a video with two hashtags is on the other one’s page too', speedSlides.length === 1 && speedSlides[0].includes(`first clip ${stamp}`));

  await V.page.goto(`/tag/photo${stamp}`, { waitUntil: 'networkidle' });
  const photoOnly = await V.page.locator('[data-hashtag-page]').innerText();
  check('a hashtag only photos use says so, and links to them', /No videos with #photo/.test(photoOnly) && (await V.page.locator(`a[href="/search?q=${encodeURIComponent(`#photo${stamp}`)}"]`).count()) === 1, photoOnly.slice(0, 80));
  await V.page.goto(`/tag/nothing${stamp}`, { waitUntil: 'networkidle' });
  check('an unused hashtag is an empty page, not an error', /No videos with #nothing/.test(await V.page.locator('body').innerText()));
  // A streamed page has sent its 200 before it can know; what matters is that
  // it is the not-found page rather than a hashtag page for nothing.
  await V.page.goto('/tag/%21%21%21', { waitUntil: 'networkidle' });
  check('something that is not a hashtag is “Nothing here”, not a page', (await V.page.getByText('Nothing here.').count()) === 1 && (await V.page.locator('[data-hashtag-page]').count()) === 0);

  /* ==================================================================== */
  section('SEARCH');
  for (const query of [`#${gameKey}`, game.toUpperCase()]) {
    await V.page.goto(`/search?q=${encodeURIComponent(query)}`, { waitUntil: 'networkidle' });
    const chip = V.page.locator(`[data-search-hashtags] a[href="/tag/${gameKey}"]`);
    const text = (await chip.count()) ? (await chip.innerText()).replace(/\s+/g, ' ') : '';
    check(`“${query}” finds the hashtag, with what uses it`, text.includes(`#${game}`) && text.includes('3 videos') && text.includes('4 posts'), text);
  }
  await V.page.locator(`[data-search-hashtags] a[href="/tag/${gameKey}"]`).click();
  await V.page.waitForURL(new RegExp(`/tag/${gameKey}$`), { timeout: 15000 }).catch(() => {});
  check('and opens its page', V.page.url().endsWith(`/tag/${gameKey}`));
  await V.page.goto(`/search?q=${encodeURIComponent(`#${speedKey}`)}`, { waitUntil: 'networkidle' });
  check('“#tag” search lists the posts that use it', (await V.page.locator(`article a[href="/post/${v1}"]`).count()) > 0);

  /* ==================================================================== */
  section('KEPT CURRENT');
  await B.page.goto(`/post/${v2}`, { waitUntil: 'networkidle' });
  await B.page.locator('button[aria-label="More options"]').first().click();
  await B.page.locator('[data-delete-post]').click();
  await B.page.locator('[data-delete-confirm-button]').click();
  await settle((s) => !s.posts.some((p) => p.id === v2));
  await V.page.goto(`/tag/${gameKey}`, { waitUntil: 'networkidle' });
  const after = await V.page.locator('section[data-index]').allInnerTexts();
  check('a deleted video is gone from the page at once', after.length === 2 && !after.some((t) => t.includes(`second clip ${stamp}`)), String(after.length));
  await V.page.goto(`/search?q=${encodeURIComponent(`#${gameKey}`)}`, { waitUntil: 'networkidle' });
  const recount = (await V.page.locator(`[data-search-hashtags] a[href="/tag/${gameKey}"]`).innerText()).replace(/\s+/g, ' ');
  check('and from the counts in search', recount.includes('2 videos') && recount.includes('3 posts'), recount);

  /* ==================================================================== */
  for (const [device, options] of [
    ['phone', { ...devices['iPhone 13'] }],
    ['desktop', { viewport: { width: 1440, height: 900 } }],
  ]) {
    section(`${device.toUpperCase()}`);
    const context = await browser.newContext({ ...options, baseURL: BASE });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`${page.url()} ${error}`));
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    await page.goto(`/post/${v1}`, { waitUntil: 'networkidle' });
    const links = page.locator('article [data-hashtags] a[data-hashtag]');
    const boxes = await links.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, height: r.height })));
    const width = await page.evaluate(() => window.innerWidth);
    check(`${device}: hashtags fit on screen, big enough to tap, signed out`, boxes.length === 2 && boxes.every((b) => b.left >= 0 && b.right <= width && b.height >= 24), JSON.stringify(boxes));
    check(`${device}: no sideways scroll on the post`, (await wide()) <= 0);
    await links.first().click();
    await page.waitForURL(new RegExp(`/tag/${gameKey}$`), { timeout: 15000 }).catch(() => {});
    // The URL changes as the page starts loading; its videos stream in after.
    await page.waitForSelector('section[data-index="0"] video', { timeout: 20000 }).catch(() => {});
    check(`${device}: a tap opens the hashtag’s page`, page.url().endsWith(`/tag/${gameKey}`));
    check(`${device}: which plays its videos full height`, (await page.locator('section[data-index]').count()) === 2 && (await page.locator('section[data-index="0"] video').count()) === 1);
    check(`${device}: no sideways scroll on the hashtag page`, (await wide()) <= 0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${device}-tag.png` });
    const slideTags = page.locator('section[data-index="0"] [data-hashtags] a[data-hashtag]');
    const slideBox = await slideTags.first().boundingBox();
    check(`${device}: the hashtags on a video are on screen`, Boolean(slideBox) && slideBox.x >= 0 && slideBox.x + slideBox.width <= width, JSON.stringify(slideBox));
    await page.goto(`/search?q=${encodeURIComponent(`#${gameKey}`)}`, { waitUntil: 'networkidle' });
    check(`${device}: search shows the hashtag without sideways scroll`, (await page.locator('[data-search-hashtags] a').count()) >= 1 && (await wide()) <= 0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${device}-search.png` });
    const real = errors.filter((e) => !/Minified React error #418/.test(e));
    check(`${device}: no page errors`, real.length === 0, real[0] ?? '');
    await context.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
