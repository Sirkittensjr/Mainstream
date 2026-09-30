/**
 * Video covers: the picture that stands in for a video before anyone plays it.
 *
 * Three ways a post gets one — a frame picked off the scrubber, an image the
 * creator supplied, or neither, in which case a frame is taken anyway — and
 * the rules that matter are the same in all three: the cover is a SEPARATE
 * stored file, it never touches the video, and nothing is uploaded until the
 * post is actually published.
 *
 *   node scripts/e2e/video-cover-flow.mjs
 *
 * Records its own short fixture in the browser, so there is nothing to build
 * first.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const CHROMIUM = process.env.CHROMIUM_PATH;
const PASSWORD = 'a long enough password';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const WORK = mkdtempSync(path.join(tmpdir(), 'fay-cover-'));

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

/** A few seconds of moving colour, recorded the way a browser records. */
async function makeVideo(page, seconds = 3) {
  const data = await page.evaluate(async (secs) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(25);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.start();
    const started = performance.now();
    await new Promise((resolve) => {
      const draw = () => {
        const elapsed = (performance.now() - started) / 1000;
        // Each second is a very different colour, so two frames far apart are
        // visibly different pictures — which is the point of a scrubber.
        ctx.fillStyle = `hsl(${Math.floor(elapsed) * 90}, 90%, 50%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 120px sans-serif';
        ctx.fillText(String(Math.floor(elapsed)), 110, 260);
        if (elapsed >= secs) return resolve();
        requestAnimationFrame(draw);
      };
      draw();
    });
    await new Promise((resolve) => {
      recorder.onstop = resolve;
      recorder.stop();
    });
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
    return [...new Uint8Array(buffer)];
  }, seconds);
  const file = path.join(WORK, `clip-${Date.now()}.webm`);
  writeFileSync(file, Buffer.from(data));
  return file;
}

/** A small solid-colour PNG, to stand in for a camera-roll thumbnail. */
async function makeImage(page, colour = '#00E5FF') {
  const data = await page.evaluate(async (fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 600, 600);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, colour);
  const file = path.join(WORK, `cover-${Date.now()}.png`);
  writeFileSync(file, Buffer.from(data));
  return file;
}

async function createAccount(browser, handle, interest, viewport) {
  const context = await browser.newContext({ baseURL: BASE, viewport });
  const page = await context.newPage();
  const email = `${handle}@example.com`;
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]', { hasText: interest }).first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/verify-email/, { timeout: 25000 });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

/** Opens the video composer with a clip loaded and waits for the cover UI. */
async function openStudio(page, videoFile) {
  // The video studio has its own route now, and `?upload=1` is its chooser door:
  // a suite handing over a file on disk does not want the camera switched on.
  await page.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('input[type=file][accept*="video"]', { state: 'attached' });
  await page.setInputFiles('input[type=file][accept*="video"]', videoFile);
  await page.waitForSelector('#cover-heading', { timeout: 30000 });
  await page.waitForSelector('img[data-cover-preview]', { timeout: 30000 });
}

/** A quiet category, so a Discover check is not a race against every post. */
const COVER_CATEGORY = 'Music';

async function publish(page, title) {
  await page.fill('#video-title', title);
  await page.selectOption('#video-category', COVER_CATEGORY).catch(() => {});
  await Promise.all([
    page.waitForURL(/\/post\//, { timeout: 90000 }),
    page.locator('button', { hasText: /^Post video$/ }).first().click(),
  ]);
  return page.url().split('/post/')[1].split(/[?#]/)[0];
}

const postJson = (page, id) =>
  page.evaluate(async (postId) => (await fetch(`/api/v1/posts/${postId}`, { cache: 'no-store' })).json(), id);

const headStatus = (page, url) =>
  page.evaluate(async (target) => (await fetch(target, { method: 'GET' })).status, url);

async function run() {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
  const A = await createAccount(browser, `cva_${stamp}`.slice(0, 20), 'Music', { width: 1280, height: 900 });

  const videoFile = await makeVideo(A.page);
  const imageFile = await makeImage(A.page);

  // ===================== 1. no cover chosen at all =====================
  section('DEFAULT — publishing without choosing anything');
  await openStudio(A.page, videoFile);

  check('a "Choose cover" section is offered', (await A.page.locator('#cover-heading').count()) === 1);
  check(
    'with a frame scrubber and an upload option',
    (await A.page.locator('#thumbnail').count()) === 1 &&
      (await A.page.locator('label[for="cover-file"]').count()) >= 1,
  );

  const defaultId = await publish(A.page, `default cover ${stamp}`);
  const defaultPost = await postJson(A.page, defaultId);
  const defaultMedia = defaultPost?.post?.media?.[0] ?? defaultPost?.media?.[0];
  check(
    '1. a video publishes with no cover chosen',
    Boolean(defaultId) && Boolean(defaultMedia),
    defaultId,
  );
  check(
    '1b. and still gets a cover automatically',
    Boolean(defaultMedia?.poster),
    defaultMedia?.poster ?? 'none',
  );
  check(
    '1c. stored as its own file, not the video',
    defaultMedia?.poster !== defaultMedia?.url,
    `${defaultMedia?.poster} vs ${defaultMedia?.url}`,
  );

  // ===================== 2-3. picking a frame =====================
  section('FRAME — scrubbing to a different frame');
  await openStudio(A.page, videoFile);

  const frameAtStart = await A.page.getAttribute('img[data-cover-preview]', 'src');
  check('the preview starts on a frame', (await A.page.getAttribute('img[data-cover-preview]', 'data-cover-preview')) === 'frame');

  // Drag the scrubber to the far end; the fixture changes colour every second
  // so a later frame is a genuinely different picture.
  await A.page.locator('#thumbnail').evaluate((input) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, input.max);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(2500);
  const frameAtEnd = await A.page.getAttribute('img[data-cover-preview]', 'src');
  check('2. moving the scrubber selects a different frame', frameAtEnd !== frameAtStart);

  const frameId = await publish(A.page, `frame cover ${stamp}`);
  const framePost = await postJson(A.page, frameId);
  const frameMedia = framePost?.post?.media?.[0] ?? framePost?.media?.[0];
  check('3. the chosen frame is saved against the right post', Boolean(frameMedia?.poster), frameMedia?.poster);
  check('3b. and is a different file from the first post’s cover', frameMedia?.poster !== defaultMedia?.poster);

  // ============ 4-6, 11. a custom thumbnail ============
  section('CUSTOM — an image the creator supplies');
  await openStudio(A.page, videoFile);

  // Nothing may go to storage just because a cover was picked.
  const uploads = [];
  A.page.on('request', (request) => {
    // The endpoint that actually stores bytes. /api/upload/sign only asks
    // WHERE to put them, and would otherwise double every count.
    if (new URL(request.url()).pathname === '/api/upload' && request.method() === 'POST') {
      uploads.push(request.url());
    }
  });

  await A.page.setInputFiles('#cover-file', imageFile);
  await A.page.waitForFunction(
    () => document.querySelector('img[data-cover-preview]')?.dataset.coverPreview === 'custom',
    undefined,
    { timeout: 15000 },
  );
  check('4. an uploaded image becomes the cover preview', true);
  check(
    '6. and takes precedence over the frame',
    (await A.page.getAttribute('img[data-cover-preview]', 'data-cover-preview')) === 'custom',
  );

  // Replace it, then go back to a frame, then pick it again — still nothing stored.
  const second = await makeImage(A.page, '#FF3D9A');
  await A.page.setInputFiles('#cover-file', second);
  await wait(800);
  await A.page.locator('button', { hasText: /Use a frame instead/ }).first().click();
  await wait(1500);
  check(
    '6b. removing the custom cover falls back to a frame',
    (await A.page.getAttribute('img[data-cover-preview]', 'data-cover-preview')) === 'frame',
  );
  await A.page.setInputFiles('#cover-file', imageFile);
  await A.page.waitForFunction(
    () => document.querySelector('img[data-cover-preview]')?.dataset.coverPreview === 'custom',
    undefined,
    { timeout: 15000 },
  );

  check(
    '11. choosing, replacing and removing covers uploaded nothing',
    uploads.length === 0,
    `${uploads.length} upload(s) before publishing`,
  );

  const customId = await publish(A.page, `custom cover ${stamp}`);
  const customPost = await postJson(A.page, customId);
  const customMedia = customPost?.post?.media?.[0] ?? customPost?.media?.[0];
  check('5. the custom thumbnail is saved against the right post', Boolean(customMedia?.poster), customMedia?.poster);
  check('5b. it is a PNG, the file that was supplied', /\.png($|\?)/i.test(customMedia?.poster ?? ''), customMedia?.poster);
  check('5c. and is not the video file', customMedia?.poster !== customMedia?.url);
  check(
    '11b. exactly two files were stored for this post: the video and one cover',
    uploads.length === 2,
    `${uploads.length}`,
  );

  // ===================== 8-9. the video itself =====================
  section('THE VIDEO IS UNTOUCHED');
  check('9. the video file still exists after a cover was chosen', (await headStatus(A.page, customMedia.url)) === 200);
  check('9b. and the cover is a separate file that also exists', (await headStatus(A.page, customMedia.poster)) === 200);

  await A.page.goto(`/post/${customId}`, { waitUntil: 'domcontentloaded' });
  await A.page.waitForLoadState('networkidle');
  const videoEl = A.page.locator('video').first();
  check('8. the post plays the original video file', (await videoEl.getAttribute('src')) === customMedia.url, await videoEl.getAttribute('src'));
  check('8b. with the cover as its poster', (await videoEl.getAttribute('poster')) === customMedia.poster);

  // ===================== 7. everywhere a video is previewed ============
  section('THE COVER APPEARS EVERYWHERE A VIDEO IS SHOWN');
  const B = await createAccount(browser, `cvb_${stamp}`.slice(0, 20), 'Art', { width: 1280, height: 900 });

  /**
   * Is this cover on the page?
   *
   * Polls, because Discover and the rankings read a community snapshot that is
   * cached for a minute — a post can be live and correct and still not be on
   * that board yet. The check is about the cover, not about how quickly a
   * ranking turns over, so it waits rather than racing it.
   */
  const shows = async (who, label, url, expectPoster, budgetMs = 8000) => {
    const deadline = Date.now() + budgetMs;
    let found = false;
    do {
      await who.page.goto(url, { waitUntil: 'domcontentloaded' });
      await who.page.waitForLoadState('networkidle');
      found = await who.page.evaluate(
        (poster) =>
          [...document.querySelectorAll('video')].some((v) => v.getAttribute('poster') === poster) ||
          [...document.querySelectorAll('img')].some((i) =>
            (i.getAttribute('src') ?? '').includes(poster.split('/').pop()),
          ),
        expectPoster,
      );
      if (found) break;
      if (Date.now() < deadline) await wait(5000);
    } while (Date.now() < deadline);
    check(`7. ${label}`, found, url);
  };

  // Your own posts, on the surfaces that show them to you.
  await shows(A, 'Home / Following', '/home?tab=following', customMedia.poster);
  // A profile keeps videos on their own shelf now, so a video post is on
  // `?tab=videos` rather than on the profile's default (photo) shelf.
  await shows(A, 'the profile', `/u/${A.handle}?tab=videos`, customMedia.poster);
  await shows(A, 'Search', `/search?q=custom+cover+${stamp}`, customMedia.poster);

  // Recommended, Discover and the Videos feed deliberately leave YOUR posts
  // out, so these are checked from an account that did not make them.
  await shows(B, 'Recommended', '/home?tab=recommended', defaultMedia.poster);

  // Discover's default board is "Top rated", which a brand-new post has by
  // definition not earned a place on. Rating it is what puts it there, so the
  // check is about the cover rather than about the ranking.
  await B.page.goto(`/post/${defaultId}`, { waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  await B.page.locator('button', { hasText: 'Rate' }).first().click();
  await B.page.waitForTimeout(600);
  await B.page.locator('button', { hasText: /^9$/ }).first().click();
  await B.page.locator('button', { hasText: /^(Rate|Submit|Done|Save)/ }).last().click();
  await B.page.waitForTimeout(2000);
  // Scoped to the post's own category. Discover ranks by community rating, so
  // on a site with hundreds of rated posts a brand-new one is not entitled to
  // a slot on the unfiltered board — that is the ranking working, not a cover
  // that failed to appear. Inside its own category the pool is small enough
  // for the check to be about the cover.
  await shows(B, 'Discover', `/discover?category=${COVER_CATEGORY}`, defaultMedia.poster, 90000);
  await shows(B, 'the Videos feed', '/videos', defaultMedia.poster);
  await shows(B, 'another account\u2019s profile', `/u/${A.handle}?tab=videos`, customMedia.poster);

  // ===================== 10. somebody else's cover =====================
  section('SECURITY');
  await B.page.goto(`/post/${customId}`, { waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  check(
    '10. another account is offered no way to change the cover',
    (await B.page.locator('#cover-heading, #cover-file, #thumbnail').count()) === 0,
  );
  const afterVisit = await postJson(B.page, customId);
  const afterMedia = afterVisit?.post?.media?.[0] ?? afterVisit?.media?.[0];
  check('10b. and the cover is unchanged', afterMedia?.poster === customMedia.poster);

  // ===================== the phone =====================
  section('PHONE 390x844');
  const P = await createAccount(browser, `cvp_${stamp}`.slice(0, 20), 'Tech', { width: 390, height: 844 });
  await openStudio(P.page, videoFile);
  const box = await P.page.locator('#cover-heading').boundingBox();
  check('the cover section is visible on a phone', Boolean(box) && box.width > 0, JSON.stringify(box));
  const slider = await P.page.locator('#thumbnail').boundingBox();
  check(
    'the frame scrubber is a usable size for a thumb',
    Boolean(slider) && slider.height >= 32 && slider.width > 100,
    JSON.stringify(slider),
  );
  const overflow = await P.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('and nothing overflows the screen', overflow <= 1, `${overflow}px`);
  await P.page.setInputFiles('#cover-file', imageFile);
  await P.page.waitForFunction(
    () => document.querySelector('img[data-cover-preview]')?.dataset.coverPreview === 'custom',
    undefined,
    { timeout: 15000 },
  );
  check('a custom cover can be chosen on a phone too', true);

  await browser.close();
}

await run();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
