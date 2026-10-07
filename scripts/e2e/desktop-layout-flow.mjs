/**
 * The desktop layout: navigation, the feed, and the rail beside it.
 *
 *   LEFT    Home, Videos, Discover, one + Create, Search, Messages,
 *           Notifications — Admin for admins only — and you at the bottom
 *   CENTRE  the feed, under a Following / Recommended / Discover bar, wider
 *           than the 640px it used to be capped at
 *   RIGHT   your profile card, your Top 3, Discover, and people to follow
 *
 * Everything on the rail is checked against the real thing: the counts against
 * the profile API (a different code path reading the same rows), a follow from
 * somebody else moving the follower number, and the Top 3 against the order on
 * the profile page. And the phone is checked to be exactly what it was: no
 * sidebar, no rail, the bottom bar, and Home's own four-option Create.
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/desktop-layout-flow.mjs
 *
 * Needs the GoTrue stub and a built app, against an EMPTY store, with
 * ADMIN_EMAILS including admin@faytarra.com.
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const CHROMIUM = process.env.CHROMIUM_PATH;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@faytarra.com';
const PASSWORD = 'a long enough password';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);

const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function account(browser, email, handle, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ baseURL: BASE, viewport });
  const page = await context.newPage();
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]').first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForTimeout(3000);
  if (/verify-email/.test(page.url())) {
    const link = [...mails()].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
    if (!link) throw new Error(`no confirmation email for ${email}`);
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
  } else {
    // Already exists (the admin across runs): sign in.
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.fill('#identifier', email);
    await page.fill('#password', PASSWORD);
    await page.locator('form button[type=submit]').last().click();
    await page.waitForLoadState('networkidle');
  }
  const me = await page.evaluate(async () => (await fetch('/api/v1/me')).json());
  return { context, page, handle: me?.user?.username ?? handle };
}

async function postShort(page, body) {
  await page.goto('/create?kind=text&text=short', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea#caption', { timeout: 20000 });
  await page.fill('#caption', body);
  await page.locator('[data-post-text]').click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
}

/**
 * Follows the person whose profile this is — the button on the profile, not
 * one of the rail's "People to follow", which are other people.
 */
async function followHere(page) {
  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (b) =>
        b.textContent.trim() === 'Follow' &&
        !b.closest('[data-right-rail]') &&
        !b.closest('[data-sidebar]'),
    );
    button?.click();
    return Boolean(button);
  });
  await page.waitForTimeout(800);
  return clicked;
}

const visible = (page, selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
  }, selector);

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const railStats = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-rail-stat]')].map((a) => [
        a.getAttribute('data-rail-stat'),
        Number(a.getAttribute('aria-label').split(' ')[0].replace(/,/g, '')),
      ]),
    ),
  );

const apiStats = (page, handle) =>
  page.evaluate(async (h) => (await (await fetch(`/api/v1/users/${h}`)).json()).stats, handle);

const FULL = [
  ['short-message', '/create?kind=text&text=short'],
  ['story-message', '/create?kind=text&text=story'],
  ['big-message', '/create?kind=text&text=big'],
  ['photo', '/create?kind=photo'],
  ['upload-video', '/create/video?upload=1'],
  ['record-video', '/create/video'],
];

async function run() {
  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const stamp = Date.now().toString(36).slice(-6);
  const A = await account(browser, `dl_a_${stamp}@example.com`, `dla_${stamp}`);
  const B = await account(browser, `dl_b_${stamp}@example.com`, `dlb_${stamp}`);
  const C = await account(browser, `dl_c_${stamp}@example.com`, `dlc_${stamp}`);
  const D = await account(browser, `dl_d_${stamp}@example.com`, `dld_${stamp}`);

  // Something to read, and somebody to follow: A follows B, C, D in that order,
  // which makes them A's Top 3 until A picks otherwise.
  await postShort(B.page, `Hello from ${B.handle}`);
  await postShort(A.page, `A short one from ${A.handle}`);
  for (const other of [B, C, D]) {
    await A.page.goto(`/u/${other.handle}`, { waitUntil: 'networkidle' });
    if (!(await followHere(A.page))) throw new Error(`no Follow button on @${other.handle}`);
  }
  const page = A.page;

  /* ------------------------------------------------------------ 1440 */
  section('1440 — THREE COLUMNS');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/home', { waitUntil: 'networkidle' });
  check('the sidebar is there', await visible(page, '[data-sidebar]'));
  check('the rail is there', await visible(page, '[data-right-rail]'));
  check('nothing scrolls sideways', (await sideways(page)) === 0);
  const card = await page.evaluate(() => {
    const c = document.querySelector('article.card');
    return c ? Math.round(c.getBoundingClientRect().width) : 0;
  });
  check('the feed is wider than the old 640px cap', card >= 700, `${card}px`);

  section('SIDEBAR');
  const nav = await page.evaluate(() =>
    [...document.querySelectorAll('[data-sidebar] li a, [data-sidebar] [data-sidebar-create]')].map(
      (el) => (el.hasAttribute('data-sidebar-create') ? 'Create' : el.textContent.replace(/\d+$/, '').trim()),
    ),
  );
  check(
    'Home, Videos, Discover, Create, Search, Messages, Notifications — in that order',
    nav.join(',') === 'Home,Videos,Discover,Create,Search,Messages,Notifications',
    nav.join(', '),
  );
  const sidebarText = await page.locator('[data-sidebar]').innerText();
  check('no separate "New post" or "Record" items', !/New post|Record/.test(sidebarText));
  check('no Admin for somebody who is not one', (await page.locator('[data-sidebar] a[href="/admin"]').count()) === 0);
  check(
    'and you at the bottom',
    (await page.locator('[data-sidebar]').innerText()).includes(`@${A.handle}`),
  );

  section('CREATE — one button, every kind');
  await page.locator('[data-sidebar-create]').click();
  await page.waitForSelector('[data-create-post-sheet]', { timeout: 5000 });
  const options = await page
    .locator('[data-create-post-sheet] [data-create-option]')
    .evaluateAll((nodes) => nodes.map((n) => [n.dataset.createOption, n.getAttribute('href')]));
  check(
    'Short, Story and Big Message, Photo, Upload video, Record video',
    JSON.stringify(options) === JSON.stringify(FULL),
    options.map(([k]) => k).join(', '),
  );
  const statuses = await page.evaluate(
    async (hrefs) => Promise.all(hrefs.map(async (h) => (await fetch(h)).status)),
    FULL.map(([, href]) => href),
  );
  check('every one of them is a page that exists', statuses.every((s) => s === 200), statuses.join(' '));
  await page.locator('[data-create-option="story-message"]').click();
  await page.waitForURL(/text=story/, { timeout: 10000 });
  check(
    'Story Message opens the story composer',
    (await page.locator('#text_title').count()) === 1,
    page.url(),
  );

  section('RAIL — YOUR PROFILE, REAL NUMBERS');
  await page.goto('/home', { waitUntil: 'networkidle' });
  const name = await page.locator('[data-rail-profile]').innerText();
  check('your name and handle', name.includes(A.handle.toUpperCase()) && name.includes(`@${A.handle}`), name.replace(/\n/g, ' '));
  const stats = await railStats(page);
  const api = await apiStats(page, A.handle);
  check(
    'posts, followers and following match the profile',
    stats.posts === api.posts && stats.followers === api.followers && stats.following === api.following,
    `rail ${JSON.stringify(stats)} vs profile ${JSON.stringify({ posts: api.posts, followers: api.followers, following: api.following })}`,
  );
  check('following counts the three just followed', stats.following === 3, String(stats.following));
  check(
    'Edit profile goes to Settings',
    (await page.locator('[data-rail-profile] a', { hasText: 'Edit profile' }).getAttribute('href')) === '/settings',
  );
  // Somebody else follows A: the number on A's rail moves.
  await B.page.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
  await followHere(B.page);
  await page.reload({ waitUntil: 'networkidle' });
  const after = await railStats(page);
  check('a new follower shows up in the count', after.followers === stats.followers + 1, `${stats.followers} -> ${after.followers}`);

  section('RAIL — TOP 3');
  const railTop = await page
    .locator('[data-top-creators="rail"] a[data-medal]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
  const medals = await page
    .locator('[data-top-creators="rail"] a[data-medal]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.medal));
  await page.goto(`/u/${A.handle}`, { waitUntil: 'networkidle' });
  const profileTop = await page
    .locator('[data-top-creators="profile"] a[data-medal]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
  check(
    'the rail shows the same Top 3, in the same order, as the profile',
    railTop.length === 3 && JSON.stringify(railTop) === JSON.stringify(profileTop),
    railTop.join(' > '),
  );
  check(
    'and they are the three followed first',
    JSON.stringify(railTop) === JSON.stringify([B, C, D].map((p) => `/u/${p.handle}`)),
  );
  check('gold, silver and bronze', JSON.stringify(medals) === JSON.stringify(['gold', 'silver', 'bronze']), medals.join(', '));
  // On your own profile the page IS your card and your Top 3: the rail does
  // not repeat them, so there is one of each.
  check(
    'your own profile is not repeated in the rail beside it',
    (await page.locator('[data-rail-profile]').count()) === 0 &&
      (await page.locator('[data-top-creators="rail"]').count()) === 0 &&
      (await page.locator(`a[href="/u/${A.handle}/followers"]`).count()) === 1,
  );
  check('while Discover is still there', (await page.locator('[data-rail-discover]').count()) === 1);
  check(
    'only one Top 3 editor on the page — the profile’s',
    (await page.locator('button[aria-label="Edit your Top 3 creators"]').count()) === 1,
  );

  section('RAIL — DISCOVER');
  await page.goto('/home', { waitUntil: 'networkidle' });
  const tiles = await page
    .locator('[data-rail-discover] .grid a')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
  check(
    'Trending, Top rated, Top creators, New people',
    JSON.stringify(tiles) ===
      JSON.stringify(['/discover?board=trending', '/discover', '/discover?show=people', '/discover?show=people#new']),
    tiles.join(' '),
  );
  const tileStatus = await page.evaluate(async (hrefs) => Promise.all(hrefs.map(async (h) => (await fetch(h)).status)), tiles);
  check('and each opens', tileStatus.every((s) => s === 200), tileStatus.join(' '));

  section('FEED');
  const tabs = await page.locator('[data-feed-tab]').evaluateAll((n) => n.map((x) => x.dataset.feedTab));
  check('Following, Recommended, Discover', tabs.join(',') === 'following,recommended,discover', tabs.join(','));
  await page.locator('[data-feed-tab="recommended"]').click();
  await page.waitForURL(/tab=recommended/, { timeout: 10000 });
  check(
    'Recommended opens and is marked as the one you are on',
    (await page.locator('[data-feed-tab="recommended"]').getAttribute('aria-current')) === 'page',
  );
  await page.goto('/home', { waitUntil: 'networkidle' });
  const theirs = page.locator('article', { hasText: `Hello from ${B.handle}` }).first();
  check('the followed person’s post is in Following', (await theirs.count()) === 1);
  if (await theirs.count()) {
    await theirs.locator('button[aria-label="Like"]').click();
    await page.waitForTimeout(800);
    check(
      'and it can be liked from the desktop card',
      (await theirs.locator('button[aria-label="Unlike"]').getAttribute('aria-pressed')) === 'true',
    );
    check('with its rating control still there', (await theirs.locator('button', { hasText: /Rate|★/ }).count()) >= 1);
  }

  /* ------------------------------------------------------------ 1280 */
  section('1280');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/home', { waitUntil: 'networkidle' });
  check('three columns still', (await visible(page, '[data-sidebar]')) && (await visible(page, '[data-right-rail]')));
  check('nothing scrolls sideways', (await sideways(page)) === 0);

  /* ------------------------------------------------------------ 1024 */
  section('1024 — TABLET');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/home', { waitUntil: 'networkidle' });
  check('the rail folds away', !(await visible(page, '[data-right-rail]')));
  check('the sidebar stays', await visible(page, '[data-sidebar]'));
  check('nothing scrolls sideways', (await sideways(page)) === 0);
  await A.context.close();

  /* ------------------------------------------------------------ phone */
  section('PHONE — EXACTLY AS IT WAS');
  const phone = await browser.newContext({
    ...devices['iPhone 13'],
    userAgent: undefined,
    baseURL: BASE,
  });
  const pp = await phone.newPage();
  await pp.goto('/login', { waitUntil: 'domcontentloaded' });
  await pp.fill('#identifier', `dl_c_${stamp}@example.com`);
  await pp.fill('#password', PASSWORD);
  await pp.locator('form button[type=submit]').last().click();
  await pp.waitForURL(/home/, { timeout: 30000 });
  await pp.waitForLoadState('networkidle');
  check('no sidebar', !(await visible(pp, '[data-sidebar]')));
  check('no rail', !(await visible(pp, '[data-right-rail]')));
  check('the bottom bar, with its record button', (await pp.locator('nav a[aria-label="Record a video"]').count()) === 1);
  check('nothing scrolls sideways', (await sideways(pp)) === 0);
  check('Home has its one Create post', (await pp.locator('[data-create-post]').count()) === 1);
  await pp.locator('[data-create-post]').click();
  await pp.waitForSelector('[data-create-post-sheet]', { timeout: 5000 });
  const phoneOptions = await pp
    .locator('[data-create-post-sheet] [data-create-option]')
    .evaluateAll((n) => n.map((x) => x.dataset.createOption));
  check(
    'with its four options, unchanged',
    phoneOptions.join(',') === 'photo,text,upload-video,record-video',
    phoneOptions.join(','),
  );
  await phone.close();

  /* ------------------------------------------------------------ admin + guest */
  section('ADMIN');
  const admin = await account(browser, ADMIN_EMAIL, `dladm${stamp}`.slice(0, 20));
  await admin.page.goto('/home', { waitUntil: 'networkidle' });
  check('Admin is in the sidebar for an admin', (await admin.page.locator('[data-sidebar] a[href="/admin"]').count()) === 1);
  await admin.context.close();

  section('GUEST');
  const guest = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const gp = await guest.newPage();
  await gp.goto('/home', { waitUntil: 'networkidle' });
  check('no profile card for nobody', (await gp.locator('[data-rail-profile]').count()) === 0);
  check('a Join card instead', (await gp.locator('[data-right-rail] a[href="/signup"]').count()) >= 1);
  check(
    'Create asks a guest to sign in first',
    (await gp.locator('[data-sidebar] a[href="/login?next=/create"]').count()) === 1,
  );
  await guest.close();

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
