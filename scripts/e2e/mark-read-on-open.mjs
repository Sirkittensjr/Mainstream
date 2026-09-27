/**
 * Opening a section is the read receipt.
 *
 * Notifications and Messages both clear their unread state because the page
 * was opened, not because a button was pressed. These checks care about the
 * three ways that goes wrong: the badge not clearing without a reload, the
 * state not surviving a refresh (marked only in the browser), and something
 * that arrives afterwards failing to count as new again.
 *
 *   node scripts/e2e/mark-read-on-open.mjs
 *
 * Needs the GoTrue stub and the app, same as messaging-flow.
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
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

async function createAccount(browser, handle, interest, viewport) {
  const context = await browser.newContext({ baseURL: BASE, viewport });
  const page = await context.newPage();
  const email = `${handle}@example.com`;
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]', { hasText: interest }).first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/verify-email/, { timeout: 25000 });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

async function follow(actor, handle) {
  await actor.page.goto(`/u/${handle}`, { waitUntil: 'domcontentloaded' });
  const follow = actor.page.locator('button', { hasText: /^Follow$/ });
  if (await follow.count()) {
    await follow.first().click();
    await actor.page.waitForTimeout(1600);
  }
}

/** What the server says right now, independent of anything drawn. */
const serverCounts = (page) =>
  page.evaluate(async () => (await fetch('/api/unread', { cache: 'no-store' })).json());

/** The number painted in the navigation, or 0 when there is no badge. */
async function badge(page, href) {
  const pill = page.locator(`a[href="${href}"] span`).filter({ hasText: /^\d+\+?$/ });
  if ((await pill.count()) === 0) return 0;
  return Number((await pill.first().innerText()).replace('+', '')) || 0;
}

async function post(actor, body) {
  await actor.page.goto('/create', { waitUntil: 'domcontentloaded' });
  await actor.page.waitForLoadState('networkidle');
  await actor.page.fill('textarea', body);
  await actor.page.locator('form button[type=submit]').last().click();
  await actor.page.waitForURL(/\/post\//, { timeout: 25000 });
  return actor.page.url();
}

async function sendMessage(actor, handle, body) {
  await actor.page.goto(`/messages/${handle}`, { waitUntil: 'domcontentloaded' });
  await actor.page.waitForLoadState('networkidle');
  await actor.page.fill('textarea', body);
  await actor.page.locator('form button[type=submit]').last().click();
  await actor.page.waitForTimeout(1400);
}

async function run(label, viewport) {
  console.log(`\n================ ${label} ================`);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
  const A = await createAccount(browser, `mra_${stamp}`.slice(0, 20), 'Music', viewport);
  const B = await createAccount(browser, `mrb_${stamp}`.slice(0, 20), 'Art', viewport);

  // ============================ NOTIFICATIONS ============================
  section('NOTIFICATIONS');

  // A follow is the simplest notification B can be sent.
  await follow(A, B.handle);
  await wait(800);

  await B.page.goto('/home', { waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');

  const notifBadge = await badge(B.page, '/notifications');
  const counts1 = await serverCounts(B.page);
  check('1. unread notifications show the correct count', notifBadge >= 1 && counts1.notifications >= 1, `badge=${notifBadge} server=${counts1.notifications}`);

  // Opening the page is the whole interaction — no button is pressed.
  await B.page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  await wait(2000);

  check(
    '2. opening Notifications marked them read, server-side',
    (await serverCounts(B.page)).notifications === 0,
    JSON.stringify(await serverCounts(B.page)),
  );
  check(
    '2b. and there is no "Mark all read" button to press',
    (await B.page.locator('button', { hasText: /mark all read/i }).count()) === 0,
  );
  check(
    '3. the badge cleared without a reload',
    (await badge(B.page, '/notifications')) === 0,
    String(await badge(B.page, '/notifications')),
  );

  // Persisted, not just cleared in this tab.
  await B.page.reload({ waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  check(
    '9. still read after a refresh',
    (await serverCounts(B.page)).notifications === 0 && (await badge(B.page, '/notifications')) === 0,
  );

  // Opening again with nothing unread must be a no-op, not another write.
  await B.page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  await wait(1500);
  check(
    'N. opening with zero unread does nothing and stays settled',
    (await serverCounts(B.page)).notifications === 0 && (await badge(B.page, '/notifications')) === 0,
  );

  // Something that happens AFTER the open has to count as new again.
  const postUrl = await post(B, `mark read on open ${stamp}`);
  await A.page.goto(postUrl, { waitUntil: 'domcontentloaded' });
  await A.page.waitForLoadState('networkidle');
  await A.page.locator('button[aria-label*="Like"], button[aria-label*="like"]').first().click();
  await wait(1600);

  await B.page.goto('/home', { waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  check(
    '4. a notification arriving after the open is unread again',
    (await serverCounts(B.page)).notifications >= 1 && (await badge(B.page, '/notifications')) >= 1,
    `badge=${await badge(B.page, '/notifications')}`,
  );

  // ============================== MESSAGES ===============================
  section('MESSAGES');

  // Messaging needs the follow both ways; that rule is untouched here.
  await follow(B, A.handle);
  await wait(1000);

  await sendMessage(A, B.handle, 'first');
  await sendMessage(A, B.handle, 'second');
  await sendMessage(A, B.handle, 'third');

  await B.page.goto('/home', { waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  const msgBadge = await badge(B.page, '/messages');
  const counts2 = await serverCounts(B.page);
  check('5. unread messages show the correct count', msgBadge === 3 && counts2.messages === 3, `badge=${msgBadge} server=${counts2.messages}`);

  check(
    '10a. A is not told their own sent messages are unread',
    (await serverCounts(A.page)).messages === 0,
    JSON.stringify(await serverCounts(A.page)),
  );

  // Opening the INBOX, not a thread.
  await B.page.goto('/messages', { waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  await wait(2000);

  check(
    '6. opening Messages marked the inbox read, server-side',
    (await serverCounts(B.page)).messages === 0,
    JSON.stringify(await serverCounts(B.page)),
  );
  check(
    '7. the message badge cleared without a reload',
    (await badge(B.page, '/messages')) === 0,
    String(await badge(B.page, '/messages')),
  );

  await B.page.reload({ waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  check(
    '9b. messages still read after a refresh',
    (await serverCounts(B.page)).messages === 0 && (await badge(B.page, '/messages')) === 0,
  );

  await B.page.goto('/messages', { waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  await wait(1500);
  check(
    'M. opening an already-clear inbox does nothing',
    (await serverCounts(B.page)).messages === 0,
  );

  await sendMessage(A, B.handle, 'after the open');
  await B.page.goto('/home', { waitUntil: 'domcontentloaded' });
  await B.page.waitForLoadState('networkidle');
  check(
    '8. a message arriving after the open is unread again',
    (await serverCounts(B.page)).messages === 1 && (await badge(B.page, '/messages')) === 1,
    `badge=${await badge(B.page, '/messages')}`,
  );

  // ============================== SECURITY ===============================
  section('SECURITY — unchanged');

  // The mark-read endpoints answer only for the session that asks. A third
  // account must not have had anything cleared by B opening their own inbox.
  const C = await createAccount(browser, `mrc_${stamp}`.slice(0, 20), 'Tech', viewport);
  await follow(A, C.handle);
  await wait(1000);
  await C.page.goto('/home', { waitUntil: 'domcontentloaded' });
  await C.page.waitForLoadState('networkidle');
  check(
    '10b. one account opening its own tabs does not clear another account',
    (await serverCounts(C.page)).notifications >= 1,
    JSON.stringify(await serverCounts(C.page)),
  );

  // B opening Messages must not have touched what B SENT to A.
  check(
    '10c. B reading its inbox left A’s own unread state alone',
    (await serverCounts(A.page)).messages === 0,
  );

  await browser.close();
}

await run('DESKTOP 1280x900', { width: 1280, height: 900 });
await run('MOBILE 390x844', { width: 390, height: 844 });

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
