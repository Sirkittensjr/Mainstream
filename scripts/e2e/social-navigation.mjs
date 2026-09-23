/**
 * Getting from a list of people, or a notification, to the right profile.
 *
 * Four accounts with real follows, likes, comments and ratings between them —
 * no fixtures, no seeded conversations. Every check ends the same way: click
 * the person, and confirm the profile that opens is THEIRS, by reading the
 * @handle off the page rather than trusting the URL alone.
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e/social-navigation.mjs
 */
import { chromium } from 'playwright';
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

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

async function createAccount(browser, handle, interest, viewport) {
  const context = await browser.newContext({ baseURL: BASE, ...(viewport ?? {}) });
  const page = await context.newPage();
  const email = `${handle}@example.com`;
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]', { hasText: interest }).first().click();
  await page.locator('form button[type=submit]').last().click();
  // On the URL, not on a load event: signup redirects from a server action,
  // which is a client-side navigation and never fires one.
  await page.waitForFunction(() => location.pathname.startsWith('/verify-email'), undefined, {
    timeout: 30000,
  });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  return { context, page, handle };
}

async function follow(actor, handle) {
  await actor.page.goto(`/u/${handle}`, { waitUntil: 'domcontentloaded' });
  const button = actor.page.locator('button', { hasText: /^Follow$/ });
  if ((await button.count()) > 0) {
    await button.first().click();
    await actor.page.waitForTimeout(1500);
  }
}

/** Waits for an element that proves the page has rendered, not merely parsed. */
const waitFor = (page, selector) =>
  page.locator(selector).first().waitFor({ state: 'visible', timeout: 15000 });

/**
 * Clicks a person and reports whose profile opened.
 *
 * Two things this has to get right. The wait is for the path to CHANGE to a
 * bare `/u/<handle>`, because a followers list is already under `/u/` and a
 * looser check returns before the click has gone anywhere. And the handle
 * comes off the URL rather than the page text, because the first @handle in
 * the text is the VIEWER's own, in the navigation, on every page.
 */
async function clickThrough(page, locator) {
  const from = new URL(page.url()).pathname;
  await locator.click();
  await page.waitForFunction(
    (before) => location.pathname !== before && /^\/u\/[^/]+$/.test(location.pathname),
    from,
    { timeout: 15000 },
  );
  const handle = new URL(page.url()).pathname.split('/')[2] ?? null;
  // Then confirm the page really is about them, not just that the URL says so.
  const shown = await page
    .waitForFunction((h) => document.body.innerText.includes(`@${h}`), handle, { timeout: 15000 })
    .then(() => true, () => false);
  return { url: page.url(), handle, shown };
}

const run = async () => {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = Date.now().toString(36).slice(-6);
  const aH = `nav_${stamp}`;
  const bH = `bee_${stamp}`;
  const cH = `cee_${stamp}`;
  const dH = `dee_${stamp}`;

  const A = await createAccount(browser, aH, 'Music');
  const B = await createAccount(browser, bH, 'Art');
  const C = await createAccount(browser, cH, 'Life');
  const D = await createAccount(browser, dH, 'Gaming');
  check('four accounts created', true);

  // A real graph: B, C and D all follow A. A follows B and C.
  for (const person of [B, C, D]) await follow(person, aH);
  for (const handle of [bH, cH]) await follow(A, handle);
  // And B follows C, so B has someone in their own following list.
  await follow(B, cH);

  /* ===================================================================== */
  section('MY OWN LISTS');

  await A.page.goto(`/u/${aH}`, { waitUntil: 'domcontentloaded' });
  const followersLink = A.page.locator(`a[href="/u/${aH}/followers"]`);
  const followingLink = A.page.locator(`a[href="/u/${aH}/following"]`);
  check('Followers on my profile is a link', (await followersLink.count()) > 0);
  check('Following on my profile is a link', (await followingLink.count()) > 0);

  await followersLink.first().click();
  await waitFor(A.page, 'nav[aria-label="Followers and following"]');
  const myFollowers = await A.page.locator('body').innerText();
  check('my followers list opens', /Followers/.test(myFollowers), A.page.url());
  check('and lists the people who actually follow me', [bH, cH, dH].every((h) => myFollowers.includes(`@${h}`)));
  check('each row shows a display name as well as the handle', myFollowers.includes(bH.toUpperCase()));

  const first = await clickThrough(A.page, A.page.locator(`a[href="/u/${bH}"]`).first());
  check('clicking a follower opens THEIR profile', first.handle === bH && first.shown, `${first.url} shows @${first.handle}`);

  await A.page.goto(`/u/${aH}/following`, { waitUntil: 'domcontentloaded' });
  await waitFor(A.page, 'nav[aria-label="Followers and following"]');
  const myFollowing = await A.page.locator('body').innerText();
  check('my following list lists who I follow', myFollowing.includes(`@${bH}`) && myFollowing.includes(`@${cH}`));
  check('and not people I do not follow', !myFollowing.includes(`@${dH}`), `d=${dH}`);

  const second = await clickThrough(A.page, A.page.locator(`a[href="/u/${cH}"]`).first());
  check('clicking someone I follow opens THEIR profile', second.handle === cH && second.shown, `shows @${second.handle}`);

  /* ===================================================================== */
  section("SOMEBODY ELSE'S LISTS");

  await A.page.goto(`/u/${bH}`, { waitUntil: 'domcontentloaded' });
  await A.page.locator(`a[href="/u/${bH}/followers"]`).first().click();
  await waitFor(A.page, 'nav[aria-label="Followers and following"]');
  const theirFollowers = await A.page.locator('body').innerText();
  check("another person's followers list opens", theirFollowers.includes(`@${aH}`), A.page.url());

  const third = await clickThrough(A.page, A.page.locator(`a[href="/u/${aH}"]`).first());
  check("clicking a person in their followers opens that person's profile", third.handle === aH && third.shown, `shows @${third.handle}`);

  await A.page.goto(`/u/${bH}/following`, { waitUntil: 'domcontentloaded' });
  await waitFor(A.page, 'nav[aria-label="Followers and following"]');
  const theirFollowing = await A.page.locator('body').innerText();
  check("another person's following list opens", theirFollowing.includes(`@${cH}`), A.page.url());

  const fourth = await clickThrough(A.page, A.page.locator(`a[href="/u/${cH}"]`).first());
  check("clicking a person in their following opens that person's profile", fourth.handle === cH && fourth.shown, `shows @${fourth.handle}`);

  check('the two lists are reachable from each other', true);
  await A.page.goto(`/u/${bH}/followers`, { waitUntil: 'domcontentloaded' });
  await A.page.locator('nav[aria-label="Followers and following"] a', { hasText: 'Following' }).click();
  await A.page.waitForFunction(() => location.pathname.endsWith('/following'), undefined, { timeout: 15000 });
  check('switching between Followers and Following works', /\/following$/.test(A.page.url()), A.page.url());

  /* ===================================================================== */
  section('NOTIFICATIONS');

  // A posts, then B likes, C comments and D rates it — four kinds of actor.
  await A.page.goto('/create', { waitUntil: 'domcontentloaded' });
  const caption = `navigation test post ${stamp}`;
  await A.page.fill('textarea[name=caption]', caption);
  await A.page.locator('form button[type=submit]').last().click();
  await A.page.waitForFunction(() => location.pathname.startsWith('/post/'), undefined, {
    timeout: 30000,
  });
  const postUrl = A.page.url();

  await B.page.goto(postUrl, { waitUntil: 'domcontentloaded' });
  await B.page.locator('button[aria-label*="ike"]').first().click();
  await B.page.waitForTimeout(1200);

  await C.page.goto(postUrl, { waitUntil: 'domcontentloaded' });
  await C.page.fill('textarea[name=body]', `a comment from C ${stamp}`);
  await C.page.locator('form button[type=submit]').first().click();
  await C.page.waitForTimeout(1800);

  await D.page.goto(postUrl, { waitUntil: 'domcontentloaded' });
  await D.page.locator('button', { hasText: 'Rate' }).first().click();
  await D.page.waitForTimeout(600);
  await D.page.locator('[role=dialog] button', { hasText: /^8$/ }).first().click();
  await D.page.locator('[role=dialog] button', { hasText: /Send|Rate|Save/ }).last().click();
  await D.page.waitForTimeout(1800);

  await A.page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await waitFor(A.page, 'li div.card');
  const feed = await A.page.locator('body').innerText();
  check('a follow notification arrived', new RegExp(`@(${bH}|${cH}|${dH}) started following you`).test(feed));
  check('a like notification arrived', new RegExp(`@${bH} liked your post`).test(feed));
  check('a comment notification arrived', new RegExp(`@${cH} commented on your post`).test(feed));
  check('a rating notification arrived', new RegExp(`@${dH} rated your post`).test(feed));

  /**
   * Finds the notification about `expected` doing `text`, and clicks them.
   *
   * Scoped to the row that mentions that person, not merely the first row of
   * that kind: three people follow A here, so "the first follow notification"
   * is whichever one the database happened to return first.
   */
  async function clickPersonIn(text, expected) {
    await A.page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await waitFor(A.page, 'li div.card');
    const row = A.page
      .locator('li')
      .filter({ hasText: text })
      .filter({ has: A.page.locator(`a[href="/u/${expected}"]`) })
      .first();
    if ((await row.count()) === 0) {
      return { handle: null, url: `no row where @${expected} ${text}` };
    }
    return clickThrough(A.page, row.locator(`a[href="/u/${expected}"]`).first());
  }

  const followNote = await clickPersonIn('started following you', dH);
  check('clicking the person on a follow notification opens their profile', followNote.handle === dH && followNote.shown, `shows @${followNote.handle}`);

  const likeNote = await clickPersonIn('liked your post', bH);
  check('clicking the person on a like notification opens their profile', likeNote.handle === bH && likeNote.shown, `shows @${likeNote.handle}`);

  const commentNote = await clickPersonIn('commented on your post', cH);
  check('clicking the person on a comment notification opens their profile', commentNote.handle === cH && commentNote.shown, `shows @${commentNote.handle}`);

  const rateNote = await clickPersonIn('rated your post', dH);
  check('clicking the person on a rating notification opens their profile', rateNote.handle === dH && rateNote.shown, `shows @${rateNote.handle}`);

  // The content half of the row must still go where it always did.
  await A.page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await waitFor(A.page, 'li div.card');
  const likeRow = A.page.locator('li', { hasText: 'liked your post' }).first();
  await likeRow.locator('a[href^="/post/"]').first().click();
  await A.page.waitForFunction(() => location.pathname.startsWith('/post/'), undefined, { timeout: 15000 });
  await A.page
    .waitForFunction((text) => document.body.innerText.includes(text), caption, { timeout: 15000 })
    .catch(() => undefined);
  check('and the rest of the row still opens the post', (await A.page.locator('body').innerText()).includes(caption), A.page.url());

  await A.page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  const avatarLinks = await A.page.locator('li a[href^="/u/"] img, li a[href^="/u/"] span[style]').count();
  check('the avatar is a link to the person too', avatarLinks > 0, `${avatarLinks} avatar links`);

  /* ===================================================================== */
  section('BLOCKING');

  await A.page.goto(`/u/${dH}`, { waitUntil: 'domcontentloaded' });
  await A.page.locator('button[aria-label="More options"]').first().click();
  await A.page.locator('button', { hasText: new RegExp(`^Block @${dH}$`) }).first().click();
  await A.page.waitForTimeout(2000);

  await A.page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await A.page.waitForTimeout(600);
  const afterBlock = await A.page.locator('body').innerText();
  check('a blocked account drops out of notifications', !afterBlock.includes(`@${dH}`), `d=${dH}`);

  await A.page.goto(`/u/${aH}/followers`, { waitUntil: 'domcontentloaded' });
  check(
    'and out of the followers list',
    !(await A.page.locator('body').innerText()).includes(`@${dH}`),
  );

  /* ===================================================================== */
  section('MOBILE');

  const phone = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: await A.context.storageState(),
  });
  const phonePage = await phone.newPage();

  await phonePage.goto(`/u/${aH}`, { waitUntil: 'domcontentloaded' });
  await phonePage.waitForTimeout(500);
  const tapTarget = await phonePage.locator(`a[href="/u/${aH}/followers"]`).boundingBox();
  check('the Followers link is big enough to tap', (tapTarget?.height ?? 0) >= 40, `${Math.round(tapTarget?.height ?? 0)}px`);

  await phonePage.locator(`a[href="/u/${aH}/followers"]`).first().click();
  await waitFor(phonePage, 'nav[aria-label="Followers and following"]');
  const phoneOverflow = await phonePage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('the list does not scroll sideways on a phone', phoneOverflow <= 0, `${phoneOverflow}px`);

  const phoneRow = await clickThrough(phonePage, phonePage.locator(`a[href="/u/${bH}"]`).first());
  check('tapping a person on a phone opens their profile', phoneRow.handle === bH && phoneRow.shown, `shows @${phoneRow.handle}`);

  await phonePage.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await waitFor(phonePage, 'li div.card');
  const noteOverflow = await phonePage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('notifications do not scroll sideways on a phone', noteOverflow <= 0, `${noteOverflow}px`);

  const phoneNote = await clickThrough(
    phonePage,
    phonePage.locator('li', { hasText: 'liked your post' }).first().locator(`a[href="/u/${bH}"]`).first(),
  );
  check('tapping the person on a notification opens their profile', phoneNote.handle === bH && phoneNote.shown, `shows @${phoneNote.handle}`);
  await phone.close();

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
