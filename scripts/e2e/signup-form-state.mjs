/**
 * A failed signup must not cost the person everything they typed.
 *
 * React resets a `<form action={…}>` once the action settles, so uncontrolled
 * inputs are wiped by any server-side validation failure. These checks are the
 * regression guard for that, at desktop and phone width.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHROMIUM = process.env.CHROMIUM_PATH;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const read = (page) =>
  page.evaluate(() => ({
    email: document.querySelector('#email')?.value ?? null,
    username: document.querySelector('#username')?.value ?? null,
    password: document.querySelector('#password')?.value ?? null,
    displayName: document.querySelector('#display_name')?.value ?? null,
    bio: document.querySelector('textarea[name=bio]')?.value ?? null,
    location: document.querySelector('input[name=location]')?.value ?? null,
    interests: [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) =>
      b.textContent.trim(),
    ),
  }));

async function fill(page, values) {
  await page.fill('#email', values.email);
  await page.fill('#username', values.username);
  await page.fill('#password', values.password);
  await page.fill('#display_name', values.displayName);
  await page.fill('textarea[name=bio]', values.bio);
  await page.fill('input[name=location]', values.location);
}

async function run(label, viewport, isMobile) {
  console.log(`\n######## ${label} ########`);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const context = await browser.newContext({ baseURL: BASE, viewport, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  const stamp = Date.now().toString(36);

  const typed = {
    email: `keep_${stamp}@example.com`,
    username: `keep_${stamp}`.slice(0, 20),
    password: 'a long enough password',
    displayName: 'Keep Me',
    bio: 'this bio should survive',
    location: 'Leeds',
  };

  // --- 1-5. everything filled in EXCEPT an interest, then submit ----------
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await fill(page, typed);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForTimeout(3500);

  // --- 6. the validation error appears, next to the interests ------------
  const interestError = page.locator('fieldset', { hasText: 'What are you into?' }).locator('[role=alert]');
  check(
    'the error appears beside the interests, not only in a banner',
    (await interestError.count()) > 0 && /Pick at least one/i.test(await interestError.first().innerText()),
  );

  // --- 7. everything else is still there ---------------------------------
  let now = await read(page);
  check('email is still filled in', now.email === typed.email, JSON.stringify(now.email));
  check('username is still filled in', now.username === typed.username, JSON.stringify(now.username));
  check('display name is still filled in', now.displayName === typed.displayName);
  check('bio is still filled in', now.bio === typed.bio);
  check('location is still filled in', now.location === typed.location);
  check('password was cleared, deliberately', now.password === '', JSON.stringify(now.password));

  // --- and a second failure keeps them too -------------------------------
  await page.locator('button[aria-pressed]', { hasText: 'Music' }).first().click();
  await page.locator('button[aria-pressed]', { hasText: 'Art' }).first().click();
  await page.fill('#username', 'tommy'); // taken: fails server-side, not in the browser
  await page.fill('#password', typed.password);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForTimeout(3500);

  const taken = page.locator('#username-error');
  check(
    'a taken username reports beside the username field',
    (await taken.count()) > 0 && /taken/i.test(await taken.innerText()),
  );
  now = await read(page);
  check('email survived the second failure', now.email === typed.email);
  check('bio survived the second failure', now.bio === typed.bio);
  check('location survived the second failure', now.location === typed.location);
  check(
    'chosen interests are still selected',
    now.interests.includes('Music') && now.interests.includes('Art'),
    now.interests.join(', '),
  );

  // --- fixing the one bad field is now enough to get through -------------
  await page.fill('#username', `keep2_${stamp}`.slice(0, 20));
  await page.fill('#password', typed.password);
  await Promise.all([
    page.waitForURL(/verify-email|home/, { timeout: 25000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
  check(
    'correcting only the bad field completes the signup',
    /verify-email|home/.test(page.url()),
    page.url(),
  );

  await browser.close();
}

await run('DESKTOP 1440x900', { width: 1440, height: 900 }, false);
await run('MOBILE 390x844', { width: 390, height: 844 }, true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
