/**
 * A profile's tabs, end to end: what each one holds, and that changing between
 * them happens in the page.
 *
 *   Posts  -> everything: a photo, a video, a Short, a Story and a Big message
 *   Videos -> only the video
 *   Text   -> only the three written posts
 *   About  -> the About card
 *
 * Switching is checked for what a screenshot cannot show: that the document was
 * never reloaded (a marker left on `window` survives), that nothing was asked of
 * the server for it, that the tab bar stays exactly where it was on the screen
 * (so the page did not jump to the top, nor shuffle down when a shorter tab
 * opened), that only the open tab's posts are in the page, once each, with no
 * fade-in, and that the address, the highlighted tab and the shelf agree. Then
 * Back and Forward, a burst of fast taps, a ctrl-click into a new tab, a direct
 * load of `?tab=…`, a visitor's view, and the same again on a phone.
 *
 *   node scripts/e2e/make-video-fixtures.mjs /tmp/fay-video-fixtures
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/profile-tabs-flow.mjs
 *
 * Needs the GoTrue stub and a built app, against an EMPTY store.
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

async function postText(page, kind, body, title) {
  await page.goto(`/create?kind=text&text=${kind}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea#caption', { timeout: 20000 });
  if (title) await page.fill('#text_title', title);
  await page.fill('#caption', body);
  await page.locator('[data-post-text]').click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
}

async function postPhoto(page, caption) {
  await page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  const jpeg = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const g = c.getContext('2d');
    g.fillStyle = '#7c5cff';
    g.fillRect(0, 0, 1200, 900);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(jpeg, 'base64'),
  });
  await page.waitForSelector('form img, [data-media-preview] img', { timeout: 20000 }).catch(() => {});
  await page.fill('textarea[name=caption]', caption);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
}

async function postVideo(page, title) {
  await page.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Post a video', { timeout: 15000 });
  await page.locator('input[type=file]').setInputFiles({
    name: 'square.webm',
    mimeType: 'video/webm',
    buffer: readFileSync(path.join(FIXTURES, 'square.webm')),
  });
  await page.waitForSelector('#video-title', { timeout: 30000 });
  await page.fill('#video-title', title);
  await page.selectOption('#video-category', 'Music');
  await page.locator('button', { hasText: /^Post video$/ }).click();
  await page.waitForURL(/\/post\//, { timeout: 180000 });
}

/** Everything about the page that a tab change might get wrong. */
const state = (page) =>
  page.evaluate(() => {
    const shelf = document.querySelector('[data-profile-shelf]');
    const nav = document.querySelector('[data-profile-tab]')?.parentElement;
    const cards = [...(shelf?.querySelectorAll('article') ?? [])];
    const postLinks = cards
      .map((card) => card.querySelector('a[href^="/post/"]')?.getAttribute('href'))
      .filter(Boolean);
    return {
      url: location.pathname + location.search,
      marker: window.__fayTabsMarker ?? null,
      active: [...document.querySelectorAll('[data-profile-tab][aria-current="page"]')].map(
        (el) => el.getAttribute('data-profile-tab'),
      ),
      shelf: shelf?.getAttribute('data-profile-shelf') ?? null,
      shelves: document.querySelectorAll('[data-profile-shelf]').length,
      // textContent, not innerText: a Big message is set in capitals.
      text: shelf?.textContent ?? '',
      cards: cards.length,
      uniqueCards: new Set(postLinks).size,
      bubbles: shelf?.querySelectorAll('[data-speech-bubble]').length ?? 0,
      animated: cards.filter((card) => getComputedStyle(card).animationName !== 'none').length,
      navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
      scrollY: Math.round(window.scrollY),
      history: history.length,
    };
  });

async function run() {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = Date.now().toString(36).slice(-6);
  const A = await account(browser, `pt_${stamp}`);
  const page = A.page;
  const me = `/u/${A.handle}`;

  const C = {
    short: `Short from ${stamp}`,
    story: `Story body ${stamp}`,
    big: `Big ${stamp}`,
    photo: `Photo from ${stamp}`,
    video: `Video from ${stamp}`,
  };

  /* ------------------------------------------------------------ content */
  section('CONTENT — one of every kind');
  await postText(page, 'short', C.short);
  await postPhoto(page, C.photo);
  await postText(page, 'story', C.story, `A story ${stamp}`);
  await postVideo(page, C.video);
  await postText(page, 'big', C.big);
  check('a Short, a photo, a Story, a video and a Big message posted', true);

  /** What each tab must, and must not, show. */
  const expect = {
    posts: { has: [C.short, C.story, C.big, C.photo, C.video], not: [], cards: 5 },
    videos: { has: [C.video], not: [C.short, C.story, C.big, C.photo], cards: 1 },
    text: { has: [C.short, C.story, C.big], not: [C.photo, C.video], cards: 3 },
    about: { has: ['Joined', 'Likes received'], not: [C.short, C.video, C.photo], cards: 0 },
  };
  const hrefOf = (tab) => (tab === 'posts' ? me : `${me}?tab=${tab}`);

  function holds(label, s, tab) {
    const e = expect[tab];
    const missing = e.has.filter((needle) => !s.text.includes(needle));
    const extra = e.not.filter((needle) => s.text.includes(needle));
    check(
      `${label}: shows exactly what ${tab} holds`,
      missing.length === 0 && extra.length === 0 && s.cards === e.cards && s.uniqueCards === e.cards,
      `cards=${s.cards} unique=${s.uniqueCards}${missing.length ? ` missing=${missing}` : ''}${extra.length ? ` extra=${extra}` : ''}`,
    );
  }

  /* ------------------------------------------------- direct loads, filters */
  section('FILTERS — each tab loaded directly');
  for (const tab of ['posts', 'videos', 'text', 'about']) {
    await page.goto(hrefOf(tab), { waitUntil: 'networkidle' });
    const s = await state(page);
    check(`${tab}: is the highlighted tab, and the only one`, s.active.join() === tab, s.active.join());
    holds(tab, s, tab);
  }
  await page.goto(`${me}?tab=text`, { waitUntil: 'networkidle' });
  check('Text has all three written kinds', (await state(page)).bubbles === 3);
  await page.goto(me, { waitUntil: 'networkidle' });
  const counts = await page
    .locator('[data-profile-tab]')
    .evaluateAll((nodes) => nodes.map((n) => n.textContent.trim()));
  check(
    'the counts: Posts 5, Videos 1, Text 3',
    JSON.stringify(counts) === JSON.stringify(['posts5', 'videos1', 'text3', 'about']),
    counts.join(' | '),
  );
  const hrefs = await page
    .locator('[data-profile-tab]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
  check(
    'each tab is still a real link with the ?tab= it always had',
    JSON.stringify(hrefs) === JSON.stringify([me, `${me}?tab=videos`, `${me}?tab=text`, `${me}?tab=about`]),
    hrefs.join(' '),
  );

  /* -------------------------------------------- switching, in the page */
  async function switching(page, label, { tap = false } = {}) {
    section(`SWITCHING — ${label}`);
    await page.goto(me, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.__fayTabsMarker = 'still the same document';
    });
    // Scroll so the tab bar sits a little way down the screen, the way it is
    // when somebody has read the header and reaches for a tab.
    const target = await page.evaluate(() => {
      const nav = document.querySelector('[data-profile-tab]').parentElement;
      window.scrollTo(0, nav.getBoundingClientRect().top + window.scrollY - 120);
      return Math.round(nav.getBoundingClientRect().top);
    });
    await page.waitForTimeout(300);
    check('the tab bar is part-way down the screen to begin with', Math.abs(target - 120) <= 1, `${target}px`);

    const asked = [];
    const listen = (request) => {
      const url = new URL(request.url());
      const headers = request.headers();
      if (!url.pathname.startsWith(`/u/${A.handle}`)) return;
      if (headers['next-router-prefetch']) return;
      if (request.resourceType() === 'document' || headers.rsc) asked.push(url.pathname + url.search);
    };
    page.on('request', listen);

    let previousHistory = (await state(page)).history;
    for (const tab of ['videos', 'text', 'posts', 'about', 'videos']) {
      const tabLink = page.locator(`[data-profile-tab="${tab}"]`);
      if (tap) await tabLink.tap();
      else await tabLink.click();
      await page.waitForSelector(`[data-profile-shelf="${tab}"]`, { timeout: 5000 });
      const s = await state(page);
      check(
        `→ ${tab}: no reload, address ${hrefOf(tab).replace(me, '') || '(profile)'}, highlighted`,
        s.marker === 'still the same document' && s.url === hrefOf(tab) && s.active.join() === tab && s.shelves === 1,
        `${s.url} active=${s.active.join()} marker=${s.marker}`,
      );
      holds(`→ ${tab}`, s, tab);
      check(
        `→ ${tab}: the page did not move — the tab bar is where it was`,
        Math.abs(s.navTop - 120) <= 1,
        `tab bar at ${s.navTop}px, scrollY ${s.scrollY}`,
      );
      check(`→ ${tab}: the cards are simply there, no fade-in`, s.animated === 0, `${s.animated} animating`);
      check(`→ ${tab}: one history entry`, s.history === previousHistory + 1, `${previousHistory} → ${s.history}`);
      previousHistory = s.history;
    }
    check('nothing was asked of the server to switch', asked.length === 0, asked.join(', '));

    // Tapping the tab you are on changes nothing, and adds no history.
    await page.locator('[data-profile-tab="videos"]').click();
    await page.waitForTimeout(200);
    check('tapping the open tab again adds no history entry', (await state(page)).history === previousHistory);

    /* ----------------------------------------------------- back and forward */
    for (const [move, tab] of [
      ['back', 'about'],
      ['back', 'posts'],
      ['back', 'text'],
      ['forward', 'posts'],
      ['forward', 'about'],
    ]) {
      if (move === 'back') await page.goBack();
      else await page.goForward();
      await page.waitForSelector(`[data-profile-shelf="${tab}"]`, { timeout: 5000 });
      await page.waitForTimeout(150);
      const s = await state(page);
      check(
        `${move} → ${tab}: same document, right address, right tab`,
        s.marker === 'still the same document' && s.url === hrefOf(tab) && s.active.join() === tab,
        `${s.url} active=${s.active.join()}`,
      );
      holds(`${move} → ${tab}`, s, tab);
    }
    check('Back and Forward asked nothing of the server either', asked.length === 0, asked.join(', '));

    /* ----------------------------------------------------- rapid switching */
    const burst = ['videos', 'text', 'posts', 'about', 'videos', 'posts', 'text', 'about', 'posts', 'text'];
    for (const tab of burst) {
      const tabLink = page.locator(`[data-profile-tab="${tab}"]`);
      if (tap) await tabLink.tap({ noWaitAfter: true });
      else await tabLink.click({ noWaitAfter: true, delay: 0 });
    }
    await page.waitForTimeout(400);
    const last = burst.at(-1);
    const s = await state(page);
    check(
      `ten fast taps: ends on ${last}, and everything agrees`,
      s.marker === 'still the same document' && s.url === hrefOf(last) && s.active.join() === last && s.shelf === last && s.shelves === 1,
      `${s.url} active=${s.active.join()} shelf=${s.shelf}`,
    );
    holds('after the burst', s, last);
    check('no stray copies of any post after the burst', s.cards === s.uniqueCards);
    page.off('request', listen);
    check('and still nothing asked of the server', asked.length === 0, asked.join(', '));
  }

  await switching(page, 'desktop, 1440');

  /* -------------------------------------------------------------- new tab */
  section('A CTRL-CLICK STILL OPENS A NEW TAB');
  await page.goto(me, { waitUntil: 'networkidle' });
  const [opened] = await Promise.all([
    A.context.waitForEvent('page', { timeout: 10000 }),
    page.locator('[data-profile-tab="videos"]').click({ modifiers: ['Control'] }),
  ]);
  await opened.waitForLoadState('domcontentloaded');
  await opened.waitForSelector('[data-profile-shelf="videos"]', { timeout: 15000 });
  check('the new tab opens on Videos', new URL(opened.url()).search === '?tab=videos', opened.url());
  check('and this one stayed on Posts', (await state(page)).url === me);
  await opened.close();

  /* ------------------------------------------------------- show= is kept */
  section('A SHELF OPENED FURTHER KEEPS ITS PLACE IN THE ADDRESS');
  await page.goto(`${me}?tab=text&show=40`, { waitUntil: 'networkidle' });
  const opened40 = await page
    .locator('[data-profile-tab]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
  check(
    'the open shelf’s tab says how far it is opened; the others are at a first page',
    opened40[2] === `${me}?tab=text&show=40` && opened40[0] === me && opened40[1] === `${me}?tab=videos`,
    opened40.join(' '),
  );
  await page.locator('[data-profile-tab="posts"]').click();
  await page.waitForSelector('[data-profile-shelf="posts"]');
  await page.locator('[data-profile-tab="text"]').click();
  await page.waitForSelector('[data-profile-shelf="text"]');
  check('and switching back returns to that address', (await state(page)).url === `${me}?tab=text&show=40`);

  /* ---------------------------------------------------------- owner bits */
  section('THE OWNER’S WAYS TO ADD ARE ON THEIR SHELVES');
  await page.goto(me, { waitUntil: 'networkidle' });
  check('Posts: New photo post', (await page.locator('[data-new-photo-post]').count()) === 1);
  await page.locator('[data-profile-tab="videos"]').click();
  await page.waitForSelector('[data-profile-shelf="videos"]');
  check('Videos: upload a video', (await page.locator('[data-upload-video]').count()) === 1 && (await page.locator('[data-new-photo-post]').count()) === 0);
  await page.locator('[data-profile-tab="text"]').click();
  await page.waitForSelector('[data-profile-shelf="text"]');
  check('Text: somewhere to write', (await page.locator('[data-text-post-form]').count()) === 1 && (await page.locator('[data-upload-video]').count()) === 0);

  /* ---------------------------------------------------------------- guest */
  section('A VISITOR SEES THE SAME SHELVES');
  const guest = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const visitor = await guest.newPage();
  await visitor.goto(me, { waitUntil: 'networkidle' });
  await visitor.evaluate(() => {
    window.__fayTabsMarker = 'still the same document';
  });
  for (const tab of ['videos', 'text', 'posts', 'about']) {
    await visitor.locator(`[data-profile-tab="${tab}"]`).click();
    await visitor.waitForSelector(`[data-profile-shelf="${tab}"]`);
    const s = await state(visitor);
    check(`visitor → ${tab}: in the page`, s.marker === 'still the same document' && s.url === hrefOf(tab));
    holds(`visitor → ${tab}`, s, tab);
  }
  check(
    'and none of the owner’s buttons',
    (await visitor.locator('[data-new-photo-post], [data-upload-video], [data-text-post-form]').count()) === 0,
  );
  await guest.close();

  /* ---------------------------------------------------------------- phone */
  const phone = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    storageState: await A.context.storageState(),
  });
  const handset = await phone.newPage();
  await switching(handset, 'phone, 390 × 844', { tap: true });
  const sideways = await handset.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('nothing scrolls sideways on the phone', sideways === 0, `${sideways}px`);
  await phone.close();

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
