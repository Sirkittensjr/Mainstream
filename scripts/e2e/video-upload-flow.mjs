/**
 * Posting a video the way a phone does it.
 *
 * The whole point of this suite is the transport: the file must go from the
 * browser straight to Supabase Storage, in chunks, and no part of it may ever
 * be a request body the app receives. That is not something a screenshot can
 * show, so it is measured — every request the page makes is recorded, and the
 * checks are about which host got the bytes.
 *
 * Runs against the stubs, which speak the same HTTP protocols as the real
 * thing: GoTrue for auth, PostgREST for data, and Storage including its
 * resumable (TUS) endpoint, all behind one origin.
 *
 *   STUB_PORT=54321 node scripts/e2e/gotrue-stub.mjs &
 *   STORAGE_PORT=54500 node scripts/e2e/storage-stub.mjs &
 *   PORT=55300 GOTRUE_PORT=54321 STORAGE_PORT=54500 node scripts/e2e/postgrest-stub.mjs &
 *   BASE_URL=http://localhost:3100 STUB=http://127.0.0.1:55300 \
 *     node scripts/e2e/video-upload-flow.mjs
 */
import { chromium } from 'playwright';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const STUB = process.env.STUB || 'http://127.0.0.1:55300';
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

/**
 * A file of a given size that is still a real, playable video.
 *
 * Written to disk rather than handed over as a buffer: Playwright refuses to
 * pass more than 50MB in memory, and the point of these is to be big.
 * WebM readers stop at the last cluster, so the padding is ignored by the
 * player and by the server's probe while still costing real transfer.
 */
function paddedFixture(name, megabytes) {
  const target = path.join(tmpdir(), `fay-${megabytes}mb-${name}`);
  if (!existsSync(target)) {
    const real = readFileSync(path.join(FIXTURES, name));
    const padding = Math.max(0, megabytes * 1024 * 1024 - real.length);
    writeFileSync(target, Buffer.concat([real, Buffer.alloc(padding)]));
  }
  return { path: target, bytes: statSync(target).size };
}

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

async function createAccount(browser, handle, options = {}) {
  const context = await browser.newContext({ baseURL: BASE, ...options });
  const page = await context.newPage();
  const email = `${handle}@example.com`;
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]', { hasText: 'Music' }).first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForFunction(() => location.pathname.startsWith('/verify-email'), undefined, {
    timeout: 60000,
  });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  return { context, page, handle };
}

/**
 * Records every request the page makes, and how many bytes of body actually
 * went out.
 *
 * `postDataBuffer()` is null for a large or streamed body, which would make
 * every measurement here read zero and every check pass for the wrong reason.
 * `sizes()` is what the browser really sent.
 */
function watchRequests(page) {
  const seen = [];
  page.on('requestfinished', (request) => {
    seen.push(
      request
        .sizes()
        .then((sizes) => ({
          url: request.url(),
          method: request.method(),
          bytes: sizes.requestBodySize,
        }))
        .catch(() => ({ url: request.url(), method: request.method(), bytes: 0 })),
    );
  });
  return seen;
}

/** Settles the recorded requests. */
const settle = (seen) => Promise.all(seen);

const appBytes = (entries) =>
  entries
    .filter((entry) => entry.url.startsWith(BASE))
    .reduce((most, entry) => Math.max(most, entry.bytes), 0);

/**
 * How many bytes of upload body Storage actually received.
 *
 * Asked of Storage rather than of the browser: Chromium reports a streamed
 * request body as zero bytes, so measuring this page-side would make every
 * check here pass for the wrong reason.
 */
async function storageBytes() {
  const stats = await (await fetch(`${STUB.replace('55300', '54500')}/__stats`)).json();
  return stats.total ?? 0;
}

const resetStorageBytes = () =>
  fetch(`${STUB.replace('55300', '54500')}/__stats`, { method: 'POST' });

async function openStudio(page) {
  await page.goto('/create', { waitUntil: 'domcontentloaded' });
  await page.locator('button[role=tab]', { hasText: 'Video' }).click();
  await page.waitForSelector('text=Post a video', { timeout: 15000 });
}

const run = async () => {
  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const stamp = Date.now().toString(36).slice(-6);

  // A phone, because that is what this is for.
  const A = await createAccount(browser, `vid_${stamp}`, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const B = await createAccount(browser, `see_${stamp}`);

  /* ============================== the simple UI ========================== */
  section('SIMPLE — one video, no clips anywhere');

  await openStudio(A.page);
  const empty = await A.page.locator('body').innerText();
  check('the first screen says what fits', /2 minutes and 250MB/.test(empty), empty.split('\n').find((l) => /minutes and/.test(l)));
  check('it offers Select video', (await A.page.locator('button', { hasText: 'Select video' }).count()) === 1);

  await A.page.locator('input[type=file]').setInputFiles(fixture('portrait.webm'));
  await A.page.waitForSelector('#video-title', { timeout: 20000 });
  const composing = await A.page.locator('body').innerText();
  check('the video is previewed', (await A.page.locator('video').count()) >= 1);
  check('its length is shown', /0:0[23]/.test(composing), composing.split('\n').find((l) => /^0:/.test(l)));
  check(
    'the caption, tags and content warning are all there',
    /title/i.test(composing) && /tags/i.test(composing) && /content warning/i.test(composing),
  );
  check('and nothing about clips is on screen', !/Clip 1|Combining|clip 1 of/i.test(composing));
  check('no upload has started yet', (await A.page.locator('text=Uploading').count()) === 0);

  /* ============================== the transport ========================== */
  section('TRANSPORT — the bytes never touch the app');

  const seen = watchRequests(A.page);
  await resetStorageBytes();
  await A.page.fill('#video-title', `phone clip ${stamp}`);
  await A.page.fill('#video-tags', `phone${stamp}`);
  // Twice, as fast as a thumb on a phone that thinks nothing happened. The
  // second tap must not start a second upload or a second post.
  const postButton = A.page.locator('button', { hasText: /^Post video$/ });
  await postButton.click();
  await postButton.click({ timeout: 2000, force: true }).catch(() => undefined);
  await A.page.waitForURL(/\/post\//, { timeout: 120000 });
  const postId = A.page.url().split('/post/')[1];
  check('the post was created', Boolean(postId), A.page.url());

  const sent = await settle(seen);
  const video = fixture('portrait.webm').buffer.length;
  const toStorage = await storageBytes();
  check(
    'the video went to Supabase Storage, not to FayTarra',
    toStorage >= video,
    `${(toStorage / 1024).toFixed(0)}KB to storage, file is ${(video / 1024).toFixed(0)}KB`,
  );
  check(
    'the largest request the app received is metadata-sized',
    appBytes(sent) < 64 * 1024,
    `${appBytes(sent)} bytes`,
  );
  check(
    'nothing was posted to /api/upload at all',
    !sent.some((entry) => entry.url.endsWith('/api/upload') && entry.bytes > 0),
  );
  check(
    'the upload was resumable, chunk by chunk',
    sent.some((entry) => entry.method === 'POST' && entry.url.includes('/upload/resumable')) &&
      sent.some((entry) => entry.method === 'PATCH' && entry.url.includes('/upload/resumable')),
    `${sent.filter((e) => e.method === 'PATCH').length} chunks`,
  );

  /* ================================ the post ============================= */
  section('POST — an ordinary FayTarra post');

  const stored = await (await fetch(`${STUB}/__dump`)).json();
  const row = (stored.posts ?? []).find((post) => post.id === postId);
  check('the row is in the database', Boolean(row));
  check(
    'and only one row, however many times Post was tapped',
    (stored.posts ?? []).filter((post) => (post.caption ?? '').includes(`phone clip ${stamp}`))
      .length === 1,
  );
  check('with the storage URL on it', /\/storage\/v1\/object\/public\/.*media\//.test(row?.media?.[0]?.url ?? ''), row?.media?.[0]?.url?.slice(0, 80));
  check('marked as a video', row?.media?.[0]?.kind === 'video');
  check('with its duration stored', typeof row?.media?.[0]?.duration === 'number', String(row?.media?.[0]?.duration));
  check('and its title as the caption', (row?.caption ?? '').includes(`phone clip ${stamp}`));
  check('and the tag', (row?.tags ?? []).includes(`phone${stamp}`));
  check('nothing is left in the pending folder', !JSON.stringify(stored).includes('"pending/'));

  await B.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  check('another account can watch it', (await B.page.locator('video[controls]').count()) === 1);

  /* ============================== a big file ============================= */
  section('BIG — past the one-request ceiling');

  await openStudio(A.page);
  const big = paddedFixture('portrait.webm', 9);
  await A.page.locator('input[type=file]').setInputFiles(big.path);
  await A.page.waitForSelector('#video-title', { timeout: 30000 });
  const bigSeen = watchRequests(A.page);
  await resetStorageBytes();
  await A.page.fill('#video-title', `big clip ${stamp}`);
  await A.page.locator('button', { hasText: /^Post video$/ }).click();
  await A.page.waitForURL(/\/post\//, { timeout: 180000 });
  const bigSent = await settle(bigSeen);
  const bigToStorage = await storageBytes();
  check(
    'a 9MB video posts, which one 4.5MB request could never carry',
    bigToStorage >= big.bytes,
    `${(bigToStorage / 1024 / 1024).toFixed(1)}MB to storage`,
  );
  check(
    'in more than one chunk',
    bigSent.filter((entry) => entry.method === 'PATCH').length >= 2,
    `${bigSent.filter((e) => e.method === 'PATCH').length} chunks`,
  );
  check('and the app still received nothing large', appBytes(bigSent) < 64 * 1024, `${appBytes(bigSent)} bytes`);

  /* ============================== refusals =============================== */
  section('REFUSED — before anything is uploaded');

  await openStudio(A.page);
  const beforeLong = watchRequests(A.page);
  await resetStorageBytes();
  await A.page.locator('input[type=file]').setInputFiles(fixture('toolong.webm'));
  await A.page.waitForTimeout(3000);
  const longMessage = await A.page.locator('body').innerText();
  check(
    'a video over two minutes is refused',
    /long\. FayTarra videos can be up to 2 minutes/.test(longMessage) &&
      (await A.page.locator('#video-title').count()) === 0,
    longMessage.split('\n').find((l) => /trim it/i.test(l))?.slice(0, 100),
  );
  await settle(beforeLong);
  const afterLong = await storageBytes();
  check('and nothing was sent anywhere first', afterLong === 0, `${afterLong} bytes`);

  await openStudio(A.page);
  const beforeHuge = watchRequests(A.page);
  await resetStorageBytes();
  await A.page.locator('input[type=file]').setInputFiles(paddedFixture('tiny.webm', 260).path);
  await A.page.waitForTimeout(4000);
  check(
    'a file over 250MB is refused',
    /Videos can be up to 250MB/.test(await A.page.locator('body').innerText()),
  );
  await settle(beforeHuge);
  check('again without uploading a byte', (await storageBytes()) === 0);

  /* ============================= interruption ============================ */
  if (process.env.EXPECT_INTERRUPTION === '1') {
    section('INTERRUPTED — the connection drops mid-upload');

    await openStudio(A.page);
    const resumeFile = paddedFixture('portrait.webm', 14);
    await A.page.locator('input[type=file]').setInputFiles(resumeFile.path);
    await A.page.waitForSelector('#video-title', { timeout: 30000 });
    await resetStorageBytes();
    await A.page.fill('#video-title', `resumed ${stamp}`);
    await A.page.locator('button', { hasText: /^Post video$/ }).click();
    await A.page.waitForURL(/\/post\//, { timeout: 240000 });
    const resent = await storageBytes();
    check('R. the upload finished despite the drop', A.page.url().includes('/post/'));
    check(
      'R. and picked up where it stopped rather than starting again',
      resent < resumeFile.bytes * 1.6,
      `${(resent / 1024 / 1024).toFixed(1)}MB sent for a ${(resumeFile.bytes / 1024 / 1024).toFixed(0)}MB file`,
    );
  }

  /* ============================= cancellation ============================ */
  section('CANCEL — and no half-finished object left behind');

  await openStudio(A.page);
  await A.page.locator('input[type=file]').setInputFiles(paddedFixture('portrait.webm', 24).path);
  await A.page.waitForSelector('#video-title', { timeout: 30000 });
  await A.page.fill('#video-title', `cancelled ${stamp}`);
  await A.page.locator('button', { hasText: /^Post video$/ }).click();
  await A.page.waitForSelector('button:has-text("Cancel")', { timeout: 30000 });
  check('the progress shows a real percentage', /\d+%/.test(await A.page.locator('body').innerText()));
  check('and the Post button is locked while it runs', await A.page.locator('button', { hasText: 'Posting…' }).isDisabled());
  await A.page.locator('button', { hasText: 'Cancel' }).click();
  await A.page.waitForTimeout(2500);
  check('cancelling leaves you on the composer', (await A.page.locator('#video-title').count()) === 1);
  check('and does not create a post', !(await A.page.url()).includes('/post/'));
  const afterCancel = await (await fetch(`${STUB}/__dump`)).json();
  check(
    'no post row was written',
    !(afterCancel.posts ?? []).some((post) => (post.caption ?? '').includes(`cancelled ${stamp}`)),
  );
  check('and it can be posted again afterwards', await A.page.locator('button', { hasText: /^Post video$/ }).isEnabled());

  /* =============================== the feeds ============================= */
  section('FEEDS — one post, every surface');

  /**
   * Polled rather than read once: the post list behind the feeds is shared
   * between visitors and held for up to a minute, so a brand new post takes a
   * beat to appear everywhere. That is this site's caching, not a post that
   * failed to be created.
   */
  let lastSeen = '';
  async function appears(page, where, needle) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      // A different URL each time, so nothing between here and the server can
      // hand back a copy of the answer it gave a moment ago.
      const url = `${where}${where.includes('?') ? '&' : '?'}t=${Date.now()}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      // /home streams: it flushes its loading skeleton first and the posts
      // arrive after. Reading the body at domcontentloaded there gets the
      // skeleton, which contains no post and no empty state either — twenty
      // attempts of that look exactly like a feed that is missing a post.
      await page.waitForLoadState('networkidle').catch(() => undefined);
      lastSeen = await page.locator('body').innerText();
      if (lastSeen.includes(needle)) return true;
      await page.waitForTimeout(5000);
    }
    return false;
  }

  const summarise = () =>
    lastSeen
      .split('\n')
      .filter((line) => /clip|Nothing|quiet|sign in|error/i.test(line))
      .slice(0, 4)
      .join(' | ')
      .slice(0, 160);

  const needle = `phone clip ${stamp}`;
  check('it is in the normal feed', await appears(B.page, '/home?tab=recommended', needle), summarise());
  check('and in the Videos feed', await appears(B.page, '/videos', needle), summarise());
  check('and on the creator profile', await appears(B.page, `/u/${A.handle}`, needle), summarise());
  check(
    'and findable by its tag',
    await appears(B.page, `/search?q=phone${stamp}`, needle),
    summarise(),
  );

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
