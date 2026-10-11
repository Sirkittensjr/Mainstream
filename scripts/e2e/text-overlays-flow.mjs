/**
 * Several lines of text on one video, each with its own timing, moved and
 * pinched to size on a phone — and the posted video carrying all of it.
 *
 * Two clips (about 4s and 6s) and three lines:
 *
 *   One    0–3s   (clip 1)
 *   Two    2–5s   (across the join between the clips)
 *   Three  6–9s   (clip 2)
 *
 * In the editor, on an iPhone-sized touch screen:
 *   - adding a line never replaces or resets another; the Add control is
 *     labelled and always there;
 *   - timing one line changes no other, and a line just timed stays on screen
 *     (it used to vanish: the playhead was parked at its OLD end);
 *   - picking a line brings it on screen (it used to stay invisible);
 *   - the preview shows exactly the lines whose windows contain the playhead,
 *     in project time, across the join;
 *   - dragging moves only that line; two-finger pinch resizes only that line,
 *     around the point between the fingers — with both fingers on the text, and
 *     with the second finger on bare video — without playing, seeking,
 *     scrolling or zooming; the corner handle resizes with a mouse; a resized
 *     line stays inside the frame;
 *   - tapping a line selects it rather than adding one; delete removes only it;
 *   - all of it survives switching tools.
 * Then Next, Post, and the posted video: every line's words, place, size and
 * window in the stored post; the post page and the Videos feed each show the
 * right lines at the right moments, over the picture, at the right size. And a
 * single-clip video with two overlapping lines.
 *
 * Pinches are real two-finger touches (Chrome DevTools Input.dispatchTouchEvent),
 * which arrive as two touch pointers exactly as they do on a phone.
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/text-overlays-flow.mjs
 *
 * Needs the GoTrue stub and a built app, against an EMPTY store.
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
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

async function phoneAccount(browser, handle) {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
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
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
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

async function openTool(page, key) {
  const button = page.locator(`[data-editor-tool="${key}"]`);
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await page.waitForSelector(`[data-editor-panel="${key}"]`, { timeout: 5000 });
}

async function setRange(locator, value) {
  await locator.evaluate((element, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** Every line drawn on the editor's video right now. */
const drawn = (page) =>
  page.evaluate(() => {
    const layer = document.querySelector('[data-video-text]');
    const frame = layer?.getBoundingClientRect();
    return [...document.querySelectorAll('[data-video-text-line]')].map((node) => {
      const box = node.getBoundingClientRect();
      return {
        index: Number(node.getAttribute('data-video-text-line')),
        text: node.querySelector('[data-video-text-words]')?.textContent ?? '',
        x: Number.parseFloat(node.style.left) / 100,
        y: Number.parseFloat(node.style.top) / 100,
        scale: Number(node.getAttribute('data-video-text-scale')),
        selected: node.getAttribute('data-video-text-selected') === 'true',
        cx: box.left + box.width / 2,
        cy: box.top + box.height / 2,
        inside: frame
          ? box.left >= frame.left - 1 && box.right <= frame.right + 1 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1
          : false,
      };
    });
  });

const textsOnScreen = async (page) => (await drawn(page)).map((line) => line.text).sort().join(',');
const lineOf = async (page, index) => (await drawn(page)).find((line) => line.index === index);

/** The picked line's window, from its handles. */
const windowNow = (page) =>
  page.evaluate(() => ({
    from: Number(document.querySelector('[data-editor-text-handle="from"]')?.getAttribute('aria-valuenow')),
    to: Number(document.querySelector('[data-editor-text-handle="to"]')?.getAttribute('aria-valuenow')),
    total: Number(document.querySelector('[data-editor-text-handle="to"]')?.getAttribute('aria-valuemax')),
  }));

const editorTime = (page) =>
  page.evaluate(() => {
    const [now] = (document.querySelector('[data-editor-time]')?.textContent ?? '').split('/');
    const [m, s] = now.trim().split(':');
    return Number(m) * 60 + Number(s);
  });

/** Drags one end of the picked line's window to `seconds`. */
async function dragTextEdge(page, edge, seconds, total) {
  const grip = await page.locator(`[data-editor-text-handle="${edge}"]`).boundingBox();
  const rail = await page.locator('[data-editor-track]').boundingBox();
  const y = grip.y + grip.height / 2;
  // The grip's bar sits 4px in from its box on the start side, and 4px in from
  // its right edge on the end side; aim the bar, not the box.
  const startX = edge === 'from' ? grip.x + 4 + 3 : grip.x + grip.width - 4 - 3;
  const target = rail.x + (rail.width * seconds) / total;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await page.mouse.move(startX + (target - startX) * step, y);
    await wait(40);
  }
  await page.mouse.up();
  await wait(400);
}

async function setWindow(page, from, to) {
  const { total } = await windowNow(page);
  const current = await windowNow(page);
  // Move whichever end would otherwise block the other, first.
  if (to > current.from) {
    await dragTextEdge(page, 'to', to, total);
    await dragTextEdge(page, 'from', from, total);
  } else {
    await dragTextEdge(page, 'from', from, total);
    await dragTextEdge(page, 'to', to, total);
  }
  return windowNow(page);
}

async function pick(page, index) {
  await page.locator(`[data-editor-overlay="${index}"]`).click();
  await wait(500);
}

async function seek(page, seconds) {
  await setRange(page.locator('[data-editor-timeline]'), seconds);
  await wait(500);
}

/** Real touches, through DevTools: arrive as touch pointers, as on a phone. */
async function touch(client, type, points) {
  await client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })),
  });
}

/** Two fingers from `a0`,`b0` to `a1`,`b1`, in steps. */
async function pinchGesture(client, a0, b0, a1, b1, { secondLater = false } = {}) {
  if (secondLater) {
    await touch(client, 'touchStart', [a0]);
    await wait(60);
  }
  await touch(client, 'touchStart', [a0, b0]);
  for (let step = 1; step <= 8; step += 1) {
    const t = step / 8;
    const at = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    await touch(client, 'touchMove', [at(a0, a1), at(b0, b1)]);
    await wait(30);
  }
  await touch(client, 'touchEnd', []);
  await wait(400);
}

async function oneFingerDrag(client, from, to) {
  await touch(client, 'touchStart', [from]);
  for (let step = 1; step <= 8; step += 1) {
    const t = step / 8;
    await touch(client, 'touchMove', [[from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]]);
    await wait(30);
  }
  await touch(client, 'touchEnd', []);
  await wait(400);
}

const quiet = (page) =>
  page.evaluate(() => ({
    playing: document.querySelector('[data-editor-playpause]')?.getAttribute('aria-label') === 'Pause',
    zoom: window.visualViewport ? Math.round(window.visualViewport.scale * 100) / 100 : 1,
    scrollY: window.scrollY,
  }));

async function addLine(page, words) {
  const add = page.locator('[data-editor-add-text]');
  await add.click();
  await page.locator('[data-editor-text-input]').fill(words);
  await wait(300);
}

async function postFromEditor(page, title) {
  await page.locator('[data-editor-next]').click();
  await page.waitForSelector('[data-post-stage]', { timeout: 180000 });
  await page.fill('#video-title', title);
  await page.locator('[data-post-button]').click();
  await page.waitForURL(/\/post\//, { timeout: 180000 });
  return page.url().split('/post/')[1].split(/[?#]/)[0];
}

const apiPost = (page, id) =>
  page.evaluate(async (postId) => (await fetch(`/api/v1/posts/${postId}`, { cache: 'no-store' })).json(), id);

/** Puts a <video> at `seconds` and says which lines its surface draws. */
async function playerShows(page, root, seconds) {
  return page.evaluate(
    async ({ selector, t }) => {
      const scope = document.querySelector(selector);
      const video = scope?.querySelector('video');
      if (!video) return 'no video';
      video.pause();
      await new Promise((resolve) => {
        const done = () => {
          video.removeEventListener('seeked', done);
          resolve();
        };
        video.addEventListener('seeked', done);
        video.currentTime = t;
        setTimeout(resolve, 1500);
      });
      video.dispatchEvent(new Event('timeupdate'));
      await new Promise((r) => setTimeout(r, 300));
      return [...scope.querySelectorAll('[data-video-text-words]')].map((n) => n.textContent).sort().join(',');
    },
    { selector: root, t: seconds },
  );
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
  const { page } = await phoneAccount(browser, `txt_${stamp}`);
  const client = await page.context().newCDPSession(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  /* ============================================================ the project */
  section('TWO CLIPS, THREE LINES OF TEXT');
  await page.goto('/create/video', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  await record(page, 4);
  await record(page, 6);
  await page.locator('[data-camera-next]').click();
  await page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  check('the editor has both clips', (await page.locator('[data-editor-clip]').count()) === 2);
  await openTool(page, 'text');
  const addBox = await page.locator('[data-editor-add-text]').boundingBox();
  check('Add text is there, and big enough to tap', addBox && addBox.width >= 44 && addBox.height >= 36, JSON.stringify(addBox));

  await addLine(page, 'One');
  let w = await windowNow(page);
  const total = w.total;
  check('the project is long enough for the three windows', total >= 9.3, `${total}s`);
  check('a new line shows for the whole video until it is timed', near(w.from, 0, 0.05) && near(w.to, total, 0.1), JSON.stringify(w));

  w = await setWindow(page, 0, 3);
  check('One is timed 0–3s', near(w.from, 0, 0.25) && near(w.to, 3, 0.25), JSON.stringify(w));
  check(
    'and it is STILL ON SCREEN after timing its end (it used to vanish)',
    (await textsOnScreen(page)).includes('One'),
    `on screen: [${await textsOnScreen(page)}] at ${await editorTime(page)}s`,
  );

  const addAgain = await page.locator('[data-editor-add-text]').boundingBox();
  check(
    'with a line picked, Add is still a labelled, tappable control',
    addAgain && addAgain.width >= 44 && /Text/.test(await page.locator('[data-editor-add-text]').innerText()),
    `${Math.round(addAgain?.width ?? 0)}px, “${(await page.locator('[data-editor-add-text]').innerText()).trim()}”`,
  );
  await addLine(page, 'Two');
  check('adding a second line keeps the first: two numbered lines', (await page.locator('[data-editor-overlay]').count()) === 2);
  w = await setWindow(page, 2, 5);
  check('Two is timed 2–5s', near(w.from, 2, 0.25) && near(w.to, 5, 0.25), JSON.stringify(w));

  await addLine(page, 'Three');
  w = await setWindow(page, 6, 9);
  check('Three is timed 6–9s', near(w.from, 6, 0.25) && near(w.to, 9, 0.25), JSON.stringify(w));

  section('EACH LINE HAS ITS OWN WINDOW');
  const windows = [];
  for (const index of [0, 1, 2]) {
    await pick(page, index);
    windows.push(await windowNow(page));
    check(
      `picking line ${index + 1} brings it on screen`,
      (await drawn(page)).some((line) => line.index === index),
      `t=${await editorTime(page)}s, on screen [${await textsOnScreen(page)}]`,
    );
  }
  const expected = [[0, 3], [2, 5], [6, 9]];
  check(
    'One 0–3, Two 2–5, Three 6–9 — timing one changed none of the others',
    windows.every((each, i) => near(each.from, expected[i][0], 0.25) && near(each.to, expected[i][1], 0.25)),
    windows.map((each) => `${each.from.toFixed(2)}–${each.to.toFixed(2)}`).join(' · '),
  );
  const lanes = await page.locator('[data-editor-text-lane]').count();
  check('the other lines’ windows are drawn faintly on the strip', lanes === 2, `${lanes} lanes`);
  check('the editor still knows the words of every line', (await page.locator('[data-editor-overlay]').count()) === 3);

  section('THE PREVIEW SHOWS EACH LINE ONLY IN ITS WINDOW (project time, across the join)');
  const clipOne = Number(
    (await page.locator('[data-editor-clip]').first().innerText()).match(/0:0?(\d+(?:\.\d+)?)/)?.[1] ?? 0,
  );
  for (const [t, want] of [
    [1, 'One'],
    [2.5, 'One,Two'],
    [4.6, 'Two'],
    [5.6, ''],
    [7, 'Three'],
    [9.25, ''],
  ]) {
    await seek(page, t);
    const shown = await textsOnScreen(page);
    check(`at ${t}s: [${want}]`, shown === want, `[${shown}]`);
  }
  check('Two’s window really does cross the join between the clips', clipOne > 2 && clipOne < 5, `clip 1 is ${clipOne}s`);

  /* ============================================================== gestures */
  section('DRAG — only that line moves');
  await pick(page, 2);
  let before = await drawn(page);
  const three = before.find((line) => line.index === 2);
  const layer = await page.locator('[data-video-text]').boundingBox();
  await oneFingerDrag(client, [three.cx, three.cy], [three.cx - layer.width * 0.2, three.cy - layer.height * 0.25]);
  let after = await lineOf(page, 2);
  check(
    'one finger drags Three up and to the left',
    after && after.x < three.x - 0.1 && after.y < three.y - 0.15,
    `${three.x.toFixed(2)},${three.y.toFixed(2)} → ${after?.x.toFixed(2)},${after?.y.toFixed(2)}`,
  );
  check('and its size did not change', after?.scale === 1);
  let q = await quiet(page);
  check('the drag played nothing, scrolled nothing, zoomed nothing', !q.playing && q.zoom === 1 && q.scrollY === 0, JSON.stringify(q));

  section('PINCH — resize only the selected line, around the fingers');
  await seek(page, 2.5);
  await pick(page, 0);
  before = await drawn(page);
  let one = before.find((line) => line.index === 0);
  const twoBefore = before.find((line) => line.index === 1);
  const timeBefore = await editorTime(page);
  await pinchGesture(client, [one.cx - 20, one.cy], [one.cx + 20, one.cy], [one.cx - 50, one.cy], [one.cx + 50, one.cy]);
  after = await drawn(page);
  one = after.find((line) => line.index === 0);
  const two = after.find((line) => line.index === 1);
  check('pinching outward makes One bigger', one && one.scale >= 2, `scale ${one?.scale}`);
  check('anchored: its centre stayed where the fingers were', near(one.x, before[0].x, 0.03) && near(one.y, before[0].y, 0.03), `${before[0].x.toFixed(3)},${before[0].y.toFixed(3)} → ${one.x.toFixed(3)},${one.y.toFixed(3)}`);
  check('Two, also on screen, did not change at all', two && two.scale === 1 && near(two.x, twoBefore.x, 0.001) && near(two.y, twoBefore.y, 0.001), JSON.stringify(two));
  q = await quiet(page);
  check('the pinch did not start playback or zoom the page', !q.playing && q.zoom === 1 && q.scrollY === 0, JSON.stringify(q));
  check('and did not seek the timeline', near(await editorTime(page), timeBefore, 0.15), `${timeBefore} → ${await editorTime(page)}`);
  check('One is still inside the frame', one.inside);

  await pick(page, 1);
  let twoNow = await lineOf(page, 1);
  await pinchGesture(client, [twoNow.cx - 60, twoNow.cy], [twoNow.cx + 60, twoNow.cy], [twoNow.cx - 30, twoNow.cy], [twoNow.cx + 30, twoNow.cy]);
  twoNow = await lineOf(page, 1);
  check('pinching inward makes Two smaller', twoNow && twoNow.scale < 0.8, `scale ${twoNow?.scale}`);
  check('One kept the size it was given', (await lineOf(page, 0))?.scale === one.scale);

  // One finger on the line, the second landing on bare video beside it.
  const twoBeforeSplit = await lineOf(page, 1);
  const bare = [layer.x + layer.width * 0.5, layer.y + layer.height * 0.9];
  await pinchGesture(
    client,
    [twoBeforeSplit.cx, twoBeforeSplit.cy],
    bare,
    [twoBeforeSplit.cx, twoBeforeSplit.cy - 30],
    [bare[0], bare[1] + 25],
    { secondLater: true },
  );
  const twoAfterSplit = await lineOf(page, 1);
  check(
    'a second finger on bare video still pinches the line',
    twoAfterSplit && twoAfterSplit.scale > twoBeforeSplit.scale,
    `${twoBeforeSplit.scale} → ${twoAfterSplit?.scale}`,
  );
  q = await quiet(page);
  check('and that finger did not tap play/pause underneath', !q.playing, JSON.stringify(q));

  section('RESIZE HANDLE — with a mouse');
  await pick(page, 0);
  const handle = await page.locator('[data-video-text-resize="0"]').boundingBox();
  const centre = await lineOf(page, 0);
  check('the selected line is outlined and has a resize handle', centre?.selected && Boolean(handle));
  const sizeBefore = centre.scale;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(centre.cx + (handle.x - centre.cx) * 0.6, centre.cy + (handle.y - centre.cy) * 0.6, { steps: 6 });
  await page.mouse.up();
  await wait(400);
  const shrunk = await lineOf(page, 0);
  check('dragging the handle inward shrinks it', shrunk && shrunk.scale < sizeBefore, `${sizeBefore} → ${shrunk?.scale}`);
  q = await quiet(page);
  check('and did not play the video', !q.playing);

  section('KEPT INSIDE THE FRAME');
  const edge = await lineOf(page, 0);
  await pinchGesture(client, [edge.cx - 15, edge.cy], [edge.cx + 15, edge.cy], [layer.x + 2, edge.cy], [layer.x + layer.width - 2, edge.cy]);
  const huge = await lineOf(page, 0);
  check('pinched as big as it goes, the whole line is still inside the video', huge && huge.inside, JSON.stringify(huge));

  section('TAP SELECTS — it never adds a line');
  await seek(page, 2.5);
  const twoTap = await lineOf(page, 1);
  await touch(client, 'touchStart', [[twoTap.cx, twoTap.cy]]);
  await touch(client, 'touchEnd', []);
  await wait(400);
  check(
    'tapping Two on the video picks it, and there are still three lines',
    (await page.locator('[data-editor-overlay]').count()) === 3 &&
      (await page.locator('[data-editor-overlay="1"]').getAttribute('aria-pressed')) === 'true',
  );
  q = await quiet(page);
  check('and the tap did not start playback', !q.playing);

  section('DELETE — only the selected line goes');
  await addLine(page, 'Four');
  check('a fourth line', (await page.locator('[data-editor-overlay]').count()) === 4);
  check('which is the most a video may carry, so Add is gone', (await page.locator('[data-editor-add-text]').count()) === 0);
  await page.locator('[data-editor-text-remove]').click();
  await wait(300);
  check('deleted: three lines again, and Add is back', (await page.locator('[data-editor-overlay]').count()) === 3 && (await page.locator('[data-editor-add-text]').count()) === 1);

  /** Everything about every line, read from the editor. */
  async function snapshot() {
    const out = [];
    for (const index of [0, 1, 2]) {
      await pick(page, index);
      const line = await lineOf(page, index);
      out.push({
        text: await page.locator('[data-editor-text-input]').inputValue(),
        window: await windowNow(page),
        x: line?.x,
        y: line?.y,
        scale: line?.scale,
      });
    }
    return out;
  }
  const kept = await snapshot();
  check('the three lines are One, Two, Three', kept.map((l) => l.text).join(',') === 'One,Two,Three', kept.map((l) => l.text).join(','));

  section('EVERYTHING SURVIVES SWITCHING TOOLS');
  for (const tool of ['trim', 'sound', 'crop', 'cover', 'text']) await openTool(page, tool);
  const back = await snapshot();
  check(
    'words, windows, places and sizes are exactly as they were',
    JSON.stringify(back) === JSON.stringify(kept),
    JSON.stringify(back.map((l) => [l.text, l.window.from, l.window.to, l.scale])),
  );

  /* ================================================================ posted */
  section('POSTED: THE VIDEO CARRIES EVERY LINE');
  const postId = await postFromEditor(page, `Three lines ${stamp}`);
  check('it posts', Boolean(postId), postId);
  const body = await apiPost(page, postId);
  const media = body?.post?.media?.[0];
  const stored = media?.text ?? [];
  check('all three lines are on the posted video', stored.length === 3, `${stored.length}`);
  for (const [i, line] of kept.entries()) {
    const got = stored[i] ?? {};
    check(
      `${line.text}: words, window, place and size kept`,
      got.text === line.text &&
        near(got.from, line.window.from, 0.06) &&
        near(got.to, line.window.to, 0.06) &&
        near(got.x, line.x, 0.01) &&
        near(got.y, line.y, 0.01) &&
        near(got.scale ?? 1, line.scale, 0.01),
      JSON.stringify(got),
    );
  }
  check('the posted video is as long as the project was', near(media?.duration ?? 0, total, 0.6), `${media?.duration} vs ${total}`);

  section('THE POST PAGE SHOWS EACH LINE AT ITS TIME');
  await page.goto(`/post/${postId}`, { waitUntil: 'networkidle' });
  const root = 'article';
  for (const [t, want] of [
    [1, 'One'],
    [2.5, 'One,Two'],
    [4.6, 'Two'],
    [5.6, ''],
    [7, 'Three'],
  ]) {
    const shown = await playerShows(page, root, t);
    check(`post page at ${t}s: [${want}]`, shown === want, `[${shown}]`);
  }
  await playerShows(page, root, 2.5);
  const sizes = await page.evaluate(() => {
    const frame = document.querySelector('article [data-video-text]')?.getBoundingClientRect();
    return [...document.querySelectorAll('article [data-video-text-line]')].map((node) => {
      const words = node.querySelector('[data-video-text-words]');
      const box = node.getBoundingClientRect();
      return {
        text: words.textContent,
        font: Number.parseFloat(getComputedStyle(words).fontSize),
        x: (box.left + box.width / 2 - frame.left) / frame.width,
        y: (box.top + box.height / 2 - frame.top) / frame.height,
      };
    });
  });
  const oneOnPost = sizes.find((s) => s.text === 'One');
  const twoOnPost = sizes.find((s) => s.text === 'Two');
  check(
    'and at the sizes they were given: One’s type is bigger than Two’s by their scales',
    oneOnPost && twoOnPost && near(oneOnPost.font / twoOnPost.font, kept[0].scale / kept[1].scale, 0.25),
    `${oneOnPost?.font}px / ${twoOnPost?.font}px vs ${(kept[0].scale / kept[1].scale).toFixed(2)}`,
  );
  check(
    'in the places they were put',
    twoOnPost && near(twoOnPost.x, kept[1].x, 0.04) && near(twoOnPost.y, kept[1].y, 0.04),
    `${twoOnPost?.x.toFixed(2)},${twoOnPost?.y.toFixed(2)} vs ${kept[1].x.toFixed(2)},${kept[1].y.toFixed(2)}`,
  );

  section('THE VIDEOS FEED, TOO — over the picture, timed, even when paused');
  await page.goto(`/videos?v=${postId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('section[data-index="0"] video', { timeout: 20000 });
  check('the feed draws the text over the picture’s own box', (await page.locator('section[data-index="0"] [data-video-picture-box]').count()) === 1);
  // Sampled as it plays, against the player's own clock — the local media
  // route has no Range support, so this video cannot be seeked here.
  const samples = await page.evaluate(async () => {
    const slide = document.querySelector('section[data-index="0"]');
    const video = slide.querySelector('video');
    video.muted = true;
    await video.play().catch(() => undefined);
    const out = [];
    const end = performance.now() + 11000;
    while (performance.now() < end) {
      await new Promise((r) => setTimeout(r, 120));
      out.push({
        t: video.currentTime,
        lines: [...slide.querySelectorAll('[data-video-text-words]')].map((n) => n.textContent).sort().join(','),
      });
    }
    video.pause();
    return out;
  });
  const want = (t) =>
    kept
      .filter((line) => t >= line.window.from && t <= line.window.to)
      .map((line) => line.text)
      .sort()
      .join(',');
  // A line appears on the first timeupdate inside its window — up to a quarter
  // of a second late — so moments that close to an edge are not judged.
  const edges = kept.flatMap((line) => [line.window.from, line.window.to]);
  const judged = samples.filter((sample) => edges.every((e) => Math.abs(sample.t - e) > 0.35));
  const wrong = judged.filter((sample) => sample.lines !== want(sample.t));
  check(
    'as it plays, the feed shows exactly the lines whose window it is in',
    judged.length > 30 && wrong.length === 0,
    `${judged.length} moments judged, ${wrong.length} wrong${wrong.length ? `: ${wrong.slice(0, 3).map((w) => `${w.t.toFixed(2)}s [${w.lines}]`).join(' ')}` : ''}`,
  );
  const sets = new Set(judged.map((sample) => sample.lines));
  check('and it went through every combination: One · One,Two · Two · none · Three', ['One', 'One,Two', 'Two', '', 'Three'].every((set) => sets.has(set)), [...sets].map((x) => `[${x}]`).join(' '));
  await page.evaluate(async () => {
    const slide = document.querySelector('section[data-index="0"]');
    const video = slide.querySelector('video');
    await new Promise((r) => {
      const t = () => (video.currentTime > 7 && video.currentTime < 8.5 ? (video.pause(), r()) : setTimeout(t, 50));
      video.play().then(t, r);
      setTimeout(r, 12000);
    });
  });
  await wait(400);
  const pausedLines = await page.evaluate(() =>
    [...document.querySelectorAll('section[data-index="0"] [data-video-text-words]')].map((n) => n.textContent).sort().join(','),
  );
  check('paused at about 7.5s, only Three — not every line at once', pausedLines === 'Three', `[${pausedLines}]`);
  const fit = await page.evaluate(() => {
    const slide = document.querySelector('section[data-index="0"]');
    const box = slide.querySelector('[data-video-picture-box]').getBoundingClientRect();
    const video = slide.querySelector('video');
    const ratio = video.videoWidth / video.videoHeight;
    return { boxRatio: box.width / box.height, ratio };
  });
  check('that box is the picture’s shape', near(fit.boxRatio, fit.ratio, 0.02), JSON.stringify(fit));

  /* ============================================================ one clip */
  section('A SINGLE-CLIP VIDEO WITH TWO OVERLAPPING LINES');
  await page.goto('/create/video', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="Start recording"]', { timeout: 25000 });
  await record(page, 5);
  await page.locator('[data-camera-next]').click();
  await page.waitForSelector('[data-editor-fullscreen]', { timeout: 20000 });
  await openTool(page, 'text');
  await addLine(page, 'Alpha');
  const a = await setWindow(page, 0, 2.5);
  await addLine(page, 'Beta');
  const b = await setWindow(page, 1, 3.5);
  await seek(page, 1.8);
  check('both show where they overlap', (await textsOnScreen(page)) === 'Alpha,Beta', `[${await textsOnScreen(page)}]`);
  await seek(page, 3);
  check('and only Beta after Alpha ends', (await textsOnScreen(page)) === 'Beta', `[${await textsOnScreen(page)}]`);
  const singleId = await postFromEditor(page, `One clip ${stamp}`);
  const single = (await apiPost(page, singleId))?.post?.media?.[0]?.text ?? [];
  check(
    'posted with both windows',
    single.length === 2 && near(single[0].from, a.from, 0.06) && near(single[0].to, a.to, 0.06) && near(single[1].from, b.from, 0.06) && near(single[1].to, b.to, 0.06),
    JSON.stringify(single.map((l) => [l.text, l.from, l.to])),
  );

  check('no errors on any page', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
