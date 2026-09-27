/**
 * The official administrator badge.
 *
 * It is granted by one thing: `role = 'admin'` in the database. These checks
 * are about the two ways a badge like this goes wrong — an admin who does not
 * carry it somewhere they are shown, and somebody who is not an admin managing
 * to wear one.
 *
 * The second is the one worth being thorough about. A display name is
 * free-form text, so the test below puts the badge's own words and its icon
 * into a normal account's name and bio and checks that what appears is text,
 * not a badge.
 *
 *   node scripts/e2e/admin-badge.mjs
 */
import { chromium } from 'playwright';
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const confirmationLink = (email) =>
  [...mails()].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;

async function account(browser, email, handle, interest, viewport) {
  const context = await browser.newContext({ baseURL: BASE, viewport });
  const page = await context.newPage();
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]', { hasText: interest }).first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForTimeout(3500);

  if (/verify-email/.test(page.url())) {
    const link = confirmationLink(email);
    if (!link) throw new Error(`no confirmation email for ${email}`);
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    return { context, page, email, handle };
  }

  // The address already exists — which is the normal case for the admin, both
  // here across runs and in a real deployment. Sign in instead.
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', email);
  await page.fill('#password', PASSWORD);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  if (/\/login/.test(page.url())) {
    throw new Error(`could not create or sign in ${email} — stuck at ${page.url()}`);
  }

  // The account already existed, so its handle is whatever it was created
  // with — NOT the one just asked for. Using the wrong one points every later
  // check at a profile that does not exist, which looks exactly like a badge
  // that failed to render.
  const actual = await page.evaluate(async () => (await fetch('/api/v1/me')).json());
  return { context, page, email, handle: actual?.user?.username ?? handle };
}

/** Is the profile HEADING itself badged? Separate from the rest of the page:
 *  an ordinary profile can legitimately show a badge lower down, on a Top 3
 *  card naming an admin, and counting those would make this test nonsense. */
const headingBadge = (page) =>
  page.evaluate(() => document.querySelector('h1 [data-admin-badge="true"]') !== null);

/** How many badges are on this page, and do they say the right thing? */
async function badges(page) {
  return page.evaluate(() => {
    const found = [...document.querySelectorAll('[data-admin-badge="true"]')];
    return {
      count: found.length,
      labels: [...new Set(found.map((b) => b.getAttribute('aria-label')))],
      titles: [...new Set(found.map((b) => b.getAttribute('title')))],
      // A badge next to a name must not be a wall of its own.
      widths: found.map((b) => Math.round(b.getBoundingClientRect().width)),
    };
  });
}

async function post(actor, body) {
  await actor.page.goto('/create', { waitUntil: 'domcontentloaded' });
  await actor.page.waitForLoadState('networkidle');
  await actor.page.fill('textarea', body);
  await actor.page.locator('form button[type=submit]').last().click();
  await actor.page.waitForURL(/\/post\//, { timeout: 25000 });
  return actor.page.url().split('/post/')[1].split(/[?#]/)[0];
}

async function comment(actor, postId, body) {
  await actor.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await actor.page.waitForLoadState('networkidle');
  await actor.page.fill('textarea[name=body]', body);
  await actor.page.locator('form button[type=submit]').first().click();
  await actor.page.waitForTimeout(1800);
}

async function run(label, viewport) {
  console.log(`\n================ ${label} ================`);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

  const admin = await account(browser, ADMIN_EMAIL, `fayadm${stamp}`.slice(0, 20), 'Tech', viewport);
  const user = await account(browser, `plain_${stamp}@example.com`, `plain_${stamp}`.slice(0, 20), 'Music', viewport);

  // ==================== THE ADMIN CARRIES IT ====================
  section('AN ADMIN IS MARKED');

  await user.page.goto(`/u/${admin.handle}`, { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  const onProfile = await badges(user.page);
  check('the admin profile shows a badge', onProfile.count >= 1, `${onProfile.count} found`);
  check('and it is on the name itself', await headingBadge(user.page));
  check('it is labelled "FayTarra Admin"', onProfile.labels.includes('FayTarra Admin'), onProfile.labels.join(', '));
  check('and carries the same tooltip', onProfile.titles.includes('FayTarra Admin'), onProfile.titles.join(', '));
  check(
    'it is small enough to sit beside a name',
    onProfile.widths.every((w) => w > 0 && w <= 28),
    onProfile.widths.join(', '),
  );

  // A post by the admin, seen by somebody else.
  const adminPost = await post(admin, `an official announcement ${stamp}`);
  await user.page.goto(`/post/${adminPost}`, { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  check('the admin post card shows a badge', (await badges(user.page)).count >= 1);

  // A comment by the admin, on somebody else's post.
  const userPost = await post(user, `an ordinary post ${stamp}`);
  await comment(admin, userPost, `replying officially ${stamp}`);
  await user.page.goto(`/post/${userPost}`, { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  const onComment = await badges(user.page);
  check('the admin comment shows a badge', onComment.count >= 1, `${onComment.count} found`);
  check(
    'and the ordinary author of that post does not',
    onComment.count === 1,
    `${onComment.count} badges on a page with one admin comment`,
  );

  // Search, and the follower lists.
  await user.page.goto(`/search?q=${admin.handle}`, { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  check('search results show the badge', (await badges(user.page)).count >= 1, user.page.url());

  await user.page.goto(`/u/${admin.handle}`, { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  const follow = user.page.locator('button', { hasText: /^Follow$/ });
  if (await follow.count()) {
    await follow.first().click();
    await wait(1600);
  }
  await user.page.goto(`/u/${user.handle}/following`, { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  check('the following list shows the badge', (await badges(user.page)).count >= 1, user.page.url());

  await admin.page.goto(`/u/${admin.handle}/followers`, { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const onFollowers = await badges(admin.page);
  check(
    'a followers list of ordinary accounts shows none',
    onFollowers.count === 0,
    `${onFollowers.count} found`,
  );

  // Notifications: the admin's follow of the user, seen by the user.
  await admin.page.goto(`/u/${user.handle}`, { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const adminFollow = admin.page.locator('button', { hasText: /^Follow$/ });
  if (await adminFollow.count()) {
    await adminFollow.first().click();
    await wait(1600);
  }
  await user.page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  check('notifications from an admin show the badge', (await badges(user.page)).count >= 1);

  // ==================== A NORMAL ACCOUNT DOES NOT ====================
  section('AN ORDINARY ACCOUNT IS NOT');

  await admin.page.goto(`/u/${user.handle}`, { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  check('an ordinary profile\u2019s name carries no badge', !(await headingBadge(admin.page)));

  await admin.page.goto(`/post/${userPost}`, { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const onUserPost = await badges(admin.page);
  check(
    'an ordinary post shows only the admin comment’s badge, not the author’s',
    onUserPost.count === 1,
    `${onUserPost.count} found`,
  );

  // ============ AND CANNOT GIVE ITSELF ONE ============
  section('NOBODY CAN AWARD THEMSELVES ONE');

  // The badge's own words, and its icon, typed into the places a person
  // controls. What comes out must be text, not a badge.
  await user.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  // A name that is ALLOWED, so this save goes through and the bio lands — the
  // reserved name is refused outright now, and is proved so in its own section
  // below. What is under test here is whether text and markup can fake a
  // badge, not whether the name is taken.
  await user.page.fill('#display_name', 'FayTarra Admin Fan');
  await user.page.fill('#bio', '🛡️ FayTarra Admin — official <span data-admin-badge="true"></span>');
  // By its label: /settings has TWO submit buttons and the other one is
  // "Log out", which is a memorable way to fail the rest of a test run.
  await user.page.locator('button', { hasText: /^Save profile$/ }).first().click();
  await wait(2500);

  await admin.page.goto(`/u/${user.handle}`, { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  check(
    'a name mentioning FayTarra Admin does not award a badge',
    !(await headingBadge(admin.page)),
  );
  const shown = await admin.page.locator('body').innerText();
  check(
    'the name is still shown — it is just text, not a credential',
    shown.includes('FayTarra Admin Fan'),
    shown.split('\n').find((line) => /FayTarra Admin/.test(line))?.trim() ?? 'not found',
  );
  // The bio held `<span data-admin-badge="true"></span>`. It must come back as
  // visible TEXT — escaped — rather than as an element the badge counter finds.
  const bioText = await admin.page.locator('body').innerText();
  check(
    'badge markup typed into a bio comes back as text, escaped',
    bioText.includes('<span data-admin-badge'),
    'the literal tag is shown, not rendered',
  );
  // Scoped to the heading: this profile legitimately shows a badge lower down,
  // on the Top 3 card naming the admin they follow.
  check(
    'and it did not become a real badge on their name',
    !(await headingBadge(admin.page)),
  );

  // ============ AND CANNOT TAKE THE NAME EITHER ============
  section('THE NAME IS RESERVED TOO');

  // The rename above should have been REFUSED, not merely left unbadged.
  await user.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  check(
    'the ordinary account never got the reserved name',
    (await user.page.inputValue('#display_name')) !== 'FayTarra Admin',
    await user.page.inputValue('#display_name'),
  );

  for (const attempt of ['FayTarra Admin', 'faytarra admin', '  FayTarra  Admin  ', 'FayTarra-Admin', 'F\u0430yTarra Admin']) {
    await user.page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await user.page.waitForLoadState('networkidle');
    await user.page.fill('#display_name', attempt);
    await user.page.locator('button', { hasText: /^Save profile$/ }).first().click();
    await wait(2000);
    const said = await user.page.locator('body').innerText();
    check(
      `refused: ${JSON.stringify(attempt)}`,
      /reserved for official FayTarra accounts/i.test(said),
      said.split('\n').find((line) => /reserved/i.test(line))?.trim() ?? 'no message',
    );
  }

  // A name that merely contains the word must still be fine.
  await user.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  await user.page.fill('#display_name', 'FayTarra Fan Club');
  await user.page.locator('button', { hasText: /^Save profile$/ }).first().click();
  await wait(2000);
  check(
    'an ordinary name that mentions FayTarra still saves',
    (await user.page.inputValue('#display_name')) === 'FayTarra Fan Club',
    await user.page.inputValue('#display_name'),
  );

  // The admin may use it, because it is theirs.
  await admin.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const adminNameBefore = await admin.page.inputValue('#display_name');
  await admin.page.fill('#display_name', 'FayTarra Admin');
  await admin.page.locator('button', { hasText: /^Save profile$/ }).first().click();
  await wait(2000);
  check(
    'an administrator CAN use the reserved name',
    (await admin.page.inputValue('#display_name')) === 'FayTarra Admin',
    await admin.page.inputValue('#display_name'),
  );

  await admin.page.goto(`/u/${admin.handle}`, { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  check('and still carries the badge with it', await headingBadge(admin.page));

  // Put it back, so a rerun starts from where this one did.
  await admin.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  await admin.page.fill('#display_name', adminNameBefore);
  await admin.page.locator('button', { hasText: /^Save profile$/ }).first().click();
  await wait(1500);

  // The API must not hand the browser a role to play with.
  const me = await user.page.evaluate(async () => (await fetch('/api/v1/me')).json());
  check('the API exposes no role field', me?.user && !('role' in me.user), JSON.stringify(Object.keys(me?.user ?? {})));
  check(
    'only a derived isAdmin, and it is false for them',
    me?.user?.isAdmin === false,
    JSON.stringify(me?.user?.isAdmin),
  );

  const adminMe = await admin.page.evaluate(async () => (await fetch('/api/v1/me')).json());
  check('and true for the admin', adminMe?.user?.isAdmin === true, JSON.stringify(adminMe?.user?.isAdmin));
  check('with still no role field', adminMe?.user && !('role' in adminMe.user));

  await browser.close();
}

await run('DESKTOP 1280x900', { width: 1280, height: 900 });
await run('MOBILE 390x844', { width: 390, height: 844 });

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
