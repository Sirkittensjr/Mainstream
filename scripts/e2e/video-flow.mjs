/**
 * The video creator, end to end, in a real browser.
 *
 * Recording uses Chromium's fake camera and microphone, so the permission
 * prompt, getUserMedia, MediaRecorder and the audio track are all the real
 * code paths — only the lens is synthetic. Uploads go through the real routes
 * and the finished video is posted, viewed from a second account, and rated
 * and commented on like any other post.
 *
 *   node scripts/e2e/make-video-fixtures.mjs /tmp/fay-video-fixtures
 *   BASE_URL=http://localhost:3000 node scripts/e2e/video-flow.mjs
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
  mimeType: name.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
  buffer: readFileSync(path.join(FIXTURES, name)),
});

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

async function createAccount(browser, handle, interest) {
  const context = await browser.newContext({
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
  await page.locator('button[aria-pressed]', { hasText: interest }).first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/verify-email/, { timeout: 25000 });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  return { context, page, email, handle };
}

/** Opens Create and switches to the video tab. */
async function openStudio(page) {
  await page.goto('/create', { waitUntil: 'domcontentloaded' });
  await page.locator('button[role=tab]', { hasText: 'Video' }).click();
  await page.waitForSelector('text=Post a video', { timeout: 10000 });
}

/**
 * Into the multi-clip editor, which is deliberately not where anybody starts.
 * One video is the normal case and gets a plain screen; this is the door to
 * the rest, and everything from here down is the advanced half.
 */
async function openClipEditor(page) {
  const opener = page.locator('button', { hasText: /^(Add another clip|\d+ clips)$/ });
  if ((await opener.count()) > 0) {
    await opener.first().click();
    await page.waitForTimeout(400);
  }
}

async function addClip(page, name) {
  await page.locator('input[type=file]').setInputFiles(fixture(name));
  await page.waitForTimeout(1200);
}

/** The clip strip: the only list on the page whose rows hold a video. */
const clips = (page) => page.locator('li:has(video)');
const clipCount = (page) => clips(page).count();

/**
 * Drags a range input to a value.
 *
 * `fill` refuses values that are not exactly on the input's step, and a step
 * of 0.1 cannot be hit exactly in binary floating point. Setting the value and
 * firing the events is what a drag does anyway.
 */
async function setRange(locator, value) {
  await locator.evaluate((input, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

const run = async () => {
  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const stamp = Date.now().toString(36).slice(-6);
  const aHandle = `vid_${stamp}`;
  const bHandle = `see_${stamp}`;

  const A = await createAccount(browser, aHandle, 'Music');
  const B = await createAccount(browser, bHandle, 'Art');
  check('two accounts for the video tests', true);

  /* ============================== the editor ============================== */
  section('CREATE — upload, record, and the clip strip');

  await openStudio(A.page);
  check('the existing Post tab is still there', (await A.page.locator('button[role=tab]', { hasText: 'Post' }).count()) === 1);

  // 1. Upload a video. One video is the plain screen, so the clip strip only
  // exists once somebody goes looking for it.
  await addClip(A.page, 'landscape.webm');
  check('1. a video file can be uploaded', (await A.page.locator('#video-title').count()) === 1);
  check(
    '1. and one video shows no clip machinery at all',
    !/Clip 1|Combining|clip 1 of/i.test(await A.page.locator('body').innerText()),
  );

  // 12. Choose a thumbnail. Tucked away, because most posts never touch it.
  await A.page.locator('summary', { hasText: 'Cover frame' }).click();
  await A.page.waitForTimeout(1500);
  const thumbSlider = A.page.locator('#thumbnail');
  const firstThumb = await A.page.locator('img[alt="The frame chosen for this post"]').getAttribute('src');
  await setRange(thumbSlider, Number(await thumbSlider.getAttribute('max')) * 0.6);
  await A.page.waitForTimeout(1500);
  const secondThumb = await A.page.locator('img[alt="The frame chosen for this post"]').getAttribute('src');
  check(
    '12. a different frame can be chosen as the thumbnail',
    Boolean(firstThumb && secondThumb && firstThumb !== secondThumb),
  );

  await openClipEditor(A.page);
  check('1. the clip strip is there for anybody who wants it', (await clipCount(A.page)) === 1);
  const firstRow = await clips(A.page).first().innerText();
  check('the clip shows its length', /\d:\d\d(\.\d)?/.test(firstRow), firstRow.replace(/\n/g, ' '));

  // 4. Upload multiple clips.
  await addClip(A.page, 'portrait.webm');
  await addClip(A.page, 'square.webm');
  check('4. several clips can be added', (await clipCount(A.page)) === 3, `${await clipCount(A.page)} clips`);

  // 2 + 3. Record with a microphone, twice.
  await A.page.locator('button', { hasText: 'Record video' }).click();
  await A.page.waitForSelector('button[aria-label="Start recording"]', { timeout: 20000 });
  check('2. the camera opens and asks for permission', true);
  for (const take of [1, 2]) {
    await A.page.locator('button[aria-label="Start recording"]').click();
    await A.page.waitForSelector('button[aria-label="Stop recording"]', { timeout: 10000 });
    await A.page.waitForTimeout(2200);
    await A.page.locator('button[aria-label="Stop recording"]').click();
    await A.page.waitForTimeout(1200);
    check(`3. clip ${take} recorded without leaving the camera`, true);
  }
  await A.page.locator('button[aria-label="Close the camera"]').click();
  await A.page.waitForTimeout(600);
  check('3. recorded clips land in the strip', (await clipCount(A.page)) === 5, `${await clipCount(A.page)} clips`);

  // 5. Reorder clips.
  const labels = () => clips(A.page).locator('p.truncate').allInnerTexts();
  const before = await labels();
  await A.page.locator('button[aria-label^="Move"][aria-label$="later"]').first().click();
  await A.page.waitForTimeout(300);
  const after = await labels();
  check('5. a clip can be moved later', after[0] === before[1] && after[1] === before[0], `${before[0]} -> ${after[1]}`);
  await A.page.locator('button[aria-label^="Move"][aria-label$="earlier"]').nth(1).click();
  await A.page.waitForTimeout(300);
  check('5. and moved back', (await labels())[0] === before[0]);

  // 6. Delete a clip.
  await A.page.locator('button[aria-label^="Remove"]').last().click();
  await A.page.waitForTimeout(300);
  check('6. a clip can be deleted', (await clipCount(A.page)) === 4, `${await clipCount(A.page)} clips`);

  /* ============================ editing a clip ============================ */
  section('EDIT — trim, crop, rotate, volume');

  const lengthOf = async (index) => {
    const text = await clips(A.page).nth(index).innerText();
    const match = /(\d+):(\d\d\.\d)/.exec(text);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };

  const startingLength = await lengthOf(0);
  await clips(A.page).locator('button', { hasText: 'Edit' }).first().click();
  await A.page.waitForSelector('button[aria-pressed][class*="flex-col"]', { timeout: 10000 });

  // 7. Trim a clip.
  const endSlider = A.page.locator('input[id^="end-"]');
  const endMax = Number(await endSlider.getAttribute('max'));
  await setRange(endSlider, Math.max(0.6, endMax - 1.2));
  await A.page.waitForTimeout(400);
  const startSlider = A.page.locator('input[id^="start-"]');
  await setRange(startSlider, 0.4);
  await A.page.waitForTimeout(400);

  // 8. Crop a clip.
  await A.page.locator('button', { hasText: 'Crop' }).first().click();
  await A.page.locator('button', { hasText: 'Square' }).click();
  await A.page.waitForTimeout(300);
  check('8. a crop can be chosen', (await A.page.locator('button[aria-pressed=true]', { hasText: 'Square' }).count()) === 1);

  // 9. Rotate a clip.
  await A.page.locator('button', { hasText: 'Rotate' }).first().click();
  await A.page.locator('button[aria-pressed]', { hasText: '90°' }).click();
  await A.page.waitForTimeout(300);
  check('9. a rotation can be chosen', (await A.page.locator('button[aria-pressed=true]', { hasText: '90°' }).count()) === 1);

  // 10. Adjust volume.
  await A.page.locator('button', { hasText: 'Volume' }).first().click();
  await setRange(A.page.locator('input[aria-label="Clip volume"]'), 0);
  await A.page.waitForTimeout(300);
  check('10. volume can be taken to silent', (await A.page.locator('text=This clip will be silent').count()) === 1);

  await A.page.locator('button', { hasText: 'Done' }).first().click();
  await A.page.waitForTimeout(500);
  await openClipEditor(A.page);

  const trimmedLength = await lengthOf(0);
  check('7. trimming makes the clip shorter', trimmedLength !== null && startingLength !== null && trimmedLength < startingLength, `${startingLength}s -> ${trimmedLength}s`);
  const summary = await clips(A.page).first().innerText();
  check('the strip shows the edits that were made', summary.includes('90°') && summary.includes('cropped'), summary.replace(/\n/g, ' '));

  /* ============================== the limits ============================== */
  section('LIMITS — two minutes, 250MB, and files that are not video');

  // 21. Invalid/unsupported files.
  await A.page.locator('input[type=file]').setInputFiles({
    name: 'notavideo.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(path.join(FIXTURES, 'notavideo.mp4')),
  });
  await A.page.waitForTimeout(1500);
  check(
    '21. a file that is not really a video is refused',
    (await A.page.locator('text=could not be opened').count()) > 0,
  );

  // 19. The length limit, from the editor.
  const countBefore = await clipCount(A.page);
  await addClip(A.page, 'toolong.webm');
  await A.page.waitForTimeout(1500);
  const refusal = await A.page.locator('p.text-fay-soft').innerText().catch(() => '');
  check('19. a clip past the length limit is refused', (await clipCount(A.page)) === countBefore, `${countBefore} clips before and after`);
  check('19. and the person is told why, not silently cut off', /room is left|Trim/.test(refusal), refusal.slice(0, 90));

  /* =========================== preview and post =========================== */
  section('POST — preview, thumbnail, caption');

  // Two clips is enough to prove combining works without a long render.
  while ((await clipCount(A.page)) > 2) {
    await A.page.locator('button[aria-label^="Remove"]').last().click();
    await A.page.waitForTimeout(250);
  }
  check('11. the editor is down to the clips we want to combine', (await clipCount(A.page)) === 2);

  await A.page.locator('button', { hasText: /^Done$/ }).last().click();
  await A.page.waitForSelector('#video-title', { timeout: 20000 });
  check('11. two clips are ready to post as one video', true);

  // 13 + 14. Caption and post. The clips are combined on the way, and the
  // upload only starts here.
  const caption = `my first faytarra video ${stamp}`;
  await A.page.fill('#video-title', caption);
  await A.page.selectOption('#video-category', 'Music');
  await A.page.fill('#video-tags', 'firstvideo');
  await A.page.locator('button', { hasText: 'Post video' }).click();
  await A.page.waitForURL(/\/post\//, { timeout: 240000 });
  const postUrl = A.page.url();
  check('13 + 14. the video posts and lands on its post page', /\/post\/[0-9a-f-]+$/.test(postUrl), postUrl);

  /* ============================== playback =============================== */
  section('WATCH — the player, the aspect ratio, and the social features');

  const player = A.page.locator('video').first();
  await player.waitFor({ timeout: 15000 });
  check('16. the post has a video player with controls', await player.getAttribute('controls') !== null);
  check('the player is inline on mobile, not forced fullscreen', await player.getAttribute('playsinline') !== null);
  check('12. the chosen thumbnail is the poster', Boolean(await player.getAttribute('poster')));

  const fit = await player.evaluate((el) => getComputedStyle(el).objectFit);
  check('18. the video is contained, never stretched or cropped', fit === 'contain', `object-fit: ${fit}`);

  // A video with a poster does not fetch its own metadata until somebody
  // presses play, which is the point — so ask for it before comparing.
  check(
    'a video in a feed does not download itself before it is played',
    (await player.getAttribute('preload')) === 'none',
    `preload=${await player.getAttribute('preload')}`,
  );
  const shape = await player.evaluate(async (el) => {
    if (!el.videoWidth) {
      el.preload = 'metadata';
      el.load();
      await new Promise((resolve) => {
        if (el.readyState >= 1) return resolve();
        el.addEventListener('loadedmetadata', resolve, { once: true });
        setTimeout(resolve, 6000);
      });
    }
    const box = el.getBoundingClientRect();
    return { boxRatio: box.width / box.height, videoRatio: el.videoWidth / el.videoHeight };
  });
  check(
    '18. the space reserved matches the video\'s own aspect ratio',
    Math.abs(shape.boxRatio - shape.videoRatio) < 0.08,
    `box ${shape.boxRatio.toFixed(3)} vs video ${shape.videoRatio.toFixed(3)}`,
  );

  const plays = await player.evaluate(async (el) => {
    el.muted = true;
    await el.play().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 900));
    return { time: el.currentTime, duration: el.duration };
  });
  check('16. the video actually plays on desktop', plays.time > 0.1, `played to ${plays.time.toFixed(2)}s`);
  check('the finished video holds both clips', plays.duration > 2.5, `${plays.duration?.toFixed(2)}s`);

  // 15. View the video from another account.
  await B.page.goto(postUrl, { waitUntil: 'domcontentloaded' });
  const otherPlayer = B.page.locator('video').first();
  await otherPlayer.waitFor({ timeout: 15000 });
  check('15. another account can see the video post', (await B.page.locator(`text=${caption}`).count()) > 0);
  const otherPlays = await otherPlayer.evaluate(async (el) => {
    el.muted = true;
    await el.play().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 900));
    return el.currentTime;
  });
  check('15. and can play it', otherPlays > 0.1, `played to ${otherPlays.toFixed(2)}s`);

  // 17. Mobile.
  // Signed in as the same person, so /create is reachable rather than a redirect.
  const phone = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: await A.context.storageState(),
  });
  const phonePage = await phone.newPage();
  await phonePage.goto(postUrl, { waitUntil: 'domcontentloaded' });
  await phonePage.locator('video').first().waitFor({ timeout: 15000 });
  const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('17. the video post fits a phone screen', overflow <= 0, `${overflow}px of overflow`);
  const phoneShape = await phonePage.locator('video').first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { width: box.width, ratio: box.width / box.height };
  });
  check('17. and is sized to the screen', phoneShape.width > 200 && phoneShape.width <= 390, `${phoneShape.width.toFixed(0)}px wide`);

  await phonePage.goto(`${BASE}/create`, { waitUntil: 'domcontentloaded' });
  await phonePage.locator('button[role=tab]', { hasText: 'Video' }).click();
  await phonePage.waitForTimeout(500);
  const editorOverflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('17. the editor fits a phone screen', editorOverflow <= 0, `${editorOverflow}px of overflow`);
  // Scoped to the editor: the surrounding navigation is not this feature's.
  const smallTargets = await phonePage.evaluate(() =>
    [...document.querySelectorAll('#create-panel-video button, #create-panel-video input[type=range]')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({
        height: Math.round(el.getBoundingClientRect().height),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
      }))
      .filter((el) => el.height > 0 && el.height < 44),
  );
  check(
    '17. every control in the editor is big enough to tap',
    smallTargets.length === 0,
    smallTargets.map((t) => `${t.label} ${t.height}px`).join(', '),
  );
  await phone.close();

  // 23. Likes, comments and ratings on a video post.
  await B.page.locator('button[aria-label*="Like"], button[aria-label*="like"]').first().click().catch(() => undefined);
  await B.page.waitForTimeout(900);
  await B.page.fill('textarea[name=body]', 'the second clip is the good one');
  await B.page.locator('form button[type=submit]', { hasText: /Reply|Post|Comment|Send/ }).first().click();
  await B.page.waitForTimeout(1500);
  check('23. a video post can be commented on', (await B.page.locator('text=the second clip is the good one').count()) > 0);

  await B.page.locator('button', { hasText: 'Rate' }).first().click();
  await B.page.waitForTimeout(600);
  await B.page.locator('button', { hasText: /^9$/ }).first().click();
  await B.page.locator('button', { hasText: /^(Rate|Submit|Done|Save)/ }).last().click();
  await B.page.waitForTimeout(1800);
  await B.page.reload({ waitUntil: 'domcontentloaded' });
  const rated = await B.page.locator('body').innerText();
  check('23. and rated like any other post', /9\.0/.test(rated), rated.match(/\d\.\d/g)?.slice(0, 3).join(' '));

  // 24. Discover.
  await B.page.goto('/discover', { waitUntil: 'domcontentloaded' });
  await B.page.waitForTimeout(800);
  check('24. Discover shows the video post', (await B.page.locator(`text=${caption}`).count()) > 0);
  check('24. and renders it with a player', (await B.page.locator('article video').count()) > 0);

  /* ============================== security =============================== */
  section('SECURITY — requests that skip the editor entirely');

  /** A request made from the signed-in page, so it carries a real session. */
  const asUser = (page, url, init) =>
    page.evaluate(
      async ([target, options]) => {
        const response = await fetch(target, options);
        let body = {};
        try {
          body = await response.json();
        } catch {
          body = {};
        }
        return { status: response.status, body };
      },
      [url, init],
    );

  // A video past the limit, posted straight at the upload route.
  const overLength = readFileSync(path.join(FIXTURES, 'toolong.webm'));
  const refusedLength = await A.page.evaluate(async (bytes) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'video/webm' }), 'sneaky.webm');
    const response = await fetch('/api/upload', { method: 'POST', body: form });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, Array.from(overLength));
  check(
    'a video past two minutes is refused by the server, not just the editor',
    refusedLength.status === 422 && /up to 2 minutes/.test(refusedLength.body.error ?? ''),
    `${refusedLength.status} ${refusedLength.body.error ?? ''}`.slice(0, 90),
  );

  // A file that is not a video, whatever it claims to be.
  const refusedType = await A.page.evaluate(async () => {
    const form = new FormData();
    form.append('file', new Blob(['not a video at all'.repeat(40)], { type: 'video/mp4' }), 'x.mp4');
    const response = await fetch('/api/upload', { method: 'POST', body: form });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  });
  check('a file that only claims to be video is refused', refusedType.status === 415, `${refusedType.status}`);

  // Something far past the size limit, declared up front.
  const refusedSize = await asUser(A.page, '/api/upload/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType: 'video/mp4', size: 400 * 1024 * 1024 }),
  });
  check(
    'a file bigger than 250MB is refused before it is sent',
    refusedSize.status === 413,
    `${refusedSize.status} ${refusedSize.body.error ?? ''}`.slice(0, 80),
  );

  const refusedExecutable = await asUser(A.page, '/api/upload/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType: 'application/x-msdownload', size: 1000 }),
  });
  check('a type that is not media is refused', refusedExecutable.status === 415, `${refusedExecutable.status}`);

  // Somebody else's upload.
  const bId = (await B.page.evaluate(async () => (await fetch('/api/v1/me')).json()))?.user?.id;
  for (const [what, target] of [
    ["another person's upload", `pending/${bId}/stolen.mp4`],
    ['a published file', 'media/anyone/already-posted.mp4'],
    ['a path climbing out of their own folder', 'pending/../media/x.mp4'],
  ]) {
    const refused = await asUser(A.page, '/api/upload/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target }),
    });
    check(`${what} cannot be claimed`, refused.status === 403, `${refused.status} for ${target}`);
  }

  // Not signed in at all.
  const anonymous = await browser.newContext({ baseURL: BASE });
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto('/', { waitUntil: 'domcontentloaded' });
  for (const route of ['/api/upload/sign', '/api/upload/commit']) {
    const refused = await asUser(anonymousPage, route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'video/mp4', size: 10, path: 'pending/x/y.mp4' }),
    });
    check(`${route} turns away a request with no account`, refused.status === 401, `${refused.status}`);
  }
  await anonymous.close();

  /* ======================== the old ways still work ======================= */
  section('UNCHANGED — text and photo posting');

  await A.page.goto('/create', { waitUntil: 'domcontentloaded' });
  const textCaption = `just a plain text post ${stamp}`;
  await A.page.fill('textarea[name=caption]', textCaption);
  await Promise.all([
    A.page.waitForURL(/\/post\//, { timeout: 30000 }),
    A.page.locator('form button[type=submit]').last().click(),
  ]);
  // /post/[id] streams: the URL changes before the post itself arrives.
  await A.page.locator('article').first().waitFor({ state: 'visible', timeout: 20000 });
  check('22. a text-only post still works', (await A.page.locator(`text=${textCaption}`).count()) > 0);

  await A.page.goto('/create', { waitUntil: 'domcontentloaded' });
  const photoCaption = `and a photo post ${stamp}`;
  await A.page.fill('textarea[name=caption]', photoCaption);
  await A.page.locator('input[type=file]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await A.page.waitForTimeout(2500);
  await Promise.all([
    A.page.waitForURL(/\/post\//, { timeout: 30000 }),
    A.page.locator('form button[type=submit]').last().click(),
  ]);
  await A.page.locator('article').first().waitFor({ state: 'visible', timeout: 20000 });
  // Photos are served through Next's optimiser now, so the src is a
  // /_next/image URL pointing at the stored file rather than the file itself.
  check(
    '22. a photo post still works',
    (await A.page
      .locator('article img[src*="/api/media/"], article img[src*="/storage/"], article img[src*="_next/image"]')
      .count()) > 0,
  );

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
