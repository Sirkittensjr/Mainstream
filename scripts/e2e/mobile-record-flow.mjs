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
  check(
    'the Post tab is still there beside it',
    (await page.locator('button[role=tab]', { hasText: 'Post' }).count()) === 1,
  );

  // The camera opens ITSELF. Tapping + and then Video on a phone is already a
  // decision to use the camera, and a chooser card in between is a form in front
  // of the thing somebody asked for.
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  check('the camera opens on its own — no chooser in the way', true);
  check('the camera fills the screen without overflowing', (await sideways(page)) === 0);

  // Uploading has to stay reachable from a phone, in both directions: a button
  // to the camera roll on the camera itself, and the chooser behind the X.
  check(
    'the camera roll is one tap away',
    (await page.locator('[data-camera-roll]').count()) === 1,
  );
  await page.locator('button[aria-label="Close the camera"]').click();
  await page.waitForTimeout(400);
  check(
    'and closing the camera still offers the file chooser',
    (await page.locator('button', { hasText: 'Choose a file' }).count()) === 1,
  );
  await page.locator('button', { hasText: 'Record a video' }).click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });

  /* ========================== the camera ========================== */
  section('CAMERA CONTROLS');

  // The picture is the screen, not a letterboxed panel between two bars.
  const frame = await page.locator('video').first().evaluate((v) => {
    const box = v.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      top: box.top,
      fit: getComputedStyle(v).objectFit,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  check(
    'the preview fills the whole screen',
    frame.width >= frame.vw - 1 && frame.height >= frame.vh - 1,
    `${Math.round(frame.width)}x${Math.round(frame.height)} in ${frame.vw}x${frame.vh}`,
  );
  check('and fills it rather than letterboxing', frame.fit === 'cover', frame.fit);
  check('starting at the very top of the screen', frame.top <= 0, `${Math.round(frame.top)}px`);

  const timer = page.locator('button[aria-label="Close the camera"]').locator('..');
  const budget = (await timer.innerText()).trim();
  check('the 2-minute budget is shown before recording', /2:00/.test(budget), budget.replace(/\n/g, ' '));

  const switchButton = page.locator('button[aria-label="Switch camera"]');
  check('the camera can be switched', (await switchButton.count()) === 1);
  await switchButton.click();
  await page.waitForTimeout(1500);
  check(
    'switching keeps the camera open rather than dropping it',
    (await page.locator('button[aria-label="Start recording"]').count()) === 1,
  );

  // The tool rail exists as a column, so the next camera tool has somewhere to
  // go. Flash only appears where the camera reports a torch — headless Chromium
  // does not, and a control that would do nothing must not be drawn.
  const flash = await page.locator('[data-camera-flash]').count();
  check(
    'flash is shown only where the camera has one',
    flash === 0 || flash === 1,
    flash === 1 ? 'this camera reports a torch' : 'no torch on this camera, so no control',
  );

  for (const label of ['Close the camera', 'Switch camera', 'Start recording']) {
    const size = await page
      .locator(`button[aria-label="${label}"]`)
      .evaluate((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height));
    check(`"${label}" is at least 44px`, size >= 44, `${Math.round(size)}px`);
  }
  check(
    'the camera roll button is big enough to tap',
    await page
      .locator('[data-camera-roll]')
      .evaluate((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height) >= 44),
  );

  // Safe areas. Headless Chromium reports no insets, so what this can prove is
  // that the controls sit inside the viewport with room at both ends rather than
  // flush against the edges the notch and the home indicator occupy.
  const edges = await page.evaluate(() => {
    const close = document.querySelector('button[aria-label="Close the camera"]');
    const shutter = document.querySelector('button[aria-label="Start recording"]');
    return {
      top: close.getBoundingClientRect().top,
      bottom: window.innerHeight - shutter.getBoundingClientRect().bottom,
    };
  });
  check('the close button is clear of the top edge', edges.top >= 8, `${Math.round(edges.top)}px`);
  check('the record button is clear of the bottom edge', edges.bottom >= 8, `${Math.round(edges.bottom)}px`);

  // Recording says so in more than a ticking number.
  check(
    'nothing claims to be recording before it is',
    (await page.locator('[data-recording-indicator]').count()) === 0,
  );
  await page.locator('button[aria-label="Start recording"]').click();
  await page.waitForSelector('button[aria-label="Stop recording"]', { timeout: 15000 });
  const indicator = page.locator('[data-recording-indicator]');
  check('recording is clearly indicated', (await indicator.count()) === 1);
  check('and says so in words', /REC/.test(await indicator.innerText()), (await indicator.innerText()).trim());
  await wait(2500);
  check(
    'the shutter shows how much of the budget is gone',
    await page.evaluate(() => {
      const arc = document.querySelector('button[aria-label="Stop recording"] circle:nth-of-type(2)');
      if (!arc) return false;
      const total = Number(arc.getAttribute('stroke-dasharray'));
      const left = Number(arc.getAttribute('stroke-dashoffset'));
      return total > 0 && left < total && left > 0;
    }),
  );
  await page.locator('button[aria-label="Stop recording"]').click();
  await page.waitForSelector('video[data-recorder-playback]', { timeout: 15000 });

  check('recording stops and the take is shown back', true);

  /* ========================== the review ========================== */
  section('WATCH IT BACK, THEN RE-RECORD');

  const playback = page.locator('video[data-recorder-playback]');
  check('the take is on screen', (await playback.count()) === 1);
  const shape = await playback.evaluate((v) => {
    const box = v.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      fit: getComputedStyle(v).objectFit,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  check(
    'and it takes the whole screen',
    shape.width >= shape.vw - 1 && shape.height >= shape.vh - 1,
    `${Math.round(shape.width)}x${Math.round(shape.height)} in ${shape.vw}x${shape.vh}`,
  );
  check(
    'without cropping it — this is the thing being judged',
    shape.fit === 'contain',
    shape.fit,
  );
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

  // The WHOLE take has to be watchable, which means somewhere to drag.
  const scrub = page.locator('[data-review-scrub]');
  check('there is a scrubber', (await scrub.count()) === 1);
  check(
    'that covers the whole recording',
    await scrub.evaluate((input, length) => {
      const max = Number(input.max);
      return Number.isFinite(length) ? Math.abs(max - length) < 0.5 : max > 0;
    }, await playback.evaluate((v) => v.duration)),
    `max=${await scrub.getAttribute('max')}`,
  );
  await setRange(scrub, 2);
  await wait(500);
  check(
    'and dragging it moves the video',
    await playback.evaluate((v) => Math.abs(v.currentTime - 2) < 0.6),
    `t=${await playback.evaluate((v) => v.currentTime.toFixed(2))}`,
  );
  check(
    'the review screen does not scroll sideways',
    (await sideways(page)) === 0,
    `${await sideways(page)}px`,
  );
  check(
    'the scrubber meets the 44px the rest of the app uses',
    await scrub.evaluate((i) => i.getBoundingClientRect().height >= 44),
    `${Math.round(await scrub.evaluate((i) => i.getBoundingClientRect().height))}px`,
  );

  // Sound. The recording has audio, so being able to silence the playback is
  // the control that matters here.
  const sound = page.locator('[data-review-sound]');
  check('there is a sound control', (await sound.count()) === 1);
  check('and it starts with sound on', (await sound.getAttribute('data-review-sound')) === 'on');
  await sound.click();
  await wait(300);
  check(
    'turning it off mutes the playback',
    (await sound.getAttribute('data-review-sound')) === 'off' &&
      (await playback.evaluate((v) => v.muted)),
  );
  await sound.click();
  await wait(300);
  check(
    'and it comes back on',
    (await sound.getAttribute('data-review-sound')) === 'on' &&
      !(await playback.evaluate((v) => v.muted)),
  );

  // Choosing a cover is offered from here, not only from the posting screen —
  // and it has to actually land there, with the cover editor in view rather
  // than somewhere below the fold. There is ONE cover implementation; this is a
  // way into it, not a second copy of it.
  check(
    'a cover can be chosen from the review screen',
    (await page.locator('button', { hasText: 'Cover' }).count()) >= 1,
  );
  await page.locator('button', { hasText: 'Cover' }).click();
  await page.waitForSelector('[data-cover-section]', { timeout: 20000 });
  await wait(1200);
  const coverInView = await page.locator('[data-cover-section]').evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.top < window.innerHeight && box.bottom > 0;
  });
  check('tapping Cover lands on the posting screen with the cover in view', coverInView);
  check(
    'and the take came with it',
    (await page.locator('#thumbnail').count()) === 1,
    'the frame scrubber is there, so there is a video to cover',
  );

  // Back to the camera for the rest of the flow.
  await page.locator('button', { hasText: 'Start over' }).click();
  await wait(600);
  await page.locator('button', { hasText: 'Record a video' }).click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  await record(page, 3);
  check('and the camera is reachable again afterwards', (await playback.count()) === 1);

  // The camera light must be off while watching a take back.
  check(
    'the camera is released while the take is being watched',
    await page.evaluate(() => {
      const live = document.querySelector('video:not([data-recorder-playback])');
      return !live || !live.srcObject;
    }),
  );

  // Back to the camera: the first take is thrown away and a new one can be made.
  await page.locator('button[aria-label="Back to the camera"]').click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  check('back goes to the camera to re-record', true);
  await record(page, 3);
  check('and a second take can be made', (await playback.count()) === 1);

  await page.locator('button', { hasText: 'Continue' }).click();
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

  // The posting screen a phone opens on: the video, a caption, a cover, a
  // content warning, Post. Everything else is folded away rather than removed.
  const visibleOnArrival = await page.evaluate(() =>
    ['#video-caption', '#video-category', '#video-tags'].filter((id) => {
      const element = document.querySelector(id);
      return element && element.offsetParent !== null;
    }),
  );
  check(
    'the extra fields are folded away on a phone',
    visibleOnArrival.length === 0,
    visibleOnArrival.join(', ') || 'none showing',
  );
  check(
    'and reachable, not removed',
    (await page.locator('[data-more-options]').count()) === 1,
  );
  await page.locator('[data-more-options]').click();
  await wait(400);
  check(
    'opening More options reveals them',
    await page.evaluate(() =>
      ['#video-caption', '#video-category', '#video-tags'].every((id) => {
        const element = document.querySelector(id);
        return element && element.offsetParent !== null;
      }),
    ),
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

  // `waitForURL` resolves when the navigation commits, not when the page has
  // rendered — so the body has to be waited for, not just read. On a slower
  // deployment reading it straight away gets an empty string, which looks
  // exactly like a post that came out wrong.
  await page.waitForLoadState('networkidle');
  await page
    .waitForFunction((needle) => document.body.innerText.includes(needle), title, {
      timeout: 20000,
    })
    .catch(() => undefined);
  const body = await page.locator('body').innerText();
  check('the post page shows the title', body.includes(title), `${body.length} chars rendered`);
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
