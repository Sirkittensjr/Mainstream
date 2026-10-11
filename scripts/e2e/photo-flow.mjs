/**
 * Photos, end to end: what is posted is what is stored is what is shown.
 *
 *   1. The file stored is byte for byte the file chosen, in its own format —
 *      a JPEG stays a JPEG, a PNG a PNG, a WebP a WebP, EXIF and all.
 *   2. The post records the photo's real size, upright (a phone photo stored
 *      sideways with an EXIF rotation counts as the portrait it is).
 *   3. Portrait, landscape, square, sideways, tiny and very tall photos show
 *      WHOLE — no crop — in the feed, Discover, search, the profile and the
 *      post page, on a phone and on a desktop: `object-contain`, nothing of
 *      the picture outside its frame, and the frame the photo's own shape
 *      unless the photo is taller than the screen allows.
 *   4. A small photo is not blown up past its own size.
 *   5. Lists show a high-quality resized copy; the post page shows the
 *      original file itself, at its full pixel size, and tapping it opens that
 *      file. Tapping a photo in a list opens the post.
 *   6. A post made before sizes were recorded still shows its photo whole.
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/photo-flow.mjs
 *
 * Needs the GoTrue stub, a built app and an EMPTY store (Discover then has
 * room for every post). Fixtures are made here with sharp, which Next installs.
 */
import { chromium, devices } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const STORE = process.env.FAY_STORE || '.data/faytarra.json';
const CHROMIUM = process.env.CHROMIUM_PATH;
const PASSWORD = 'a long enough password';
const SHOTS = process.env.SHOTS_DIR;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const store = () => JSON.parse(readFileSync(STORE, 'utf8'));
async function settle(predicate, timeout = 8000) {
  const until = Date.now() + timeout;
  for (;;) {
    let snapshot = null;
    try {
      snapshot = store();
    } catch {
      /* mid-write */
    }
    if (snapshot && predicate(snapshot)) return snapshot;
    if (Date.now() >= until) return snapshot;
    await wait(250);
  }
}
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

// --- fixtures ------------------------------------------------------------------

/** A picture with detail in it — gradients, lines and text — so compression shows. */
function art(width, height, label) {
  const lines = Array.from({ length: 24 }, (_, i) => {
    const x = Math.round(((i + 1) * width) / 25);
    return `<line x1="${x}" y1="0" x2="${width - x}" y2="${height}" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>`;
  }).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d53a7b"/><stop offset="0.5" stop-color="#2b6cb0"/><stop offset="1" stop-color="#f6ad55"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>${lines}
    <rect x="4" y="4" width="${width - 8}" height="${height - 8}" fill="none" stroke="#00ff66" stroke-width="8"/>
    <text x="50%" y="50%" font-size="${Math.round(Math.min(width, height) / 8)}" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text>
  </svg>`);
}

async function fixtures() {
  return [
    {
      key: 'portrait',
      name: 'portrait.jpg',
      mime: 'image/jpeg',
      buffer: await sharp(art(1200, 1600, 'PORTRAIT')).jpeg({ quality: 92 }).toBuffer(),
      width: 1200,
      height: 1600,
    },
    {
      key: 'landscape',
      name: 'landscape.png',
      mime: 'image/png',
      buffer: await sharp(art(1600, 900, 'LANDSCAPE')).png().toBuffer(),
      width: 1600,
      height: 900,
    },
    {
      key: 'square',
      name: 'square.webp',
      mime: 'image/webp',
      buffer: await sharp(art(1000, 1000, 'SQUARE')).webp({ quality: 90 }).toBuffer(),
      width: 1000,
      height: 1000,
    },
    {
      // Stored as 1600×1200 landscape pixels with "rotate 90°" in its EXIF,
      // the way phones write portrait photos. Viewers see 1200×1600.
      key: 'sideways',
      name: 'IMG_0042.JPG',
      mime: 'image/jpeg',
      buffer: await sharp(art(1600, 1200, 'SIDEWAYS')).withMetadata({ orientation: 6 }).jpeg({ quality: 92 }).toBuffer(),
      width: 1200,
      height: 1600,
    },
    {
      key: 'tiny',
      name: 'tiny.jpg',
      mime: 'image/jpeg',
      buffer: await sharp(art(300, 200, 'TINY')).jpeg({ quality: 92 }).toBuffer(),
      width: 300,
      height: 200,
    },
    {
      key: 'tall',
      name: 'screenshot.png',
      mime: 'image/png',
      buffer: await sharp(art(600, 2400, 'TALL')).png().toBuffer(),
      width: 600,
      height: 2400,
    },
  ];
}

// --- accounts and posting ------------------------------------------------------

async function signUp(browser, email, handle) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]').first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/verify-email/, { timeout: 25000 });
  const link = [...mails()].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

async function post(actor, fixture, caption) {
  const { page } = actor;
  await page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file]').setInputFiles({ name: fixture.name, mimeType: fixture.mime, buffer: fixture.buffer });
  await page.waitForSelector('form img', { timeout: 20000 });
  await page.fill('textarea[name=caption]', caption);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
  return page.url().split('/post/')[1].split(/[?#]/)[0];
}

// --- looking at a photo on a page ------------------------------------------------

/** Everything needed to tell whether a post's photo is shown whole. */
async function look(page, postId) {
  const article = page.locator(`article:has(a[href="/post/${postId}"]), article:has([data-post-photo="original"])`).first();
  if (!(await article.count())) return null;
  const img = article.locator('img[data-post-photo]').first();
  if (!(await img.count())) return null;
  await img.scrollIntoViewIfNeeded();
  await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await img.elementHandle(), { timeout: 15000 }).catch(() => {});
  return img.evaluate((el) => {
    const frame = el.closest('[data-photo-frame]');
    const box = el.getBoundingClientRect();
    const outer = frame.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      fit: style.objectFit,
      maxHeight: parseFloat(style.maxHeight),
      box: { x: box.x, y: box.y, w: box.width, h: box.height },
      frame: { x: outer.x, y: outer.y, w: outer.width, h: outer.height },
      nw: el.naturalWidth,
      nh: el.naturalHeight,
      src: el.currentSrc,
      kind: el.dataset.postPhoto,
      href: frame.getAttribute('href'),
    };
  });
}

function judge(where, fixture, seen, mediaUrl, postId) {
  const label = `${where}: ${fixture.key}`;
  if (!seen) {
    check(`${label} — on the page`, false, 'not found');
    return;
  }
  const expected = fixture.width / fixture.height;
  const natural = seen.nw / seen.nh;
  const inside =
    seen.box.x >= seen.frame.x - 1 &&
    seen.box.y >= seen.frame.y - 1 &&
    seen.box.x + seen.box.w <= seen.frame.x + seen.frame.w + 1 &&
    seen.box.y + seen.box.h <= seen.frame.y + seen.frame.h + 1;
  const clamped = seen.box.h >= seen.maxHeight - 1;
  const boxRatio = seen.box.w / seen.box.h;
  check(
    `${label} — whole, not cropped`,
    seen.fit === 'contain' && inside && Math.abs(natural - expected) < 0.02 && (clamped || Math.abs(boxRatio - expected) < 0.02),
    `fit=${seen.fit} natural=${seen.nw}×${seen.nh} box=${Math.round(seen.box.w)}×${Math.round(seen.box.h)} frame=${Math.round(seen.frame.w)}×${Math.round(seen.frame.h)}${clamped ? ' (fitted to the screen height)' : ''}`,
  );
  if (fixture.key === 'tiny') {
    check(`${label} — not blown up past its own size`, seen.box.w <= fixture.width + 1, `${Math.round(seen.box.w)}px wide`);
  }
  if (seen.kind === 'original') {
    const absolute = new URL(mediaUrl, BASE).href;
    check(
      `${label} — the original file, at full size`,
      seen.src === absolute && seen.nw === fixture.width && seen.nh === fixture.height,
      `${seen.src.replace(BASE, '')} ${seen.nw}×${seen.nh}`,
    );
    check(`${label} — tapping it opens the original`, seen.href === mediaUrl);
  } else {
    const copy = new URL(seen.src);
    check(
      `${label} — a high-quality copy of this photo`,
      copy.pathname === '/_next/image' && copy.searchParams.get('url') === mediaUrl && copy.searchParams.get('q') === '90',
      seen.src.replace(BASE, ''),
    );
    check(`${label} — tapping it opens the post`, seen.href === `/post/${postId}`);
  }
}

async function run() {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`.slice(-8);
  const author = await signUp(browser, `ph${stamp}@example.com`, `ph${stamp}`);
  const viewer = await signUp(browser, `pv${stamp}@example.com`, `pv${stamp}`);
  const files = await fixtures();

  /* ==================================================================== */
  section('POSTING: THE FILE STORED IS THE FILE CHOSEN');
  const posts = [];
  for (const fixture of files) {
    const caption = `photo${stamp} ${fixture.key}`;
    const id = await post(author, fixture, caption);
    const row = (await settle((s) => s.posts.some((p) => p.id === id)))?.posts.find((p) => p.id === id);
    const media = row?.media?.[0];
    posts.push({ fixture, id, url: media?.url });
    const response = await fetch(new URL(media.url, BASE), { cache: 'no-store' });
    const stored = Buffer.from(await response.arrayBuffer());
    check(
      `${fixture.key}: stored byte for byte as chosen`,
      sha(stored) === sha(fixture.buffer) && stored.length === fixture.buffer.length,
      `${fixture.buffer.length} → ${stored.length} bytes`,
    );
    check(`${fixture.key}: kept as ${fixture.mime}`, response.headers.get('content-type') === fixture.mime, response.headers.get('content-type') ?? '');
    check(
      `${fixture.key}: the post knows its real, upright size`,
      media?.width === fixture.width && media?.height === fixture.height,
      `${media?.width}×${media?.height}`,
    );
  }
  const sideways = posts.find((p) => p.fixture.key === 'sideways');
  const sidewaysBytes = Buffer.from(await (await fetch(new URL(sideways.url, BASE))).arrayBuffer());
  check('the sideways photo still carries its EXIF rotation', (await sharp(sidewaysBytes).metadata()).orientation === 6);

  // A post from before sizes were recorded: the same upload, with the size
  // taken out of the answer, is exactly what such a post looks like.
  const legacyFixture = { ...files[0], key: 'legacy' };
  await author.page.route('**/api/upload', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.width;
    delete body.height;
    await route.fulfill({ response, json: body });
  });
  const legacyId = await post(author, legacyFixture, `photo${stamp} legacy`);
  await author.page.unroute('**/api/upload');
  const legacyRow = (await settle((s) => s.posts.some((p) => p.id === legacyId)))?.posts.find((p) => p.id === legacyId);
  check('an older post really has no size recorded', legacyRow?.media?.[0] && legacyRow.media[0].width === undefined);
  posts.push({ fixture: legacyFixture, id: legacyId, url: legacyRow?.media?.[0]?.url });

  /* ==================================================================== */
  for (const [device, options] of [
    ['phone', { ...devices['iPhone 13'] }],
    ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
  ]) {
    section(`SHOWN WHOLE — ${device.toUpperCase()}`);
    const context = await browser.newContext({ ...options, baseURL: BASE, storageState: await viewer.context.storageState() });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`${page.url()} ${error}`));
    const surfaces = [
      ['feed', '/home?tab=recommended'],
      ['Discover', '/discover'],
      ['search', `/search?q=photo${stamp}`],
      ['profile', `/u/${author.handle}`],
    ];
    for (const [where, url] of surfaces) {
      await page.goto(url, { waitUntil: 'networkidle' });
      for (const item of posts) judge(`${device} ${where}`, item.fixture, await look(page, item.id), item.url, item.id);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${device}-${where}.png`, fullPage: true });
    }
    for (const item of posts) {
      await page.goto(`/post/${item.id}`, { waitUntil: 'networkidle' });
      judge(`${device} post page`, item.fixture, await look(page, item.id), item.url, item.id);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${device}-post-${item.fixture.key}.png` });
    }
    check(`${device}: no horizontal scroll on a post page`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    // React #418 is a known mismatch unrelated to photos: a card's relative
    // time ("now" / "1m") is worked out on the server and again in the
    // browser, and differs when a minute ticks over in between. Reported, not
    // counted; any other error is.
    const clock = errors.filter((error) => /Minified React error #418/.test(error));
    if (clock.length) console.log(`NOTE  ${device}: ${clock.length} relative-time hydration mismatch(es) (#418), not a photo error`);
    const other = errors.filter((error) => !clock.includes(error));
    check(`${device}: no page errors`, other.length === 0, other[0] ?? '');
    await context.close();
  }

  /* ==================================================================== */
  section('TAPPING A PHOTO IN A LIST OPENS THE POST');
  await viewer.page.goto(`/u/${author.handle}`, { waitUntil: 'networkidle' });
  const portrait = posts.find((p) => p.fixture.key === 'portrait');
  await viewer.page.locator(`a[data-photo-frame][href="/post/${portrait.id}"]`).click();
  await viewer.page.waitForURL(new RegExp(`/post/${portrait.id}`), { timeout: 15000 }).catch(() => {});
  const opened = await viewer.page.locator('img[data-post-photo="original"]').first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  check('the post opens, with the original photo', viewer.page.url().includes(`/post/${portrait.id}`) && opened, viewer.page.url().replace(BASE, ''));

  await browser.close();
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
