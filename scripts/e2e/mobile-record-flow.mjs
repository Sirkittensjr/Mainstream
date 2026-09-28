/**
 * Recording a video on a phone, end to end, at phone size.
 *
 * The flow this walks is the one somebody holding a phone actually walks:
 *
 *   Create -> Video -> Record -> switch camera -> record -> stop
 *     -> watch it back -> re-record -> watch it back -> keep it
 *     -> pick a cover off the scrubber -> caption -> content warning -> Post
 *     -> it is in the feed and in the Videos feed
 *
 * Chromium's fake camera and microphone stand in for the lens, so getUserMedia,
 * the permission prompt, MediaRecorder, the audio track, the TUS upload and the
 * post are all the real code paths.
 *
 * The check that matters most here is the one about transcoding. An untouched
 * recording must upload the bytes the camera produced; re-encoding it in the
 * browser costs a real-time pass — two more minutes on a two-minute video — to
 * arrive back at something the upload routes already accepted. That is
 * observable from outside: "Preparing your video…" is the render pass, and it
 * must never appear for a recording nobody edited.
 *
 *   node scripts/e2e/mobile-record-flow.mjs
 *
 * Needs the GoTrue stub, a built app, and Playwright — same setup as
 * video-flow.mjs, minus the fixtures (nothing is uploaded from disk here).
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

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

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return [...rows].reverse().find((mail) => mail.type === 'signup' && mail.to === email)?.link;
}

/** Drags a range input to a value, the way a thumb would. */
async function setRange(input, value) {
  await input.evaluate((element, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function phoneAccount(browser, handle) {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    // A Chromium-flavoured phone: the iPhone descriptor's WebKit user agent on
    // a Chromium engine would be a lie the app might behave differently for,
    // and the point here is the viewport and the touch input.
    userAgent: undefined,
    baseURL: BASE,
    permissions: ['camera', 'microphone'],
  });
  const page = await context.newPage();
  const email = `${handle}@example.com`;
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]').first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/verify-email/, { timeout: 25000 });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, email, handle };
}

/** Records for `seconds`, then stops and waits for the review screen. */
async function record(page, seconds) {
  await page.locator('button[aria-label="Start recording"]').click();
  await page.waitForSelector('button[aria-label="Stop recording"]', { timeout: 15000 });
  await wait(seconds * 1000);
  await page.locator('button[aria-label="Stop recording"]').click();
  await page.waitForSelector('video[data-recorder-playback]', { timeout: 15000 });
}

/** How far down the page anything overflows sideways — 0 on a good phone layout. */
const sideways = (page) =>
  page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  );

async function run() {
  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const stamp = Date.now().toString(36).slice(-6);
  const me = await phoneAccount(browser, `rec_${stamp}`);
  const { page } = me;

  /* ===================== getting to the camera ===================== */
  section('CREATE -> VIDEO -> CAMERA, ON A PHONE');

  // Through the bottom navigation, the way somebody on a phone gets there.
  await page.goto('/home', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  // `:visible` matters: the desktop sidebar's link to /create is in the DOM at
  // phone width too, just hidden, and it is the first match without this.
  await page.locator('a[href="/create"]:visible').first().click();
  await page.waitForURL(/\/create/, { timeout: 15000 });
  check('the + in the bottom navigation opens Create', true, page.url());
  check('Create fits the phone screen', (await sideways(page)) === 0, `${await sideways(page)}px`);

  await page.locator('button[role=tab]', { hasText: 'Video' }).click();
  await page.waitForTimeout(400);
  check(
    'the Post tab is still there beside it',
    (await page.locator('button[role=tab]', { hasText: 'Post' }).count()) === 1,
  );

  // Recording leads on a phone; choosing a file is still offered.
  const recordButton = page.locator('button', { hasText: 'Record a video' });
  const fileButton = page.locator('button', { hasText: 'Choose a file' });
  check('Record is offered', (await recordButton.count()) === 1);
  check('and so is choosing a file, on a phone too', (await fileButton.count()) === 1);
  const order = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const find = (text) => buttons.find((b) => b.textContent.trim() === text);
    const rec = find('Record a video');
    const file = find('Choose a file');
    if (!rec || !file) return null;
    return rec.getBoundingClientRect().top <= file.getBoundingClientRect().top ? 'record' : 'file';
  });
  check('and Record comes first on a phone', order === 'record', String(order));
  check(
    'Record is a comfortable tap target',
    await recordButton.evaluate((b) => b.getBoundingClientRect().height >= 44),
  );

  await recordButton.click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  check('the camera opens', true);
  check('the camera fills the screen without overflowing', (await sideways(page)) === 0);

  /* ========================== the camera ========================== */
  section('CAMERA CONTROLS');

  const timer = page.locator('span.tabular-nums').first();
  check('a time budget is shown before recording', /left/.test(await timer.innerText()), (await timer.innerText()).trim());
  check(
    'it is the 2-minute maximum',
    /^2:00 left$/.test((await timer.innerText()).trim()),
    (await timer.innerText()).trim(),
  );

  const switchButton = page.locator('button[aria-label="Switch camera"]');
  check('the camera can be switched', (await switchButton.count()) === 1);
  await switchButton.click();
  await page.waitForTimeout(1500);
  check(
    'switching keeps the camera open rather than dropping it',
    (await page.locator('button[aria-label="Start recording"]').count()) === 1,
  );

  for (const label of ['Close the camera', 'Switch camera', 'Start recording']) {
    const size = await page
      .locator(`button[aria-label="${label}"]`)
      .evaluate((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height));
    check(`"${label}" is at least 44px`, size >= 44, `${Math.round(size)}px`);
  }

  // The record button must not be under the home indicator. The iPhone 13
  // descriptor has no inset in headless Chromium, so what this can check is
  // that the control sits inside the viewport with room to spare.
  const bottomGap = await page
    .locator('button[aria-label="Start recording"]')
    .evaluate((b) => window.innerHeight - b.getBoundingClientRect().bottom);
  check('the record button is clear of the bottom edge', bottomGap >= 8, `${Math.round(bottomGap)}px`);

  await record(page, 3);
  check('recording stops and the take is shown back', true);

  /* ========================== the review ========================== */
  section('WATCH IT BACK, THEN RE-RECORD');

  const playback = page.locator('video[data-recorder-playback]');
  check('the take is on screen', (await playback.count()) === 1);
  const takeLength = await playback.evaluate((v) => v.duration);
  check(
    'and it is about as long as it was recorded for',
    !Number.isFinite(takeLength) || (takeLength > 1 && takeLength < 9),
    String(takeLength),
  );

  // Play, then pause. A recording's duration is Infinity until the browser has
  // been made to work one out, and until then the element will not play — so the
  // tap handler settles it first and this waits for that to happen.
  await page.locator('button[aria-label="Play"]').click();
  await page.waitForFunction(
    () => {
      const video = document.querySelector('video[data-recorder-playback]');
      return Boolean(video && !video.paused && video.currentTime > 0);
    },
    undefined,
    { timeout: 10000 },
  ).catch(() => undefined);
  check(
    'it plays',
    await playback.evaluate((v) => !v.paused && v.currentTime > 0),
    `paused=${await playback.evaluate((v) => v.paused)} t=${await playback.evaluate((v) => v.currentTime.toFixed(2))} duration=${await playback.evaluate((v) => String(v.duration))}`,
  );
  check(
    'and its length is known by then, not Infinity',
    await playback.evaluate((v) => Number.isFinite(v.duration) && v.duration > 0),
    String(await playback.evaluate((v) => v.duration)),
  );
  await page.locator('button[aria-label="Pause"]').click();
  await wait(300);
  check('and pauses', await playback.evaluate((v) => v.paused));

  // The camera light must be off while watching a take back.
  check(
    'the camera is released while the take is being watched',
    await page.evaluate(() => {
      const live = document.querySelector('video:not([data-recorder-playback])');
      return !live || !live.srcObject;
    }),
  );

  // Re-record: the first take is thrown away and the camera comes back.
  await page.locator('button', { hasText: 'Re-record' }).click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  check('Re-record goes back to the camera', true);
  await record(page, 3);
  check('and a second take can be made', (await playback.count()) === 1);

  await page.locator('button', { hasText: 'Use this video' }).click();
  await page.waitForTimeout(1500);
  check(
    'keeping it leaves the camera and lands on the posting screen',
    (await page.locator('button[aria-label="Start recording"]').count()) === 0,
  );
  check(
    'only the one take was kept',
    !/2 clips/.test(await page.locator('body').innerText()),
    'the discarded take is not in the list',
  );

  /* ========================== cover + caption ========================== */
  section('COVER, CAPTION, CONTENT WARNING');

  await page.waitForSelector('#thumbnail', { timeout: 20000 });
  check('the cover scrubber is there for a recording', true);
  const firstCover = await page.locator('[data-cover-preview]').getAttribute('src');
  await setRange(page.locator('#thumbnail'), 1.5);
  await page.waitForTimeout(1800);
  const secondCover = await page.locator('[data-cover-preview]').getAttribute('src');
  check(
    'scrubbing changes the cover frame',
    Boolean(firstCover && secondCover && firstCover !== secondCover),
  );
  check(
    'and a custom thumbnail can still be uploaded instead',
    (await page.locator('label[for="cover-file"]').count()) >= 1,
  );
  check(
    'the cover scrubber is thumb-sized',
    await page.locator('#thumbnail').evaluate((i) => i.getBoundingClientRect().height >= 40),
  );

  const title = `Phone take ${stamp}`;
  await page.fill('#video-title', title);
  await page.fill('#video-caption', 'Recorded on a phone, in the browser.');
  check('the caption fields take text', (await page.inputValue('#video-title')) === title);
  check('the posting screen does not scroll sideways', (await sideways(page)) === 0);

  // The field being typed into has to stay on screen. The keyboard itself is
  // not simulable here, so what this checks is that focusing the field brings it
  // into view rather than leaving it off the bottom of the page.
  await page.locator('#video-caption').focus();
  await page.waitForTimeout(400);
  const visible = await page.locator('#video-caption').evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight + 1;
  });
  check('the caption field is in view when focused', visible);

  await page.locator('#video-content-warning').check();
  check('the content warning can be set', await page.locator('#video-content-warning').isChecked());

  /* ========================== the upload ========================== */
  section('UPLOAD AND POST');

  // Every request the upload makes, so the route taken can be proved rather
  // than assumed.
  const calls = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/\/api\/upload/.test(url) || /\/upload\/resumable/.test(url)) {
      calls.push(`${request.method()} ${url.replace(BASE, '')}`);
    }
  });
  // The render pass announces itself. For an untouched recording it must not run.
  let sawPreparing = false;
  const watchLabel = setInterval(async () => {
    try {
      if (/Preparing your video/i.test(await page.locator('body').innerText())) sawPreparing = true;
    } catch {
      /* the page navigated */
    }
  }, 250);

  await page.locator('button', { hasText: 'Post video' }).click();
  await page.waitForURL(/\/post\//, { timeout: 120000 });
  clearInterval(watchLabel);
  const postId = page.url().split('/post/')[1].split(/[?#]/)[0];
  check('the video posts', Boolean(postId), page.url());

  check(
    'an untouched recording was NOT re-encoded in the browser',
    !sawPreparing,
    'the render pass never ran',
  );
  check(
    'the upload asked the server where to put it',
    calls.some((call) => call.includes('POST /api/upload/sign')),
    calls.join(' | ') || 'no upload calls seen',
  );

  // Which route the server chose, read from its own answer rather than assumed.
  const mode = await page.evaluate(async () => {
    const response = await fetch('/api/upload/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'video/webm', size: 1024 }),
    });
    return (await response.json())?.mode ?? 'unknown';
  });
  check(
    'the server decides the upload route, and named one',
    ['post', 'resumable', 'direct'].includes(mode),
    `mode: ${mode}`,
  );
  // Where validation happens depends on the route the server chose: `commit`
  // re-reads an object that went straight to Storage, while `post` mode has the
  // bytes in hand and checks them inline. Asserting the wrong one for the mode
  // would be asserting the harness, not the product.
  const validated =
    mode === 'post'
      ? calls.some((call) => call === 'POST /api/upload')
      : calls.some((call) => call.includes('POST /api/upload/commit'));
  check(
    `and the bytes were validated server-side (${mode} route)`,
    validated,
    calls.join(' | '),
  );
  if (mode === 'resumable') {
    check(
      'a resumable ticket was used for the TUS endpoint, not a one-shot POST',
      calls.some((call) => /\/upload\/resumable/.test(call)) &&
        !calls.some((call) => call === 'POST /api/upload'),
      calls.join(' | '),
    );
  } else {
    console.log(
      `SKIP  TUS resumable upload — this deployment answered "${mode}" because it has no\n` +
        '      Supabase Storage bucket. The resumable branch needs a real one; it is\n' +
        '      unchanged by this work and is covered by video-upload-flow.mjs.',
    );
  }

  /* ========================== where it ends up ========================== */
  section('IT IS AN ORDINARY POST');

  const body = await page.locator('body').innerText();
  check('the post page shows the title', body.includes(title));
  check('it carries the content warning', /content warning|sensitive|Show/i.test(body));
  check('a video element is on the page', (await page.locator('video').count()) >= 1);

  // Both feeds are checked from SOMEBODY ELSE's account, because neither of them
  // recommends you your own posts — `videoFeed` filters on
  // `post.author_id !== viewerId` on purpose. Looking as the author is a question
  // with no right answer, and a check that can only fail is not a check.
  const viewer = await phoneAccount(browser, `see_${stamp}`);

  // Retried rather than asserted once: the community feeds are served from a
  // 60-second cache (services/community-cache.ts), so "not yet" and "not there"
  // are different answers and only the second is a bug. The wait is reported.
  async function appears(find) {
    const started = Date.now();
    while (Date.now() - started < 90_000) {
      if (await find()) return Math.round((Date.now() - started) / 1000);
      await wait(4000);
      await viewer.page.reload({ waitUntil: 'domcontentloaded' });
      await viewer.page.waitForLoadState('networkidle');
    }
    return null;
  }

  await viewer.page.goto('/videos', { waitUntil: 'domcontentloaded' });
  await viewer.page.waitForLoadState('networkidle');
  const inVideos = await appears(async () => {
    const labels = await viewer.page
      .locator('section[data-index]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
    return labels.some((label) => label.includes(title));
  });
  check(
    'somebody else finds it in the Videos feed',
    inVideos !== null,
    inVideos === null ? 'not there after 90s' : `after ${inVideos}s`,
  );
  check('the Videos feed fits their phone', (await sideways(viewer.page)) === 0);
  check(
    'and it plays there behind its content warning',
    (await viewer.page.locator('video').count()) >= 1 ||
      /content warning|sensitive/i.test(await viewer.page.locator('body').innerText()),
  );

  await viewer.page.goto('/home?tab=recommended', { waitUntil: 'domcontentloaded' });
  await viewer.page.waitForLoadState('networkidle');
  const inHome = await appears(
    async () =>
      (await viewer.page.locator(`a[href*="/post/${postId}"]`).count()) > 0 ||
      (await viewer.page.locator('body').innerText()).includes(title),
  );
  check(
    'and in the normal feed',
    inHome !== null,
    inHome === null ? 'not there after 90s' : `after ${inHome}s`,
  );

  // And the post itself opens for them, content warning and all.
  await viewer.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await viewer.page.waitForLoadState('networkidle');
  const theirView = await viewer.page.locator('body').innerText();
  check('somebody else can open the post', theirView.includes(title));
  check('with the content warning in front of it', /content warning|sensitive|Show/i.test(theirView));

  /* ========================== desktop is untouched ========================== */
  section('THE DESKTOP FILE UPLOAD STILL WORKS');

  const desktop = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 900 },
    storageState: await me.context.storageState(),
  });
  const wide = await desktop.newPage();
  await wide.goto('/create', { waitUntil: 'domcontentloaded' });
  await wide.waitForLoadState('networkidle');
  await wide.locator('button[role=tab]', { hasText: 'Video' }).click();
  await wide.waitForTimeout(400);
  check(
    'the file picker is still offered on desktop',
    (await wide.locator('button', { hasText: 'Choose a file' }).count()) === 1,
  );
  check(
    'and it comes first there',
    await wide.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const find = (text) => buttons.find((b) => b.textContent.trim() === text);
      const rec = find('Record a video');
      const file = find('Choose a file');
      if (!rec || !file) return false;
      return file.getBoundingClientRect().left < rec.getBoundingClientRect().left;
    }),
  );
  check(
    'the hidden file input still accepts video files',
    await wide
      .locator('input[type=file][accept*="video"]')
      .first()
      .evaluate((i) => i.accept.includes('video/mp4')),
  );

  await browser.close();
}

await run();

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
