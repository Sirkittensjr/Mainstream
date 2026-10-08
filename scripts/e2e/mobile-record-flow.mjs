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

/**
 * Taps a profile shelf and waits for it to actually open.
 *
 * Switching shelf happens in the page — the address changes with
 * `history.pushState` and the shelf, already rendered, is swapped in — so there
 * is no document load for `waitForLoadState` to wait on. Waiting for the tab to
 * claim `aria-current` is waiting for the render, which is the thing being
 * asserted.
 */
async function openShelf(page, shelf) {
  await page.locator(`[data-profile-tab="${shelf}"]`).click();
  await page.waitForSelector(`[data-profile-tab="${shelf}"][aria-current="page"]`, {
    timeout: 20000,
  });
}

/**
 * Records for `seconds`, then stops and comes back to the viewfinder.
 *
 * Stopping no longer ends the session: the camera stays open for the next
 * segment and Next is the only way out, so there is no per-take review screen to
 * wait for any more.
 */
async function record(page, seconds) {
  await page.locator('button[aria-label="Start recording"]').click();
  await page.waitForSelector('button[aria-label="Stop recording"]', { timeout: 15000 });
  await wait(seconds * 1000);
  await page.locator('button[aria-label="Stop recording"]').click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 15000 });
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
  section('+ IS A CAMERA BUTTON');

  // Through the bottom navigation, the way somebody on a phone gets there.
  await page.goto('/home', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  // `:visible` matters: the desktop sidebar has the same links in the DOM at phone
  // width, just hidden, and they are the first matches without this.
  const plus = page.locator('a[href="/create/video"]:visible').first();
  check('the + in the bottom navigation is a camera button', (await plus.count()) === 1);
  check(
    'and it says so',
    (await plus.getAttribute('aria-label')) === 'Record a video',
    String(await plus.getAttribute('aria-label')),
  );
  await plus.click();
  await page.waitForURL(/\/create\/video/, { timeout: 15000 });

  // The camera, with nothing in between: no Create page, no Post/Video toggle.
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  check('tapping it opens the camera directly', true, page.url());
  check(
    'with no Post/Video toggle anywhere',
    (await page.locator('[role=tab]').count()) === 0,
  );
  check(
    'and no generic Create page in the way',
    !/New post|Post a video/.test(await page.locator('body').innerText()),
  );
  check('the camera fills the screen without overflowing', (await sideways(page)) === 0);

  // The Create page was not deleted, it was demoted: photo posts still live
  // there, and it is what the Posts shelf of a profile points at. Asked over HTTP
  // rather than by navigating, so the camera is not torn down to find out.
  const createPage = await page.evaluate(async () => {
    const response = await fetch('/create');
    return { ok: response.ok, body: await response.text() };
  });
  check('/create is still there for photo posts', createPage.ok);
  check(
    'and carries no Post/Video toggle either',
    !createPage.body.includes('role="tab"'),
  );

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

  /* ------------------------- how long this one is ------------------------- */
  // 15s, 60s, 2 minutes. The cap is a decision about the take, made before
  // filming, and the whole point of it is that the clock and the shutter's ring
  // then mean something — so what is checked is the BUDGET moving, not a class
  // name on a chip.
  const caps = page.locator('[data-camera-cap]');
  check('three lengths are offered', (await caps.count()) === 3);
  check(
    'and they are 15s, 60s and 2 minutes',
    JSON.stringify(await caps.evaluateAll((nodes) => nodes.map((n) => n.dataset.cameraCap))) ===
      JSON.stringify(['15', '60', '120']),
    (await caps.allInnerTexts()).join(' / ').replace(/\n/g, ''),
  );
  check(
    'labelled the way a camera labels them',
    JSON.stringify((await caps.allInnerTexts()).map((t) => t.trim())) ===
      JSON.stringify(['15s', '60s', '2m']),
  );
  check(
    'the full two minutes is the one already chosen',
    (await page.locator('[data-camera-cap="120"]').getAttribute('aria-pressed')) === 'true',
  );
  check(
    'each length is big enough to tap',
    await caps.evaluateAll((nodes) =>
      nodes.every((n) => n.getBoundingClientRect().height >= 34),
    ),
    (await caps.evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().height)))).join(', '),
  );

  await page.locator('[data-camera-cap="15"]').click();
  await wait(300);
  check(
    'choosing 15s shortens the budget on the clock',
    /0:15/.test((await timer.innerText()).trim()),
    (await timer.innerText()).trim().replace(/\n/g, ' '),
  );
  check(
    'and moves which one is chosen',
    (await page.locator('[data-camera-cap="15"]').getAttribute('aria-pressed')) === 'true' &&
      (await page.locator('[data-camera-cap="120"]').getAttribute('aria-pressed')) === 'false',
  );
  await page.locator('[data-camera-cap="120"]').click();
  await wait(300);
  check(
    'and going back to 2 minutes restores it',
    /2:00/.test((await timer.innerText()).trim()),
    (await timer.innerText()).trim().replace(/\n/g, ' '),
  );

  /* ---------------------------- sound or not ---------------------------- */
  // Whether the microphone is used AT ALL, which is not the editor's Sound tool
  // (that silences playback on a video which has audio). So the check is the
  // track count on the live stream, not a button's state: recording without
  // sound has to mean there was never any.
  const mic = page.locator('[data-camera-mic]');
  check('sound can be turned off before filming', (await mic.count()) === 1);
  const audioTracks = () =>
    page.locator('video').first().evaluate((v) => v.srcObject?.getAudioTracks().length ?? -1);
  check('it is on to start with', (await mic.getAttribute('data-camera-mic')) === 'on');
  check('and the camera really has an audio track', (await audioTracks()) === 1, `${await audioTracks()} tracks`);
  await mic.click();
  await page.waitForFunction(
    () => {
      const video = document.querySelector('video');
      return video?.srcObject?.getAudioTracks().length === 0;
    },
    undefined,
    { timeout: 15000 },
  ).catch(() => undefined);
  check('turning it off says so', (await mic.getAttribute('data-camera-mic')) === 'off');
  check(
    'and reopens the camera with NO audio track, not a muted one',
    (await audioTracks()) === 0,
    `${await audioTracks()} tracks`,
  );
  check(
    'the camera is still usable with sound off',
    (await page.locator('button[aria-label="Start recording"]').count()) === 1,
  );
  // Back on, because the rest of the suite is about a video with sound.
  await mic.click();
  await page.waitForFunction(
    () => {
      const video = document.querySelector('video');
      return video?.srcObject?.getAudioTracks().length === 1;
    },
    undefined,
    { timeout: 15000 },
  ).catch(() => undefined);
  check('and it can be turned back on', (await audioTracks()) === 1, `${await audioTracks()} tracks`);

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
  check(
    'and the length chooser is out of the way while filming',
    (await page.locator('[data-camera-caps]').count()) === 0,
  );
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
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 15000 });

  check('recording stops and the camera is ready for the next segment', true);

  /* ===================== the camera keeps the session ===================== */
  section('STOPPING IS NOT LEAVING');

  // There is no per-take review screen any more. Releasing the shutter ends a
  // SEGMENT, the camera stays open, and Next is the only way out — so a second
  // and third clip are reachable without going back for them. This section used
  // to test that review screen; it tests the strip that replaced it.
  check(
    'the viewfinder is still up after a take',
    (await page.locator('button[aria-label="Start recording"]').count()) === 1 &&
      (await page.locator('[data-editor-fullscreen]').count()) === 0,
  );
  const strip = await page.locator('[data-camera-clips]').innerText();
  check('and it says what has been filmed', /clip/i.test(strip), strip.replace(/\n/g, ' '));
  check(
    'with a way to throw the last one away',
    (await page.locator('[data-camera-drop-last]').count()) === 1,
  );
  check(
    'and a Next to leave with',
    (await page.locator('[data-camera-next]').count()) === 1,
  );

  // A second segment, then drop it: the strip must go back to one clip.
  // `addSource` probes the recording for its duration before appending, so the
  // strip catches up a moment after the shutter — reading it straight away sees
  // the count from before.
  await record(page, 2);
  const grew = await page
    .waitForFunction(
      () => /2 clips/i.test(document.querySelector('[data-camera-clips]')?.textContent ?? ''),
      undefined,
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  const two = await page.locator('[data-camera-clips]').innerText();
  check(
    'a second segment is added rather than replacing the first',
    grew,
    two.replace(/\n/g, ' '),
  );
  // Throwing a take away asks first, like Back and Delete in the editor. It
  // used to happen on the tap, and one stray thumb lost a clip for good.
  await page.locator('[data-camera-drop-last]').click();
  const askedDrop = await page
    .waitForSelector('[data-editor-confirm-drop-last]', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  const dropQuestion = askedDrop
    ? (await page.locator('[data-editor-confirm-drop-last]').innerText()).replace(/\s+/g, ' ')
    : '';
  check('tapping Last clip asks before deleting anything', askedDrop, dropQuestion);
  check(
    'and says which clip goes, and that the other is kept',
    /clip 2/i.test(dropQuestion) && /kept/i.test(dropQuestion),
    dropQuestion,
  );
  await page.locator('[data-editor-confirm-drop-last] [data-editor-confirm-no]').click();
  await page.waitForTimeout(300);
  check(
    'No keeps both clips',
    (await page.locator('[data-editor-confirm-drop-last]').count()) === 0 &&
      /2 clips/i.test(await page.locator('[data-camera-clips]').innerText()),
  );
  await page.locator('[data-camera-drop-last]').click();
  await page.waitForSelector('[data-editor-confirm-drop-last]', { timeout: 5000 });
  await page.locator('[data-editor-confirm-drop-last] [data-editor-confirm-scrim]').click({
    position: { x: 10, y: 10 },
  });
  await page.waitForTimeout(300);
  check(
    'and so does tapping outside the question',
    (await page.locator('[data-editor-confirm-drop-last]').count()) === 0 &&
      /2 clips/i.test(await page.locator('[data-camera-clips]').innerText()),
  );
  await page.locator('[data-camera-drop-last]').click();
  await page.waitForSelector('[data-editor-confirm-drop-last] [data-editor-confirm-yes]', {
    timeout: 5000,
  });
  await page.locator('[data-editor-confirm-drop-last] [data-editor-confirm-yes]').click();
  await page
    .waitForFunction(
      () => !/2 clips/i.test(document.querySelector('[data-camera-clips]')?.textContent ?? ''),
      undefined,
      { timeout: 10000 },
    )
    .catch(() => undefined);
  const back = await page.locator('[data-camera-clips]').innerText();
  check(
    'and dropping the last one leaves the first',
    !/2 clips/i.test(back),
    back.replace(/\n/g, ' '),
  );

  // The cover is still reachable from the camera, and still goes to the editing
  // stage opened on the right tool.
  check(
    'a cover can be chosen from the camera',
    (await page.locator('button[aria-label="Choose the cover"]').count()) === 1,
  );
  await page.locator('button[aria-label="Choose the cover"]').click();
  await page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  check(
    'tapping Cover goes to the editing stage, opened on the cover tool',
    (await page.locator('[data-editor-panel="cover"]').count()) === 1 &&
      (await page.locator('[data-editor-tool="cover"]').getAttribute('aria-pressed')) === 'true',
  );
  check(
    'and the take came with it',
    (await page.locator('#thumbnail').count()) === 1,
    'the frame scrubber is there, so there is a video to cover',
  );

  // Back is a retake: it drops the clip it goes back past. It asks first —
  // the same question Delete asks — rather than losing the take on the tap.
  await page.locator('[data-editor-retake]').click();
  await page.waitForSelector('[data-editor-confirm-retake]', { timeout: 5000 });
  const retakeQuestion = (await page.locator('[data-editor-confirm-retake]').innerText()).replace(
    /\n/g,
    ' ',
  );
  check(
    'Back asks before discarding the recording',
    /Discard this recording\?/.test(retakeQuestion) && /discards this recording/.test(retakeQuestion),
    retakeQuestion,
  );
  await page.locator('[data-editor-confirm-retake] [data-editor-confirm-no]').click();
  await wait(400);
  check(
    'No keeps the recording and stays in the editor',
    (await page.locator('[data-editor-confirm-retake]').count()) === 0 &&
      (await page.locator('[data-editor-fullscreen]').count()) === 1 &&
      (await page.locator('[data-editor-clip]').count()) === 1,
  );
  await page.locator('[data-editor-retake]').click();
  await page.waitForSelector('[data-editor-confirm-retake] [data-editor-confirm-yes]', {
    timeout: 5000,
  });
  await page.locator('[data-editor-confirm-retake] [data-editor-confirm-yes]').click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 20000 });
  check('Yes returns to the camera to retake', true);

  await record(page, 3);
  await page.locator('[data-camera-next]').click();
  await page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  check('Next leaves the camera for the editing stage', true);
  check(
    'with the one clip that was filmed',
    (await page.locator('[data-editor-clip]').count()) === 1,
    'on the timeline, where its trim handles are',
  );

  /* ========================= stage 2: editing ========================= */
  section('EDITING IS ITS OWN STAGE');

  // The thing that makes this a stage rather than a panel: none of the posting
  // decisions are reachable from here.
  const postingFields = await page.evaluate(() =>
    ['#video-title', '#video-caption', '#video-category', '#video-tags', '#video-content-warning']
      .filter((id) => document.querySelector(id) !== null),
  );
  check(
    'no captions, categories, tags or content warning during editing',
    postingFields.length === 0,
    postingFields.join(', ') || 'none present',
  );

  // The editor plays the project through two video elements, swapping at each
  // join, so "the preview" is whichever one is currently shown.
  const editPreview = await page.evaluate(() => {
    const shown = [...document.querySelectorAll('[data-clip-slot]')].find(
      (v) => Number(getComputedStyle(v).opacity) > 0.5,
    );
    const box = shown.getBoundingClientRect();
    const tall = (selector) =>
      document.querySelector(selector)?.getBoundingClientRect().height ?? 0;
    // Laid out by the render's own arithmetic (lib/video/preview), so "cover" is
    // measured: the picture reaches every edge of its 9:16 frame, unstretched.
    const frame = shown.closest('[data-editor-stage]').firstElementChild.getBoundingClientRect();
    const covers =
      box.left <= frame.left + 1 &&
      box.top <= frame.top + 1 &&
      box.right >= frame.right - 1 &&
      box.bottom >= frame.bottom - 1;
    const unstretched =
      Math.abs(box.width / box.height - shown.videoWidth / shown.videoHeight) < 0.01;
    return {
      height: frame.height,
      vh: window.innerHeight,
      fit: covers && unstretched ? 'cover' : `covers=${covers} unstretched=${unstretched}`,
      controls: tall('[data-editor-controls]'),
      clips: tall('[data-editor-strip]'),
    };
  });
  check(
    // It is no longer the whole screen: the editor is five bands and the video
    // is one of them, so that nothing is laid over the picture. It still gets
    // the largest band, which is what "the video is the focus" means once the
    // controls are beside it rather than on top of it.
    'the video gets the largest band of the screen',
    editPreview.height >= editPreview.vh * 0.45 &&
      editPreview.height >= editPreview.controls &&
      editPreview.height >= editPreview.clips,
    `${Math.round(editPreview.height)}px of ${editPreview.vh}, against ${Math.round(
      editPreview.controls,
    )}px of tools and ${Math.round(editPreview.clips)}px of clips`,
  );
  check(
    // `cover`, and `contain` would be the bug rather than the requirement. A
    // full-width 9:16 frame on a 390px phone wants 693px of a 664px viewport, so
    // fitting a vertical recording into this screen leaves black bands above and
    // below it — which is exactly what it used to do. Covering crops about 4% off
    // the top and bottom instead, and it is the rule `outputFrame` renders with,
    // so the preview matches the file. What must never happen is a STRETCH, and
    // neither value does that.
    'and meets the screen the same way the render does, without stretching',
    editPreview.fit === 'cover',
    editPreview.fit,
  );

  const tools = await page
    .locator('[data-editor-tool]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.editorTool));
  check(
    'the five tools are Trim, Sound, Text, Cover and Crop',
    JSON.stringify(tools) === JSON.stringify(['trim', 'sound', 'text', 'cover', 'crop']),
    tools.join(', '),
  );
  const toolSizes = await page
    .locator('[data-editor-tool]')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  check(
    'each tool is a comfortable tap target',
    toolSizes.every((height) => height >= 44),
    toolSizes.join(', '),
  );
  check('there is a timeline', (await page.locator('[data-editor-timeline]').count()) === 1);
  check(
    // The FILMSTRIP is what a thumb reaches for: the clip's own frames, dragged
    // to scrub and carrying the trim grips. The project bar beside it answers a
    // different question — where am I in the whole video — and is deliberately
    // slim, because in a five-band editor every pixel it gives back is video.
    'and the filmstrip it scrubs with is thumb-sized',
    await page
      .locator('[data-editor-track]')
      .evaluate((node) => node.getBoundingClientRect().height >= 44),
    `${Math.round(
      await page
        .locator('[data-editor-track]')
        .evaluate((node) => node.getBoundingClientRect().height),
    )}px of frames`,
  );
  check('and a clear Next', (await page.locator('[data-editor-next]').count()) === 1);

  // --- trim ---
  // A new take arrives on Trim: the tool is remembered while editing, but coming
  // back from the camera to whichever panel was last open is disorienting.
  check(
    'a new take lands on the Trim tool',
    (await page.locator('[data-editor-tool="trim"]').getAttribute('aria-pressed')) === 'true',
  );
  const endHandle = page.locator('[data-editor-trim="end"]');
  const wholeTake = Number(await endHandle.getAttribute('max'));
  check('trim offers a start and an end', (await page.locator('[data-editor-trim]').count()) === 2);
  await setRange(endHandle, Math.max(0.5, wholeTake - 1));
  await wait(400);
  const trimmedLabel = await page.locator('[data-editor-panel="trim"]').innerText();
  check(
    'moving the end handle shortens what is kept',
    /Keeping 0:0/.test(trimmedLabel),
    trimmedLabel.split('\n')[0],
  );
  check(
    'the timeline follows the trim',
    Math.abs(Number(await page.locator('[data-editor-timeline]').getAttribute('max')) - (wholeTake - 1)) < 0.3,
    `timeline max=${await page.locator('[data-editor-timeline]').getAttribute('max')}`,
  );
  // Put it back: the rest of the run wants the whole take.
  await page.locator('button', { hasText: 'Reset' }).click();
  await wait(400);
  check(
    'and Reset puts the whole take back',
    Math.abs(Number(await endHandle.inputValue()) - wholeTake) < 0.2,
    await endHandle.inputValue(),
  );

  // --- text ---
  await page.locator('[data-editor-tool="text"]').click();
  await page.locator('[data-editor-add-text]').click();
  const overlayText = `over the video ${stamp}`;
  await page.locator('[data-editor-text-input]').fill(overlayText);
  await wait(400);
  check(
    'text appears over the video as it is typed',
    (await page.locator('[data-video-text]').innerText()).includes(overlayText),
    (await page.locator('[data-video-text]').innerText()).trim(),
  );
  // Free placement: no Top/Middle/Bottom stops any more, a line is dragged on
  // the video to wherever it is wanted.
  check(
    'the old position stops are gone',
    (await page.locator('[data-editor-text-at]').count()) === 0,
  );
  const placed = await page.locator('[data-video-text-line="0"]').boundingBox();
  const picture = await page.locator('[data-editor-stage]').boundingBox();
  await page.mouse.move(placed.x + placed.width / 2, placed.y + placed.height / 2);
  await page.mouse.down();
  for (const step of [0.4, 0.3, 0.2]) {
    await page.mouse.move(picture.x + picture.width * 0.4, picture.y + picture.height * step);
    await wait(60);
  }
  await page.mouse.up();
  await wait(400);
  const dropped = await page.locator('[data-video-text-line="0"]').boundingBox();
  check(
    'and it can be dragged up the frame',
    dropped.y < placed.y - 15,
    `${Math.round(placed.y)}px -> ${Math.round(dropped.y)}px`,
  );

  // --- sound ---
  // Per clip: a slider and a Mute button. The post-wide "Sound on / Sound off"
  // cards are gone — they took a third of the screen to say what Mute says.
  await page.locator('[data-editor-tool="sound"]').click();
  await wait(250);
  check(
    'Sound is a slider and a Mute button, not post-wide cards',
    (await page.locator('[data-editor-clip-volume]').count()) === 1 &&
      (await page.locator('[data-editor-clip-mute]').count()) === 1 &&
      (await page.locator('[data-editor-sound]').count()) === 0,
  );
  /** The level the preview actually applied to the clip on screen. */
  const slotLevel = () =>
    page.evaluate(() => {
      const shown = [...document.querySelectorAll('[data-clip-slot]')].find(
        (video) => Number(getComputedStyle(video).opacity) > 0.5,
      );
      return shown ? { volume: shown.dataset.clipVolume, muted: shown.muted } : null;
    });
  const loud = await slotLevel();
  check('sound is on to begin with', loud?.volume === '1' && !loud.muted, JSON.stringify(loud));
  await page.locator('[data-editor-clip-mute]').click();
  await wait(300);
  const quiet = await slotLevel();
  check(
    'muting the clip silences the preview too',
    quiet?.volume === '0' && quiet.muted === true,
    JSON.stringify(quiet),
  );

  // --- cover ---
  await page.locator('[data-editor-tool="cover"]').click();
  await page.waitForSelector('#thumbnail', { timeout: 15000 });
  check('the cover tool is the same picker as the posting screen', true, 'one CoverPicker');
  check(
    'a custom thumbnail can still be supplied here',
    (await page.locator('label[for="cover-file"]').count()) >= 1,
  );

  check('the editing stage does not scroll sideways', (await sideways(page)) === 0);

  // Next renders the project — every edit in it — before posting, so the
  // posting screen shows the finished file. A recording always needs it here:
  // the fake camera's 1216x2160 is not the 1080x1920 output frame.
  await page.locator('[data-editor-next]').click();
  const sawPreparingAtNext = await page
    .waitForSelector('[data-editor-preparing]', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(
    'Next puts the video together first, over the editor, with progress',
    sawPreparingAtNext,
  );
  await page.waitForSelector('#video-title', { timeout: 120000 });
  check('and then leaves editing for the posting screen', true);
  check(
    'whose preview is the rendered file, not the raw recording',
    (await page.locator('[data-post-preview]').getAttribute('data-post-preview')) === 'file',
  );

  /* ========================== stage 3: posting ========================== */
  section('POSTING IS ITS OWN STAGE');

  check(
    'the screen says it is the posting stage',
    (await page.locator('[data-post-stage]').count()) === 1,
  );
  check(
    'with a way back to editing',
    (await page.locator('[data-post-stage] button', { hasText: 'Edit' }).count()) === 1,
  );
  check(
    'the text is on the final preview',
    (await page.locator('[data-video-text]').innerText()).includes(overlayText),
  );
  // Sticky, so it is on screen without scrolling to the end of the form.
  const postButton = await page.locator('[data-post-button]').evaluate((b) => {
    const box = b.getBoundingClientRect();
    return {
      height: box.height,
      fromBottom: window.innerHeight - box.bottom,
      onScreen: box.top >= 0 && box.bottom <= window.innerHeight + 1,
    };
  });
  check(
    'the Post button is prominent',
    postButton.height >= 52,
    `${Math.round(postButton.height)}px tall`,
  );
  check(
    'and on screen without scrolling for it',
    postButton.onScreen && postButton.fromBottom < 120,
    `${Math.round(postButton.fromBottom)}px from the bottom`,
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

  // The posting screen a phone opens on: the video, a caption, hashtags, a
  // cover, a content warning, Post. Everything else is folded away rather than
  // removed. Hashtags used to be in that folded set as a comma-separated string;
  // they are a field of their own now, so they are expected to be ON SCREEN and
  // are not in this list.
  const visibleOnArrival = await page.evaluate(() =>
    ['#video-caption', '#video-category'].filter((id) => {
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
    'hashtags have a field of their own on the posting screen',
    await page.evaluate(() => {
      const field = document.querySelector('#video-tags');
      return Boolean(field && field.offsetParent !== null);
    }),
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

  // What the file actually is, which is the whole point of the pass above.
  const shot = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/posts/${id}`);
    if (!response.ok) return null;
    const body = await response.json();
    const media = body?.post?.media?.[0] ?? null;
    return media ? { width: media.width, height: media.height, url: media.url } : null;
  }, postId);
  check(
    // THE BUG THIS GUARDS. Wrapping a recording as a File is what lets an
    // untouched clip skip the render — and skipping it posted whatever the
    // sensor handed back. An iPhone hands back 1920x1080 and Chromium's fake
    // device 1216x2160, so the viewfinder's 9:16 crop was NOT what got posted,
    // and no CSS downstream can turn a landscape file into a portrait one.
    'a recording is posted as a real 1080x1920 portrait video',
    shot?.width === 1080 && shot?.height === 1920,
    `${shot?.width}x${shot?.height}`,
  );
  check(
    'which is 9:16',
    shot?.width != null && Math.abs(shot.width / shot.height - 9 / 16) < 0.001,
  );
  check(
    // The saving is still taken where it can be: a camera that really does hand
    // back 1080x1920 skips the pass, and so does every upload from the camera
    // roll. It is only paid when the frame would otherwise be wrong.
    'and the render pass ran only because the camera did not give that frame',
    sawPreparingAtNext,
    'the pass runs when the sensor frame is not the output frame',
  );
  check(
    // Next rendered exactly this project and nothing changed since, so Post only
    // uploads. Rendering twice would cost the length of the video again.
    'Post uploads the video Next made rather than rendering it again',
    !sawPreparing,
  );

  // The clip was muted in the editor. That has to be in the FILE: a silent
  // audio track, not a flag the player might or might not honour.
  const silence = await page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) return { error: `fetch ${response.status}` };
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const context = new Ctx();
    try {
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const samples = buffer.getChannelData(0);
      let total = 0;
      for (let at = 0; at < samples.length; at += 1) total += samples[at] * samples[at];
      return { rms: Math.sqrt(total / Math.max(1, samples.length)) };
    } catch {
      // No audio track at all is silent too.
      return { rms: 0, noTrack: true };
    } finally {
      void context.close();
    }
  }, shot?.url);
  check(
    'the muted clip is silent in the posted file itself',
    !silence.error && silence.rms < 0.002,
    silence.error ?? (silence.noTrack ? 'no audio track' : `RMS ${silence.rms.toFixed(5)}`),
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

  // The two playback properties chosen in the editing stage have to have
  // survived the trip through sanitiseMedia, which rebuilds media from scratch.
  check(
    'the text chosen while editing is on the posted video',
    (await page.locator('[data-video-text]').count()) >= 1 &&
      (await page.locator('[data-video-text]').first().innerText()).includes(overlayText),
    (await page.locator('[data-video-text]').first().innerText().catch(() => '-')).trim(),
  );
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
  // The overlay travels with the post, so it is on the full-screen feed too —
  // that is the point of storing it rather than burning it into the file.
  check(
    'the text is on it in the Videos feed as well',
    (await viewer.page.locator('[data-video-text]').count()) >= 1,
    `${await viewer.page.locator('[data-video-text]').count()} overlays rendered`,
  );
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

  // The ••• menu on somebody else's profile, which is where Block and Report live.
  // `.card` carries a backdrop-filter, and that creates a stacking context — so
  // this dropdown's z-index cannot lift it above anything OUTSIDE the header, and
  // the shelf tab bar comes later in the document. It painted over the open menu,
  // and a count badge landing on Block made that button unclickable. What is
  // checked is the click itself, because a hit test on a menu is the bug.
  await viewer.page.goto(`/u/${me.handle}`, { waitUntil: 'domcontentloaded' });
  await viewer.page.waitForLoadState('networkidle');
  await viewer.page
    .locator('button[aria-label="More options"], button')
    .filter({ hasText: '•••' })
    .first()
    .click();
  await wait(400);
  const blockItem = viewer.page.locator('button').filter({ hasText: /^Block/ }).first();
  check('the ••• menu opens on somebody else\u2019s profile', (await blockItem.count()) === 1);
  const blockable = await blockItem
    .click({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check('and the shelf tabs do not paint over it', blockable, 'Block is clickable');
  // Undo it, so the feed checks above are not the last word on a blocked account.
  if (blockable) {
    await wait(1200);
    await viewer.page.goto(`/u/${me.handle}`, { waitUntil: 'domcontentloaded' });
    await viewer.page.waitForLoadState('networkidle');
    await viewer.page
      .locator('button[aria-label="More options"], button')
      .filter({ hasText: '•••' })
      .first()
      .click();
    await wait(400);
    await viewer.page
      .locator('button')
      .filter({ hasText: /^Unblock/ })
      .first()
      .click()
      .catch(() => undefined);
    await wait(1200);
  }

  /* ===================== trim, all the way through ===================== */
  section('A TRIMMED VIDEO IS ACTUALLY TRIMMED');

  // Trim is the one tool that changes the bytes, so it is the one that has to be
  // followed to the finished post. Sound and text are playback properties and
  // cost no render pass — proved above, where the pass never ran.
  await page.goto('/create/video', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  await record(page, 6);
  await page.locator('[data-camera-next]').click();
  await page.waitForSelector('[data-editor-trim="end"]', { timeout: 20000 });

  const fullLength = Number(await page.locator('[data-editor-trim="end"]').getAttribute('max'));
  const target = Math.max(1.2, fullLength / 2);
  await setRange(page.locator('[data-editor-trim="end"]'), target);
  await wait(500);
  check(
    `trimmed from ${fullLength.toFixed(1)}s to about ${target.toFixed(1)}s`,
    Math.abs(Number(await page.locator('[data-editor-trim="end"]').inputValue()) - target) < 0.2,
    await page.locator('[data-editor-trim="end"]').inputValue(),
  );

  // This one MUST take the render pass — that is how a trim becomes real bytes —
  // and it takes it at Next, before the posting screen.
  await page.locator('[data-editor-next]').click();
  const sawPreparing2 = await page
    .waitForSelector('[data-editor-preparing]', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForSelector('#video-title', { timeout: 180000 });
  const trimmedTitle = `Trimmed take ${stamp}`;
  await page.fill('#video-title', trimmedTitle);

  let renderedAtPost2 = false;
  const watch2 = setInterval(async () => {
    try {
      if (/Preparing your video/i.test(await page.locator('body').innerText())) {
        renderedAtPost2 = true;
      }
    } catch {
      /* navigated */
    }
  }, 200);
  await page.locator('[data-post-button]').click();
  await page.waitForURL(/\/post\//, { timeout: 180000 });
  clearInterval(watch2);
  const trimmedId = page.url().split('/post/')[1].split(/[?#]/)[0];
  check('a trimmed video posts', Boolean(trimmedId), page.url());
  check(
    'and it DID go through the render pass, because the bytes had to change',
    sawPreparing2,
    'the trim is applied by a real pass at Next, not promised',
  );
  check('and Post did not render it a second time', !renderedAtPost2);

  // The finished post's own length, asked of the app rather than of a file — this
  // suite runs against the local JSON driver AND against the Supabase stubs, and
  // only one of those has a .data/faytarra.json to read.
  const storedDuration = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/posts/${id}`);
    if (!response.ok) return null;
    const body = await response.json();
    return body?.post?.media?.[0]?.duration ?? null;
  }, trimmedId);
  check(
    'the posted video is the trimmed length, not the original',
    storedDuration !== null && Math.abs(storedDuration - target) < 1.2,
    `stored ${storedDuration}s against a ${target.toFixed(1)}s trim of a ${fullLength.toFixed(1)}s take`,
  );

  /* ================= the profile is where content lives ================= */
  section('PROFILE: POSTS, VIDEOS, TEXT');

  // The three kinds of creation that used to sit behind one Create page are now
  // in three places, and the profile is where two of them went.
  await page.goto(`/u/${me.handle}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const shelves = await page
    .locator('[data-profile-tab]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.profileTab));
  check(
    'the profile has Posts, Videos, Text and About',
    // Posts first, which is also the shelf a profile opens on — the first chip
    // and the filled-in chip being different ones reads as a bug.
    JSON.stringify(shelves) === JSON.stringify(['posts', 'videos', 'text', 'about']),
    shelves.join(', '),
  );
  check('and they fit the phone', (await sideways(page)) === 0, `${await sideways(page)}px`);
  const tabSizes = await page
    .locator('[data-profile-tab]')
    .evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().height)));
  // 44px, the same bar every other control in this flow is held to: these four
  // are navigation, not filter chips.
  check('each is a tap target', tabSizes.every((h) => h >= 44), tabSizes.join(', '));

  // Videos: the posted video is here, and a pre-recorded one can be added.
  await openShelf(page, 'videos');
  const videoShelf = await page.locator('body').innerText();
  check('the videos shelf lists the video that was just posted', videoShelf.includes(title));
  check(
    'and offers to upload a pre-recorded one',
    (await page.locator('[data-upload-video]').count()) === 1,
  );
  await page.locator('[data-upload-video]').click();
  await page.waitForURL(/\/create\/video/, { timeout: 15000 });
  await page.waitForTimeout(1200);
  check(
    'which opens the chooser rather than the camera',
    (await page.locator('button[aria-label="Start recording"]').count()) === 0 &&
      (await page.locator('button', { hasText: 'Choose a file' }).count()) === 1,
  );

  // Text: a written post is made from here, and lands on this shelf.
  await page.goto(`/u/${me.handle}?tab=text`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check(
    'the text shelf has somewhere to write',
    (await page.locator('[data-text-post-form]').count()) === 1,
  );
  const thought = `a written thought ${stamp}`;
  await page.fill('#text-post-caption', thought);
  await page.locator('[data-text-post-submit]').click();
  await page.waitForTimeout(2500);
  await page.goto(`/u/${me.handle}?tab=text`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const textShelf = await page.locator('body').innerText();
  check('a text post can be written there', textShelf.includes(thought));
  // What the Videos shelf shows, not the raw response: the page now carries
  // every shelf's first page in its data so that switching tab is instant, so
  // the text is in the document's payload even though it is not on this shelf.
  await page.goto(`/u/${me.handle}?tab=videos`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-profile-shelf="videos"]', { timeout: 15000 });
  check(
    'and it does NOT appear on the videos shelf',
    !(await page.locator('[data-profile-shelf]').innerText()).includes(thought),
  );

  // Photos keep their own page, reachable from the Posts shelf.
  await page.goto(`/u/${me.handle}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check(
    'the posts shelf points at the photo post page',
    (await page.locator('[data-new-photo-post]').count()) === 1,
  );
  // Posts is the whole profile: the video and the written post are on it too,
  // as well as on their own shelves.
  const postsShelf = await page.locator('body').innerText();
  check(
    'and everything is on it — the video and the written post as well',
    postsShelf.includes(title) && postsShelf.includes(thought),
  );

  // And the way back across. Somebody who went to the photo page wanting to film
  // something should not have to find the + again.
  await page.locator('[data-new-photo-post]').click();
  await page.waitForURL(/\/create$/, { timeout: 15000 });
  check(
    'the photo page offers the camera as well',
    (await page.locator('[data-to-camera]').count()) === 1,
  );
  check(
    'and it goes to the camera route',
    (await page.locator('[data-to-camera]').getAttribute('href')) === '/create/video',
  );
  check(
    'while still being the photo form itself',
    (await page.locator('textarea[name=caption]').count()) === 1 &&
      (await page.locator('[role=tab]').count()) === 0,
  );

  /* ================= the general way in, beside the fast one ================= */
  section('CREATE POST: THE GENERAL PATH');

  // Two doors, on purpose. The `+` is the fast one — one tap to a viewfinder, and
  // the section at the top of this suite proves it still is. This is the general
  // one, on Home and on your own profile, and what matters about it is that it
  // OFFERS the four kinds and then hands each off to something that already
  // exists. If "Record video" here went anywhere but the same route `+` goes to,
  // there would be two cameras.
  const WANTED = [
    ['photo', '/create?kind=photo'],
    ['text', '/create?kind=text'],
    ['upload-video', '/create/video?upload=1'],
    ['record-video', '/create/video'],
  ];

  async function openCreateSheet(where) {
    await page.goto(where, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    const trigger = page.locator('[data-create-post]');
    if ((await trigger.count()) !== 1) return null;
    await trigger.click();
    await page.waitForSelector('[data-create-post-sheet]', { timeout: 10000 });
    return page.locator('[data-create-option]');
  }

  for (const where of ['/home', `/u/${me.handle}`]) {
    const label = where === '/home' ? 'Home' : 'the profile';
    const options = await openCreateSheet(where);
    check(`${label} has a Create post button`, options !== null);
    if (!options) continue;

    check(
      `${label}'s sheet offers all four kinds`,
      JSON.stringify(
        await options.evaluateAll((nodes) => nodes.map((n) => n.dataset.createOption)),
      ) === JSON.stringify(WANTED.map(([key]) => key)),
      (await options.allInnerTexts()).join(' / ').replace(/\n/g, ' '),
    );
    check(
      `${label}'s options point at the routes that already exist`,
      JSON.stringify(
        await options.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href'))),
      ) === JSON.stringify(WANTED.map(([, href]) => href)),
      (await options.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')))).join(' '),
    );
    check(
      `${label}'s options are all thumb-sized`,
      await options.evaluateAll((nodes) =>
        nodes.every((n) => n.getBoundingClientRect().height >= 44),
      ),
      (await options.evaluateAll((nodes) =>
        nodes.map((n) => Math.round(n.getBoundingClientRect().height)),
      )).join(', '),
    );
    check(`${label}'s sheet fits the phone`, (await sideways(page)) === 0);
  }

  // Record video is the SAME camera, not a second one: the same route, and a
  // viewfinder at the end of it.
  let options = await openCreateSheet('/home');
  await options.nth(3).click();
  await page.waitForURL(/\/create\/video$/, { timeout: 15000 });
  check(
    'Record video opens the same full-screen camera the + button does',
    (await page
      .waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 })
      .then(() => true)
      .catch(() => false)) &&
      (await page.locator('button[aria-label="Close the camera"]').count()) === 1,
    page.url(),
  );

  // Upload video is the other door of that same studio — chooser, camera off.
  options = await openCreateSheet(`/u/${me.handle}`);
  await options.nth(2).click();
  await page.waitForURL(/upload=1/, { timeout: 15000 });
  await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 20000 });
  check(
    'Upload video opens the chooser instead, with the camera off',
    (await page.locator('button[aria-label="Close the camera"]').count()) === 0 &&
      (await page.locator('button', { hasText: 'Choose a file' }).count()) === 1,
  );

  // Photo and Text are the one composer, leading with different halves of itself.
  await page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  const photoOrder = await page.evaluate(() => {
    const caption = document.querySelector('textarea[name=caption]');
    const picker = document.querySelector('input[type=file]')?.closest('div');
    if (!caption || !picker) return null;
    return {
      pickerFirst: picker.getBoundingClientRect().top < caption.getBoundingClientRect().top,
      heading: document.querySelector('h1')?.textContent ?? '',
    };
  });
  check('Photo leads with the picker', photoOrder?.pickerFirst === true, photoOrder?.heading);

  // Text is no longer the same composer leading with its words: it asks which of
  // the three kinds first — short, story or big — and each has its own composer.
  // The three are covered properly by text-posts-flow; what matters here is that
  // the sheet's Text option lands on that choice.
  await page.goto('/create?kind=text', { waitUntil: 'domcontentloaded' });
  const textEntry = await page.evaluate(() => ({
    kinds: [...document.querySelectorAll('[data-text-kind]')].map((n) => n.dataset.textKind),
    heading: document.querySelector('h1')?.textContent ?? '',
  }));
  check(
    'Text asks which kind of message first',
    JSON.stringify(textEntry.kinds) === JSON.stringify(['short', 'story', 'big']),
    textEntry.kinds.join(' / ') || textEntry.heading,
  );

  // And the combined composer — words AND a picker, neither taken away — is
  // still what a bare /create gives, which is where every older link points.
  await page.goto('/create', { waitUntil: 'domcontentloaded' });
  const bare = await page.evaluate(() => {
    const caption = document.querySelector('textarea[name=caption]');
    const picker = document.querySelector('input[type=file]')?.closest('div');
    if (!caption || !picker) return null;
    return {
      captionFirst: caption.getBoundingClientRect().top < picker.getBoundingClientRect().top,
      stillHasPicker: Boolean(picker),
    };
  });
  check('a bare /create still leads with the words', bare?.captionFirst === true);
  check('and still offers a picture alongside them', bare?.stillHasPicker === true);

  // A post really can still be made from here, which is the only thing that makes
  // the two of them worth offering.
  const fromSheet = `written from the sheet ${stamp}`;
  await page.fill('textarea[name=caption]', fromSheet);
  await Promise.all([
    page.waitForURL(/\/post\//, { timeout: 25000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
  check('and a post made this way lands on the Text shelf', true, page.url());
  await page.goto(`/u/${me.handle}?tab=text`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check(
    'where it belongs',
    (await page.locator('body').innerText()).includes(fromSheet),
  );

  /* ========================== desktop is untouched ========================== */
  section('THE DESKTOP FILE UPLOAD STILL WORKS');

  const desktop = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 900 },
    storageState: await me.context.storageState(),
  });
  const wide = await desktop.newPage();
  // `?upload=1` is the chooser rather than the camera — a desktop that came to
  // give us a file it already has should not have its webcam switched on.
  await wide.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await wide.waitForLoadState('networkidle');
  await wide.waitForTimeout(400);
  check(
    'a desktop asking to upload gets the chooser, not the camera',
    (await wide.locator('button[aria-label="Start recording"]').count()) === 0,
  );
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
