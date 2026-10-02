/**
 * Two clips, one video: the scenario the mobile editor used to get wrong.
 *
 *   record clip 1 -> Another -> record clip 2 -> Continue -> EDITOR
 *     -> clip 1 plays, then clip 2 starts on its own
 *     -> trim clip 1, the preview re-cuts
 *     -> trim clip 2, the preview re-cuts
 *     -> add text, it shows over the video
 *     -> Next -> POST -> the posted video is both trimmed clips, in order
 *
 * What it is really checking is that the editor treats several takes as ONE
 * project. Before this, `previewUrl` was null until a render had run, the editor
 * fell back to `clips[0].src`, and so only the first clip ever played and only
 * the first clip could be trimmed. The combined file was always correct —
 * `renderClips` walks the array in order — so the bug was entirely in what
 * somebody could see and reach before posting.
 *
 * Chromium's fake camera stands in for the lens, so getUserMedia,
 * MediaRecorder, the two-element player, the render pass and the upload are all
 * real code paths.
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/multi-clip-flow.mjs
 *
 * Needs the GoTrue stub, a built app and Playwright — same setup as
 * mobile-record-flow.mjs, which is where the single-clip camera is covered.
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

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Drags a range input to a value, the way a thumb would. */
async function setRange(input, value) {
  await input.evaluate((element, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** Which clip slot is on screen, and where its own file is. */
const playerState = (page) =>
  page.evaluate(() => {
    const slots = [...document.querySelectorAll('[data-clip-slot]')];
    const shown = slots.find((v) => Number(getComputedStyle(v).opacity) > 0.5);
    return {
      slots: slots.length,
      visible: shown ? Number(shown.dataset.clipSlot) : null,
      src: shown ? shown.currentSrc.slice(-12) : null,
      sourceTime: shown ? Number(shown.currentTime.toFixed(2)) : null,
      paused: shown ? shown.paused : null,
    };
  });

/** The scrubber's position, which is PROJECT time. */
const projectTime = (page) =>
  page.locator('[data-editor-timeline]').evaluate((i) => Number(i.value));

async function phoneAccount(browser, handle, device = 'iPhone 13') {
  const context = await browser.newContext({
    ...devices[device],
    // A Chromium-flavoured phone: a WebKit user agent on a Chromium engine is a
    // lie the app might behave differently for, and the point here is the
    // viewport and the touch input.
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
  const rows = readFileSync(OUTBOX, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const link = [...rows].reverse().find((mail) => mail.type === 'signup' && mail.to === email)?.link;
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

/** Records for `seconds` and waits for the review screen. */
async function record(page, seconds) {
  await page.locator('button[aria-label="Start recording"]').click();
  await page.waitForSelector('button[aria-label="Stop recording"]', { timeout: 15000 });
  await wait(seconds * 1000);
  await page.locator('button[aria-label="Stop recording"]').click();
  await page.waitForSelector('video[data-recorder-playback]', { timeout: 15000 });
}

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
  const me = await phoneAccount(browser, `mc_${stamp}`);
  const { page } = me;

  /* ===================== two clips, one project ===================== */
  section('RECORD TWO CLIPS');

  await page.goto('/create/video', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });

  await record(page, 4);
  check('the first take is shown back', true);
  await page.locator('[data-review-another]').click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 20000 });
  check('"Another" reopens the camera rather than going to the editor', true);

  await record(page, 3);
  await page.locator('[data-review-continue]').click();
  await page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  check('"Continue" after a second take opens the editor', true);

  /* ===================== the editor is the screen ===================== */
  section('A FULL-SCREEN 9:16 EDITOR');

  const frame = await page.evaluate(() => {
    const shell = document.querySelector('[data-editor-fullscreen]');
    const box = shell.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      vw: window.innerWidth,
      vh: window.innerHeight,
      position: getComputedStyle(shell).position,
    };
  });
  check(
    'the editor fills the viewport',
    frame.width >= frame.vw - 1 && frame.height >= frame.vh - 1 && frame.position === 'fixed',
    `${Math.round(frame.width)}x${Math.round(frame.height)} in ${frame.vw}x${frame.vh}`,
  );

  const picture = await page.evaluate(() => {
    const shown = [...document.querySelectorAll('[data-clip-slot]')].find(
      (v) => Number(getComputedStyle(v).opacity) > 0.5,
    );
    const box = shown.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      fit: getComputedStyle(shown).objectFit,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  check(
    'the video fills it too, rather than sitting in a card',
    picture.width >= picture.vw - 1 && picture.height >= picture.vh - 1,
    `${Math.round(picture.width)}x${Math.round(picture.height)}`,
  );
  check(
    'and is not stretched — the aspect ratio is preserved',
    picture.fit === 'contain',
    picture.fit,
  );
  check('the editor does not scroll sideways', (await sideways(page)) === 0);

  // The controls are over the video, not pushing it into a box.
  const overlaid = await page.evaluate(() => {
    const vh = window.innerHeight;
    const strip = document.querySelector('[data-editor-strip]')?.getBoundingClientRect();
    const tools = document.querySelector('[data-editor-tool="trim"]').getBoundingClientRect();
    const next = document.querySelector('[data-editor-next]').getBoundingClientRect();
    return {
      // Everything sits inside the viewport...
      inside: tools.bottom <= vh + 1 && next.top >= -1,
      // ...and the controls are in the lower part, leaving the middle to the video.
      low: tools.top > vh * 0.5,
      stripLow: strip ? strip.top > vh * 0.4 : true,
    };
  });
  check('the controls overlay the lower part of the screen', overlaid.inside && overlaid.low);
  check('and the clip strip with them', overlaid.stripLow);

  // The part of the picture somebody can still tap must really be clear of the
  // chrome. A tap region of the whole screen put its own centre under the editing
  // panel, so tapping the middle of the video hit a trim label.
  const tapZone = await page.evaluate(() => {
    const zone = document.querySelector('[data-editor-tap]').getBoundingClientRect();
    const chrome = document.querySelector('[data-editor-controls]').getBoundingClientRect();
    const middle = { x: zone.left + zone.width / 2, y: zone.top + zone.height / 2 };
    const hit = document.elementFromPoint(middle.x, middle.y);
    return {
      clear: zone.bottom <= chrome.top + 1,
      zoneBottom: Math.round(zone.bottom),
      chromeTop: Math.round(chrome.top),
      hitIsTheVideo: Boolean(hit && hit.closest('[data-editor-tap]')),
    };
  });
  check(
    'the tappable part of the video is clear of the controls',
    tapZone.clear,
    `tap zone ends at ${tapZone.zoneBottom}px, controls start at ${tapZone.chromeTop}px`,
  );
  check('and a tap in the middle of it reaches the video', tapZone.hitIsTheVideo);

  const two = await page.locator('[data-editor-clip]').count();
  check('both clips are in the strip', two === 2, `${two} clips`);
  check(
    'and the editor says it is two clips',
    /2 clips/.test(await page.locator('[data-editor-fullscreen]').innerText()),
  );

  /* ===================== gapless playback ===================== */
  section('CLIP 1 RUNS STRAIGHT INTO CLIP 2');

  check('there are two video elements, so the next clip can preload', (await playerState(page)).slots === 2);

  const first = await playerState(page);
  check('it starts on the first clip', first.sourceTime !== null, `slot ${first.visible}`);

  // Walk the project and watch the handover. Clip 1 is ~4s, clip 2 ~3s, so a
  // little past 4s the SECOND clip must be the one on screen — in a different
  // slot, from a different file.
  await page.locator('[data-editor-playpause]').click();
  await page.waitForFunction(
    () => {
      const input = document.querySelector('[data-editor-timeline]');
      return Number(input.value) > 0.4;
    },
    undefined,
    { timeout: 15000 },
  );
  check('playback advances', (await projectTime(page)) > 0.4, `${await projectTime(page)}s`);

  const crossed = await page
    .waitForFunction(
      (firstSlot) => {
        const slots = [...document.querySelectorAll('[data-clip-slot]')];
        const shown = slots.find((v) => Number(getComputedStyle(v).opacity) > 0.5);
        return shown && Number(shown.dataset.clipSlot) !== firstSlot;
      },
      first.visible,
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);
  const second = await playerState(page);
  check('the second clip takes over on its own', crossed, `slot ${first.visible} -> ${second.visible}`);
  check(
    'and it is a different file, not the same one replayed',
    second.src !== first.src,
    `${first.src} -> ${second.src}`,
  );
  check(
    'the handover happens near the join rather than late',
    (await projectTime(page)) < 6,
    `crossed at ${await projectTime(page)}s of the project`,
  );
  check('and it is playing, not stalled on a frame', second.paused === false);

  // Ends at the end of the LAST clip, and goes back to the top.
  await page.waitForFunction(
    () => document.querySelector('[data-editor-playpause]').getAttribute('aria-label') === 'Play',
    undefined,
    { timeout: 25000 },
  );
  check('the project ends after the last clip', (await projectTime(page)) < 0.6, 'back at the start');

  /* ===================== per-clip trimming ===================== */
  section('EACH CLIP TRIMS ON ITS OWN');

  const wholeProject = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));
  check('the scrubber covers the whole project', wholeProject > 5, `${wholeProject}s`);

  // Clip 1.
  await page.locator('[data-editor-clip="0"]').click();
  await wait(300);
  check(
    'tapping a clip selects it for trimming',
    (await page.locator('[data-editor-clip="0"]').getAttribute('aria-pressed')) === 'true',
  );
  check(
    'and the panel says which clip it is',
    /Clip 1 of 2/.test(await page.locator('[data-editor-panel="trim"]').innerText()),
  );
  const clipOneEnd = Number(await page.locator('[data-editor-trim="end"]').getAttribute('max'));
  await setRange(page.locator('[data-editor-trim="end"]'), Math.max(1, clipOneEnd - 2));
  await wait(700);
  const afterFirstTrim = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));
  check(
    'trimming clip 1 shortens the whole project',
    afterFirstTrim < wholeProject - 1,
    `${wholeProject}s -> ${afterFirstTrim}s`,
  );

  // Clip 2.
  await page.locator('[data-editor-clip="1"]').click();
  await wait(300);
  check(
    'the second clip can be selected and trimmed too',
    /Clip 2 of 2/.test(await page.locator('[data-editor-panel="trim"]').innerText()),
  );
  const clipTwoEnd = Number(await page.locator('[data-editor-trim="end"]').getAttribute('max'));
  await setRange(page.locator('[data-editor-trim="end"]'), Math.max(1, clipTwoEnd - 1.5));
  await wait(700);
  const afterSecondTrim = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));
  check(
    'trimming clip 2 shortens it again',
    afterSecondTrim < afterFirstTrim - 0.8,
    `${afterFirstTrim}s -> ${afterSecondTrim}s`,
  );

  // Selecting a clip jumps the preview to that clip, which is how somebody
  // knows which one they are cutting.
  await page.locator('[data-editor-clip="0"]').click();
  await wait(500);
  check('selecting clip 1 puts clip 1 on screen', (await projectTime(page)) < 0.3);
  await page.locator('[data-editor-clip="1"]').click();
  await wait(800);
  const atClipTwo = await projectTime(page);
  check(
    'and selecting clip 2 jumps to where clip 2 starts',
    atClipTwo > 0.3,
    `${atClipTwo}s into the project`,
  );

  // Still both clips, still in order.
  const order = await page
    .locator('[data-editor-clip]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.editorClip));
  check('both clips survive trimming, in order', JSON.stringify(order) === JSON.stringify(['0', '1']));

  /* ===================== text ===================== */
  section('TEXT OVER THE VIDEO');

  await page.locator('[data-editor-tool="text"]').click();
  await page.locator('[data-editor-add-text]').click();
  const overlayText = `two clips ${stamp}`;
  await page.locator('[data-editor-text-input]').fill(overlayText);
  await wait(400);
  check(
    'the text appears over the video as it is typed',
    (await page.locator('[data-video-text]').innerText()).includes(overlayText),
  );
  check(
    'and it is drawn in the editor variant, inset clear of the controls',
    (await page.locator('[data-video-text]').getAttribute('data-video-text-variant')) === 'editor',
  );

  // Clear of the controls is the point: positioning text you cannot see is not
  // positioning it.
  const clearOfChrome = await page.evaluate(() => {
    const text = document.querySelector('[data-video-text] p').getBoundingClientRect();
    const panel = document.querySelector('[data-editor-controls]').getBoundingClientRect();
    return { textBottom: text.bottom, panelTop: panel.top, clear: text.bottom <= panel.top + 1 };
  });
  check(
    'the text is not hidden behind the editing panel',
    clearOfChrome.clear,
    `text ends at ${Math.round(clearOfChrome.textBottom)}px, panel starts at ${Math.round(clearOfChrome.panelTop)}px`,
  );

  await page.locator('[data-editor-text-at="top"]').click();
  await wait(300);
  const moved = await page.evaluate(() => {
    const text = document.querySelector('[data-video-text] p').getBoundingClientRect();
    return { top: text.top, vh: window.innerHeight };
  });
  check('it can be moved up the frame', moved.top < moved.vh * 0.4, `${Math.round(moved.top)}px`);

  check(
    'text can be removed again',
    (await page.locator('[data-editor-text-remove]').count()) === 1,
  );

  /* ===================== the post screen ===================== */
  section('POSTING TWO TRIMMED CLIPS');

  await page.locator('[data-editor-next]').click();
  await page.waitForSelector('[data-post-stage]', { timeout: 20000 });

  // A real preview of the combined video, not a sentence describing it.
  const previewKind = await page.locator('[data-post-preview]').getAttribute('data-post-preview');
  check('the posting screen previews the video', previewKind !== null, `kind: ${previewKind}`);
  const shape = await page.locator('[data-post-preview]').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      ratio: box.width / box.height,
      width: box.width,
      height: box.height,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  check(
    // A real 9:16 window, not a short card. Driven by height with the width
    // following, because `aspectRatio` plus a `maxHeight` is not a 9:16 box — the
    // cap wins and the frame came out 0.84.
    'in a true 9:16 frame rather than a short card',
    Math.abs(shape.ratio - 9 / 16) < 0.04,
    `${shape.ratio.toFixed(3)} wide-to-tall, against ${(9 / 16).toFixed(3)}`,
  );
  check(
    // Tall, but not so tall that the caption and the Post button go below the
    // fold — this screen is a form as well as a preview.
    'tall enough to be the focus, short enough to leave room for the form',
    shape.height > shape.vh * 0.4 && shape.height < shape.vh * 0.75,
    `${Math.round(shape.height)}px of ${shape.vh}px`,
  );
  check('the posting screen does not scroll sideways', (await sideways(page)) === 0);

  const title = `Two clips ${stamp}`;
  await page.fill('#video-title', title);

  const postedUrl = await (async () => {
    await page.locator('[data-post-button]').click();
    await page.waitForURL(/\/post\//, { timeout: 180000 });
    return page.url();
  })();
  const postId = postedUrl.split('/post/')[1];
  check('a two-clip video posts', Boolean(postId), postedUrl);

  // The finished file: both clips, trimmed, in order. Asked of the app rather
  // than of a file, so this works on the local driver and the Supabase stubs.
  const stored = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/posts/${id}`);
    if (!response.ok) return null;
    const body = await response.json();
    return body?.post?.media?.[0] ?? null;
  }, postId);
  const expected = afterSecondTrim;
  check(
    'the posted video is as long as the two trimmed clips together',
    stored?.duration != null && Math.abs(stored.duration - expected) < 1.5,
    `stored ${stored?.duration}s against ${expected.toFixed(2)}s of kept clips`,
  );
  check(
    'and it is longer than either clip alone, so both are in it',
    stored?.duration != null && stored.duration > 1.2,
    `${stored?.duration}s`,
  );
  check(
    'the text overlay is kept on the post',
    Array.isArray(stored?.text) && stored.text.some((entry) => entry.text === overlayText),
    JSON.stringify(stored?.text ?? null),
  );

  await page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check(
    'the overlay is drawn on the posted video',
    (await page.locator('[data-video-text]').innerText()).includes(overlayText),
  );

  /* ===================== a smaller Android screen ===================== */
  section('A SMALLER ANDROID SCREEN');

  const android = await phoneAccount(browser, `an_${stamp}`, 'Galaxy S8');
  await android.page.goto('/create/video', { waitUntil: 'domcontentloaded' });
  await android.page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  await record(android.page, 2);
  await android.page.locator('[data-review-continue]').click();
  await android.page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  const small = await android.page.evaluate(() => {
    const shell = document.querySelector('[data-editor-fullscreen]').getBoundingClientRect();
    const tools = document.querySelector('[data-editor-tool="cover"]').getBoundingClientRect();
    return {
      fills: shell.width >= window.innerWidth - 1 && shell.height >= window.innerHeight - 1,
      toolsInside: tools.bottom <= window.innerHeight + 1,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  check('the editor fills a smaller phone too', small.fills, `${small.vw}x${small.vh}`);
  check('and every tool is still on screen', small.toolsInside);
  check('with no sideways scroll', (await sideways(android.page)) === 0);
  check(
    'one clip needs no clip strip',
    (await android.page.locator('[data-editor-strip]').count()) === 0,
    'nothing to choose between',
  );

  /* ===================== empty and error states ===================== */
  section('NOTHING TO EDIT');

  // The editor is only reachable with a clip. Arriving at the route fresh gives
  // the camera, and dropping the only take goes back to it rather than to an
  // editor with nothing in it.
  await android.page.locator('[data-editor-retake]').click();
  await android.page.waitForSelector('button[aria-label="Start recording"]', { timeout: 20000 });
  check('Retake on the only clip goes back to the camera', true);
  check(
    'and there is no empty editor behind it',
    (await android.page.locator('[data-editor-fullscreen]').count()) === 0,
  );

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
