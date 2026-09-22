/**
 * Direct messages, the seven scenarios that define them.
 *
 * Three real accounts created through the real signup flow, in three separate
 * browser contexts, so every follow, block, send and read is a genuine request
 * from a genuine session.
 *
 * The checks that matter most are the ones where the BROWSER still believes it
 * may send: the relationship is broken from the other account while a composer
 * is already on screen, and the send is then made anyway. If the rule lived in
 * the UI those would go through.
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e/messaging-flow.mjs
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

async function createAccount(browser, handle, interest) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
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
  return { context, page, handle };
}

async function setFollow(actor, handle, shouldFollow) {
  await actor.page.goto(`/u/${handle}`, { waitUntil: 'domcontentloaded' });
  const following = actor.page.locator('button:has-text("Following")');
  const follow = actor.page.locator('button', { hasText: /^Follow$/ });
  const isFollowing = (await following.count()) > 0;
  if (shouldFollow && !isFollowing) await follow.first().click();
  if (!shouldFollow && isFollowing) await following.first().click();
  if (shouldFollow !== isFollowing) await actor.page.waitForTimeout(1600);
}

async function setBlock(actor, handle, shouldBlock) {
  await actor.page.goto(`/u/${handle}`, { waitUntil: 'domcontentloaded' });
  await actor.page.locator('button[aria-label="More options"]').first().click();
  const item = actor.page.locator('button', {
    hasText: shouldBlock ? new RegExp(`^Block @${handle}$`) : new RegExp(`^Unblock @${handle}$`),
  });
  await item.first().click();
  await actor.page.waitForTimeout(1800);
}

const messageButton = (page, handle) => page.locator(`a[href="/messages/${handle}"]`);

async function openThread(actor, handle) {
  await actor.page.goto(`/messages/${handle}`, { waitUntil: 'domcontentloaded' });
  // domcontentloaded can land before anything is painted, and reading an empty
  // body then looks exactly like a blank page.
  await actor.page
    .waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 15000 })
    .catch(() => undefined);
}

async function sendVia(actor, text) {
  await actor.page.fill('#message-body', text);
  await actor.page.locator('button', { hasText: /^Send$/ }).first().click();
  await actor.page.waitForTimeout(2200);
}

/** Status of a direct GET, for the routes that must not exist for this viewer. */
const statusOf = (page, path) =>
  page.evaluate(async (target) => (await fetch(target, { redirect: 'manual' })).status, path);

const bodyText = (page) => page.locator('body').innerText();

const run = async () => {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = Date.now().toString(36).slice(-6);
  const aH = `ama_${stamp}`;
  const bH = `bex_${stamp}`;
  const cH = `caz_${stamp}`;

  const A = await createAccount(browser, aH, 'Music');
  const B = await createAccount(browser, bH, 'Art');
  const C = await createAccount(browser, cH, 'Life');
  check('three accounts created', true);

  /* ===================================================================== */
  section('TEST 6 — two people who have never messaged');

  await A.page.goto('/messages', { waitUntil: 'domcontentloaded' });
  const empty = await bodyText(A.page);
  check('6. the inbox shows the empty state', /No messages yet/.test(empty));
  check(
    '6. and explains what to do about it',
    /follow you back|follow someone/i.test(empty),
    empty.split('\n').find((l) => /follow/i.test(l))?.slice(0, 70),
  );
  check('6. with no invented conversations in it', (await A.page.locator('ul li a[href^="/messages/"]').count()) === 0);

  /* ===================================================================== */
  section('TEST 2 — A follows B, B does not follow back');

  await setFollow(A, bH, true);
  await A.page.goto(`/u/${bH}`, { waitUntil: 'domcontentloaded' });
  check('2. no Message button on a one-way follow', (await messageButton(A.page, bH).count()) === 0);

  await openThread(A, bH);
  check(
    '2. the conversation URL shows nothing to them',
    /Nothing here/i.test(await bodyText(A.page)) && (await A.page.locator('#message-body').count()) === 0,
    A.page.url(),
  );
  check('2. and answers 404 to a direct request', (await statusOf(A.page, `/messages/${bH}`)) === 404);

  /* ===================================================================== */
  section('TEST 3 — B follows A, A does not follow back');

  await setFollow(A, bH, false);
  await setFollow(B, aH, true);
  await A.page.goto(`/u/${bH}`, { waitUntil: 'domcontentloaded' });
  check('3. still no Message button the other way round', (await messageButton(A.page, bH).count()) === 0);
  await B.page.goto(`/u/${aH}`, { waitUntil: 'domcontentloaded' });
  check('3. and none for the person who did the following', (await messageButton(B.page, aH).count()) === 0);
  check('3. the conversation is unreachable', (await statusOf(B.page, `/messages/${aH}`)) === 404);

  /* ===================================================================== */
  section('TEST 1 — A and B follow each other');

  await setFollow(A, bH, true);
  await A.page.goto(`/u/${bH}`, { waitUntil: 'domcontentloaded' });
  check('1. the Message button appears on their profile', (await messageButton(A.page, bH).count()) === 1);

  await A.page.goto(`/u/${aH}`, { waitUntil: 'domcontentloaded' });
  check('1. and never on your own profile', (await messageButton(A.page, aH).count()) === 0);

  await A.page.goto(`/u/${bH}`, { waitUntil: 'domcontentloaded' });
  await messageButton(A.page, bH).first().click();
  await A.page.waitForURL(new RegExp(`/messages/${bH}`), { timeout: 15000 });
  check('1. clicking it opens the conversation', true, A.page.url());

  await sendVia(A, 'first message from A');
  check('1. A can send a message', (await bodyText(A.page)).includes('first message from A'));

  await B.page.goto('/home', { waitUntil: 'domcontentloaded' });
  const badge = B.page.locator('a[href="/messages"] span').filter({ hasText: /^\d\+?$/ });
  check('1. B sees an unread badge in the navigation', (await badge.count()) > 0, await badge.first().innerText().catch(() => ''));

  await B.page.goto('/messages', { waitUntil: 'domcontentloaded' });
  const inbox = await bodyText(B.page);
  check('1. B sees the conversation in their inbox', inbox.includes('first message from A'));
  check('1. with the sender shown', inbox.includes(aH.toUpperCase()) || inbox.includes(`@${aH}`));

  await openThread(B, aH);
  check('1. B can open it and read it', (await bodyText(B.page)).includes('first message from A'));

  await B.page.goto('/home', { waitUntil: 'domcontentloaded' });
  check(
    '7. opening the conversation cleared the unread badge',
    (await B.page.locator('a[href="/messages"] span').filter({ hasText: /^\d\+?$/ }).count()) === 0,
  );

  await openThread(B, aH);
  await sendVia(B, 'and a reply from B');
  check('1. B can reply', (await bodyText(B.page)).includes('and a reply from B'));

  /* ===================================================================== */
  section('TEST 7 — several messages, in order, with the right unread state');

  await openThread(A, bH);
  for (const text of ['one', 'two', 'three']) {
    await A.page.fill('#message-body', `counted ${text}`);
    await A.page.keyboard.press('Enter');
    await A.page
      .waitForFunction(
        (sent) => document.body.innerText.includes(sent) && !document.body.innerText.includes('Sending…'),
        `counted ${text}`,
        { timeout: 15000 },
      )
      .catch(() => undefined);
  }
  check('7. Enter sends without touching the Send button', (await bodyText(A.page)).includes('counted three'));

  const order = await A.page.locator('ol li').allInnerTexts();
  const positions = ['counted one', 'counted two', 'counted three'].map((t) =>
    order.findIndex((row) => row.includes(t)),
  );
  check(
    '7. they are in the order they were sent',
    positions.every((at, i) => at >= 0 && (i === 0 || at > positions[i - 1])),
    positions.join(' < '),
  );
  check(
    '7. the first message is still above them',
    order.findIndex((row) => row.includes('first message from A')) < positions[0],
  );

  // Sent by me and sent by them are told apart by which side they sit on.
  const sides = await A.page.locator('ol li').evaluateAll((items) =>
    items.map((li) => ({
      text: li.innerText,
      mine: li.className.includes('justify-end'),
    })),
  );
  check(
    '7. my messages and theirs are visually distinct',
    sides.some((s) => s.text.includes('counted one') && s.mine) &&
      sides.some((s) => s.text.includes('and a reply from B') && !s.mine),
  );
  check(
    '7. every message carries a timestamp',
    (await A.page.locator('ol li time[datetime]').count()) >= 5,
    `${await A.page.locator('ol li time[datetime]').count()} timestamps`,
  );

  await B.page.goto('/home', { waitUntil: 'domcontentloaded' });
  const badge3 = B.page.locator('a[href="/messages"] span').filter({ hasText: /^\d\+?$/ });
  check('7. three new messages show as unread for B', (await badge3.first().innerText().catch(() => '')) === '3', await badge3.first().innerText().catch(() => 'none'));

  await A.page.goto('/home', { waitUntil: 'domcontentloaded' });
  check(
    '7. and A is not told their own messages are unread',
    (await A.page.locator('a[href="/messages"] span').filter({ hasText: /^\d\+?$/ }).count()) === 0,
  );

  /* ===================================================================== */
  section('TEST 4 — A unfollows B while the composer is open');

  await openThread(A, bH);
  check('4. the composer is there to begin with', (await A.page.locator('#message-body').count()) === 1);

  // The unfollow is made from a SECOND TAB of the same account, so the tab
  // holding the conversation keeps its now-stale composer and the send below
  // is one the browser genuinely believes is allowed.
  const aSecondTab = await A.context.newPage();
  await aSecondTab.goto(`/u/${bH}`, { waitUntil: 'domcontentloaded' });
  const stillFollowing = aSecondTab.locator('button:has-text("Following")');
  if ((await stillFollowing.count()) > 0) {
    await stillFollowing.first().click();
    await aSecondTab.waitForTimeout(1600);
  }
  await aSecondTab.close();

  const staleComposer = await A.page.locator('#message-body').count();
  if (staleComposer > 0) {
    await sendVia(A, 'this must not arrive');
    const afterBlockedSend = await bodyText(A.page);
    check(
      '4. the server refuses a send the page still offered',
      /follow you back|cannot message/i.test(afterBlockedSend),
      afterBlockedSend.split('\n').find((l) => /follow you back|cannot message/i.test(l))?.slice(0, 70),
    );
    await openThread(A, bH);
    check('4. and nothing was stored', !(await bodyText(A.page)).includes('this must not arrive'));
  }

  await openThread(A, bH);
  const closed = await bodyText(A.page);
  check('4. the composer is replaced with the reason', (await A.page.locator('#message-body').count()) === 0);
  check('4. which says both of you must follow each other', /follow each other/i.test(closed));
  check('4. the history is still readable', closed.includes('first message from A') && closed.includes('and a reply from B'));

  await B.page.goto('/messages', { waitUntil: 'domcontentloaded' });
  check('4. and still reachable from the inbox', (await bodyText(B.page)).includes('counted three'));

  await setFollow(A, bH, true);
  await openThread(A, bH);
  check('4. following again reopens the conversation', (await A.page.locator('#message-body').count()) === 1);
  check('4. with everything still in it', (await bodyText(A.page)).includes('first message from A'));

  /* ===================================================================== */
  section('TEST 5 — A blocks B');

  await openThread(A, bH);
  check('5. the composer is open before the block', (await A.page.locator('#message-body').count()) === 1);

  const blockTab = await A.context.newPage();
  await blockTab.goto(`/u/${bH}`, { waitUntil: 'domcontentloaded' });
  await blockTab.locator('button[aria-label="More options"]').first().click();
  await blockTab.locator('button', { hasText: new RegExp(`^Block @${bH}$`) }).first().click();
  await blockTab.waitForTimeout(2000);
  await blockTab.close();

  if ((await A.page.locator('#message-body').count()) > 0) {
    await sendVia(A, 'blocked message');
    check(
      '5. the server refuses a send from the blocker',
      /not available|cannot message|follow you back/i.test(await bodyText(A.page)),
    );
  }

  check('5. the conversation is gone for the blocker', (await statusOf(A.page, `/messages/${bH}`)) === 404);
  check('5. and gone for the blocked person', (await statusOf(B.page, `/messages/${aH}`)) === 404);

  await B.page.goto('/messages', { waitUntil: 'domcontentloaded' });
  check('5. it leaves the blocked person\'s inbox too', !(await bodyText(B.page)).includes('counted three'));

  await B.page.goto(`/u/${aH}`, { waitUntil: 'domcontentloaded' });
  check('5. and there is no Message button to try again with', (await messageButton(B.page, aH).count()) === 0);

  await setBlock(A, bH, false);
  // Blocking severed the follow both ways, so unblocking alone does not bring
  // messaging back — which is the right behaviour, and the reason the mutual
  // follow has to be made again here.
  await A.page.goto(`/u/${bH}`, { waitUntil: 'domcontentloaded' });
  check('5. unblocking alone does not reopen messaging', (await messageButton(A.page, bH).count()) === 0);
  await setFollow(A, bH, true);
  await setFollow(B, aH, true);
  await A.page.goto(`/u/${bH}`, { waitUntil: 'domcontentloaded' });
  check('5. following each other again does', (await messageButton(A.page, bH).count()) === 1);

  /* ===================================================================== */
  section('SECURITY — somebody else\'s conversation');

  // C has never spoken to either of them and follows nobody.
  check('C cannot open A and B\'s conversation by guessing the URL', (await statusOf(C.page, `/messages/${aH}`)) === 404);
  check('nor the other side of it', (await statusOf(C.page, `/messages/${bH}`)) === 404);
  await C.page.goto('/messages', { waitUntil: 'domcontentloaded' });
  const cInbox = await bodyText(C.page);
  check('and sees none of it in their own inbox', !cInbox.includes('counted three') && !cInbox.includes('first message from A'));

  const anonymous = await browser.newContext({ baseURL: BASE });
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(`/messages/${aH}`, { waitUntil: 'domcontentloaded' });
  check('a signed-out visitor is sent to sign in, not into the thread', /\/login/.test(anonymousPage.url()), anonymousPage.url());
  await anonymous.close();

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

  await phonePage.goto('/home', { waitUntil: 'domcontentloaded' });
  check('Messages is reachable in one tap from the top bar', (await phonePage.locator('a[href="/messages"]').count()) > 0);

  await phonePage.goto(`/messages/${bH}`, { waitUntil: 'domcontentloaded' });
  await phonePage.waitForTimeout(600);
  const overflow = await phonePage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('the conversation does not scroll sideways', overflow <= 0, `${overflow}px`);

  // The composer has to sit above the fixed bottom navigation, not under it.
  const reachable = await phonePage.evaluate(() => {
    const box = document.querySelector('#message-body')?.getBoundingClientRect();
    const nav = document.querySelector('nav.fixed')?.getBoundingClientRect();
    if (!box || !nav) return null;
    return { composerBottom: Math.round(box.bottom), navTop: Math.round(nav.top), height: Math.round(box.height) };
  });
  check(
    'the message box is not hidden behind the bottom navigation',
    reachable !== null && reachable.composerBottom <= reachable.navTop + 1,
    reachable ? `composer ends at ${reachable.composerBottom}, nav starts at ${reachable.navTop}` : 'not found',
  );
  check('and is big enough to tap', (reachable?.height ?? 0) >= 40, `${reachable?.height}px tall`);

  await phonePage.fill('#message-body', 'sent from a phone');
  await phonePage.locator('button', { hasText: /^Send$/ }).first().click();
  await phonePage.waitForTimeout(2200);
  check('a message can be sent on a phone', (await phonePage.locator('body').innerText()).includes('sent from a phone'));
  await phone.close();

  /* ===================================================================== */
  section('LIVE UPDATE');

  await openThread(A, bH);
  await openThread(B, aH);
  await B.page.fill('#message-body', 'does this arrive on its own');
  await B.page.locator('button', { hasText: /^Send$/ }).first().click();
  await B.page.waitForTimeout(1500);

  // A's tab is sitting on the conversation and must not need a reload.
  await A.page.waitForFunction(
    () => document.body.innerText.includes('does this arrive on its own'),
    undefined,
    { timeout: 20000 },
  ).then(
    () => check('a new message appears without reloading the page', true),
    () => check('a new message appears without reloading the page', false, 'not seen within 20s'),
  );

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
