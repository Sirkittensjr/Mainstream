/**
 * A profile's appearance, end to end: the big header, and what it is painted on.
 *
 *   colour    -> the background is that colour, behind the WHOLE page
 *   gradient  -> the same, as a FayTarra gradient
 *   photo     -> uploaded through the app's own storage, shown to everybody
 *                (a guest and another account), at a resized width rather than
 *                the original, under the avatar and the header
 *   remove    -> back to the chosen colour; pick another and it shows
 *
 * Around that, the header itself: the picture (144px on a desktop, 96 on a
 * phone), the name, the numbers against the profile API, the Overall and Last
 * 30 days ratings against the API after a real rating, the Top 3, a large Edit
 * profile for the owner and none for anybody else, the four tabs, and posts of
 * each text kind and a photo landing on the right shelves. Checked at 1440,
 * 1280, 1024 and on a phone.
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/profile-appearance-flow.mjs
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
const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function account(browser, handle) {
  const email = `${handle}@example.com`;
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
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

/** A picture made in the page, as an uploadable file. */
const picture = (page, colours) =>
  page.evaluate((stops) => {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 1000;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 1600, 1000);
    stops.forEach((colour, i) => gr.addColorStop(i / (stops.length - 1), colour));
    g.fillStyle = gr;
    g.fillRect(0, 0, 1600, 1000);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, colours);

const backdrop = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-profile-backdrop]');
    if (!el) return { kind: 'none' };
    const r = el.getBoundingClientRect();
    const photo = el.querySelector('[data-profile-backdrop-photo]');
    const style = getComputedStyle(el);
    return {
      kind: el.getAttribute('data-profile-backdrop'),
      covers: r.left <= 0 && r.top <= 0 && r.right >= innerWidth && r.bottom >= innerHeight,
      colour: style.backgroundColor,
      image: style.backgroundImage,
      src: photo?.currentSrc ?? null,
      width: photo ? Number(new URL(photo.currentSrc).searchParams.get('w')) : null,
    };
  });

const header = (page) =>
  page.evaluate(() => {
    const h = document.querySelector('[data-profile-header]');
    const avatar = h?.querySelector('img, span.rounded-full > span, span.rounded-full > img');
    const pic = h?.querySelector('.rounded-full')?.firstElementChild?.getBoundingClientRect();
    const stats = Object.fromEntries(
      [...document.querySelectorAll('[data-profile-stat]')].map((el) => [
        el.getAttribute('data-profile-stat'),
        el.querySelector('span')?.textContent?.trim(),
      ]),
    );
    const tiles = [...document.querySelectorAll('[data-profile-stat]')].map((el) =>
      Math.round(el.getBoundingClientRect().top),
    );
    return {
      name: h?.querySelector('h1')?.textContent?.trim() ?? null,
      avatar: pic ? Math.round(pic.width) : 0,
      hasAvatar: Boolean(avatar),
      stats,
      tilesOnOneRow: tiles.length === 3 && new Set(tiles).size === 1,
      edit: (() => {
        const e = document.querySelector('[data-edit-profile]');
        return e ? { href: e.getAttribute('href'), height: Math.round(e.getBoundingClientRect().height) } : null;
      })(),
      text: h?.innerText ?? '',
    };
  });

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function saveColour(page, label) {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await page.locator(`button[aria-label="Background: ${label}"]`).click();
  await page.locator('button', { hasText: /^Save colours$/ }).click();
  await page.waitForSelector('text=Saved to your profile', { timeout: 15000 });
}

async function postText(page, kind, body, title) {
  await page.goto(`/create?kind=text&text=${kind}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea#caption', { timeout: 20000 });
  if (title) await page.fill('#text_title', title);
  await page.fill('#caption', body);
  await page.locator('[data-post-text]').click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
}

async function run() {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = Date.now().toString(36).slice(-6);
  const A = await account(browser, `pa_${stamp}`);
  const B = await account(browser, `pb_${stamp}`);
  const page = A.page;
  const me = `/u/${A.handle}`;

  /* ------------------------------------------------------------ content */
  section('CONTENT — a post of every kind');
  await postText(page, 'short', `Short from ${A.handle}`);
  await postText(page, 'story', 'A long one, told properly.', 'A story');
  await postText(page, 'big', 'Big news');
  await page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(await picture(page, ['#ff3d9a', '#ffb443']), 'base64'),
  });
  await page.waitForSelector('form img, [data-media-preview] img', { timeout: 20000 }).catch(() => {});
  await page.fill('textarea[name=caption]', `A photo from ${A.handle}`);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
  check('three text posts and a photo posted', true);

  // A follows B: B becomes A's Top 3 #1. B follows A, and rates A.
  await page.goto(`/u/${B.handle}`, { waitUntil: 'networkidle' });
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Follow' && !b.closest('[data-right-rail]'))
      ?.click(),
  );
  await page.waitForTimeout(800);
  await B.page.goto(me, { waitUntil: 'networkidle' });
  await B.page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Follow' && !b.closest('[data-right-rail]'))
      ?.click(),
  );
  await B.page.waitForTimeout(800);
  await B.page.locator('[data-profile-actions] button[aria-label="Rate this"]').click();
  await B.page.waitForSelector('[role=dialog]', { timeout: 10000 });
  await B.page.locator('[role=dialog] button', { hasText: /^8$/ }).first().click();
  await B.page.locator('[role=dialog] button', { hasText: /Send|Rate|Save/ }).last().click();
  await B.page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 15000 });

  /* ------------------------------------------------------------ the header */
  section('HEADER — 1440');
  await page.goto(me, { waitUntil: 'networkidle' });
  let h = await header(page);
  const api = await page.evaluate(async (u) => (await fetch(`/api/v1/users/${u}`)).json(), A.handle);
  check('the name, large', h.name === A.handle.toUpperCase(), h.name);
  check('the picture is 144px on a desktop', h.avatar === 144, `${h.avatar}px`);
  check(
    'posts, followers and following match the profile API',
    Number(h.stats.posts) === api.stats.posts &&
      Number(h.stats.followers) === api.stats.followers &&
      Number(h.stats.following) === api.stats.following,
    `${JSON.stringify(h.stats)} vs ${JSON.stringify({ posts: api.stats.posts, followers: api.stats.followers, following: api.stats.following })}`,
  );
  check('four posts, one follower, one following', h.stats.posts === '4' && h.stats.followers === '1' && h.stats.following === '1');
  check('the three numbers sit on one row of tiles', h.tilesOnOneRow);
  const overall = api.user?.rating?.overall ?? api.user?.rating;
  check('Overall and Last 30 days are both there', /Overall/i.test(h.text) && /Last 30 days/i.test(h.text));
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('[data-profile-header] .label')]
      .filter((l) => /Overall|Last 30 days/i.test(l.textContent))
      .map((l) => l.parentElement.innerText.replace(/\n/g, ' ')),
  );
  check(
    'and after a real rating they show it',
    shown.length === 2 && shown.every((t) => /\d\.\d/.test(t) && /1 rating/.test(t)),
    shown.join(' | ') + ` (api overall ${JSON.stringify(overall)})`,
  );
  check(
    'a large Edit profile, to Settings',
    h.edit?.href === '/settings' && h.edit.height >= 48,
    JSON.stringify(h.edit),
  );
  const top = await page
    .locator('[data-top-creators="profile"] a[data-medal]')
    .evaluateAll((n) => n.map((x) => [x.getAttribute('href'), x.dataset.medal]));
  check('the Top 3, with the followed account at #1 in gold', top[0]?.[0] === `/u/${B.handle}` && top[0]?.[1] === 'gold', JSON.stringify(top));
  check(
    'and only once on the page',
    (await page.locator('[data-top-creators]').count()) === 1 &&
      (await page.locator('button[aria-label="Edit your Top 3 creators"]').count()) === 1,
  );
  check('nothing scrolls sideways', (await sideways(page)) === 0);

  section('TABS');
  for (const [tab, expect] of [
    ['posts', `A photo from ${A.handle}`],
    ['videos', 'No videos yet'],
    ['text', `Short from ${A.handle}`],
    ['about', 'Joined'],
  ]) {
    await page.goto(tab === 'posts' ? me : `${me}?tab=${tab}`, { waitUntil: 'networkidle' });
    const current = await page.locator(`[data-profile-tab="${tab}"]`).getAttribute('aria-current');
    const body = await page.locator('body').innerText();
    check(`${tab} opens and shows what it holds`, current === 'page' && body.includes(expect), current ?? '');
  }
  const textShelf = await page.goto(`${me}?tab=text`, { waitUntil: 'networkidle' }).then(() =>
    page.locator('[data-speech-bubble]').count(),
  );
  check('the Text shelf has all three kinds', textShelf === 3, `${textShelf} bubbles`);

  /* ------------------------------------------------------------ appearance */
  section('BACKGROUND — COLOUR');
  await page.goto(me, { waitUntil: 'networkidle' });
  check('nothing chosen: no backdrop, the profile looks as it always has', (await backdrop(page)).kind === 'none');
  await saveColour(page, 'Purple');
  await page.goto(me, { waitUntil: 'networkidle' });
  let bd = await backdrop(page);
  check('a colour fills the background', bd.kind === 'colour' && bd.colour === 'rgb(51, 18, 94)', bd.colour);
  check('behind the whole page, not just the middle', bd.covers);

  section('BACKGROUND — GRADIENT');
  await saveColour(page, 'Aurora');
  await page.goto(me, { waitUntil: 'networkidle' });
  bd = await backdrop(page);
  check('a FayTarra gradient fills it', bd.kind === 'gradient' && /linear-gradient/.test(bd.image), bd.image.slice(0, 40));
  check('behind the whole page', bd.covers);

  section('BACKGROUND — PHOTO');
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await page.locator('[data-profile-cover-input]').setInputFiles({
    name: 'cover.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(await picture(page, ['#1e3a8a', '#0f766e', '#f59e0b']), 'base64'),
  });
  await page.waitForSelector('[data-profile-cover-settings="photo"]', { timeout: 30000 });
  check(
    'Settings says the profile uses a photo',
    (await page.locator('text=Using a photo background').count()) === 1,
  );
  await page.goto(me, { waitUntil: 'networkidle' });
  bd = await backdrop(page);
  check('the photo fills the background', bd.kind === 'photo' && Boolean(bd.src), bd.src ?? '');
  check('behind the whole page', bd.covers);
  check(
    'sent resized for the screen, never the original',
    /\/_next\/image\?/.test(bd.src ?? '') && bd.width > 0 && bd.width <= 2048,
    `w=${bd.width}`,
  );
  h = await header(page);
  check('the picture is still there, above it', h.hasAvatar && h.avatar === 144);

  await B.page.goto(me, { waitUntil: 'networkidle' });
  check('another account sees the photo', (await backdrop(B.page)).kind === 'photo');
  check('and gets no Edit profile', (await B.page.locator('[data-edit-profile]').count()) === 0);
  const guest = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const gp = await guest.newPage();
  await gp.goto(me, { waitUntil: 'networkidle' });
  check('a guest sees it too — it is public', (await backdrop(gp)).kind === 'photo');
  check('with no Edit profile', (await gp.locator('[data-edit-profile]').count()) === 0);
  await guest.close();

  section('RESPONSIVE — WITH A PHOTO');
  for (const [w, hgt, rail] of [
    [1280, 800, true],
    [1024, 768, false],
  ]) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.goto(me, { waitUntil: 'networkidle' });
    const vis = await page.evaluate(() => {
      const r = document.querySelector('[data-right-rail]');
      return r ? getComputedStyle(r).display !== 'none' : false;
    });
    check(`${w}: the background covers it`, (await backdrop(page)).covers);
    check(`${w}: the rail ${rail ? 'is there' : 'folds away'}`, vis === rail);
    check(`${w}: nothing scrolls sideways`, (await sideways(page)) === 0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const phone = await browser.newContext({
    ...devices['iPhone 13'],
    userAgent: undefined,
    baseURL: BASE,
    storageState: await A.context.storageState(),
  });
  const pp = await phone.newPage();
  await pp.goto(me, { waitUntil: 'networkidle' });
  const pbd = await backdrop(pp);
  check('phone: the photo fills the background', pbd.kind === 'photo' && pbd.covers);
  check('phone: at a phone-sized width', pbd.width > 0 && pbd.width <= 1300, `w=${pbd.width}`);
  const ph = await header(pp);
  check('phone: the picture is 96px, as before', ph.avatar === 96, `${ph.avatar}px`);
  check('phone: nothing scrolls sideways', (await sideways(pp)) === 0);
  check(
    'phone: no sidebar and no rail',
    await pp.evaluate(
      () =>
        !document.querySelector('[data-sidebar]')?.getBoundingClientRect().width &&
        !document.querySelector('[data-right-rail]')?.getBoundingClientRect().width,
    ),
  );
  await phone.close();

  section('REMOVE THE PHOTO, BACK TO COLOUR');
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await page.locator('[data-profile-cover-remove]').click();
  await page.waitForSelector('[data-profile-cover-settings="colour"]', { timeout: 15000 });
  await page.goto(me, { waitUntil: 'networkidle' });
  bd = await backdrop(page);
  check('the profile is back on the gradient it had', bd.kind === 'gradient', bd.kind);
  await saveColour(page, 'Blue');
  await page.goto(me, { waitUntil: 'networkidle' });
  bd = await backdrop(page);
  check('and a different colour can be chosen', bd.kind === 'colour' && bd.colour === 'rgb(11, 42, 94)', bd.colour);

  section('AVATAR STILL WORKS');
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await page.locator('#avatar-file').setInputFiles({
    name: 'me.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(await picture(page, ['#7c5cff', '#ff3d9a']), 'base64'),
  });
  await page.waitForSelector('label[for="avatar-file"] img', { timeout: 20000 });
  await page.locator('form button[type=submit]').first().click();
  await page.waitForSelector('text=Profile updated', { timeout: 15000 });
  await page.goto(me, { waitUntil: 'networkidle' });
  check(
    'a new avatar shows in the big header',
    (await page.locator('[data-profile-header] img').count()) >= 1,
  );

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
