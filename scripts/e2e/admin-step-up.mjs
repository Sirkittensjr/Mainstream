/**
 * The administrator's second step: a six-digit code, emailed, before /admin.
 *
 * The code is Supabase's, not FayTarra's — signInWithOtp issues it, verifyOtp
 * checks it — so the things being tested here are the ones FayTarra decides:
 * that the dashboard stays shut until the code is entered, that a wrong,
 * stale, reused or replaced code does not open it, that a normal account
 * cannot reach any of it, and that none of it leaks the code.
 *
 *   STUB_OTP_TTL_MS=4000 STUB_RESEND_COOLDOWN_MS=1000 \
 *     node scripts/e2e/gotrue-stub.mjs &
 *   ADMIN_EMAILS=admin@faytarra.com AUTH_EMAIL_COOLDOWN_SECONDS=2 npm start &
 *   node scripts/e2e/admin-step-up.mjs
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

const mails = () => {
  try {
    return readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const codesFor = (email) => mails().filter((m) => m.to === email && m.type === 'otp');
const latestCode = (email) => codesFor(email).at(-1)?.code;
const confirmationLink = (email) =>
  [...mails()].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;

async function signUpAndConfirm(browser, email, handle, interest) {
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

  if (/verify-email/.test(page.url())) {
    const link = confirmationLink(email);
    if (!link) throw new Error(`no confirmation email for ${email}`);
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
  }
  return { context, page, email, handle };
}

/** Sign in through the real form and report where it landed. */
async function signIn(page, email) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', email);
  await page.fill('#password', PASSWORD);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForLoadState('networkidle');
  await wait(2000);
  return page.url();
}

/**
 * Is this the real dashboard?
 *
 * Detected structurally, by the tab links only the dashboard renders. Its
 * heading is no good: the verification screen's own copy says "the admin
 * dashboard needs a second step", which matches a text search and would make
 * every one of these checks pass while nothing worked.
 */
async function openAdmin(page) {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const body = await page.locator('body').innerText();
  const onDashboard = await page.evaluate(
    () => document.querySelector('a[href*="/admin?tab=reports"]') !== null,
  );
  return { url: page.url(), onDashboard, body };
}

/**
 * Ask the stub to age the outstanding code out.
 *
 * From Node, not the browser: the stub is a different origin and has no CORS
 * headers, which is correct for it — nothing in a page should be calling it.
 */
const STUB = process.env.STUB_URL || 'http://127.0.0.1:54321';
const expireCode = (email) =>
  fetch(`${STUB}/auth/v1/__expire-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  }).then((response) => response.json());

async function enterCode(page, code) {
  await page.goto('/admin/verify', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.fill('#admin-code', code);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForLoadState('networkidle');
  await wait(1800);
  return page.url();
}

async function requestCode(page) {
  await page.goto('/admin/verify', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.locator('button', { hasText: /Email me a code|Send another code/ }).first().click();
  await wait(2000);
}

/**
 * Press send until a genuinely NEW code lands in the outbox.
 *
 * The per-address cooldown is real and is one of the things under test, so a
 * single click is not a guarantee that anything was sent. Anything that needs
 * a fresh code has to wait the cooldown out rather than assume.
 */
async function requestFreshCode(page, email, tries = 6) {
  const before = codesFor(email).length;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    await requestCode(page);
    if (codesFor(email).length > before) return latestCode(email);
    await wait(4000);
  }
  return null;
}

/** Sign in and make sure there is an outstanding code to use afterwards. */
async function signInWithFreshCode(page, email) {
  const before = codesFor(email).length;
  const landed = await signIn(page, email);
  if (codesFor(email).length > before) return { landed, code: latestCode(email) };
  // The login-time send was held by the cooldown; ask again once it lifts.
  return { landed, code: await requestFreshCode(page, email) };
}

async function run() {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

  const admin = await signUpAndConfirm(browser, ADMIN_EMAIL, `fayadm${stamp}`.slice(0, 20), 'Tech');
  const user = await signUpAndConfirm(
    browser,
    `plain_${stamp}@example.com`,
    `plain_${stamp}`.slice(0, 20),
    'Music',
  );

  // ==================== LOGIN SENDS A CODE ====================
  section('ADMIN LOGIN');
  const landed = await signIn(admin.page, ADMIN_EMAIL);
  check('signing in as an admin lands on the verification screen', /admin\/verify/.test(landed), landed);
  check('and a code was emailed', codesFor(ADMIN_EMAIL).length >= 1, `${codesFor(ADMIN_EMAIL).length} code(s)`);

  const screen = await admin.page.locator('body').innerText();
  const code = latestCode(ADMIN_EMAIL);
  check('the code is NOT shown anywhere on the page', !screen.includes(code), code ? 'code withheld' : 'no code');
  const html = await admin.page.content();
  check('nor anywhere in the page source', !html.includes(code));
  check('nor in the URL', !admin.page.url().includes(code));
  check(
    'the address is masked rather than printed in full',
    !screen.includes(ADMIN_EMAIL) && /•/.test(screen),
  );

  // ==================== THE GATE ====================
  section('/admin IS SHUT UNTIL THE CODE IS ENTERED');
  const before = await openAdmin(admin.page);
  check('a verified admin who has not entered a code cannot open /admin', !before.onDashboard, before.url);
  check('and is sent to the verification screen', /admin\/verify/.test(before.url), before.url);
  check('no dashboard content leaked', !/Reports|Integrity|Overview/i.test(before.body));

  for (const tab of ['/admin?tab=users', '/admin?tab=reports', '/admin?tab=integrity']) {
    await admin.page.goto(tab, { waitUntil: 'domcontentloaded' });
    await admin.page.waitForLoadState('networkidle');
    check(
      `nor ${tab}`,
      /admin\/verify/.test(admin.page.url()),
      admin.page.url(),
    );
  }

  // ==================== WRONG CODE ====================
  section('AN INCORRECT CODE');
  // A fresh code first: asking for one resets the attempt budget, which is both
  // the documented recovery and what keeps this run independent of whatever a
  // previous run left in the server's memory.
  const fresh = (await requestFreshCode(admin.page, ADMIN_EMAIL)) ?? code;
  const wrong = String((Number(fresh) + 1) % 1000000).padStart(6, '0');
  const afterWrong = await enterCode(admin.page, wrong);
  check('a wrong code does not open the dashboard', !/\/admin$/.test(afterWrong), afterWrong);
  const wrongMessage = await admin.page.locator('[role=alert]').first().innerText().catch(() => '');
  check('and says so, with the attempts left', /not right|attempt/i.test(wrongMessage), wrongMessage.trim());

  // ==================== THE RIGHT CODE ====================
  section('THE CORRECT CODE');
  const afterRight = await enterCode(admin.page, fresh);
  check('the correct code opens the dashboard', !/verify/.test(afterRight), afterRight);
  const dash = await openAdmin(admin.page);
  check('and the dashboard really renders', dash.onDashboard, dash.url);
  check('the existing tabs are untouched', /Reports/i.test(dash.body) && /Integrity/i.test(dash.body));

  // ==================== REUSE ====================
  section('THE SAME CODE AGAIN');
  // A fresh browser for the same account: the proof cookie does not travel,
  // so this is purely "does the spent code still work".
  const replay = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const replayPage = await replay.newPage();
  await signInWithFreshCode(replayPage, ADMIN_EMAIL);
  // Signing in emailed a new code; the OLD one must still be refused.
  const afterReuse = await enterCode(replayPage, code);
  check('a code that has already been used is refused', /verify/.test(afterReuse), afterReuse);
  const reuseDash = await openAdmin(replayPage);
  check('and the dashboard stays shut', !reuseDash.onDashboard, reuseDash.url);

  // ==================== A REPLACED CODE ====================
  section('A CODE REPLACED BY A NEWER ONE');
  const older = await requestFreshCode(replayPage, ADMIN_EMAIL);
  const newer = await requestFreshCode(replayPage, ADMIN_EMAIL);
  check(
    'asking again produced a different code',
    Boolean(older && newer && older !== newer),
    `${older} then ${newer}`,
  );

  const afterOld = await enterCode(replayPage, older);
  check('the superseded code no longer works', /verify/.test(afterOld), afterOld);
  const afterNew = await enterCode(replayPage, newer);
  check('the newest code does', !/verify/.test(afterNew), afterNew);
  await replay.close();

  // ==================== EXPIRY ====================
  section('AN EXPIRED CODE');
  const stale = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const stalePage = await stale.newPage();
  const { code: expiring } = await signInWithFreshCode(stalePage, ADMIN_EMAIL);
  check('a code is outstanding to expire', Boolean(expiring), String(expiring));
  const aged = await expireCode(ADMIN_EMAIL);
  check('the outstanding code was aged out', aged?.expired === true, JSON.stringify(aged));
  const afterExpiry = await enterCode(stalePage, expiring);
  check('a code past its lifetime is refused', /verify/.test(afterExpiry), afterExpiry);
  const expiredDash = await openAdmin(stalePage);
  check('and the dashboard stays shut', !expiredDash.onDashboard, expiredDash.url);
  await stale.close();

  // ==================== ATTEMPT LIMIT ====================
  section('TOO MANY WRONG CODES');
  const brute = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const brutePage = await brute.newPage();
  await signInWithFreshCode(brutePage, ADMIN_EMAIL);
  let lockedMessage = '';
  for (let attempt = 0; attempt < 7; attempt += 1) {
    await enterCode(brutePage, String(100000 + attempt));
    lockedMessage = await brutePage.locator('[role=alert]').first().innerText().catch(() => '');
    if (/too many/i.test(lockedMessage)) break;
  }
  check('a run of wrong codes is cut off', /too many/i.test(lockedMessage), lockedMessage.trim());
  const bruteDash = await openAdmin(brutePage);
  check('and nothing opened', !bruteDash.onDashboard, bruteDash.url);
  await brute.close();

  // ==================== REQUEST RATE LIMIT ====================
  section('CODE REQUESTS ARE RATE LIMITED');
  // A browser that has NOT verified: an already-verified one is redirected
  // straight off /admin/verify, which is correct and leaves no button to press.
  const burstCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const burstPage = await burstCtx.newPage();
  await signIn(burstPage, ADMIN_EMAIL);

  const before2 = codesFor(ADMIN_EMAIL).length;
  await requestCode(burstPage);
  await requestCode(burstPage);
  await requestCode(burstPage);
  const sent = codesFor(ADMIN_EMAIL).length - before2;
  check('three rapid requests do not send three codes', sent < 3, `${sent} sent`);
  // Read straight after the burst: the button is either counting down or
  // disabled. Matching only the countdown text races a short cooldown.
  const sendButton = burstPage.locator('button', {
    hasText: /Email me a code|Send another code|Send another in/,
  }).first();
  const label = await sendButton.innerText().catch(() => '');
  const disabled = await sendButton.isDisabled().catch(() => false);
  check(
    'and the button holds instead of sending again',
    disabled || /Send another in \d+ second/.test(label),
    `${JSON.stringify(label.trim())} disabled=${disabled}`,
  );
  await burstCtx.close();

  // ============ THE EMAIL ITSELF, AND THE OTHER TEMPLATES ============
  section('THE ADMIN EMAIL IS A CODE, THE OTHERS ARE UNCHANGED');
  const magic = readFileSync('supabase/templates/magic-link.html', 'utf8');
  check('the admin template names itself in its source', magic.includes('faytarra-template: magic-link (code)'));
  check('it carries the six-digit token', magic.includes('{{ .Token }}'));
  check('it contains no sign-in link', !/auth\/callback|TokenHash/.test(magic));
  check(
    'and is not the old sign-in-link body',
    !/Sign in to FayTarra/.test(magic),
    'old template would say "Sign in to FayTarra"',
  );
  const subjects = JSON.parse(readFileSync('supabase/templates/subjects.json', 'utf8'));
  check(
    'its subject is about a code, not a link',
    /admin verification code/i.test(subjects['Magic Link']),
    subjects['Magic Link'],
  );

  // The normal flows must be untouched by any of this.
  for (const [slug, dashboard] of [
    ['confirm-signup', 'Confirm signup'],
    ['reset-password', 'Reset password'],
    ['change-email', 'Change email address'],
  ]) {
    const html = readFileSync(`supabase/templates/${slug}.html`, 'utf8');
    check(
      `${slug} is still a LINK email, unaffected`,
      html.includes('{{ .TokenHash }}') && /auth\/callback/.test(html) && !html.includes('{{ .Token }}'),
      subjects[dashboard],
    );
  }

  // ==================== A NORMAL ACCOUNT ====================
  section('A NORMAL ACCOUNT CANNOT TOUCH ANY OF IT');
  const userLanded = await signIn(user.page, user.email);
  check('a normal sign-in is unchanged — no code, no verification screen', !/admin/.test(userLanded), userLanded);
  check('and no code was emailed to them', codesFor(user.email).length === 0);

  await user.page.goto('/admin/verify', { waitUntil: 'domcontentloaded' });
  await user.page.waitForLoadState('networkidle');
  check(
    'they cannot open the verification screen',
    !/Verify it is you/i.test(await user.page.locator('body').innerText()),
    user.page.url(),
  );
  check('and are sent somewhere ordinary', /\/home/.test(user.page.url()), user.page.url());

  const userAdmin = await openAdmin(user.page);
  check('they still cannot open /admin', !userAdmin.onDashboard, userAdmin.url);

  // The admin's proof cookie must be useless to anybody else. Copy every
  // cookie the admin holds into the normal account's browser and try again.
  const adminCookies = await admin.context.cookies();
  const proof = adminCookies.filter((c) => c.name === 'fay_admin_verified');
  check('the proof of verification is an httpOnly cookie', proof.length === 1 && proof[0].httpOnly, JSON.stringify(proof.map((c) => c.name)));
  check('which does not contain the code', proof.length === 1 && !proof[0].value.includes(code));

  await user.context.addCookies(proof.map((c) => ({ ...c, domain: c.domain, path: c.path })));
  const stolen = await openAdmin(user.page);
  check(
    "a normal account holding the admin's proof cookie still cannot open /admin",
    !stolen.onDashboard,
    stolen.url,
  );

  // ==================== SIGNING OUT ====================
  section('SIGNING OUT DROPS THE PROOF');
  await admin.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const logout = admin.page.locator('button', { hasText: /^Log out$/ });
  if (await logout.count()) {
    await logout.first().click();
    await admin.page.waitForLoadState('networkidle');
    await wait(1500);
  } else {
    await admin.context.clearCookies();
  }
  await signIn(admin.page, ADMIN_EMAIL);
  const afterLogout = await openAdmin(admin.page);
  check('after signing out and back in, the code is asked for again', !afterLogout.onDashboard, afterLogout.url);

  await browser.close();
}

await run();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
