/**
 * Three clips, one video: the scenario the mobile editor used to get wrong.
 *
 *   record 3s -> stop -> record 4s -> stop -> record 5s -> Next -> EDITOR
 *     -> clip 1 plays, then clip 2 starts on its own, then clip 3
 *     -> trim each clip in turn; the others survive and the preview re-cuts
 *     -> add text, it shows over the video
 *     -> Next -> POST -> the posted video is all three trimmed clips, in order,
 *        rendered 1080x1920
 *
 * What it is really checking is that the editor RECEIVES every take. The camera
 * accumulates them correctly — `addSource` appends functionally — but the editor
 * was handed `clip={clips[0]}` and `src={previewUrl ?? clips[0].src}`, where
 * `previewUrl` is null until a render has run. So it showed take one, offered one
 * set of trim handles, and said as much in its own panel. The combined file was always correct —
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

/**
 * Films one segment and comes back to the viewfinder.
 *
 * Stopping no longer ends the session: the camera stays open, ready for the next
 * segment, and Next is the only way out. So this waits for the shutter to go back
 * to "Start recording" rather than for a review screen.
 */
async function record(page, seconds) {
  await page.locator('button[aria-label="Start recording"]').click();
  await page.waitForSelector('button[aria-label="Stop recording"]', { timeout: 15000 });
  await wait(seconds * 1000);
  await page.locator('button[aria-label="Stop recording"]').click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 15000 });
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

  /* ===================== three clips, one project ===================== */
  section("RECORD THREE CLIPS: 3s, 4s, 5s");

  await page.goto('/create/video', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });

  await record(page, 3);
  check(
    'stopping the first segment keeps the camera, it does not leave it',
    (await page.locator('button[aria-label="Start recording"]').count()) === 1 &&
      (await page.locator('[data-editor-fullscreen]').count()) === 0,
  );
  await record(page, 4);
  await record(page, 5);
  // Waited for, not snapshotted: `record` returns when the recorder stopped,
  // which is before React has painted the clip it produced. Reading the counter
  // right then catches the previous render and says "2 clips" for a camera that
  // has three — a race in the asking, not in the camera.
  const filmed = await page
    .waitForFunction(
      () => {
        const text = document.querySelector('[data-camera-clips]')?.textContent ?? '';
        return /3 clips/i.test(text) ? text : false;
      },
      undefined,
      { timeout: 10000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(async () => (await page.locator('[data-camera-clips]').innerText()) || '');
  check('the camera counts all three', /3 clips/i.test(filmed), filmed.replace(/\n/g, ' '));

  await page.locator('[data-camera-next]').click();
  await page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  check('Next opens the editor', true);

  // The bug this suite exists for: the editor used to be handed `clips[0]` and a
  // `previewUrl` that is null until a render has run, so it showed take one and
  // nothing else.
  const inEditor = await page.locator('[data-editor-clip]').count();
  check('THE EDITOR HAS ALL THREE CLIPS, not just the first', inEditor === 3, `${inEditor} clips`);
  const lengths = await page
    .locator('[data-editor-clip]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.editorClip));
  check(
    'in the order they were filmed',
    JSON.stringify(lengths) === JSON.stringify(['0', '1', '2']),
    lengths.join(' -> '),
  );

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

  // THE BANDS. The editor is no longer a full-bleed video with the controls
  // floating over its lower third; it is five bands with the video as one of
  // them, so the picture is never covered by the thing editing it. What that
  // costs is width — a 9:16 box in the space left over is about 240px wide on a
  // 390px screen — and the gutters either side are where the cost shows up.
  //
  // The black band this replaced was a different thing entirely: the picture
  // laid across the whole screen with `object-contain`, fitted by width because
  // a 9:16 source is wider than a 0.46 screen, leaving ~150px of black above and
  // below. What is checked now is that the bands are in order and that the
  // picture meets its own box the way the render meets 1080x1920.
  const bands = await page.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      top: box('[data-editor-topbar]'),
      scrub: box('[data-editor-scrub]'),
      stage: box('[data-editor-stage]'),
      controls: box('[data-editor-controls]'),
      clips: box('[data-editor-strip]'),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  check(
    'the bands run top bar, filmstrip, video, tools, clips — in that order',
    bands.top.top <= 1 &&
      bands.scrub.top >= bands.top.bottom - 1 &&
      bands.stage.top >= bands.scrub.bottom - 1 &&
      bands.controls.top >= bands.stage.bottom - 1 &&
      bands.clips.top >= bands.controls.bottom - 1,
    [bands.top, bands.scrub, bands.stage, bands.controls, bands.clips]
      .map((b) => Math.round(b.top))
      .join(' -> '),
  );
  check(
    'and all of them fit the screen with nothing cut off',
    bands.clips.bottom <= bands.vh + 1,
    `clips end at ${Math.round(bands.clips.bottom)}px of ${bands.vh}px`,
  );
  check(
    'the video gets the largest band',
    bands.stage.height > bands.controls.height &&
      bands.stage.height > bands.clips.height &&
      bands.stage.height > bands.scrub.height,
    `video ${Math.round(bands.stage.height)}px, tools ${Math.round(
      bands.controls.height,
    )}px, clips ${Math.round(bands.clips.height)}px`,
  );

  const picture = await page.evaluate(() => {
    const shown = [...document.querySelectorAll('[data-clip-slot]')].find(
      (v) => Number(getComputedStyle(v).opacity) > 0.5,
    );
    const box = shown.getBoundingClientRect();
    const source = shown.videoWidth / shown.videoHeight;
    const drawn = box.width / source / box.height;
    return {
      ratio: box.width / box.height,
      width: box.width,
      height: box.height,
      fit: getComputedStyle(shown).objectFit,
      crop: Number.isFinite(drawn) ? Math.max(0, 1 - 1 / Math.max(1, drawn)) : 1,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  check(
    // The box IS the output frame, so what is on screen is the shape that gets
    // posted — not a 16:9 file in a 9:16 container.
    'the video sits in a true 9:16 box',
    Math.abs(picture.ratio - 9 / 16) < 0.02,
    `${picture.ratio.toFixed(3)} wide-to-tall, against ${(9 / 16).toFixed(3)}`,
  );
  check(
    'which is as tall as the band allows',
    picture.height >= bands.stage.height - 20,
    `${Math.round(picture.width)}x${Math.round(picture.height)} in a ${Math.round(
      bands.stage.height,
    )}px band`,
  );
  check(
    // Same rule `outputFrame` renders with, so a landscape recording is
    // centre-cropped here exactly as it will be in the file.
    'and meets it the same way the render does — cropped, never stretched',
    picture.fit === 'cover',
    picture.fit,
  );
  check(
    'with next to nothing lost to the crop, because the shapes match',
    picture.crop <= 0.02,
    `${Math.round(picture.crop * 100)}% of the frame's height cropped`,
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
  check('the controls sit in the lower part of the screen', overlaid.inside && overlaid.low);
  check('and the clip timeline with them', overlaid.stripLow);

  // The complaint this replaced: a floating 'Clip 2 of 2 / Keeping 0:03.6' panel
  // took over the middle of the screen. A tool's controls are now a short strip
  // under the timeline, inside the toolbar, and never over the video.
  const sheet = await page.evaluate(() => {
    const panel = document.querySelector('[data-editor-panel]').getBoundingClientRect();
    const stage = document.querySelector('[data-editor-stage]').getBoundingClientRect();
    return {
      top: panel.top,
      height: panel.height,
      stageBottom: stage.bottom,
      vh: window.innerHeight,
    };
  });
  check(
    'the tool controls are a strip below the video, not a sheet over it',
    sheet.top >= sheet.stageBottom - 1,
    `panel starts at ${Math.round(sheet.top)}px, video ends at ${Math.round(sheet.stageBottom)}px`,
  );
  check(
    'and a short one — it does not take over the screen',
    sheet.height <= sheet.vh * 0.3,
    `${Math.round(sheet.height)}px of ${sheet.vh}px`,
  );

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

  const inStrip = await page.locator('[data-editor-clip]').count();
  check('all three clips are in the strip', inStrip === 3, `${inStrip} clips`);
  check(
    'and the editor says which of them is open',
    /Clip \d of 3/.test(await page.locator('[data-editor-panel="trim"]').innerText()),
    (await page.locator('[data-editor-panel="trim"]').innerText()).split('\n')[0],
  );
  check(
    'with the clock over the video rather than buried in the controls',
    /\d:\d\d(\.\d)? \/ \d:\d\d/.test(await page.locator('[data-editor-time]').innerText()),
    (await page.locator('[data-editor-time]').innerText()).replace(/\n/g, ' '),
  );

  // The clips are drawn as their own FRAMES. A strip of numbered grey boxes is a
  // form; this is how somebody picks the clip they mean, by recognising it.
  const painted = await page
    .waitForFunction(
      () => {
        const tiles = [...document.querySelectorAll('[data-editor-clip]')];
        const withFrames = tiles.filter((tile) =>
          [...tile.querySelectorAll('span')].some((span) =>
            getComputedStyle(span).backgroundImage.startsWith('url('),
          ),
        );
        return withFrames.length === tiles.length ? withFrames.length : false;
      },
      undefined,
      { timeout: 25000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => 0);
  check('every clip in the strip shows a frame of itself', painted === 3, `${painted} of 3`);
  check(
    // Six frames across the open clip's whole source, so the part being cut away
    // is visible rather than implied.
    'and the open one is a filmstrip of its whole source',
    (await page.locator('[data-editor-track] > span:first-child > span').count()) >= 4,
    `${await page.locator('[data-editor-track] > span:first-child > span').count()} frames`,
  );

  const plus = await page.locator('[data-editor-add-clip]').boundingBox();
  check(
    'another clip can be added from the timeline itself',
    Boolean(plus) && plus.height >= 44 && plus.width >= 40,
    plus ? `${Math.round(plus.width)}x${Math.round(plus.height)}` : 'missing',
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
    /Clip 1 of 3/.test(await page.locator('[data-editor-panel="trim"]').innerText()),
  );
  // Trimming without opening anything: the selected clip opens out to its whole
  // source length right there on the timeline and carries a handle at each end.
  check(
    'the selected clip carries its trim handles on the timeline itself',
    (await page.locator('[data-editor-handle]').count()) === 2,
  );
  check(
    'and the other clips stay beside it rather than disappearing behind a modal',
    (await page.locator('[data-editor-clip]').count()) === 3,
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
    /Clip 2 of 3/.test(await page.locator('[data-editor-panel="trim"]').innerText()),
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

  // Trimming one clip must not cost the others. This is step 11 and 13 of the
  // scenario: after cutting clip 1, clips 2 and 3 are still there; after cutting
  // clip 2, clips 1 and 3 are still there.
  const order = await page
    .locator('[data-editor-clip]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.editorClip));
  check(
    'all three clips survive trimming, in order',
    JSON.stringify(order) === JSON.stringify(['0', '1', '2']),
    order.join(' -> '),
  );

  // Clip 3 trims as well, so the third is not a passenger.
  await page.locator('[data-editor-clip="2"]').click();
  await wait(300);
  check(
    'the third clip can be selected and trimmed',
    /Clip 3 of 3/.test(await page.locator('[data-editor-panel="trim"]').innerText()),
  );
  const beforeThird = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));
  const clipThreeEnd = Number(await page.locator('[data-editor-trim="end"]').getAttribute('max'));
  await setRange(page.locator('[data-editor-trim="end"]'), Math.max(1, clipThreeEnd - 1));
  await wait(700);
  const afterThird = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));
  check(
    'and the project is shorter again',
    afterThird < beforeThird - 0.5,
    `${beforeThird}s -> ${afterThird}s`,
  );
  check(
    'with all three still present',
    (await page.locator('[data-editor-clip]').count()) === 3,
  );

  // And the handles really trim, not just decorate. Drag clip 1's start handle a
  // third of the way across its track and the project gets shorter, without any
  // panel being opened to do it.
  await page.locator('[data-editor-clip="0"]').click();
  await wait(300);
  const beforeDrag = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));
  const grip = await page.locator('[data-editor-handle="start"]').boundingBox();
  // The inner rail, not the clip button: the rail is inset by a handle's
  // half-width so the grips stay on the clip, so the button's edges are not 0s
  // and the whole source.
  const rail = await page.locator('[data-editor-track]').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  // In steps, because one jump can be delivered as a single pointermove that
  // lands before the handler has the track measured.
  for (const part of [0.1, 0.2, 0.3]) {
    await page.mouse.move(rail.x + rail.width * part, grip.y + grip.height / 2);
    await wait(80);
  }
  await page.mouse.up();
  await wait(700);
  const afterDrag = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));
  check(
    'dragging a trim handle on the timeline cuts the clip',
    afterDrag < beforeDrag - 0.2,
    `${beforeDrag}s -> ${afterDrag}s`,
  );
  check(
    'and nothing was opened over the video to do it',
    (await page.locator('[data-editor-clip]').count()) === 3 &&
      (await page.evaluate(() => {
        const stage = document.querySelector('[data-editor-stage]').getBoundingClientRect();
        const hit = document.elementFromPoint(
          stage.left + stage.width / 2,
          stage.top + stage.height / 2,
        );
        return Boolean(hit && hit.closest('[data-editor-stage]'));
      })),
  );

  /* ===================== text ===================== */
  section('TEXT OVER THE VIDEO');

  await page.locator('[data-editor-tool="text"]').click();
  await page.locator('[data-editor-add-text]').click();
  const overlayText = `three clips ${stamp}`;
  await page.locator('[data-editor-text-input]').fill(overlayText);
  await wait(400);
  check(
    'the text appears over the video as it is typed',
    (await page.locator('[data-video-text]').innerText()).includes(overlayText),
  );
  check(
    // The variant now says whether the words can be EDITED, not which insets
    // they use: a line is placed by its own coordinates, so there is one set of
    // numbers and they mean the same thing in the editor as in the feed. In the
    // editor the lines take taps and drags; everywhere else they take nothing,
    // so a tap on a post's text still reaches the player underneath.
    'and the words here are editable, unlike the ones on a post',
    (await page.locator('[data-video-text]').getAttribute('data-video-text-variant')) === 'editor',
  );

  // Clear of the controls is the point: positioning text you cannot see is not
  // positioning it.
  const clearOfChrome = await page.evaluate(() => {
    const text = document.querySelector('[data-video-text-line]').getBoundingClientRect();
    const panel = document.querySelector('[data-editor-controls]').getBoundingClientRect();
    return { textBottom: text.bottom, panelTop: panel.top, clear: text.bottom <= panel.top + 1 };
  });
  check(
    'the text is not hidden behind the editing panel',
    clearOfChrome.clear,
    `text ends at ${Math.round(clearOfChrome.textBottom)}px, panel starts at ${Math.round(clearOfChrome.panelTop)}px`,
  );

  // FREE PLACEMENT. There are no Top/Middle/Bottom stops any more: a line starts
  // in the middle of the frame and is dragged to wherever it is wanted, which is
  // usually beside whatever it is pointing at.
  const line = page.locator('[data-video-text-line="0"]');
  const started = await line.boundingBox();
  const box9x16 = await page.locator('[data-editor-stage]').boundingBox();
  check(
    'a new line starts in the middle of the frame',
    Math.abs(started.y + started.height / 2 - (box9x16.y + box9x16.height / 2)) < box9x16.height * 0.08,
    `${Math.round(started.y + started.height / 2)}px against a frame centred at ${Math.round(
      box9x16.y + box9x16.height / 2,
    )}px`,
  );
  check(
    'and the old Top/Middle/Bottom stops are gone',
    (await page.locator('[data-editor-text-at]').count()) === 0,
  );

  // Dragged up and to the left, by a pointer, exactly as a thumb would.
  await page.mouse.move(started.x + started.width / 2, started.y + started.height / 2);
  await page.mouse.down();
  for (const step of [0.4, 0.3, 0.22]) {
    await page.mouse.move(box9x16.x + box9x16.width * 0.35, box9x16.y + box9x16.height * step);
    await wait(60);
  }
  await page.mouse.up();
  await wait(400);
  const dragged = await line.boundingBox();
  check(
    'and it can be dragged anywhere on the video — up',
    dragged.y + dragged.height / 2 < started.y + started.height / 2 - 20,
    `${Math.round(started.y)}px -> ${Math.round(dragged.y)}px`,
  );
  check(
    'and sideways, which the three stops never allowed',
    Math.abs(dragged.x - started.x) > 10,
    `${Math.round(started.x)}px -> ${Math.round(dragged.x)}px`,
  );

  // Dragged hard at a corner, it stops at the edge rather than leaving the frame.
  await page.mouse.move(dragged.x + dragged.width / 2, dragged.y + dragged.height / 2);
  await page.mouse.down();
  await page.mouse.move(box9x16.x - 400, box9x16.y - 400);
  await wait(80);
  await page.mouse.up();
  await wait(400);
  const shoved = await line.boundingBox();
  check(
    'but it cannot be pushed off the frame altogether',
    shoved.x + shoved.width > box9x16.x + 4 && shoved.y + shoved.height > box9x16.y + 4,
    `line at ${Math.round(shoved.x)},${Math.round(shoved.y)} in a frame at ${Math.round(
      box9x16.x,
    )},${Math.round(box9x16.y)}`,
  );

  // Editing a line by tapping the line itself, which is where somebody looks.
  check(
    'the words on the video are tappable while Text is open',
    (await page.locator('[data-video-text-pick]').count()) === 1,
  );
  await page.locator('[data-video-text-pick="0"]').click();
  await wait(250);
  check(
    'and tapping one opens that line for editing',
    (await page.locator('[data-editor-overlay="0"]').getAttribute('data-editor-overlay-picked')) ===
      'true',
  );

  check(
    'text can be removed again',
    (await page.locator('[data-editor-text-remove]').count()) === 1,
  );

  /* ===================== a line that comes and goes ===================== */
  section('TEXT HAS ITS OWN START AND END');

  // With a line open, the filmstrip stops being the clip and becomes the whole
  // project — because "when does this show" is a question about the finished
  // video, which one clip's strip cannot answer.
  check(
    'the open line gets handles on the timeline',
    (await page.locator('[data-editor-text-handle]').count()) === 2,
  );
  const whole = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));
  check(
    'a line shows for the whole video until it is timed',
    /0:00\.0.0:\d\d/.test(await page.locator('[data-editor-text-window="0"]').innerText()),
    (await page.locator('[data-editor-text-window="0"]').innerText()).replace(/\n/g, ' '),
  );

  // Drag the start handle a third of the way in.
  const textRail = await page.locator('[data-editor-track]').boundingBox();
  const fromGrip = await page.locator('[data-editor-text-handle="from"]').boundingBox();
  await page.mouse.move(fromGrip.x + fromGrip.width / 2, fromGrip.y + fromGrip.height / 2);
  await page.mouse.down();
  for (const part of [0.15, 0.25, 0.33]) {
    await page.mouse.move(textRail.x + textRail.width * part, fromGrip.y + fromGrip.height / 2);
    await wait(70);
  }
  await page.mouse.up();
  await wait(500);
  const timed = await page.evaluate(() => {
    const node = document.querySelector('[data-editor-text-handle="from"]');
    return Number(node.getAttribute('aria-valuenow'));
  });
  check(
    'dragging a handle moves when the line starts',
    timed > 0.5 && timed < whole,
    `starts at ${timed.toFixed(2)}s of ${whole.toFixed(2)}s`,
  );

  // And the preview obeys it: before the start, the line is not drawn.
  await setRange(page.locator('[data-editor-timeline]'), 0);
  await wait(500);
  check(
    'the line is NOT on the video before its start',
    (await page.locator('[data-video-text-line="0"]').count()) === 0,
    `playhead at 0s, line starts at ${timed.toFixed(2)}s`,
  );
  await setRange(page.locator('[data-editor-timeline]'), Math.min(whole - 0.2, timed + 0.4));
  await wait(500);
  check(
    'and IS on the video once the playhead reaches it',
    (await page.locator('[data-video-text-line="0"]').count()) === 1,
  );

  // Put the window back: the rest of the run is about a line that shows all the
  // way through, including on the posted page where there is no playhead to wait
  // for before looking for it.
  const backRail = await page.locator('[data-editor-track]').boundingBox();
  const backGrip = await page.locator('[data-editor-text-handle="from"]').boundingBox();
  await page.mouse.move(backGrip.x + backGrip.width / 2, backGrip.y + backGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(backRail.x - 40, backGrip.y + backGrip.height / 2);
  await wait(80);
  await page.mouse.up();
  await wait(400);
  check(
    'and the window can be opened back up to the whole video',
    Number(
      await page.locator('[data-editor-text-handle="from"]').getAttribute('aria-valuenow'),
    ) < 0.05,
  );

  /* ===================== another clip, and one less ===================== */
  section('ADDING A CLIP FROM THE EDITOR, AND DELETING ONE');

  const beforeAdding = await page.locator('[data-editor-clip]').count();
  await page.locator('[data-editor-add-clip]').click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 20000 });
  check('the + on the timeline opens the camera again', true);
  await record(page, 2);
  await page.locator('[data-camera-next]').click();
  await page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  const afterAdding = await page.locator('[data-editor-clip]').count();
  check(
    'and the new clip joins the project rather than replacing it',
    afterAdding === beforeAdding + 1,
    `${beforeAdding} -> ${afterAdding} clips`,
  );

  // Delete acts on the SELECTED clip, so select the one just filmed.
  await page.locator(`[data-editor-clip="${afterAdding - 1}"]`).click();
  await wait(300);
  const lengthWithFour = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));

  // IT ASKS FIRST. A clip is a take that cannot be filmed again, so Delete opens
  // a question rather than doing it.
  await page.locator('[data-editor-delete]').click();
  await wait(300);
  check(
    'Delete asks before it deletes',
    (await page.locator('[data-editor-confirm-delete]').count()) === 1,
  );
  check(
    'and names the clip it means',
    /Delete clip 4 of 4\?/.test(await page.locator('[data-editor-confirm-delete]').innerText()),
    (await page.locator('[data-editor-confirm-delete]').innerText()).replace(/\n/g, ' '),
  );
  check(
    'with the clip in question lit in the row',
    await page.evaluate(
      (position) =>
        /rgb\(248|rgb\(250|red/.test(
          getComputedStyle(
            document.querySelector(`[data-editor-clip="${position}"]`),
          ).borderTopColor,
        ) ||
        getComputedStyle(document.querySelector(`[data-editor-clip="${position}"]`))
          .boxShadow !== 'none',
      afterAdding - 1,
    ),
  );
  check(
    'and the question is small enough to leave the video visible',
    await page.evaluate(() => {
      const sheet = document
        .querySelector('[data-editor-confirm-delete] div:last-of-type')
        ?.getBoundingClientRect();
      const stage = document.querySelector('[data-editor-stage]').getBoundingClientRect();
      return sheet ? sheet.top > stage.top + stage.height * 0.4 : false;
    }),
  );

  // No leaves everything exactly as it was.
  await page.locator('[data-editor-confirm-no]').click();
  await wait(400);
  check(
    'No closes it and changes nothing',
    (await page.locator('[data-editor-confirm-delete]').count()) === 0 &&
      (await page.locator('[data-editor-clip]').count()) === afterAdding &&
      Number(await page.locator('[data-editor-timeline]').getAttribute('max')) === lengthWithFour,
    `${await page.locator('[data-editor-clip]').count()} clips still here`,
  );

  // Yes deletes that one and only that one.
  await page.locator('[data-editor-delete]').click();
  await page.waitForSelector('[data-editor-confirm-yes]', { timeout: 5000 });
  await page.locator('[data-editor-confirm-yes]').click();
  await wait(600);
  check(
    'and the question closes once it is answered',
    (await page.locator('[data-editor-confirm-delete]').count()) === 0,
  );
  const afterDeleting = await page.locator('[data-editor-clip]').count();
  check(
    'deleting the selected clip takes it out of the project',
    afterDeleting === beforeAdding,
    `${afterAdding} -> ${afterDeleting} clips`,
  );
  const lengthWithThree = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));
  check(
    'and the video gets shorter by that clip',
    lengthWithThree < lengthWithFour - 1,
    `${lengthWithFour}s -> ${lengthWithThree}s`,
  );
  check(
    'with the editor still on the video rather than dropped back to the camera',
    (await page.locator('[data-editor-fullscreen]').count()) === 1,
  );

  /* ===================== each clip's own level ===================== */
  section('SOUND IS PER CLIP, NOT ONE SWITCH OVER THE LOT');

  /** Reads the level the Sound tool shows for whichever clip is open. */
  const levelNow = async () =>
    Number(
      (await page.locator('[data-editor-clip-volume-value]').innerText()).replace('%', ''),
    );

  await page.locator('[data-editor-tool="sound"]').click();
  await wait(250);
  await page.locator('[data-editor-clip="0"]').click();
  await wait(300);
  check('a clip starts at full volume', (await levelNow()) === 100, `${await levelNow()}%`);

  // Clip 2 down to nothing. It is one of the two long clips, which is what makes
  // it measurable in the finished file further down.
  await page.locator('[data-editor-clip="1"]').click();
  await wait(300);
  await page.locator('[data-editor-clip-mute]').click();
  await wait(300);
  check('a clip can be muted on its own', (await levelNow()) === 0, `${await levelNow()}%`);

  // Clip 3 to half.
  await page.locator('[data-editor-clip="2"]').click();
  await wait(300);
  await setRange(page.locator('[data-editor-clip-volume]'), 0.5);
  await wait(300);
  const half = await levelNow();
  check('and another set to half', half > 40 && half < 60, `${half}%`);

  // The point of all three: they are independent.
  const levels = [];
  for (const position of [0, 1, 2]) {
    await page.locator(`[data-editor-clip="${position}"]`).click();
    await wait(350);
    levels.push(await levelNow());
  }
  check(
    'each clip kept its own level',
    levels[0] === 100 && levels[1] === 0 && levels[2] === half,
    levels.map((value) => `${value}%`).join(' / '),
  );

  // And they survive the other editing somebody does afterwards.
  await page.locator('[data-editor-tool="trim"]').click();
  // The longest clip, which is the one with room left to cut: clip 1 has been
  // trimmed twice and dragged once by now and is near its floor.
  await page.locator('[data-editor-clip="2"]').click();
  await wait(300);
  const beforeVolumeTrim = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));
  // Relative to where this clip's end already is, not to its maximum: `max - 0.4`
  // on an already-trimmed clip would make it LONGER.
  const endNow = Number(await page.locator('[data-editor-trim="end"]').inputValue());
  await setRange(page.locator('[data-editor-trim="end"]'), Math.max(0.5, endNow - 0.4));
  await wait(600);
  await page.locator('[data-editor-tool="sound"]').click();
  const afterTrimLevels = [];
  for (const position of [0, 1, 2]) {
    await page.locator(`[data-editor-clip="${position}"]`).click();
    await wait(350);
    afterTrimLevels.push(await levelNow());
  }
  check(
    'and trimming a clip does not disturb any of them',
    JSON.stringify(afterTrimLevels) === JSON.stringify(levels),
    afterTrimLevels.map((value) => `${value}%`).join(' / '),
  );
  check(
    'the trim still took',
    Number(await page.locator('[data-editor-timeline]').getAttribute('max')) < beforeVolumeTrim,
  );
  await page.locator('[data-editor-tool="trim"]').click();
  await wait(200);

  /* ===================== the clip's own shape ===================== */
  section('CROP CHANGES THE CLIP, NOT JUST A LABEL');

  await page.locator('[data-editor-tool="crop"]').click();
  await wait(250);
  check(
    'Crop offers the same shapes the desktop editor does',
    (await page.locator('[data-editor-shape]').count()) === 5,
    (await page.locator('[data-editor-shape]').allInnerTexts()).join(' / '),
  );
  check(
    'a recording starts on its original shape',
    (await page.locator('[data-editor-shape="Original"]').getAttribute('aria-pressed')) === 'true',
  );
  await page.locator('[data-editor-shape="1:1"]').click();
  await wait(400);
  check(
    'choosing a square crops the clip',
    (await page.locator('[data-editor-shape="1:1"]').getAttribute('aria-pressed')) === 'true' &&
      (await page.locator('[data-editor-shape="Original"]').getAttribute('aria-pressed')) ===
        'false',
  );
  // Put it back: the rest of the run is about a 9:16 project.
  await page.locator('[data-editor-shape="Original"]').click();
  await wait(400);
  check(
    'and it goes back to the original',
    (await page.locator('[data-editor-shape="Original"]').getAttribute('aria-pressed')) === 'true',
  );
  await page.locator('[data-editor-tool="trim"]').click();
  await wait(200);

  /* ===================== the post screen ===================== */
  section('POSTING THREE TRIMMED CLIPS');

  // Read the project's length HERE, not from a variable captured before the last
  // trim: every cut moves it, and comparing the posted file against a stale
  // number measures the suite rather than the render.
  const projectLength = Number(await page.locator('[data-editor-timeline]').getAttribute('max'));

  // Each clip's kept length, read from its own trim handles, so the audio check
  // after posting knows which stretch of the finished file is which clip.
  const keptLengths = [];
  for (const position of [0, 1, 2]) {
    await page.locator(`[data-editor-clip="${position}"]`).click();
    await wait(300);
    const from = Number(await page.locator('[data-editor-trim="start"]').inputValue());
    const to = Number(await page.locator('[data-editor-trim="end"]').inputValue());
    keptLengths.push(to - from);
  }

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
  check('a three-clip video posts', Boolean(postId), postedUrl);

  // The finished file: both clips, trimmed, in order. Asked of the app rather
  // than of a file, so this works on the local driver and the Supabase stubs.
  const stored = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/posts/${id}`);
    if (!response.ok) return null;
    const body = await response.json();
    return body?.post?.media?.[0] ?? null;
  }, postId);
  const expected = projectLength;
  check(
    // Proportional, and deliberately not "within 1.5 seconds": that would pass a
    // file a quarter short on a long project and catch nothing.
    //
    // ±18%, and the asymmetry of what that catches is the point.
    //
    // Frames are now paced on the SOURCE — `round(progress * OUTPUT_FPS)` by the
    // time the source has played `progress` seconds — so the video can no longer
    // play fast or slow. Length is a per-clip recording window, so the dead time
    // between clips is no longer in the file. The median of this same fixed
    // project across runs is 101%.
    //
    // The tail is MediaRecorder's and cannot be closed from here: it records in
    // real time, so when the main thread blocks, the recorder keeps running and
    // no timer can shut the window on the beat. Measured across four designs and
    // a dozen runs, that leaves occasional runs at 85% and 113%. The band is set
    // to pass those and still fail the behaviour this replaced, which ranged from
    // 49% to 134% on the same project. A hard guarantee means encoding frames
    // with explicit timestamps (WebCodecs) rather than recording a canvas in real
    // time; see the note in scripts/e2e/README.md.
    'the posted video is as long as the three trimmed clips together',
    stored?.duration != null &&
      stored.duration <= expected * 1.18 &&
      stored.duration >= expected * 0.82,
    `stored ${stored?.duration}s against ${expected.toFixed(2)}s of kept clips (${
      stored?.duration ? Math.round((stored.duration / expected) * 100) : 0
    }%)`,
  );
  check(
    'and longer than any one clip, so all three are in it',
    stored?.duration != null && stored.duration > 1.2,
    `${stored?.duration}s`,
  );
  // ============ the audio that actually came out ============
  // Not "the UI remembered the numbers" — the finished file. Clip 1 was left at
  // full, clip 2 muted and clip 3 halved, and `renderClips` routes each clip
  // through its own gain node, so those three stretches of the posted audio
  // should be loud, silent and in between. Measured by decoding the file.
  const loudness = await page.evaluate(
    async ({ url, lengths }) => {
      const response = await fetch(url);
      if (!response.ok) return { error: `fetch ${response.status}` };
      const bytes = await response.arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return { error: 'no AudioContext' };
      const context = new Ctx();
      let buffer;
      try {
        buffer = await context.decodeAudioData(bytes);
      } catch (error) {
        return { error: `decode: ${error}` };
      }
      if (buffer.numberOfChannels === 0) return { error: 'no audio track' };
      const samples = buffer.getChannelData(0);

      // The file can come out a little longer or shorter than the arithmetic, so
      // the boundaries are scaled onto what was actually produced.
      const arithmetic = lengths.reduce((sum, value) => sum + value, 0);
      const scale = arithmetic > 0 ? buffer.duration / arithmetic : 1;
      const rms = (from, to) => {
        const first = Math.max(0, Math.floor(from * buffer.sampleRate));
        const last = Math.min(samples.length, Math.ceil(to * buffer.sampleRate));
        if (last <= first) return 0;
        let total = 0;
        for (let at = first; at < last; at += 1) total += samples[at] * samples[at];
        return Math.sqrt(total / (last - first));
      };

      const levels = [];
      let at = 0;
      for (const length of lengths) {
        const from = at * scale;
        const to = (at + length) * scale;
        // Inset, so a boundary landing a few milliseconds out does not leak one
        // clip's audio into another's measurement.
        const inset = Math.min(0.15, (to - from) * 0.2);
        levels.push(rms(from + inset, to - inset));
        at += length;
      }
      void context.close();
      return { levels, duration: buffer.duration };
    },
    { url: stored?.url, lengths: keptLengths },
  );

  if (loudness.error) {
    check('the posted audio could be decoded to check per-clip volume', false, loudness.error);
  } else {
    const [, silenced, halved] = loudness.levels;
    const loudest = Math.max(...loudness.levels);
    check(
      'the posted file has audio in it at all',
      loudest > 0.005,
      `loudest stretch RMS ${loudest.toFixed(4)}`,
    );
    check(
      // THE ONE THAT MATTERS. The muted clip is silent in the FILE itself, not
      // merely flagged somewhere downstream — and the rest of the file is not,
      // so this is a clip being muted rather than the whole video.
      'the stretch where clip 2 was muted is silent',
      silenced < 0.002 && silenced < loudest * 0.1,
      `RMS ${silenced.toFixed(4)} against ${loudest.toFixed(4)} elsewhere`,
    );
    check(
      // Not silent, which is the difference between "half" and "off". The ratio
      // between half and full is NOT asserted: Chromium's fake microphone emits a
      // pulsed tone rather than a continuous one, so RMS over a stretch measures
      // how many beeps happened to fall in it as much as how loud they were. The
      // UI checks above are what prove 50% is held as 50%.
      'and the stretch where clip 3 was halved still has sound in it',
      halved > silenced && halved > 0.002,
      `RMS ${halved.toFixed(4)} against ${silenced.toFixed(4)} muted`,
    );
  }

  check(
    // A vertical project renders into the full 9:16 frame. This used to scale the
    // LONG edge to 1080, so a 1080x1920 recording came out 608x1080.
    'the posted video is a proper 1080x1920 vertical',
    stored?.width === 1080 && stored?.height === 1920,
    `${stored?.width}x${stored?.height}`,
  );
  check(
    'which is 9:16',
    stored?.width != null && Math.abs(stored.width / stored.height - 9 / 16) < 0.001,
    stored?.width && stored?.height ? (stored.width / stored.height).toFixed(4) : 'unknown',
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
  await android.page.locator('[data-camera-next]').click();
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
  // One clip still gets the timeline: there is nothing to choose between, but the
  // trim handles live on it, so taking it away would take trimming away with it.
  check(
    'a single clip still gets a timeline',
    (await android.page.locator('[data-editor-clip]').count()) === 1,
  );
  check(
    'carrying its two trim handles',
    (await android.page.locator('[data-editor-handle]').count()) === 2,
  );
  check(
    'and the bands still stack in order on this screen',
    await android.page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const scrub = box('[data-editor-scrub]');
      const stage = box('[data-editor-stage]');
      const controls = box('[data-editor-controls]');
      const clips = box('[data-editor-strip]');
      return (
        stage.top >= scrub.bottom - 1 &&
        controls.top >= stage.bottom - 1 &&
        clips.top >= controls.bottom - 1 &&
        clips.bottom <= window.innerHeight + 1
      );
    }),
  );

  // Two clips, on the small screen: the shortest project where choosing between
  // clips means anything, and the one the three-clip run never passes through.
  await android.page.locator('[data-editor-add-clip]').click();
  await android.page.waitForSelector('button[aria-label="Start recording"]', { timeout: 20000 });
  await record(android.page, 2);
  await android.page.locator('[data-camera-next]').click();
  await android.page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  check(
    'a second clip makes a two-clip project',
    (await android.page.locator('[data-editor-clip]').count()) === 2,
  );
  for (const position of [1, 0]) {
    await android.page.locator(`[data-editor-clip="${position}"]`).click();
    await wait(400);
    check(
      `clip ${position + 1} of two can be selected and carries the grips`,
      (await android.page
        .locator(`[data-editor-clip="${position}"]`)
        .getAttribute('aria-pressed')) === 'true' &&
        (await android.page.locator('[data-editor-handle]').count()) === 2,
    );
  }
  check('with no sideways scroll on two clips either', (await sideways(android.page)) === 0);
  check(
    'and the tools still all on screen',
    await android.page.evaluate(
      () =>
        document.querySelector('[data-editor-tool="crop"]').getBoundingClientRect().bottom <=
        window.innerHeight + 1,
    ),
  );
  // Back to one, so the Retake check below is still about the only clip.
  await android.page.locator('[data-editor-clip="1"]').click();
  await wait(300);
  await android.page.locator('[data-editor-delete]').click();
  await android.page.waitForSelector('[data-editor-confirm-yes]', { timeout: 5000 });
  await android.page.locator('[data-editor-confirm-yes]').click();
  await wait(500);
  check(
    'deleting it leaves the one clip, still in the editor',
    (await android.page.locator('[data-editor-clip]').count()) === 1 &&
      (await android.page.locator('[data-editor-fullscreen]').count()) === 1,
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
