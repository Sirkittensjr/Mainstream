/**
 * The full account lifecycle, driven through a real browser against the
 * production build: sign up, confirm the email, sign in, sign out, sign back
 * in, and check that nothing was lost. Also checks that a signed-out browser
 * cannot reach the signed-in-only parts of FayTarra.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const stamp = Date.now().toString(36);
const ACCOUNT = {
  email: `testperson_${stamp}@example.com`,
  username: `tester_${stamp}`.slice(0, 20),
  display: 'Test Person',
  password: 'correct horse battery',
  bio: 'Here to test the sign-in.',
};

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function mail(type, to) {
  const lines = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...lines].reverse().find((m) => m.type === type && m.to === to);
}

const run = async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();

  // --- 0. a signed-out browser is kept out --------------------------------
  for (const route of ['/create', '/settings', '/notifications', '/admin']) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    check(
      `signed out: ${route} is not reachable`,
      url.pathname === '/login' && url.searchParams.get('next') === route,
      `landed on ${page.url()}`,
    );
  }

  // --- 1. sign up ----------------------------------------------------------
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', ACCOUNT.email);
  await page.fill('#username', ACCOUNT.username);
  await page.fill('#password', ACCOUNT.password);
  await page.fill('#display_name', ACCOUNT.display);
  await page.fill('textarea[name=bio]', ACCOUNT.bio);
  await page.locator('button[aria-pressed]', { hasText: 'Music' }).first().click();
  await Promise.all([
    page.waitForURL(/verify-email|home/, { timeout: 20000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
  check('signup lands on the confirm-your-email step', page.url().includes('/verify-email'), page.url());

  // --- 2. an unconfirmed account cannot sign in ---------------------------
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', ACCOUNT.email);
  await page.fill('#password', ACCOUNT.password);
  await page.locator('form button[type=submit]').click();
  await page.waitForLoadState('networkidle');
  check(
    'an unconfirmed account cannot sign in yet',
    page.url().includes('/verify-email') || (await page.content()).includes('Confirm your email'),
    page.url(),
  );

  // --- 3. confirm the address ---------------------------------------------
  const confirmation = mail('signup', ACCOUNT.email);
  check('a confirmation email was sent', Boolean(confirmation), confirmation?.link ?? 'no email');
  await page.goto(confirmation.link, { waitUntil: 'domcontentloaded' });
  check('the confirmation link signs the new account in', new URL(page.url()).pathname === '/home', page.url());

  // --- 4. the profile exists and is the one that was typed in -------------
  let me = await page.evaluate(async () => (await fetch('/api/v1/me')).json());
  check('the FayTarra profile was created', me?.user?.username === ACCOUNT.username, JSON.stringify(me?.user ?? me));
  check('the display name was kept', me?.user?.displayName === ACCOUNT.display, me?.user?.displayName);
  check('the bio was kept', me?.user?.bio === ACCOUNT.bio, me?.user?.bio);

  // --- 5. post something, so there is data to persist ---------------------
  await page.goto('/create', { waitUntil: 'domcontentloaded' });
  check('signed in: /create is reachable', new URL(page.url()).pathname === '/create', page.url());
  const caption = `a post from the auth test ${stamp}`;
  await page.fill('textarea[name=caption]', caption);
  await Promise.all([
    page.waitForURL(/\/post\/|\/home/, { timeout: 20000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
  check('the post was published', page.url().includes('/post/') || page.url().includes('/home'), page.url());

  // --- 6. the session survives a reload and a fresh visit -----------------
  // A hard reload is the thing people actually do, and it is what catches a
  // session held only in memory rather than in the cookies.
  await page.goto('/home', { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const afterReload = await page.evaluate(async () => (await fetch('/api/v1/me')).json());
  check('still signed in after a hard refresh', afterReload?.user?.username === ACCOUNT.username);
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  check(
    'a signed-in-only page still opens after a refresh',
    new URL(page.url()).pathname === '/settings',
    page.url(),
  );

  const revisit = await context.newPage();
  await revisit.goto('/home', { waitUntil: 'domcontentloaded' });
  const still = await revisit.evaluate(async () => (await fetch('/api/v1/me')).json());
  check('still signed in on a new tab', still?.user?.username === ACCOUNT.username);
  await revisit.close();

  // A brand new browser context must NOT be signed in.
  const stranger = await browser.newContext({ baseURL: BASE });
  const strangerPage = await stranger.newPage();
  await strangerPage.goto('/settings', { waitUntil: 'domcontentloaded' });
  check(
    'a different browser is not signed in',
    new URL(strangerPage.url()).pathname === '/login',
    strangerPage.url(),
  );
  const strangerMe = await strangerPage.evaluate(async () => {
    const response = await fetch('/api/v1/me');
    return response.status;
  });
  check('the API refuses an unauthenticated caller', strangerMe === 401, `status ${strangerMe}`);
  await stranger.close();

  // --- 7. sign out ---------------------------------------------------------
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await Promise.all([
    page.waitForURL(`${BASE}/`, { timeout: 20000 }),
    page.getByRole('button', { name: /log out|sign out/i }).first().click(),
  ]);
  check('logging out returns to the landing page', new URL(page.url()).pathname === '/', page.url());
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  check('after logging out, /settings is closed again', new URL(page.url()).pathname === '/login', page.url());

  // --- 8. sign back in -----------------------------------------------------
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', ACCOUNT.username); // by username this time
  await page.fill('#password', ACCOUNT.password);
  await Promise.all([
    page.waitForURL(/\/home/, { timeout: 20000 }),
    page.locator('form button[type=submit]').click(),
  ]);
  check('signing back in works, by username', page.url().includes('/home'), page.url());

  // --- 9. everything is still there ---------------------------------------
  me = await page.evaluate(async () => (await fetch('/api/v1/me')).json());
  check('the same profile came back', me?.user?.username === ACCOUNT.username);
  check('the bio persisted', me?.user?.bio === ACCOUNT.bio);
  await page.goto(`/u/${ACCOUNT.username}`, { waitUntil: 'domcontentloaded' });
  const profileHtml = await page.content();
  check('the post written before signing out is still on the profile', profileHtml.includes(caption));

  // --- 10. a wrong password is refused ------------------------------------
  const wrong = await browser.newContext({ baseURL: BASE });
  const wrongPage = await wrong.newPage();
  await wrongPage.goto('/login', { waitUntil: 'domcontentloaded' });
  await wrongPage.fill('#identifier', ACCOUNT.email);
  await wrongPage.fill('#password', 'not the password');
  await wrongPage.locator('form button[type=submit]').click();
  await wrongPage.waitForLoadState('networkidle');
  check(
    'the wrong password is refused',
    new URL(wrongPage.url()).pathname === '/login' &&
      (await wrongPage.content()).includes('do not match an account'),
    wrongPage.url(),
  );
  await wrong.close();

  // --- 11. usernames cannot be taken twice --------------------------------
  const dup = await browser.newContext({ baseURL: BASE });
  const dupPage = await dup.newPage();
  await dupPage.goto('/signup', { waitUntil: 'domcontentloaded' });
  await dupPage.fill('#email', `someone_else_${stamp}@example.com`);
  await dupPage.fill('#username', ACCOUNT.username.toUpperCase());
  await dupPage.fill('#password', 'another password');
  await dupPage.fill('#display_name', 'Impostor');
  await dupPage.locator('button[aria-pressed]', { hasText: 'Music' }).first().click();
  await dupPage.locator('form button[type=submit]').last().click();
  await dupPage.waitForLoadState('networkidle');
  check(
    'the username cannot be taken a second time',
    (await dupPage.content()).includes('username is taken'),
    dupPage.url(),
  );
  await dup.close();

  // --- 12. password reset --------------------------------------------------
  const reset = await browser.newContext({ baseURL: BASE });
  const resetPage = await reset.newPage();
  await resetPage.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
  await resetPage.fill('#email', ACCOUNT.email);
  await resetPage.locator('form button[type=submit]').click();
  await resetPage.waitForLoadState('networkidle');
  const recovery = mail('recovery', ACCOUNT.email);
  check('a reset email was sent', Boolean(recovery), recovery?.link ?? 'no email');
  await resetPage.goto(recovery.link, { waitUntil: 'domcontentloaded' });
  check('the reset link opens the new-password form', resetPage.url().includes('/reset-password'), resetPage.url());
  const NEW_PASSWORD = 'a brand new password';
  await resetPage.fill('#password', NEW_PASSWORD);
  await resetPage.fill('#confirm', NEW_PASSWORD);
  await Promise.all([
    resetPage.waitForURL(/\/home/, { timeout: 20000 }),
    resetPage.locator('form button[type=submit]').click(),
  ]);
  check('setting a new password works', resetPage.url().includes('/home'), resetPage.url());
  await reset.close();

  const after = await browser.newContext({ baseURL: BASE });
  const afterPage = await after.newPage();
  await afterPage.goto('/login', { waitUntil: 'domcontentloaded' });
  await afterPage.fill('#identifier', ACCOUNT.email);
  await afterPage.fill('#password', NEW_PASSWORD);
  await Promise.all([
    afterPage.waitForURL(/\/home/, { timeout: 20000 }),
    afterPage.locator('form button[type=submit]').click(),
  ]);
  check('the new password signs in', afterPage.url().includes('/home'), afterPage.url());
  await afterPage.goto('/login', { waitUntil: 'domcontentloaded' });
  await afterPage.fill('#identifier', ACCOUNT.email);
  await afterPage.fill('#password', ACCOUNT.password);
  await afterPage.locator('form button[type=submit]').click();
  await afterPage.waitForLoadState('networkidle');
  check(
    'the old password no longer works',
    (await afterPage.content()).includes('do not match an account'),
    afterPage.url(),
  );
  await after.close();

  // --- 13. no password ever reaches FayTarra's own store ------------------
  const dump = readFileSync(process.env.FAYTARRA_DATA_FILE || '.data/faytarra.json', 'utf8');
  check('the password is nowhere in FayTarra\'s data', !dump.includes(ACCOUNT.password));
  check('no password_hash column exists', !dump.includes('password_hash'));

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
