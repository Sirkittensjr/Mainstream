/**
 * The /admin route, and who is allowed through it.
 *
 * The rule under test is that admin is enforced on the SERVER. Hiding the
 * link is not a lock, so every check here asks for the page directly rather
 * than looking for a button — a normal account typing /admin into the address
 * bar is exactly the attack.
 *
 *   ADMIN_EMAILS=admin@faytarra.com npm start &
 *   node scripts/e2e/admin-access.mjs
 *
 * The app needs ADMIN_EMAILS to contain the admin address: that is the hook
 * `ensureProfile` uses to apply the role on sign-in. In production the role is
 * set by migration 0008 instead, and both end at the same column.
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

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

async function createAccount(browser, email, handle, interest) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]', { hasText: interest }).first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForTimeout(3500);

  // The admin address may already exist — in a real deployment it certainly
  // does, which is the whole point. Fall back to signing in.
  if (!/verify-email/.test(page.url())) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.fill('#identifier', email);
    await page.fill('#password', PASSWORD);
    await page.locator('form button[type=submit]').last().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    if (/\/login/.test(page.url())) {
      throw new Error(`could not create or sign in ${email} — at ${page.url()}`);
    }
    return { context, page, email, handle };
  }

  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, email, handle };
}

/**
 * Ask for /admin directly and report where you ended up and what you saw.
 *
 * The dashboard is detected by the tab links only it renders, NOT by its
 * heading: the admin verification screen's own copy contains the words "admin
 * dashboard", so a text search matches it too and would let every check here
 * pass while the dashboard stayed shut — or, worse, while it was open.
 */
async function tryAdmin(page) {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const body = await page.locator('body').innerText();
  const onAdmin = await page.evaluate(
    () => document.querySelector('a[href*="/admin?tab=reports"]') !== null,
  );
  return { url: page.url(), onAdmin, body };
}

/** The code the stub wrote to the outbox for this address. */
function latestCode(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'otp' && m.to === email)?.code;
}

/** How many codes the outbox holds for this address. */
function codeCount(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return rows.filter((m) => m.type === 'otp' && m.to === email).length;
}

/**
 * Complete the emailed-code step, which /admin now requires.
 *
 * Presses send until a genuinely NEW code lands. A single click proves
 * nothing: the per-address cooldown is real, so the send may be held, and
 * reading the outbox anyway hands back a code that has already been spent.
 */
async function completeStepUp(page, email, tries = 6) {
  const before = codeCount(email);
  let code = null;

  for (let attempt = 0; attempt < tries && !code; attempt += 1) {
    await page.goto('/admin/verify', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    const send = page.locator('button', { hasText: /Email me a code|Send another code/ });
    if (await send.count()) {
      await send.first().click();
      await page.waitForTimeout(2500);
    }
    if (codeCount(email) > before) code = latestCode(email);
    else await page.waitForTimeout(4000);
  }
  if (!code) return false;

  await page.fill('#admin-code', code);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1800);
  // Success is leaving the verification screen, not merely having typed.
  return !/admin\/verify/.test(page.url());
}

async function run() {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

  // ============================ SIGNED OUT ============================
  section('SIGNED OUT');
  const anon = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const anonPage = await anon.newPage();
  const anonTry = await tryAdmin(anonPage);
  check(
    '/admin is closed to a signed-out browser',
    !anonTry.onAdmin && /\/login/.test(anonTry.url),
    anonTry.url,
  );
  check(
    'and it remembers where they were going',
    new URL(anonTry.url).searchParams.get('next') === '/admin',
    anonTry.url,
  );
  await anon.close();

  // ============================ NORMAL USER ============================
  section('A NORMAL ACCOUNT');
  const user = await createAccount(browser, `plain_${stamp}@example.com`, `plain_${stamp}`.slice(0, 20), 'Music');

  const userTry = await tryAdmin(user.page);
  check(
    'a signed-in normal account is turned away from /admin',
    !userTry.onAdmin,
    userTry.url,
  );
  check('and lands somewhere ordinary instead', /\/home/.test(userTry.url), userTry.url);
  check(
    'none of the dashboard leaked into the response',
    !/Admin dashboard|Reports|Integrity/i.test(userTry.body),
  );

  await user.page.goto('/home', { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  check(
    'no Admin link is offered to them',
    (await user.page.locator('a[href="/admin"]').count()) === 0,
  );

  // Nothing in the product lets somebody set their own role.
  await user.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  check(
    'settings offers no way to change your own role',
    (await user.page.locator('[name="role"], #role, select[name*="role" i]').count()) === 0,
  );
  const settingsHtml = await user.page.content();
  check(
    'and the word admin is not a field they can post',
    !/name="role"|value="admin"/i.test(settingsHtml),
  );

  // The API describes the viewer without ever mentioning a role. Nothing in
  // the browser needs to know, and what is not sent cannot be read off the
  // wire or trusted by mistake — the gate is on the server either way.
  const me = await user.page.evaluate(async () => (await fetch('/api/v1/me')).json());
  check(
    'the API never exposes a role field at all',
    me?.user && !('role' in me.user),
    JSON.stringify(Object.keys(me?.user ?? {})),
  );

  // ============================ THE ADMIN ============================
  section('THE ADMIN ACCOUNT');
  const admin = await createAccount(browser, ADMIN_EMAIL, `fayadmin${stamp}`.slice(0, 20), 'Tech');

  // The dashboard now needs the emailed code as well as the role.
  const beforeCode = await tryAdmin(admin.page);
  check(
    'even an admin cannot open /admin before the code step',
    !beforeCode.onAdmin && /admin\/verify/.test(beforeCode.url),
    beforeCode.url,
  );

  check('the admin can complete the code step', await completeStepUp(admin.page, ADMIN_EMAIL));

  const adminTry = await tryAdmin(admin.page);
  check('and then reaches /admin', adminTry.onAdmin, adminTry.url);
  check('and stays on /admin', /\/admin/.test(adminTry.url) && !/verify/.test(adminTry.url), adminTry.url);

  // Not even for the admin: being one is decided on the server, per request.
  const adminMe = await admin.page.evaluate(async () => (await fetch('/api/v1/me')).json());
  check(
    'the API does not expose a role for the admin either',
    adminMe?.user && !('role' in adminMe.user),
    JSON.stringify(Object.keys(adminMe?.user ?? {})),
  );

  await admin.page.goto('/home', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  check(
    'and an Admin link is offered to them',
    (await admin.page.locator('a[href="/admin"]').count()) > 0,
  );

  // ================== THE LINK IS NOT THE LOCK ==================
  section('THE LINK IS NOT THE LOCK');
  // The normal account asks again, this time for a deep tab, the way somebody
  // would after seeing the URL over a shoulder.
  for (const path of ['/admin?tab=users', '/admin?tab=reports', '/admin?tab=integrity']) {
    await user.page.goto(path, { waitUntil: 'domcontentloaded' });
    await user.page.waitForLoadState('networkidle');
    const body = await user.page.locator('body').innerText();
    check(
      `a normal account cannot reach ${path}`,
      !/Reports|Integrity/i.test(body) && !/\/admin/.test(new URL(user.page.url()).pathname),
      user.page.url(),
    );
  }

  // And the admin is still an admin after all that.
  const stillAdmin = await tryAdmin(admin.page);
  check('the admin is unaffected by any of it', stillAdmin.onAdmin, stillAdmin.url);

  await browser.close();
}

await run();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
