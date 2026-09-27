/**
 * Email verification and password recovery, driven end to end.
 *
 * Everything above the mail transport is the real thing: the real pages, the
 * real Server Actions, the real @supabase/supabase-js client and the real
 * cookies. Only the GoTrue server is a stub, and it behaves like GoTrue —
 * including refusing a resend that comes too soon, which is the case the app
 * used to report as a success.
 *
 * Setup (see README):
 *   AUTH_EMAIL_COOLDOWN_SECONDS=5 STUB_RESEND_COOLDOWN_MS=2000
 *
 * The cooldown is shortened so the run does not sit through 30 seconds twice.
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
const mailsFor = (to, type) => mails().filter((m) => m.to === to && (!type || m.type === type));
const latest = (to, type) => mailsFor(to, type).at(-1);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function signUp(page, account) {
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', account.email);
  await page.fill('#username', account.username);
  await page.fill('#password', account.password);
  await page.fill('#display_name', account.display);
  await page.locator('button[aria-pressed]', { hasText: 'Music' }).first().click();
  await Promise.all([
    page.waitForURL(/verify-email/, { timeout: 25000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
}

async function run(label, viewport, isMobile) {
  console.log(`\n################ ${label} ################`);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const context = await browser.newContext({ baseURL: BASE, viewport, isMobile, hasTouch: isMobile });
  const page = await context.newPage();

  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const account = {
    email: `mail_${stamp}@example.com`,
    username: `mail_${stamp}`.slice(0, 20),
    display: 'Mail Tester',
    password: 'first password here',
  };
  const newPassword = 'a second password entirely';

  // ==================== VERIFICATION ====================
  console.log('\n---- verification ----');

  await signUp(page, account);
  check('signing up lands on the confirmation screen', /verify-email/.test(page.url()), page.url());

  const first = latest(account.email, 'signup');
  check('a verification email was generated', Boolean(first), first ? first.type : 'none');
  check(
    'the verification link points at the configured site, not a stray origin',
    Boolean(first) && first.link.startsWith(BASE),
    first?.link,
  );
  check(
    'the link carries a one-time token hash for Supabase to verify',
    Boolean(first) && new URL(first.link).searchParams.has('token_hash'),
    first?.link,
  );

  // --- resend ---
  const resend = page.locator('form button[type=submit]', { hasText: /send verification|resend/i });
  check('the confirmation screen offers to send it again', (await resend.count()) > 0);
  check(
    'the resend button says what it does',
    /send verification email again/i.test(await resend.innerText()),
    (await resend.innerText()).trim(),
  );

  const before = mailsFor(account.email, 'signup').length;
  await resend.click();
  await page.waitForFunction(
    () => document.querySelector('[role=status], [role=alert]') !== null,
    undefined,
    { timeout: 20000 },
  );

  const after = mailsFor(account.email, 'signup').length;
  check('clicking resend really sends another email', after === before + 1, `${before} -> ${after}`);

  const notice = page.locator('[role=status]').first();
  check(
    'it reports success in plain words',
    (await notice.count()) > 0 && /verification email sent/i.test(await notice.innerText()),
    (await notice.count()) ? (await notice.innerText()).trim() : 'no notice',
  );

  const second = latest(account.email, 'signup');
  check(
    'the second email is a genuinely new link, not the first one repeated',
    Boolean(second) && Boolean(first) && second.link !== first.link,
  );

  // --- cooldown ---
  const holding = (await resend.innerText()).trim();
  check('the button switches to a countdown', /resend available in \d+ second/i.test(holding), holding);
  check('and is disabled while it counts', await resend.isDisabled());

  const firstReading = Number(/(\d+)/.exec(holding)?.[1] ?? 0);
  await wait(2200);
  const secondReading = Number(/(\d+)/.exec(await resend.innerText())?.[1] ?? 99);
  check(
    'the countdown actually counts down',
    secondReading < firstReading,
    `${firstReading}s -> ${secondReading}s`,
  );

  // Past the disabled button, to prove the SERVER refuses too rather than the
  // cooldown being a button that anybody can re-enable.
  const guarded = mailsFor(account.email, 'signup').length;
  await page.evaluate(() => {
    const form = document.querySelector('form:has(#resend-email)') ?? document.querySelector('form');
    form?.requestSubmit();
  });
  await wait(2500);
  check(
    'submitting past the disabled button does not send another email',
    mailsFor(account.email, 'signup').length === guarded,
    `${guarded} -> ${mailsFor(account.email, 'signup').length}`,
  );
  const refusal = page.locator('[role=alert]').first();
  check(
    'and it says why instead of claiming it sent one',
    (await refusal.count()) > 0 && /wait|too many|second/i.test(await refusal.innerText()),
    (await refusal.count()) ? (await refusal.innerText()).trim() : 'no message',
  );

  // --- a bad address ---
  await wait(COOLDOWN * 1000);
  await page.fill('#resend-email', 'not-an-email');
  const badBefore = mails().length;
  await page.evaluate(() => {
    const form = document.querySelector('form:has(#resend-email)');
    form?.requestSubmit();
  });
  await wait(2000);
  check(
    'an address that is not an address is refused, and sends nothing',
    mails().length === badBefore,
    `${badBefore} -> ${mails().length}`,
  );
  check(
    'with a message beside the field',
    (await page.locator('[role=alert]').count()) > 0,
    (await page.locator('[role=alert]').first().innerText().catch(() => '')).trim(),
  );

  // --- following the link ---
  // The newest one: Supabase's PKCE verifier lives in this browser and is
  // replaced by each new request, so the most recent email is the one whose
  // code this browser can still exchange. A real person who resends and then
  // opens the older email meets the same rule.
  const usable = latest(account.email, 'signup');
  await page.goto(usable.link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check(
    'the verification link signs the account in rather than bouncing to login',
    !/\/login/.test(page.url()),
    page.url(),
  );
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check('the confirmed account can reach a signed-in page', !/\/login/.test(page.url()), page.url());

  // A confirmed address is not sent another confirmation.
  await page.goto(`/verify-email?email=${encodeURIComponent(account.email)}`, {
    waitUntil: 'domcontentloaded',
  });
  const confirmedBefore = mailsFor(account.email, 'signup').length;
  await page.locator('form button[type=submit]').last().click();
  await wait(2500);
  check(
    'an already-confirmed address is told so, not sent a pointless email',
    mailsFor(account.email, 'signup').length === confirmedBefore,
    `${confirmedBefore} -> ${mailsFor(account.email, 'signup').length}`,
  );
  const already = await page
    .locator('[role=alert]')
    .first()
    .innerText()
    .catch(() => '');
  check('and the reason is shown', /already confirmed/i.test(already), already.trim());

  // ==================== PASSWORD RESET ====================
  console.log('\n---- password reset ----');

  await context.clearCookies();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const forgot = page.locator('a[href="/forgot-password"]');
  check('the login page offers "Forgot password?"', (await forgot.count()) > 0);

  await forgot.first().click();
  await page.waitForURL(/forgot-password/, { timeout: 15000 });
  check('it opens the reset request page', /forgot-password/.test(page.url()), page.url());

  // An address with no account must be answered exactly like one with an account.
  const unknown = `nobody_${stamp}@example.com`;
  await page.fill('#email', unknown);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForSelector('[role=status]', { timeout: 20000 });
  const unknownAnswer = (await page.locator('[role=status]').first().innerText()).trim();
  check('an unknown address gets a success message', unknownAnswer.length > 0, unknownAnswer);
  check('and no email is actually sent for it', mailsFor(unknown).length === 0);

  await wait(COOLDOWN * 1000);
  await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', account.email);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForSelector('[role=status]', { timeout: 20000 });
  const knownAnswer = (await page.locator('[role=status]').first().innerText()).trim();
  check(
    'a real address gets the IDENTICAL message, so accounts cannot be enumerated',
    knownAnswer === unknownAnswer,
    `${JSON.stringify(unknownAnswer)} vs ${JSON.stringify(knownAnswer)}`,
  );
  check(
    'and the wording is conditional, never confirming an account either way',
    /if an account exists/i.test(knownAnswer) && !/we have sent you|no account found|is not registered/i.test(knownAnswer),
    knownAnswer,
  );

  const recovery = latest(account.email, 'recovery');
  check('a reset email was generated', Boolean(recovery), recovery?.type);
  check(
    'the reset link points at the configured site',
    Boolean(recovery) && recovery.link.startsWith(BASE),
    recovery?.link,
  );

  // --- an expired / bogus link ---
  await page.goto('/reset-password', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check(
    'opening the reset page with no live recovery session says the link expired',
    /expired/i.test(await page.locator('h1').first().innerText()),
    (await page.locator('h1').first().innerText()).trim(),
  );

  // --- the real link ---
  await page.goto(recovery.link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  check('the reset link opens the FayTarra reset page', /reset-password/.test(page.url()), page.url());
  check(
    'headed for setting a new password',
    /new password/i.test(await page.locator('h1').first().innerText()),
    (await page.locator('h1').first().innerText()).trim(),
  );

  const save = page.locator('form button[type=submit]').last();
  check('the save button starts disabled, with nothing typed', await save.isDisabled());

  // weak
  await page.fill('#password', 'short');
  await page.fill('#confirm', 'short');
  check('a password under 8 characters is refused', await save.isDisabled());
  check(
    'and says so',
    (await page.locator('#password-hint').count()) > 0,
    (await page.locator('#password-hint').innerText().catch(() => '')).trim(),
  );

  // mismatch
  await page.fill('#password', newPassword);
  await page.fill('#confirm', `${newPassword} nope`);
  check('mismatched passwords are refused', await save.isDisabled());
  check(
    'and say so',
    (await page.locator('#confirm-hint').count()) > 0,
    (await page.locator('#confirm-hint').innerText().catch(() => '')).trim(),
  );

  // visibility toggle
  const show = page.locator('button[aria-pressed]', { hasText: /show|hide/i }).first();
  check('there is a show/hide control', (await show.count()) > 0);
  check(
    'the password is hidden to begin with',
    (await page.getAttribute('#password', 'type')) === 'password',
  );
  await show.click();
  check('showing it reveals the text', (await page.getAttribute('#password', 'type')) === 'text');
  await show.click();
  check('and hiding it covers it again', (await page.getAttribute('#password', 'type')) === 'password');

  // the real change
  await page.fill('#confirm', newPassword);
  check('with both matching, saving is allowed', !(await save.isDisabled()));
  await Promise.all([
    page.waitForURL(/\/login/, { timeout: 25000 }),
    save.click(),
  ]);
  check('a finished reset lands on the login page', /\/login/.test(page.url()), page.url());

  const done = (await page.locator('[role=status]').first().innerText()).trim();
  check('the password change is confirmed', /password has been updated/i.test(done), done);
  check(
    'and the login form is right there to use it',
    (await page.locator('#identifier').count()) > 0 && (await page.locator('#password').count()) > 0,
  );

  // --- the new password is the one that works ---
  await context.clearCookies();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', account.email);
  await page.fill('#password', account.password);
  await page.locator('form button[type=submit]').last().click();
  await wait(3500);
  check('the OLD password no longer signs in', /\/login/.test(page.url()), page.url());

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', account.email);
  await page.fill('#password', newPassword);
  await Promise.all([
    page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 25000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
  check('the NEW password signs in', !/\/login/.test(page.url()), page.url());

  // --- the reset link is single use ---
  await context.clearCookies();
  await page.goto(recovery.link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const reused = await page.locator('h1').first().innerText();
  check(
    'the used reset link cannot be replayed',
    /expired|no longer valid/i.test(reused) || /\/login/.test(page.url()),
    `${page.url()} — ${reused.trim()}`,
  );

  await browser.close();
}

// The templates are the other half of this feature: what the emails say.
function checkTemplates() {
  console.log('\n---- branded templates ----');
  const required = ['confirm-signup', 'reset-password', 'change-email'];
  for (const slug of required) {
    let html = '';
    try {
      html = readFileSync(`supabase/templates/${slug}.html`, 'utf8');
    } catch {
      check(`supabase/templates/${slug}.html exists`, false);
      continue;
    }
    check(`${slug}: built and branded`, html.includes('FayTarra') && html.includes('#FF3D9A'));
    check(
      `${slug}: carries Supabase's own action variable`,
      /\{\{ \.(TokenHash|Token) \}\}/.test(html),
    );
    check(`${slug}: no localhost`, !/localhost|127\.0\.0\.1/.test(html));
    check(`${slug}: no script and no remote images`, !/<script|<img/i.test(html));
    check(`${slug}: has a plain-text alternative`, readFileSync(`supabase/templates/${slug}.txt`, 'utf8').length > 120);
  }
}

writeFileSync(OUTBOX, '');
checkTemplates();
await run('DESKTOP 1440x900', { width: 1440, height: 900 }, false);
await run('MOBILE 390x844 (iPhone-ish)', { width: 390, height: 844 }, true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
