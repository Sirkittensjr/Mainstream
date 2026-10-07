/**
 * The selected clip and the clip on screen are always the same clip.
 *
 * Found on an iPhone: three clips, Clip 3 highlighted, the Trim panel saying
 * "Clip 3 of 3" — and the preview showing Clip 1. The editor's selection and
 * the player's picture had come apart, so every tool was editing a clip that
 * was not the one being looked at. Then Next failed with "The browser would not
 * play this clip back."
 *
 * This walks the editor the way a thumb does and, after every step, compares
 * `data-editor-selected-clip` (what the tools act on) with the `data-clip-id`
 * of the visible player slot (what is on screen):
 *
 *   - picking Clip 1, 2 and 3, forwards and backwards, and rapidly;
 *   - trimming, changing the sound, turning (crop), undo and redo;
 *   - deleting a clip and adding one;
 *   - playing the whole project: Clip 1 -> 2 -> 3 in order, each at its own
 *     level, for its trimmed length, without stalling at a join;
 *   - and Next, which puts the video together.
 *
 * IT RUNS UNDER THE IPHONE'S PLAYBACK RULE. Every other video suite launches
 * Chromium with `--autoplay-policy=no-user-gesture-required`, which lets any
 * element play with sound at any time. iOS Safari does not: an element may
 * start with sound only inside a tap, or once it has been started inside one.
 * Chromium's own `user-gesture-required` is looser than that (it lets a page
 * play for seconds after any tap), and did NOT reproduce the iPhone's "The
 * browser would not play this clip back". So the rule is applied here as iOS
 * applies it, per element, by an init script around `play()` — and with it the
 * failure reproduced exactly, on Clip 1, the instant Next was tapped.
 * IOS_PLAY_RULE=0 turns it off.
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/editor-clip-sync-flow.mjs
 *
 * Needs the GoTrue stub, a built app and Playwright — the same setup as
 * multi-clip-flow.mjs.
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const CHROMIUM = process.env.CHROMIUM_PATH;
const POLICY = process.env.AUTOPLAY_POLICY || 'user-gesture-required';
const IOS_PLAY_RULE = process.env.IOS_PLAY_RULE !== '0';

/**
 * iOS Safari's rule for <video>, per element: it may play with sound only if
 * `play()` was called inside a tap — or was, once, earlier, which releases that
 * element for good. Muted video may always play. A tap here is the dispatch of
 * the input event plus whatever runs before the next task, which is how long
 * WebKit treats code as "processing a user gesture".
 */
function iosPlayRule() {
  let inTap = false;
  for (const type of ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown']) {
    window.addEventListener(
      type,
      () => {
        inTap = true;
        setTimeout(() => {
          inTap = false;
        }, 0);
      },
      true,
    );
  }
  const released = new WeakSet();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function playLikeAnIphone() {
    if (inTap) released.add(this);
    if (!this.muted && !released.has(this)) {
      window.__iosRefused = (window.__iosRefused || 0) + 1;
      return Promise.reject(new DOMException('play() with sound outside a tap', 'NotAllowedError'));
    }
    return play.call(this);
  };
}
const PASSWORD = 'a long enough password';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function setRange(input, value) {
  await input.evaluate((element, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/**
 * What the tools are about, against what is on screen.
 *
 * `shown` is the clip in the visible player slot; `inWindow` says its playhead
 * is inside that clip's kept part, read from the trim grips when they are open.
 */
const state = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-editor-fullscreen]');
    const slots = [...document.querySelectorAll('[data-clip-slot]')];
    const shown = slots.find((v) => Number(getComputedStyle(v).opacity) > 0.5);
    const rows = [...document.querySelectorAll('[data-editor-clip]')];
    const pressed = rows.findIndex((row) => row.getAttribute('aria-pressed') === 'true');
    const start = document.querySelector('[data-editor-handle="start"]');
    const end = document.querySelector('[data-editor-handle="end"]');
    const trimStart = start ? Number(start.getAttribute('aria-valuenow')) : null;
    const trimEnd = end ? Number(end.getAttribute('aria-valuenow')) : null;
    const t = shown ? shown.currentTime : null;
    return {
      selected: root?.getAttribute('data-editor-selected-clip') ?? null,
      shown: shown?.dataset.clipId ?? null,
      pressed,
      clips: rows.length,
      time: t === null ? null : Number(t.toFixed(2)),
      volume: shown ? Number(shown.dataset.clipVolume) : null,
      rotation: shown ? Number(shown.dataset.clipRotation) : null,
      inWindow:
        trimStart === null || t === null ? null : t >= trimStart - 0.05 && t <= trimEnd + 0.05,
      ready: shown ? shown.readyState : 0,
      src: shown ? shown.currentSrc : null,
      error: shown?.error ? shown.error.code : null,
    };
  });

/** Waits for selection and picture to agree, then says whether they did. */
async function settled(page, timeout = 4000) {
  const end = Date.now() + timeout;
  let now = await state(page);
  while (Date.now() < end) {
    if (now.selected && now.selected === now.shown && now.ready >= 2) return now;
    await wait(100);
    now = await state(page);
  }
  return now;
}

function describe(s) {
  return `selected ${s.selected?.slice(0, 6)} · shown ${s.shown?.slice(0, 6)} · row ${s.pressed + 1}/${s.clips} · t=${s.time}`;
}

/**
 * The file each clip id was first seen playing. A slot's id is only worth
 * trusting if it is always the same file: the player used to label slots by
 * POSITION, so after a delete one said "Clip 2" while playing Clip 1's file.
 */
const fileOf = new Map();

async function expectSynced(page, label, wantRow) {
  const s = await settled(page);
  let sameFile = true;
  if (s.shown && s.src) {
    if (!fileOf.has(s.shown)) fileOf.set(s.shown, s.src);
    sameFile = fileOf.get(s.shown) === s.src;
  }
  check(
    label,
    s.selected !== null &&
      s.selected === s.shown &&
      sameFile &&
      (wantRow === undefined || s.pressed === wantRow),
    sameFile ? describe(s) : `${describe(s)} · but the slot is playing ANOTHER clip's file`,
  );
  return s;
}

async function phoneAccount(browser, handle) {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    userAgent: undefined,
    baseURL: BASE,
    permissions: ['camera', 'microphone'],
  });
  if (IOS_PLAY_RULE) await context.addInitScript(iosPlayRule);
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
  return { context, page };
}

async function record(page, seconds) {
  await page.locator('button[aria-label="Start recording"]').click();
  await page.waitForSelector('button[aria-label="Stop recording"]', { timeout: 15000 });
  await wait(seconds * 1000);
  await page.locator('button[aria-label="Stop recording"]').click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 15000 });
}

const pick = (page, row) => page.locator(`[data-editor-clip="${row}"]`).click();

async function openTool(page, key) {
  const button = page.locator(`[data-editor-tool="${key}"]`);
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await page.waitForSelector(`[data-editor-panel="${key}"]`, { timeout: 5000 });
}

/** Drags a trim grip to a fraction of the zoomed strip. */
async function dragGrip(page, edge, fraction) {
  const grip = await page.locator(`[data-editor-handle="${edge}"]`).boundingBox();
  const rail = await page.locator('[data-editor-track]').boundingBox();
  const y = grip.y + grip.height / 2;
  await page.mouse.move(grip.x + grip.width / 2, y);
  await page.mouse.down();
  for (const step of [0.25, 0.5, 0.75, 1]) {
    const from = grip.x + grip.width / 2;
    const to = rail.x + rail.width * fraction;
    await page.mouse.move(from + (to - from) * step, y);
    await wait(40);
  }
  await page.mouse.up();
}

const lengths = (page) =>
  page
    .locator('[data-editor-clip]')
    .evaluateAll((rows) => rows.map((row) => row.querySelector('span:nth-child(2)')?.textContent));

async function run() {
  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--autoplay-policy=${POLICY}`,
    ],
  });
  const stamp = Date.now().toString(36).slice(-6);
  const { page } = await phoneAccount(browser, `sync_${stamp}`);
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  section(`THREE CLIPS: 3s, 4s, 5s  (autoplay ${POLICY}, iOS play rule ${IOS_PLAY_RULE ? 'on' : 'off'})`);
  await page.goto('/create/video', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  await record(page, 3);
  await record(page, 4);
  await record(page, 5);
  await page.waitForFunction(
    () => /3 clips/i.test(document.querySelector('[data-camera-clips]')?.textContent ?? ''),
    undefined,
    { timeout: 15000 },
  );
  await page.locator('[data-camera-next]').click();
  await page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  check('the editor has three clips', (await page.locator('[data-editor-clip]').count()) === 3);
  const ids = [];
  for (const row of [0, 1, 2]) {
    await pick(page, row);
    ids.push((await expectSynced(page, `Clip ${row + 1} opens`, row)).selected);
  }
  check('each clip has its own id', new Set(ids).size === 3, ids.map((id) => id?.slice(0, 6)).join(' '));

  /* ------------------------------------------------- picking each clip */
  section('PICKING CLIP 1, 2, 3 — the preview follows');
  for (const row of [0, 1, 2, 1, 0, 2, 0]) {
    await pick(page, row);
    const s = await expectSynced(page, `Clip ${row + 1} selected -> Clip ${row + 1} on screen`, row);
    check(`  and it is the clip that row is`, s.shown === ids[row], describe(s));
  }

  section('RAPID SWITCHING');
  for (const row of [2, 0, 1, 2, 0, 1, 2]) await pick(page, row);
  await expectSynced(page, 'seven fast taps end on Clip 3, showing Clip 3', 2);
  for (const row of [1, 2, 0, 2, 1, 0]) {
    await pick(page, row);
    await wait(30);
  }
  await expectSynced(page, 'and six more end on Clip 1, showing Clip 1', 0);

  /* ------------------------------------------------------- trimming */
  section('TRIM — the clip being trimmed stays the clip on screen');
  await openTool(page, 'trim');
  await pick(page, 2);
  await expectSynced(page, 'Trim open on Clip 3, showing Clip 3', 2);
  const trimLabel = await page.locator('[data-editor-panel="trim"]').innerText();
  check('the panel names Clip 3 of 3', /Clip 3 of 3/.test(trimLabel), trimLabel.replace(/\n/g, ' '));

  await dragGrip(page, 'start', 0.45);
  let s = await expectSynced(page, 'after trimming Clip 3’s start forward, still Clip 3 on screen', 2);
  check('  showing a frame inside what Clip 3 keeps', s.inWindow === true, describe(s));

  await pick(page, 1);
  await expectSynced(page, 'Clip 2 picked with Trim open', 1);
  await dragGrip(page, 'end', 0.6);
  s = await expectSynced(page, 'after trimming Clip 2’s end back, still Clip 2 on screen', 1);
  check('  showing a frame inside what Clip 2 keeps', s.inWindow === true, describe(s));

  await pick(page, 0);
  await expectSynced(page, 'Clip 1 picked after two trims', 0);
  await dragGrip(page, 'start', 0.3);
  s = await expectSynced(page, 'after trimming Clip 1’s start, still Clip 1 on screen', 0);
  check('  showing a frame inside what Clip 1 keeps', s.inWindow === true, describe(s));

  for (const row of [2, 1, 0]) {
    await pick(page, row);
    await expectSynced(page, `re-picking Clip ${row + 1} after the trims`, row);
  }
  const trimmed = await lengths(page);
  check('three trimmed lengths on the strip', trimmed.length === 3, trimmed.join(' · '));

  /* ---------------------------------------------------------- sound */
  section('SOUND — each clip at its own level');
  await openTool(page, 'sound');
  await pick(page, 1);
  await expectSynced(page, 'Sound open on Clip 2', 1);
  await setRange(page.locator('[data-editor-clip-volume]'), 0.3);
  await wait(300);
  s = await expectSynced(page, 'changing Clip 2’s level keeps Clip 2 on screen', 1);
  check('  and the preview plays Clip 2 at 0.3', s.volume === 0.3, `volume ${s.volume}`);
  await pick(page, 0);
  s = await expectSynced(page, 'Clip 1 picked', 0);
  check('  Clip 1 is still at its own level, 1', s.volume === 1, `volume ${s.volume}`);
  await page.locator('[data-editor-clip-mute]').click();
  await wait(300);
  s = await expectSynced(page, 'muting Clip 1 keeps Clip 1 on screen', 0);
  check('  and Clip 1 is muted', s.volume === 0, `volume ${s.volume}`);
  await pick(page, 1);
  s = await expectSynced(page, 'back to Clip 2', 1);
  check('  which kept its 0.3', s.volume === 0.3, `volume ${s.volume}`);
  const levels = await page
    .locator('[data-editor-clip]')
    .evaluateAll((rows) => rows.map((row) => Number(row.dataset.editorClipVolumeLevel)));
  check('the strip agrees: 0 · 0.3 · 1', levels.join(',') === '0,0.3,1', levels.join(','));

  /* ----------------------------------------------------------- crop */
  section('CROP — turning a clip');
  await openTool(page, 'crop');
  await pick(page, 2);
  await expectSynced(page, 'Crop open on Clip 3', 2);
  await page.locator('[data-editor-rotate]').click();
  await wait(300);
  s = await expectSynced(page, 'turning Clip 3 keeps Clip 3 on screen', 2);
  check('  and the preview shows Clip 3 turned', s.rotation === 90, `rotation ${s.rotation}`);
  await pick(page, 0);
  s = await expectSynced(page, 'Clip 1 picked after the turn', 0);
  check('  Clip 1 is not turned', s.rotation === 0, `rotation ${s.rotation}`);

  /* ------------------------------------------------------ undo, redo */
  if ((await page.locator('[data-editor-undo]').count()) > 0) {
    section('UNDO AND REDO');
    await pick(page, 2);
    await expectSynced(page, 'Clip 3 picked', 2);
    await page.locator('[data-editor-undo]').click();
    await wait(400);
    s = await expectSynced(page, 'undo (the turn) keeps selection and picture together', undefined);
    check('  Clip 3 is no longer turned', s.shown !== ids[2] || s.rotation === 0, describe(s));
    await page.locator('[data-editor-redo]').click();
    await wait(400);
    await expectSynced(page, 'redo keeps them together too', undefined);
    for (const row of [0, 1, 2]) {
      await pick(page, row);
      await expectSynced(page, `Clip ${row + 1} after undo/redo`, row);
    }
  }

  /* -------------------------------------------------- the whole video */
  section('PLAYBACK — Clip 1, then 2, then 3');
  await openTool(page, 'trim');
  await pick(page, 0);
  await expectSynced(page, 'Clip 1 picked to play from', 0);
  const total = await page.locator('[data-editor-timeline]').evaluate((i) => Number(i.max));
  const seen = [];
  await page.locator('[data-editor-playpause]').click();
  const started = Date.now();
  let lastTime = -1;
  let stalls = 0;
  while (Date.now() - started < (total + 6) * 1000) {
    const now = await state(page);
    const label = await page
      .locator('[data-editor-playpause]')
      .getAttribute('aria-label');
    if (now.shown && seen[seen.length - 1] !== now.shown) seen.push(now.shown);
    if (now.selected !== now.shown && seen.length > 0) {
      // While playing, selection follows the playhead within a frame or two.
      await wait(150);
      const again = await state(page);
      if (again.selected !== again.shown) stalls += 1000;
    }
    if (label === 'Play' && Date.now() - started > 800) break;
    if (now.time === lastTime) stalls += 1;
    lastTime = now.time;
    await wait(100);
  }
  const playedFor = (Date.now() - started) / 1000;
  const order = seen.map((id) => ids.indexOf(id) + 1).join(' -> ');
  // At the end it goes back to the top, paused, like a short video: so 1, 2, 3
  // and then Clip 1 again. That last step is where the selection used to stay
  // on Clip 3 over a picture of Clip 1.
  check(
    'the preview played Clip 1 -> 2 -> 3, in order, then back to Clip 1',
    order === '1 -> 2 -> 3 -> 1' || order === '1 -> 2 -> 3',
    order,
  );
  await expectSynced(page, 'after the play-through, Clip 1 is both selected and on screen', 0);
  check(
    'for the trimmed length of the project',
    playedFor > total - 1 && playedFor < total + 4,
    `${playedFor.toFixed(1)}s for a ${total.toFixed(1)}s project`,
  );
  check('selection followed the picture the whole way', stalls < 1000);
  check('and nothing stalled at a join', stalls < 15, `${stalls} still samples`);

  /* -------------------------------------------------- delete and add */
  section('DELETE CLIP 1, then ADD A CLIP');
  await pick(page, 0);
  await expectSynced(page, 'Clip 1 picked to delete', 0);
  await page.locator('[data-editor-delete]').click();
  await page.locator('[data-editor-confirm-delete] [data-editor-confirm-yes]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-editor-clip]').length === 2, undefined, {
    timeout: 5000,
  });
  s = await expectSynced(page, 'after deleting, selection and picture agree', undefined);
  check('  and neither is the deleted clip', s.selected !== ids[0] && s.shown !== ids[0], describe(s));
  for (const row of [0, 1, 0, 1]) {
    await pick(page, row);
    const after = await expectSynced(page, `Clip ${row + 1} of 2 after the delete`, row);
    check(`  is the old Clip ${row + 2}`, after.shown === ids[row + 1], describe(after));
  }

  await page.locator('[data-editor-add-clip]').click();
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 20000 });
  await record(page, 2);
  await page.locator('[data-camera-next]').click();
  await page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-editor-clip]').length === 3, undefined, {
    timeout: 10000,
  });
  s = await expectSynced(page, 'after adding a clip, selection and picture agree', undefined);
  for (const row of [2, 0, 1, 2]) {
    await pick(page, row);
    await expectSynced(page, `Clip ${row + 1} of 3 after the add`, row);
  }

  /* ---------------------------------------------------- putting it together */
  section('NEXT — the video is put together');
  await page.locator('[data-editor-next]').click();
  const outcome = await Promise.race([
    page
      .waitForSelector('[data-editor-fullscreen]', { state: 'detached', timeout: 90000 })
      .then(() => 'posting'),
    page.waitForSelector('[data-editor-problem]', { timeout: 90000 }).then(() => 'problem'),
  ]).catch(() => 'timeout');
  const problem =
    outcome === 'problem' ? await page.locator('[data-editor-problem]').innerText() : '';
  check(
    'Next reaches the posting screen, with no "would not play" error',
    outcome === 'posting',
    outcome === 'problem' ? problem : outcome,
  );

  const relevant = consoleErrors.filter((text) => /render|play|NotAllowed/i.test(text));
  check('no playback errors in the console', relevant.length === 0, relevant.slice(0, 2).join(' | '));
  if (IOS_PLAY_RULE) {
    const refused = await page.evaluate(() => window.__iosRefused || 0);
    check('nothing was refused by the iPhone play rule', refused === 0, `${refused} refused`);
  }

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
