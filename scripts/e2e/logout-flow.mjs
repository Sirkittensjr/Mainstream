/**
 * The log-out flow, on desktop and on a phone.
 *
 * Checks the thing that actually matters: that signing out happened on the
 * SERVER. A client-only logout looks identical until you reload — so every
 * check here reloads, opens a gated page, or asks the API who it thinks you
 * are, rather than trusting what the navigation is drawing.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHROMIUM = process.env.CHROMIUM_PATH;
const WHO = { email: 'tommy@faytarra.app', password: 'faydemo123' };

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const me = (page) => page.evaluate(async () => (await fetch('/api/v1/me')).json());

async function run(label, viewport, isMobile) {
  console.log(`\n######## ${label} ########`);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const context = await browser.newContext({ baseURL: BASE, viewport, isMobile, hasTouch: isMobile });
  const page = await context.newPage();

  // --- sign in -------------------------------------------------------------
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', WHO.email);
  await page.fill('#password', WHO.password);
  await Promise.all([
    page.waitForURL(/\/home/, { timeout: 20000 }),
    page.locator('form button[type=submit]').click(),
  ]);
  check('signed in', (await me(page))?.user?.username === 'tommy');

  // --- the account menu is reachable from the navigation -------------------
  const trigger = page.locator('button[aria-label="Account menu"]:visible').first();
  check('an account menu is visible in the navigation', (await trigger.count()) > 0);
  await trigger.click();
  const logout = page.locator('[role=menu] button:has-text("Log out")');
  check('the menu offers Log out', await logout.isVisible());
  check(
    'the menu also offers profile and settings',
    (await page.locator('[role=menu] a[href^="/u/"]').count()) > 0 &&
      (await page.locator('[role=menu] a[href="/settings"]').count()) > 0,
  );

  // Log out is a real form posting to a server action, not an onClick.
  check(
    'Log out submits a form (server action), not a client handler',
    (await page.locator('[role=menu] form button:has-text("Log out")').count()) > 0,
  );

  // --- log out -------------------------------------------------------------
  await Promise.all([page.waitForURL(`${BASE}/`, { timeout: 25000 }), logout.click()]);
  check('redirected to the homepage', new URL(page.url()).pathname === '/', page.url());

  // --- the navigation flips immediately, with no reload --------------------
  const navHtml = await page.content();
  check(
    'navigation immediately shows the logged-out state',
    /Join FayTarra|Sign in/i.test(navHtml) &&
      (await page.locator('button[aria-label="Account menu"]').count()) === 0,
  );

  // --- the SESSION is actually gone ---------------------------------------
  check('the API no longer recognises the session', (await me(page))?.user === undefined);

  // --- refresh does not sign you back in -----------------------------------
  await page.reload({ waitUntil: 'domcontentloaded' });
  check('still logged out after a refresh', (await me(page))?.user === undefined);
  check(
    'navigation still shows logged out after a refresh',
    (await page.locator('button[aria-label="Account menu"]').count()) === 0,
  );

  // --- gated pages are closed again ---------------------------------------
  for (const route of ['/settings', '/create', '/notifications']) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    check(`${route} is closed again`, new URL(page.url()).pathname === '/login', page.url());
  }

  // --- a brand new tab in the same browser is also signed out -------------
  const fresh = await context.newPage();
  await fresh.goto('/home', { waitUntil: 'domcontentloaded' });
  check('a new tab is signed out too', (await me(fresh))?.user === undefined);
  await fresh.close();

  await browser.close();
}

await run('DESKTOP 1440x900', { width: 1440, height: 900 }, false);
await run('MOBILE 390x844', { width: 390, height: 844 }, true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
