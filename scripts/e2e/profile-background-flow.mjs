/**
 * Profile background photos, LOADED — not just present — for everybody.
 *
 * profile-appearance-flow.mjs checks that the backdrop's <img> is there and asks
 * the optimiser for a resized copy. It never checked that the picture arrived,
 * and so it kept passing while every background photo on the site was a broken
 * image: ProfileBackdrop asked /_next/image for quality 70, next.config.mjs
 * allows only the qualities in `images.qualities`, and the optimiser answers
 * any other with 400 `"q" parameter (quality) of 70 is not allowed`. Here, a
 * photo counts only when its request came back 200 as an image and the browser
 * decoded it (naturalWidth > 0).
 *
 *   EXISTING   backgrounds saved before this check existed, written straight to
 *              the database and storage as production holds them: one under
 *              media/<owner id>/ and one from before uploads had folders (the
 *              bucket root), each with a colour and box colour of its own
 *   EVERYBODY  the owner, another account and a guest; after a refresh; after
 *              signing out and back in; on a phone and a desktop
 *   KEPT       looking never rewrites a background, a colour or a box colour
 *   NEW        a photo uploaded and saved through Settings, then seen the same
 *              way by all three
 *
 * Against the Supabase stand-in (supabase-gateway.mjs), with storage served
 * over HTTPS as a real project's is: `images.remotePatterns` only lets the
 * optimiser fetch https:// pictures, so an http:// stand-in fails for a reason
 * production never has. See README section 4h-2 for the HTTPS front (https-front.mjs).
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=postgres://…/faytarra_sb \
 *   SUPABASE_URL=https://127.0.0.1:54443 SUPABASE_SERVICE_KEY=… \
 *   NODE_EXTRA_CA_CERTS=…/ca.pem CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/profile-background-flow.mjs
 *
 * SUPABASE_URL must be the NEXT_PUBLIC_SUPABASE_URL the app was built with.
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const CHROMIUM = process.env.CHROMIUM_PATH;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'faytarra-media';
const PASSWORD = 'a long enough password';

if (!SUPABASE_URL || !SERVICE_KEY || !DATABASE_URL) {
  console.error('Needs SUPABASE_URL, SUPABASE_SERVICE_KEY and DATABASE_URL (the Supabase stand-in).');
  process.exit(2);
}

const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: DATABASE_URL });

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});

/**
 * A browser context that remembers every /_next/image answer, so a check can
 * say what the optimiser did with the backdrop's request.
 */
async function context(options = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, ...options });
  ctx.images = [];
  ctx.errors = [];
  ctx.on('response', (response) => {
    if (response.url().includes('/_next/image?')) {
      ctx.images.push({ url: response.url(), status: response.status(), type: response.headers()['content-type'] ?? '' });
    }
  });
  // What a person opening the browser console would see: a refused picture
  // shows up there as a failed resource.
  ctx.on('console', (message) => {
    if (message.type() === 'error') ctx.errors.push(`${message.text()} ${message.location()?.url ?? ''}`.trim());
  });
  return ctx;
}

async function signUp(handle) {
  const email = `${handle}@example.com`;
  const ctx = await context();
  const page = await ctx.newPage();
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
  const { rows } = await pool.query('select id from public.users where username = $1', [handle]);
  return { ctx, page, handle, email, id: rows[0]?.id };
}

async function signIn(ctx, email) {
  const page = await ctx.newPage();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', email);
  await page.fill('#password', PASSWORD);
  await Promise.all([page.waitForURL(/\/home/, { timeout: 25000 }), page.locator('form button[type=submit]').click()]);
  return page;
}

/** A real picture, made in the browser, as bytes. */
async function picture(page, type, colours) {
  const base64 = await page.evaluate(
    ([mime, stops]) => {
      const c = document.createElement('canvas');
      c.width = 1600;
      c.height = 1000;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 1600, 1000);
      stops.forEach((colour, i) => gr.addColorStop(i / (stops.length - 1), colour));
      g.fillStyle = gr;
      g.fillRect(0, 0, 1600, 1000);
      return c.toDataURL(mime, 0.9).split(',')[1];
    },
    [type, colours],
  );
  return Buffer.from(base64, 'base64');
}

/** Puts bytes in the bucket the way an upload does (signed URL, then the PUT), with the service key. */
async function store(path, bytes, type) {
  const auth = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
  const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: auth,
  });
  const { url } = await sign.json();
  const put = await fetch(`${SUPABASE_URL}/storage/v1${url}`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': type },
    body: bytes,
  });
  if (!put.ok) throw new Error(`storing ${path}: HTTP ${put.status}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

const appearance = async (id) =>
  (
    await pool.query(
      'select profile_cover_url as cover, profile_bg as bg, profile_box as box from public.users where id = $1',
      [id],
    )
  ).rows[0];

/**
 * What the backdrop photo did: waits for the browser to finish with it, then
 * reports whether it decoded and what the optimiser answered for it.
 */
async function backdrop(page) {
  const handle = await page.waitForSelector('[data-profile-backdrop]', { timeout: 15000 }).catch(() => null);
  if (!handle) return { kind: 'none' };
  await page
    .waitForFunction(
      () => {
        const img = document.querySelector('[data-profile-backdrop-photo]');
        return !img || (img.complete && img.currentSrc !== '');
      },
      null,
      { timeout: 15000 },
    )
    .catch(() => undefined);
  const seen = await page.evaluate(() => {
    const el = document.querySelector('[data-profile-backdrop]');
    const img = el.querySelector('[data-profile-backdrop-photo]');
    return {
      kind: el.getAttribute('data-profile-backdrop'),
      src: img?.currentSrc ?? null,
      decoded: img ? img.complete && img.naturalWidth > 0 : false,
      naturalWidth: img?.naturalWidth ?? 0,
      skin: document.querySelector('[data-profile-skin]')?.getAttribute('data-profile-skin') ?? null,
      colour: getComputedStyle(el).backgroundColor,
    };
  });
  const answer = seen.src ? page.context().images.findLast((r) => r.url === seen.src) : null;
  return { ...seen, status: answer?.status ?? null, type: answer?.type ?? '' };
}

/** Every check a background photo has to pass for somebody looking at it. */
function photoShown(who, seen, original) {
  check(`${who}: the backdrop is a photo`, seen.kind === 'photo', seen.kind);
  check(
    `${who}: it is the saved picture, resized by the optimiser`,
    Boolean(seen.src) &&
      seen.src.includes('/_next/image?') &&
      new URL(seen.src).searchParams.get('url') === original,
    seen.src ?? '',
  );
  check(
    `${who}: the optimiser answered 200 with an image`,
    seen.status === 200 && seen.type.startsWith('image/'),
    `HTTP ${seen.status} ${seen.type}`,
  );
  check(`${who}: the browser decoded it`, seen.decoded, `naturalWidth ${seen.naturalWidth}`);
}

/** No picture on the page was refused by the optimiser. */
function noRefusals(who, ctx) {
  const refused = ctx.images.filter((r) => r.status >= 400);
  check(`${who}: no image request refused`, refused.length === 0, refused.map((r) => `${r.status} ${r.url}`).join(' ').slice(0, 300));
}

try {
  section('SETUP — two people, and the backgrounds they saved before');
  const A = await signUp(`bgown${Date.now() % 100000}`);
  const B = await signUp(`bgsee${Date.now() % 100000}`);
  check('two accounts', Boolean(A.id && B.id), `${A.handle} ${B.handle}`);

  // A: a checked upload in their own folder, with a gradient and a box colour.
  const coverA = await store(
    `media/${A.id}/${randomUUID()}.jpg`,
    await picture(A.page, 'image/jpeg', ['#1e3a8a', '#0f766e', '#f59e0b']),
    'image/jpeg',
  );
  // B: an object from before uploads had folders — the bucket root — as a PNG.
  const coverB = await store(
    `${randomUUID()}.png`,
    await picture(B.page, 'image/png', ['#7c2d12', '#a21caf']),
    'image/png',
  );
  await pool.query(
    "update public.users set profile_cover_url = $2, profile_bg = 'fay-aurora', profile_box = 'blue' where id = $1",
    [A.id, coverA],
  );
  await pool.query(
    "update public.users set profile_cover_url = $2, profile_bg = 'red', profile_box = 'black' where id = $1",
    [B.id, coverB],
  );
  const savedA = await appearance(A.id);
  const savedB = await appearance(B.id);
  for (const [who, url] of [
    ['A', coverA],
    ['B', coverB],
  ]) {
    const response = await fetch(url);
    check(`${who}'s stored picture is served publicly`, response.ok && /^image\//.test(response.headers.get('content-type') ?? ''), `HTTP ${response.status}`);
  }

  section('EXISTING — the owner sees theirs');
  await A.page.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
  photoShown('owner', await backdrop(A.page), coverA);
  const ownerSeen = await backdrop(A.page);
  check('owner: the colours are still applied with it', ownerSeen.skin === 'on', ownerSeen.skin ?? 'no skin');
  check('owner: Edit profile is there', (await A.page.locator('[data-edit-profile]').count()) > 0);
  noRefusals('owner', A.ctx);

  section('EXISTING — another account and a guest');
  await B.page.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
  photoShown('another account', await backdrop(B.page), coverA);
  check('another account: no Edit profile', (await B.page.locator('[data-edit-profile]').count()) === 0);
  await A.page.goto(`/u/${B.handle}`, { waitUntil: 'networkidle' });
  photoShown('the older, folderless photo, seen by somebody else', await backdrop(A.page), coverB);
  const guest = await context();
  const gp = await guest.newPage();
  await gp.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
  photoShown('a guest', await backdrop(gp), coverA);
  await gp.goto(`/u/${B.handle}`, { waitUntil: 'networkidle' });
  photoShown('a guest, the older photo', await backdrop(gp), coverB);
  noRefusals('a guest', guest);

  section('EXISTING — after a refresh, and after signing out and back in');
  await A.page.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
  await A.page.reload({ waitUntil: 'networkidle' });
  photoShown('owner, refreshed', await backdrop(A.page), coverA);
  await A.ctx.clearCookies();
  await A.page.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
  check('signed out: no Edit profile', (await A.page.locator('[data-edit-profile]').count()) === 0);
  photoShown('owner, signed out', await backdrop(A.page), coverA);
  const back = await signIn(A.ctx, A.email);
  await back.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
  check('signed back in: Edit profile again', (await back.locator('[data-edit-profile]').count()) > 0);
  photoShown('owner, signed back in', await backdrop(back), coverA);
  await back.close();

  section('EXISTING — a phone');
  const phone = await context({ ...devices['iPhone 13'], viewport: devices['iPhone 13'].viewport });
  const pp = await phone.newPage();
  await pp.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
  const onPhone = await backdrop(pp);
  photoShown('a phone', onPhone, coverA);
  check(
    'a phone gets a phone-sized copy',
    Number(new URL(onPhone.src ?? `${BASE}/`).searchParams.get('w')) <= 1300,
    onPhone.src ?? '',
  );
  noRefusals('a phone', phone);
  await phone.close();

  section('KEPT — looking changed nothing that was saved');
  const afterA = await appearance(A.id);
  const afterB = await appearance(B.id);
  check('A: photo, background and box colour unchanged', JSON.stringify(afterA) === JSON.stringify(savedA), JSON.stringify(afterA));
  check('B: photo, background and box colour unchanged', JSON.stringify(afterB) === JSON.stringify(savedB), JSON.stringify(afterB));

  section('NEW — uploaded and saved through Settings');
  const settings = await A.ctx.newPage();
  await settings.goto('/settings', { waitUntil: 'networkidle' });
  await settings.locator('[data-profile-cover-input]').setInputFiles({
    name: 'new-cover.jpg',
    mimeType: 'image/jpeg',
    buffer: await picture(settings, 'image/jpeg', ['#064e3b', '#facc15']),
  });
  await settings.waitForFunction(
    (old) => document.querySelector('[data-profile-cover-settings="photo"] img')?.getAttribute('src') !== old,
    coverA,
    { timeout: 30000 },
  ).catch(() => undefined);
  let newCover = null;
  for (let i = 0; i < 40 && !newCover; i += 1) {
    const row = await appearance(A.id);
    if (row.cover && row.cover !== coverA) newCover = row.cover;
    else await settings.waitForTimeout(250);
  }
  check(
    'saved: the new photo is in the bucket, in the owner\'s folder',
    Boolean(newCover) && newCover.startsWith(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/media/${A.id}/`),
    newCover ?? 'nothing saved',
  );
  const kept = await appearance(A.id);
  check('saved: the colours were left as they were', kept.bg === savedA.bg && kept.box === savedA.box, `${kept.bg}/${kept.box}`);
  if (newCover) {
    await settings.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
    photoShown('owner, new photo', await backdrop(settings), newCover);
    await B.page.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
    photoShown('another account, new photo', await backdrop(B.page), newCover);
    await gp.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
    photoShown('a guest, new photo', await backdrop(gp), newCover);
  }
  noRefusals('everybody, throughout', { images: [...A.ctx.images, ...B.ctx.images, ...guest.images] });
  const consoleErrors = [...A.ctx.errors, ...B.ctx.errors, ...guest.errors].filter((e) => /_next\/image|Failed to load resource/.test(e));
  check('no failed image in anybody\'s browser console', consoleErrors.length === 0, [...new Set(consoleErrors)].join(' | ').slice(0, 400));
  await guest.close();
} catch (error) {
  failures += 1;
  console.log(`FAIL  the flow itself  — ${error instanceof Error ? error.stack : error}`);
} finally {
  await browser.close();
  await pool.end();
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
