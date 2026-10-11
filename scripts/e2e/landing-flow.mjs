/**
 * The public landing page, end to end, as a visitor sees it before signing in.
 *
 *   - the bar: every link goes somewhere real, search, Sign in, Join FayTarra,
 *     and on a phone a menu that opens, closes, and holds the same links
 *   - the hero's words and its two buttons
 *   - the carousel: several cards at once with the middle one largest, arrows,
 *     dots, the arrow keys, a swipe on a phone (and a vertical drag scrolling
 *     the page instead), reduced motion switching the slide off, no video
 *   - with no posts yet: preview cards that say so, with example ratings and
 *     no usernames; with real photo posts: those first, opening the post
 *   - exactly three feature cards, side by side and the same width, and no
 *     "Follow and get followed"
 *   - the ratings section's profile card: an example until somebody is ranked,
 *     then the best rated person with their real numbers (run it against the
 *     seeded store as well to see that half)
 *   - no sideways scroll at 1440, 1024, 820, 390, 360 or 320 wide
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/landing-flow.mjs
 *
 * Needs the GoTrue stub and a built app, against an EMPTY store — or a seeded
 * one, for the ranked profile card.
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
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** Which slide is at the front. */
const activeSlide = (page) =>
  page.locator('[data-landing-slide][data-active]').getAttribute('data-landing-slide').then(Number);

/** Waits out the slide between cards. */
const settle = (page) => page.waitForTimeout(650);

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

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

async function postPhoto(page, caption, colour) {
  await page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  const jpeg = await page.evaluate((fill) => {
    const c = document.createElement('canvas');
    c.width = 1000;
    c.height = 1250;
    const g = c.getContext('2d');
    g.fillStyle = fill;
    g.fillRect(0, 0, 1000, 1250);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, colour);
  await page.locator('input[type=file]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(jpeg, 'base64'),
  });
  await page.waitForSelector('form img, [data-media-preview] img', { timeout: 20000 }).catch(() => {});
  await page.fill('textarea[name=caption]', caption);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
  return new URL(page.url()).pathname.split('/').pop();
}

async function touch(client, type, points) {
  await client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })),
  });
}

/** One finger from `from` to `to`, in steps, the way a thumb moves. */
async function drag(client, from, to, steps = 10) {
  await touch(client, 'touchStart', [from]);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await touch(client, 'touchMove', [[from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]]);
    await wait(16);
  }
  await touch(client, 'touchEnd', []);
}

const run = async () => {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  /* =============================================================== desktop */
  section('DESKTOP, NOBODY HAS POSTED YET');
  const desk = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await desk.newPage();
  page.on('pageerror', (error) => errors.push(`${page.url()} ${error}`));
  await page.goto('/', { waitUntil: 'networkidle' });

  const h1 = (await page.locator('h1').innerText()).replace(/\s+/g, ' ').trim();
  check('one headline: FAYTARRA and the tagline', (await page.locator('h1').count()) === 1 && h1 === 'FAYTARRA WHERE THE COMMUNITY DECIDES WHAT THEY LIKE.', h1);
  const body = await page.locator('main').innerText();
  check(
    'the supporting text',
    body.includes('Share what you’re into. Discover new creators. Post photos, videos, thoughts, art, gaming, music, jokes, and anything else you enjoy.'),
  );
  const heroText = await page.locator('h1').boundingBox();
  const carouselBox = await page.locator('[data-landing-carousel]').boundingBox();
  check('words on the left, the carousel on the right', heroText.x + heroText.width <= carouselBox.x + 40 && carouselBox.x > 600, `${Math.round(heroText.x + heroText.width)} / ${Math.round(carouselBox.x)}`);

  // --- the bar ----------------------------------------------------------
  const want = { Home: '/', Discover: '/discover', About: '#about', Features: '#features', Community: '/home?tab=recommended' };
  for (const [label, href] of Object.entries(want)) {
    const link = page.locator(`[data-landing-nav] nav [data-landing-link="${label}"]:visible`);
    check(`the bar has ${label}`, (await link.count()) === 1 && (await link.getAttribute('href')) === href, await link.getAttribute('href').catch(() => 'missing'));
  }
  check('Home is marked as this page', (await page.locator('[data-landing-link="Home"]:visible').getAttribute('aria-current')) === 'page');
  for (const href of ['/discover', '/home?tab=recommended', '/search', '/login', '/signup']) {
    const status = await page.evaluate(async (url) => (await fetch(url)).status, href);
    check(`${href} answers`, status === 200, String(status));
  }
  check('About and Features land on sections of this page', (await page.locator('#about').count()) === 1 && (await page.locator('#features').count()) === 1);
  check('a search button, named for screen readers', (await page.locator('[data-landing-search]:visible').getAttribute('aria-label')) === 'Search FayTarra');
  check('Sign in and Join FayTarra are in the bar', (await page.locator('[data-landing-signin]:visible').innerText()) === 'Sign in' && (await page.locator('[data-landing-join]:visible').innerText()) === 'Join FayTarra');
  const joinBg = await page.locator('[data-landing-join]').evaluate((el) => getComputedStyle(el).backgroundImage);
  check('Join FayTarra wears the brand gradient', joinBg.includes('linear-gradient'), joinBg.slice(0, 60));
  check('no menu button on a desktop', !(await page.locator('[data-landing-menu-button]').isVisible()));

  await page.locator('[data-landing-link="Features"]:visible').click();
  await page.waitForTimeout(300);
  const featuresTop = await page.locator('#features').evaluate((el) => el.getBoundingClientRect().top);
  check('Features scrolls to the feature cards, clear of the sticky bar', featuresTop >= 40 && featuresTop < 200, String(Math.round(featuresTop)));
  check('the bar stays on screen', (await page.locator('[data-landing-nav]').boundingBox()).y === 0);
  await page.evaluate(() => window.scrollTo(0, 0));

  // --- the carousel --------------------------------------------------------
  const slides = await page.locator('[data-landing-slide]').count();
  check('the carousel has at least five cards', slides >= 5, String(slides));
  check('all of them previews, when nobody has posted', (await page.locator('[data-landing-card="preview"]').count()) === slides);
  check('every preview is badged as one', (await page.locator('[data-landing-preview-badge]').count()) === slides);
  const previewText = await page.locator('[data-landing-carousel]').innerText();
  check('previews show example ratings, not scores', (previewText.match(/example/gi) ?? []).length >= slides, String((previewText.match(/example/gi) ?? []).length));
  check('and no usernames', !/@\w/.test(previewText));
  check('no video in the carousel', (await page.locator('[data-landing-carousel] video').count()) === 0);
  check('the first card is at the front', (await activeSlide(page)) === 0);

  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('[data-landing-slide]')]
      .map((el) => ({ box: el.getBoundingClientRect(), opacity: Number(getComputedStyle(el).opacity), active: el.hasAttribute('data-active') }))
      .filter(({ box, opacity }) => opacity > 0.8 && box.right > 0 && box.left < window.innerWidth),
  );
  const front = shown.find((s) => s.active);
  check('three cards are showing at once', shown.length === 3, String(shown.length));
  check('the middle one is the largest', shown.every((s) => s.active || s.box.width < front.box.width - 10));
  check('with one either side of it', shown.filter((s) => s.box.x < front.box.x).length === 1 && shown.filter((s) => s.box.x > front.box.x).length === 1);
  const leftmost = Math.min(...shown.map((s) => s.box.x));
  check('the cards stay clear of the words', leftmost >= heroText.x + heroText.width - 10, `${Math.round(leftmost)} vs ${Math.round(heroText.x + heroText.width)}`);

  await page.locator('[data-landing-next]').click();
  await settle(page);
  check('Next moves to the second card', (await activeSlide(page)) === 1);
  await page.locator('[data-landing-prev]').click();
  await settle(page);
  check('Previous moves back', (await activeSlide(page)) === 0);
  await page.locator('[data-landing-prev]').click();
  await settle(page);
  check('and round from the first to the last', (await activeSlide(page)) === slides - 1);
  await page.locator('[data-landing-dot="3"]').click();
  await settle(page);
  check('a dot goes straight to its card', (await activeSlide(page)) === 3);
  check('the dot says which one is showing', (await page.locator('[data-landing-dot="3"]').getAttribute('aria-current')) === 'true');
  check('and a screen reader hears it', (await page.locator('[data-landing-status]').innerText()) === `Post 4 of ${slides}`);
  await page.keyboard.press('ArrowRight');
  await settle(page);
  check('the right arrow key moves on', (await activeSlide(page)) === 4);
  await page.keyboard.press('ArrowLeft');
  await settle(page);
  check('the left arrow key moves back', (await activeSlide(page)) === 3);
  await page.keyboard.press('Home');
  await settle(page);
  check('Home goes to the first card', (await activeSlide(page)) === 0);

  // Hidden cards are not in the tab order; the front one is.
  const tabbable = await page.evaluate(() =>
    [...document.querySelectorAll('[data-landing-slide] a')].filter((a) => a.tabIndex >= 0).length,
  );
  check('only the front card can be tabbed to', tabbable === 1, String(tabbable));

  const neighbour = await page.locator('[data-landing-slide="1"]').boundingBox();
  await page.mouse.click(neighbour.x + neighbour.width * 0.75, neighbour.y + neighbour.height / 2);
  await settle(page);
  check('clicking the card beside it brings that card forward', (await activeSlide(page)) === 1 && new URL(page.url()).pathname === '/');
  await Promise.all([page.waitForURL(/\/signup/, { timeout: 15000 }), page.locator('[data-landing-slide][data-active] [data-landing-open]').click()]);
  check('a preview card leads to joining', new URL(page.url()).pathname === '/signup');
  await page.goto('/', { waitUntil: 'networkidle' });

  // --- the three cards -----------------------------------------------------
  const features = page.locator('[data-landing-feature]');
  check('exactly three feature cards', (await features.count()) === 3, String(await features.count()));
  const titles = await features.locator('h3').allInnerTexts();
  check('Post anything, Rate what you like, Find your people', JSON.stringify(titles) === JSON.stringify(['Post anything', 'Rate what you like', 'Find your people']), titles.join(' / '));
  const featureText = await page.locator('[data-landing-features]').innerText();
  check('with their words', featureText.includes('Photos, video, or just a thought. Pick a category so the right people find it.') && featureText.includes('Everyone can rate posts and profiles out of 10. Helpful, fun, and all community driven.') && featureText.includes('Music, art, gaming, food, jokes, random moments — whatever you are into.'));
  check('no "Follow and get followed" card anywhere', !(await page.content()).includes('Follow and get followed'));
  const boxes = await features.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map(({ x, y, width }) => ({ x, y, width })));
  check('side by side in one row', new Set(boxes.map((b) => Math.round(b.y))).size === 1);
  check('the same width, using the row evenly', Math.max(...boxes.map((b) => b.width)) - Math.min(...boxes.map((b) => b.width)) < 2 && boxes[2].x + boxes[2].width - boxes[0].x > 1100, boxes.map((b) => Math.round(b.width)).join(','));

  // --- ratings ---------------------------------------------------------------
  check('the ratings heading', (await page.locator('#ratings-title').innerText()).replace(/\s+/g, ' ') === 'A rating that means something.');
  check(
    'and its words',
    body.includes('Every profile has an overall rating from everything you have been rated on, and a last 30 days rating that shows how people are responding lately.'),
  );
  const profile = page.locator('[data-landing-profile]');
  const profileKind = await profile.getAttribute('data-landing-profile');
  const profileText = await profile.innerText();
  check('the profile card has Overall and last 30 days', /Overall rating/i.test(profileText) && /Last 30 days/i.test(profileText));
  if (profileKind === 'example') {
    // An empty store: nobody has the ratings to be ranked.
    check('until somebody is ranked it is an example', /Example profile/i.test(profileText));
    check('with a picture, a placeholder name and username, and Follow', (await profile.locator('[aria-hidden]').count()) > 0 && profileText.includes('Your name') && profileText.includes('@yourname') && profileText.includes('Follow'), JSON.stringify(profileText.slice(0, 80)));
    check('both numbers marked as examples', (profileText.match(/^Example$/gim) ?? []).length >= 2);
    await Promise.all([page.waitForURL(/\/signup/), profile.getByRole('link', { name: /Follow/ }).click()]);
    check('its Follow leads to joining', new URL(page.url()).pathname === '/signup');
    await page.goto('/', { waitUntil: 'networkidle' });
  } else {
    // A store with ranked people: the best rated one, with their real numbers.
    check('once somebody is ranked it is them', profileKind === 'live' && /Top rated right now/i.test(profileText), profileKind);
    check('with no example numbers', !/Example/i.test(profileText));
    check('their rating, from real ratings', /\b\d+(\.\d)?\s*\/10/.test(profileText) && /ratings?/i.test(profileText), JSON.stringify(profileText.slice(0, 120)));
    await Promise.all([page.waitForURL(/\/login/), profile.getByRole('button', { name: 'Follow' }).click()]);
    check('Follow asks a visitor to sign in first', new URL(page.url()).pathname === '/login');
    await page.goto('/', { waitUntil: 'networkidle' });
  }
  check('headings in order: one h1, then h2s, then h3s', await page.evaluate(() => {
    const levels = [...document.querySelectorAll('h1, h2, h3, h4')].map((h) => Number(h.tagName[1]));
    return levels[0] === 1 && levels.every((level, i) => i === 0 || level - levels[i - 1] <= 1);
  }));

  // --- the bar's buttons, followed -----------------------------------------
  await Promise.all([page.waitForURL(/\/login/), page.locator('[data-landing-signin]').click()]);
  check('Sign in opens the sign-in page', (await page.locator('#identifier').count()) === 1);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await Promise.all([page.waitForURL(/\/signup/), page.locator('[data-landing-join]').click()]);
  check('Join FayTarra opens sign-up', (await page.locator('#email').count()) === 1);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await Promise.all([page.waitForURL(/\/signup/), page.locator('[data-landing-hero-join]').click()]);
  check('so does the hero’s Join FayTarra', new URL(page.url()).pathname === '/signup');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await Promise.all([page.waitForURL(/\/home/), page.locator('[data-landing-explore]').click()]);
  check('Explore the community opens the public feed', new URL(page.url()).pathname === '/home');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await Promise.all([page.waitForURL(/\/search/), page.locator('[data-landing-search]').click()]);
  check('search opens Search', new URL(page.url()).pathname === '/search');

  for (const [width, height] of [[1440, 900], [1024, 768], [820, 1180]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/', { waitUntil: 'networkidle' });
    check(`no sideways scroll at ${width}`, (await overflow(page)) <= 0, String(await overflow(page)));
  }
  await desk.close();

  /* ======================================================== reduced motion */
  section('REDUCED MOTION');
  const calm = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const still = await calm.newPage();
  await still.goto('/', { waitUntil: 'networkidle' });
  const transition = await still.locator('[data-landing-slide="0"]').evaluate((el) => {
    const style = getComputedStyle(el);
    return `${style.transitionProperty} ${style.transitionDuration}`;
  });
  check('cards change without sliding', /^none /.test(transition) || /^\S+ 0s$/.test(transition), transition);
  const before = await activeSlide(still);
  await still.waitForTimeout(6000);
  check('and nothing moves on its own', (await activeSlide(still)) === before);
  await calm.close();

  /* ================================================================= phone */
  section('ON A PHONE');
  const phone = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
  const mobile = await phone.newPage();
  mobile.on('pageerror', (error) => errors.push(`${mobile.url()} ${error}`));
  const client = await phone.newCDPSession(mobile);
  await mobile.goto('/', { waitUntil: 'networkidle' });
  check('no sideways scroll at 390', (await overflow(mobile)) <= 0, String(await overflow(mobile)));
  check('Join is in the bar', await mobile.locator('[data-landing-join]').isVisible());
  check('the links are behind a menu', !(await mobile.locator('[data-landing-menu]').isVisible()) && (await mobile.locator('[data-landing-menu-button]').getAttribute('aria-expanded')) === 'false');
  await mobile.locator('[data-landing-menu-button]').tap();
  const menu = mobile.locator('[data-landing-menu]');
  check('the menu opens', (await menu.isVisible()) && (await mobile.locator('[data-landing-menu-button]').getAttribute('aria-expanded')) === 'true');
  const menuLinks = await menu.locator('[data-landing-link]').evaluateAll((els) => els.map((el) => `${el.textContent}=${el.getAttribute('href')}`));
  check('with the same five links', menuLinks.join(',') === 'Home=/,Discover=/discover,About=#about,Features=#features,Community=/home?tab=recommended', menuLinks.join(','));
  check('and Sign in', (await menu.getByText('Sign in', { exact: true }).count()) === 1);
  await mobile.keyboard.press('Escape');
  check('Escape closes it', !(await menu.isVisible()));
  await mobile.locator('[data-landing-menu-button]').tap();
  await menu.locator('[data-landing-link="About"]').tap();
  await mobile.waitForTimeout(300);
  check('a link closes it and goes to its section', !(await menu.isVisible()) && (await mobile.locator('#about').evaluate((el) => el.getBoundingClientRect().top)) < 200);
  await mobile.evaluate(() => window.scrollTo(0, 0));

  const hero = await mobile.locator('h1').boundingBox();
  const mStage = await mobile.locator('[data-landing-stage]').boundingBox();
  check('the carousel comes after the words', mStage.y > hero.y + hero.height);
  const controls = await mobile.locator('[data-landing-next]').boundingBox();
  check('and the whole hero fits in about two screens', controls.y + controls.height < 844 * 2.1, String(Math.round(controls.y + controls.height)));
  const features3 = await mobile.locator('[data-landing-feature]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
  check('feature cards stack on a phone', new Set(features3).size === 1);

  await mobile.locator('[data-landing-stage]').scrollIntoViewIfNeeded();
  await mobile.evaluate(() => window.scrollBy(0, -120));
  await mobile.waitForTimeout(200);
  const stageNow = await mobile.locator('[data-landing-stage]').boundingBox();
  const midY = stageNow.y + Math.min(stageNow.height / 2, 300);
  await drag(client, [300, midY], [80, midY]);
  await settle(mobile);
  check('a swipe left shows the next card', (await activeSlide(mobile)) === 1);
  check('without leaving the page', new URL(mobile.url()).pathname === '/');
  await drag(client, [80, midY], [320, midY]);
  await settle(mobile);
  check('a swipe right goes back', (await activeSlide(mobile)) === 0);
  const scrolled = await mobile.evaluate(() => window.scrollY);
  await drag(client, [195, midY + 60], [195, midY - 160], 12);
  await mobile.waitForTimeout(500);
  check('a vertical drag on the carousel scrolls the page', (await mobile.evaluate(() => window.scrollY)) > scrolled + 50);
  check('and leaves the card where it was', (await activeSlide(mobile)) === 0);
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await mobile.locator('[data-landing-stage]').scrollIntoViewIfNeeded();
  await Promise.all([
    mobile.waitForURL(/\/signup/, { timeout: 15000 }),
    mobile.locator('[data-landing-slide][data-active] [data-landing-open]').tap(),
  ]);
  check('tapping the front card opens it', new URL(mobile.url()).pathname === '/signup');

  for (const [width, height] of [[360, 740], [320, 640]]) {
    await mobile.setViewportSize({ width, height });
    await mobile.goto('/', { waitUntil: 'networkidle' });
    check(`no sideways scroll at ${width}`, (await overflow(mobile)) <= 0, String(await overflow(mobile)));
    const bar = await mobile.locator('[data-landing-nav] > div').first().evaluate((el) => el.scrollWidth - el.clientWidth);
    check(`the bar fits at ${width}`, bar <= 0, String(bar));
  }
  await phone.close();

  /* ============================================================ real posts */
  section('ONCE PEOPLE HAVE POSTED');
  const ana = await account(browser, `ana${Date.now().toString(36).slice(-5)}`);
  const ids = [await postPhoto(ana.page, 'Morning light on the lake', '#3a7bd5'), await postPhoto(ana.page, 'New sketchbook page', '#d53a7b')];
  const ben = await account(browser, `ben${Date.now().toString(36).slice(-5)}`);
  ids.push(await postPhoto(ben.page, 'My cat, unimpressed', '#d5a33a'));

  const visitor = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const look = await visitor.newPage();
  look.on('pageerror', (error) => errors.push(`${look.url()} ${error}`));
  await look.goto('/', { waitUntil: 'networkidle' });
  const real = await look.locator('[data-landing-card="post"]').count();
  const previews = await look.locator('[data-landing-card="preview"]').count();
  check('the three real photos are in the carousel', real === 3, String(real));
  check('topped up with previews to five', previews === 2, String(previews));
  const order = await look.locator('[data-landing-card]').evaluateAll((els) => els.map((el) => el.getAttribute('data-landing-card')));
  check('real posts first', order.slice(0, 3).every((type) => type === 'post'), order.join(','));
  const realText = await look.locator('[data-landing-card="post"]').first().innerText();
  check('a real card names its author', new RegExp(`@(${ana.handle}|${ben.handle})`).test(realText), realText.split('\n').slice(0, 3).join(' | '));
  check('and is not badged as a preview', (await look.locator('[data-landing-card="post"] [data-landing-preview-badge]').count()) === 0);
  const href = await look.locator('[data-landing-slide][data-active] [data-landing-open]').getAttribute('href');
  check('the front card opens its post', ids.some((id) => href === `/post/${id}`), href);
  await Promise.all([look.waitForURL(/\/post\//), look.locator('[data-landing-slide][data-active] [data-landing-open]').click()]);
  const captions = ['Morning light on the lake', 'New sketchbook page', 'My cat, unimpressed'];
  const readable = await look
    .waitForFunction((list) => list.some((caption) => document.body.innerText.includes(caption)), captions, { timeout: 15000 })
    .then(() => true, () => false);
  check('which a visitor can read', readable && new URL(look.url()).pathname === href, (await look.locator('body').innerText()).slice(0, 120).replace(/\s+/g, ' '));
  await look.goto('/', { waitUntil: 'networkidle' });
  const img = look.locator('[data-landing-slide][data-active] img');
  await img.evaluate((el) => (el.complete ? null : new Promise((resolve) => el.addEventListener('load', resolve, { once: true }))));
  const chosen = await img.evaluate((el) => el.currentSrc);
  const width = Number(new URL(chosen).searchParams.get('w'));
  check('its photo is a resized thumbnail, not the upload', chosen.includes('/_next/image') && width > 0 && width <= 1080, chosen);
  check('loaded and drawn', await img.evaluate((el) => el.complete && el.naturalWidth > 0 && el.naturalWidth <= 1080), String(await img.evaluate((el) => el.naturalWidth)));
  await visitor.close();

  section('SIGNED IN');
  await ana.page.goto('/', { waitUntil: 'networkidle' });
  check('the bar offers Open FayTarra instead of Sign in', (await ana.page.locator('[data-landing-nav]').getByText('Open FayTarra').count()) === 1 && (await ana.page.locator('[data-landing-signin]').count()) === 0);
  await ana.context.close();
  await ben.context.close();

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
