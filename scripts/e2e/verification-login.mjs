/**
 * The confirmation loop: verify your email, then get told to verify your email.
 *
 * The reported production bug was that a user who had clicked the confirmation
 * link was still bounced to /verify-email when they signed in with the same
 * email and password.
 *
 * Two things made that possible, and both are covered here:
 *
 *   1. The email linked with {{ .ConfirmationURL }}, which comes back carrying
 *      a PKCE code. @supabase/ssr pins the client to PKCE, so exchanging that
 *      code needs the code-verifier cookie written in the browser that signed
 *      up. Open the email on a phone, in a mail app's in-app browser, or after
 *      the cookie has gone, and the exchange fails — leaving the address
 *      unconfirmed on a link that looked like it worked. FayTarra's templates
 *      now link with {{ .TokenHash }}, which verifyOtp resolves server-side
 *      with nothing from the browser.
 *
 *   2. Sign-in decided "is this confirmed?" from the sign-in response alone.
 *      It now re-reads the authoritative user.
 *
 * `DIFFERENT_BROWSER` is the whole point of check 4: the confirmation link is
 * opened in a browser context that never saw the signup, which is what a
 * phone does with a link mailed to it.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const CHROMIUM = process.env.CHROMIUM_PATH;
/** Must match AUTH_EMAIL_COOLDOWN_SECONDS given to the app. */
const COOLDOWN = Number(process.env.AUTH_EMAIL_COOLDOWN_SECONDS || 5);

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const mails = () => {
  try {
    return readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const latest = (to, type) => mails().filter((m) => m.to === to && m.type === type).at(-1);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function signUp(page, account) {
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', account.email);
  await page.fill('#username', account.username);
  await page.fill('#password', account.password);
  await page.fill('#display_name', 'Loop Tester');
  await page.locator('button[aria-pressed]', { hasText: 'Music' }).first().click();
  await Promise.all([
    page.waitForURL(/verify-email/, { timeout: 25000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
}

async function logIn(page, email, password) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', email);
  await page.fill('#password', password);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForLoadState('networkidle');
  await wait(1200);
  return page.url();
}

async function run(label, viewport, isMobile) {
  console.log(`\n################ ${label} ################`);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const context = await browser.newContext({ baseURL: BASE, viewport, isMobile, hasTouch: isMobile });
  const page = await context.newPage();

  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const account = {
    email: `loop_${stamp}@example.com`,
    username: `loop_${stamp}`.slice(0, 20),
    password: 'a perfectly good password',
  };

  await signUp(page, account);
  check('signup lands on the confirmation screen', /verify-email/.test(page.url()), page.url());

  // ---- 1. an unverified account cannot simply log in ----------------------
  const unverified = await logIn(page, account.email, account.password);
  check(
    '1. a newly created, unverified account cannot log in',
    !/\/home/.test(unverified),
    unverified,
  );
  check(
    '1b. and is sent to verify its email, not let in',
    /verify-email/.test(unverified),
    unverified,
  );

  // ---- 6. resend still works for a genuinely unverified account -----------
  const before = mails().filter((m) => m.to === account.email && m.type === 'signup').length;
  await page.goto(`/verify-email?email=${encodeURIComponent(account.email)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('form button[type=submit]').last().click();
  await page.waitForSelector('[role=status], [role=alert]', { timeout: 20000 });
  const after = mails().filter((m) => m.to === account.email && m.type === 'signup').length;
  check('6. resend still sends for a genuinely unverified account', after === before + 1, `${before} -> ${after}`);

  // ---- 4. the confirmation link works from a browser that never saw signup -
  const mail = latest(account.email, 'signup');
  check(
    '4a. the emailed link is the stateless token_hash form',
    Boolean(mail) && /token_hash=/.test(mail.link) && /[?&]type=signup/.test(mail.link),
    mail?.link,
  );

  const DIFFERENT_BROWSER = await browser.newContext({ baseURL: BASE, viewport, isMobile, hasTouch: isMobile });
  const phone = await DIFFERENT_BROWSER.newPage();
  await phone.goto(mail.link, { waitUntil: 'domcontentloaded' });
  await phone.waitForLoadState('networkidle');
  check(
    '4. confirming from a different browser establishes the session',
    /\/home/.test(phone.url()),
    phone.url(),
  );
  const who = await phone.evaluate(async () => (await fetch('/api/v1/me')).json());
  check('4b. and that session is really authenticated', who?.user?.username === account.username, JSON.stringify(who?.user?.username));
  await DIFFERENT_BROWSER.close();

  // ---- 2 & 3. the verified account can now log in, and is NOT bounced ------
  await context.clearCookies();
  const verified = await logIn(page, account.email, account.password);
  check('2. a verified account logs in with email and password', /\/home/.test(verified), verified);
  check(
    '3. and is NOT redirected to the verification page',
    !/verify-email/.test(verified),
    verified,
  );

  // ---- 5. a refresh keeps them signed in ----------------------------------
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check('5. refreshing after login keeps the session', !/\/login|verify-email/.test(page.url()), page.url());
  const afterRefresh = await page.evaluate(async () => (await fetch('/api/v1/me')).json());
  check('5b. and the server still recognises them', afterRefresh?.user?.username === account.username);

  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check('5c. a gated page opens after the refresh', /\/settings/.test(page.url()), page.url());

  // ---- 7. an already verified account is not shown the verification page ---
  // Past the per-address cooldown first, so what answers is the
  // already-confirmed rule and not the rate limit in front of it.
  await wait(COOLDOWN * 1000 + 500);
  const confirmedResend = mails().filter((m) => m.to === account.email && m.type === 'signup').length;
  await page.goto(`/verify-email?email=${encodeURIComponent(account.email)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('form button[type=submit]').last().click();
  await wait(2500);
  check(
    '7. an already verified address is not sent another confirmation',
    mails().filter((m) => m.to === account.email && m.type === 'signup').length === confirmedResend,
  );
  const told = await page.locator('[role=alert]').first().innerText().catch(() => '');
  check('7b. and is told it is already confirmed', /already confirmed/i.test(told), told.trim());

  // ---- 8. password reset still works --------------------------------------
  // The refused resend above still spent a cooldown slot for this address, so
  // wait it out rather than measuring the rate limiter again.
  await wait(COOLDOWN * 1000 + 500);
  await context.clearCookies();
  const NEW_PASSWORD = 'an entirely different password';
  await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', account.email);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForSelector('[role=status]', { timeout: 20000 });

  const recovery = latest(account.email, 'recovery');
  check('8a. a reset email was generated', Boolean(recovery), recovery?.link);
  check(
    '8b. the reset link is the token_hash form too',
    Boolean(recovery) && /token_hash=/.test(recovery.link) && /type=recovery/.test(recovery.link),
    recovery?.link,
  );

  // Opened in a browser that never asked for the reset, like a phone would.
  const OTHER = await browser.newContext({ baseURL: BASE, viewport, isMobile, hasTouch: isMobile });
  const resetPage = await OTHER.newPage();
  await resetPage.goto(recovery.link, { waitUntil: 'domcontentloaded' });
  await resetPage.waitForLoadState('networkidle');
  check('8c. the reset link opens the reset page', /reset-password/.test(resetPage.url()), resetPage.url());

  await resetPage.fill('#password', NEW_PASSWORD);
  await resetPage.fill('#confirm', NEW_PASSWORD);
  await Promise.all([
    resetPage.waitForURL(/\/login/, { timeout: 25000 }),
    resetPage.locator('form button[type=submit]').last().click(),
  ]);
  check('8d. the reset completes', /reset=done/.test(resetPage.url()), resetPage.url());
  await OTHER.close();

  const withNew = await logIn(page, account.email, NEW_PASSWORD);
  check('8e. the new password signs in', /\/home/.test(withNew), withNew);
  check('8f. and a reset does NOT send the user to verification', !/verify-email/.test(withNew), withNew);

  await browser.close();
}

/**
 * Links already sitting in real inboxes carry a PKCE code. They must keep
 * working when opened in the browser that signed up.
 */
async function legacyLink(label) {
  console.log(`\n################ ${label} ################`);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();

  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const account = {
    email: `legacy_${stamp}@example.com`,
    username: `legacy_${stamp}`.slice(0, 20),
    password: 'another good password',
  };
  await signUp(page, account);

  const mail = latest(account.email, 'signup');
  check('the old-style PKCE link is still understood', Boolean(mail?.pkceLink), mail?.pkceLink);

  // THE ROOT CAUSE, demonstrated. A PKCE link opened anywhere but the browser
  // that signed up cannot be exchanged — there is no code verifier to exchange
  // it with — so the address stays unconfirmed however valid the link was.
  // This is what a phone does with a link mailed to it, and it is why the
  // templates no longer send this shape. If someone ever puts
  // {{ .ConfirmationURL }} back, this check is the alarm.
  const elsewhere = await browser.newContext({ baseURL: BASE });
  const strangerPage = await elsewhere.newPage();
  await strangerPage.goto(mail.pkceLink, { waitUntil: 'domcontentloaded' });
  await strangerPage.waitForLoadState('networkidle');
  check(
    'a PKCE link opened in another browser CANNOT confirm — the old bug',
    !/\/home/.test(strangerPage.url()),
    strangerPage.url(),
  );
  await elsewhere.close();

  // The token-hash link for the same account, from that same stranger browser,
  // works — which is the fix.
  const rescue = await browser.newContext({ baseURL: BASE });
  const rescuePage = await rescue.newPage();
  await rescuePage.goto(mail.link, { waitUntil: 'domcontentloaded' });
  await rescuePage.waitForLoadState('networkidle');
  check(
    'the token_hash link for the same account confirms from that same browser',
    /\/home/.test(rescuePage.url()),
    rescuePage.url(),
  );
  await rescue.close();

  await page.goto(mail.pkceLink, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check(
    'opening the old link in the signup browser still works',
    !/\/login/.test(page.url()),
    page.url(),
  );

  await context.clearCookies();
  const url = await logIn(page, account.email, account.password);
  check('and that account can then log in normally', /\/home/.test(url), url);
  check('without being bounced to verification', !/verify-email/.test(url), url);

  await browser.close();
}

writeFileSync(OUTBOX, '');
await run('DESKTOP 1440x900', { width: 1440, height: 900 }, false);
await run('MOBILE 390x844 (iPhone-ish)', { width: 390, height: 844 }, true);
await legacyLink('LEGACY {{ .ConfirmationURL }} LINKS');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
