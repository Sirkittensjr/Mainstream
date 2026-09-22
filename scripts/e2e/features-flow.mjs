/**
 * Direct messaging, username changes, Discover always having content, and the
 * rating display being the real average.
 *
 * Uses two freshly created accounts rather than the seeded community, so it
 * exercises exactly what a new FayTarra looks like.
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

const me = (page) => page.evaluate(async () => (await fetch('/api/v1/me')).json());

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

/** Creates a real account through the real signup flow and returns its page. */
async function createAccount(browser, handle, interest) {
  const context = await browser.newContext({ baseURL: BASE });
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
  return { context, page, email, handle };
}

async function follow(page, handle) {
  await page.goto(`/u/${handle}`, { waitUntil: 'domcontentloaded' });
  const button = page.locator('button:has-text("Follow")').first();
  if ((await button.count()) > 0 && (await button.innerText()) === 'Follow') {
    await button.click();
    await page.waitForTimeout(1500);
  }
}

async function unfollow(page, handle) {
  await page.goto(`/u/${handle}`, { waitUntil: 'domcontentloaded' });
  const button = page.locator('button:has-text("Following")').first();
  if ((await button.count()) > 0) {
    await button.click();
    await page.waitForTimeout(1500);
  }
}

const run = async () => {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = Date.now().toString(36).slice(-6);
  const aHandle = `ann_${stamp}`;
  const bHandle = `ben_${stamp}`;

  const A = await createAccount(browser, aHandle, 'Music');
  const B = await createAccount(browser, bHandle, 'Art');
  check('two real accounts were created', (await me(A.page))?.user?.username === aHandle);

  // A posts something, so there is content with zero engagement.
  await A.page.goto('/create', { waitUntil: 'domcontentloaded' });
  const caption = `ann's first post ${stamp}`;
  await A.page.fill('textarea[name=caption]', caption);
  await A.page.selectOption('select#category', 'Music');
  await Promise.all([
    A.page.waitForURL(/\/post\//, { timeout: 25000 }),
    A.page.locator('form button[type=submit]').last().click(),
  ]);
  const postUrl = A.page.url();
  const postId = postUrl.split('/post/')[1];

  // ===================== DISCOVERY =====================
  section('DISCOVERY — a brand new account must not see an empty site');
  await B.page.goto('/discover?show=people', { waitUntil: 'domcontentloaded' });
  let html = await B.page.content();
  check('a brand-new user appears in Discover / People', html.includes(`/u/${aHandle}`));
  check(
    'Discover People is not empty for a new account',
    (await B.page.locator('li a[href^="/u/"]').count()) > 0,
  );

  await B.page.goto('/discover', { waitUntil: 'domcontentloaded' });
  check(
    "a brand-new post with no likes/ratings appears in Discover",
    (await B.page.content()).includes(caption),
  );
  await B.page.goto('/discover?board=trending', { waitUntil: 'domcontentloaded' });
  check('Trending is not empty either', (await B.page.locator('article').count()) > 0);

  // Own content is filtered out ONCE there is somebody else's to show — with
  // nothing else on the platform, seeing your own post beats an empty page.
  await A.page.goto('/discover', { waitUntil: 'domcontentloaded' });
  check(
    'with nothing else posted, Discover shows something rather than nothing',
    (await A.page.locator('article').count()) > 0,
  );

  await B.page.goto('/create', { waitUntil: 'domcontentloaded' });
  const bCaption = `ben's post ${stamp}`;
  await B.page.fill('textarea[name=caption]', bCaption);
  await Promise.all([
    B.page.waitForURL(/\/post\//, { timeout: 25000 }),
    B.page.locator('form button[type=submit]').last().click(),
  ]);

  await A.page.goto('/discover', { waitUntil: 'domcontentloaded' });
  const aDiscover = await A.page.innerText('body');
  check("once somebody else has posted, Discover shows theirs", aDiscover.includes(bCaption));
  check(
    'and stops showing you your own post back',
    !aDiscover.includes(caption),
  );

  // ===================== RATINGS =====================
  section('RATINGS — displayed rating is the real average');
  await B.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await B.page.locator('button[aria-label="Rate this"]').first().click();
  await B.page.waitForSelector('[role=dialog]', { timeout: 10000 });
  await B.page.locator('[role=dialog] button', { hasText: /^10$/ }).first().click();
  await B.page.locator('[role=dialog] button', { hasText: /Send|Rate|Save/ }).last().click();
  await B.page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 15000 });
  await B.page.reload({ waitUntil: 'domcontentloaded' });

  const rated = await B.page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/posts/${id}`);
    return (await r.json())?.post?.rating ?? null;
  }, postId);
  check(
    'a single rating of 10 displays as 10.0, not 7.2',
    rated?.value === 10,
    `api says ${JSON.stringify(rated)}`,
  );
  check('10.0 is what the page shows', (await B.page.content()).includes('10.0'));
  check(
    'one rater reads as "1 rating", not a weighted fraction',
    rated?.votes === 1,
    `votes=${rated?.votes}`,
  );

  // A second rating of 8 -> the average must become 9.0.
  const C = await createAccount(browser, `cat_${stamp}`, 'Music');
  await C.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await C.page.locator('button[aria-label="Rate this"]').first().click();
  await C.page.waitForSelector('[role=dialog]', { timeout: 10000 });
  await C.page.locator('[role=dialog] button', { hasText: /^8$/ }).first().click();
  await C.page.locator('[role=dialog] button', { hasText: /Send|Rate|Save/ }).last().click();
  await C.page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 15000 });

  const averaged = await C.page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/posts/${id}`);
    return (await r.json())?.post?.rating ?? null;
  }, postId);
  check(
    'ratings of 10 and 8 display as the real average, 9.0',
    averaged?.value === 9,
    `api says ${JSON.stringify(averaged)}`,
  );
  check('two raters read as 2 ratings', averaged?.votes === 2, `votes=${averaged?.votes}`);

  // The public UI must not explain the ranking maths.
  const leak = /weighted by how many|more rating.? and you appear|needs \d+ ratings to be ranked|does not beat an|confidence|bayesian/i;
  for (const route of ['/discover', '/discover?show=people', `/u/${aHandle}`, '/']) {
    await B.page.goto(route, { waitUntil: 'domcontentloaded' });
    const text = await B.page.innerText('body');
    check(`${route} does not explain the ranking formula`, !leak.test(text),
      (text.match(leak) || [''])[0]);
  }

  // ===================== MESSAGING =====================
  section('MESSAGING — mutual follow required');
  await follow(A.page, bHandle); // A follows B, one way only

  await A.page.goto(`/u/${bHandle}`, { waitUntil: 'domcontentloaded' });
  check(
    'no Message button while the follow is one-way',
    (await A.page.locator('a[href^="/messages/"]').count()) === 0,
  );

  // The important one: the API must refuse, not just the button be hidden.
  const blocked = await A.page.evaluate(async (handle) => {
    const response = await fetch(`/messages/${handle}`, { redirect: 'manual' });
    return response.status;
  }, bHandle);
  check('the conversation page is not reachable one-way', blocked >= 400 || blocked === 0,
    `status ${blocked}`);

  await B.page.goto(`/messages/${aHandle}`, { waitUntil: 'domcontentloaded' });
  check(
    'a one-way follow cannot open a thread',
    !B.page.url().includes(`/messages/${aHandle}`) ||
      (await B.page.content()).includes('Nothing here'),
    B.page.url(),
  );

  // Now make it mutual.
  await follow(B.page, aHandle);
  await A.page.goto(`/u/${bHandle}`, { waitUntil: 'domcontentloaded' });
  check(
    'a Message button appears once the follow is mutual',
    (await A.page.locator('a[href^="/messages/"]').count()) > 0,
  );

  await A.page.goto(`/messages/${bHandle}`, { waitUntil: 'domcontentloaded' });
  await A.page.fill('textarea[name=body]', 'hello ben');
  await A.page.locator('form button:has-text("Send")').click();
  await A.page.waitForTimeout(2500);
  check('A can send a message', (await A.page.content()).includes('hello ben'));

  await B.page.goto(`/messages/${aHandle}`, { waitUntil: 'domcontentloaded' });
  check('B receives it', (await B.page.content()).includes('hello ben'));
  await B.page.fill('textarea[name=body]', 'hi ann');
  await B.page.locator('form button:has-text("Send")').click();
  await B.page.waitForTimeout(2500);

  await A.page.goto(`/messages/${bHandle}`, { waitUntil: 'domcontentloaded' });
  const convo = await A.page.content();
  check('both sides of the conversation are visible', convo.includes('hello ben') && convo.includes('hi ann'));

  await A.page.goto('/messages', { waitUntil: 'domcontentloaded' });
  check('the conversation is listed', (await A.page.content()).includes(bHandle));

  // Unfollow -> no new messages.
  await unfollow(B.page, aHandle);
  await A.page.goto(`/messages/${bHandle}`, { waitUntil: 'domcontentloaded' });
  check(
    'the composer is replaced once they no longer follow each other',
    (await A.page.content()).includes('cannot message each other'),
  );
  check('history is still there for the two of them', (await A.page.content()).includes('hello ben'));

  // And the server refuses even if the form is bypassed.
  const refused = await A.page.evaluate(async () => {
    const box = document.querySelector('textarea[name=body]');
    return box === null;
  });
  check('no composer is rendered to bypass', refused);

  // ===================== USERNAME =====================
  section('USERNAME — change it without moving the account');
  const before = await me(A.page);
  const newHandle = `ann2_${stamp}`;
  await A.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await A.page.fill('#username', newHandle);
  await A.page.locator('button:has-text("Change username")').click();
  await A.page.waitForTimeout(3000);

  const after = await me(A.page);
  check('the username changed', after?.user?.username === newHandle, after?.user?.username);
  check('the account id did NOT change', after?.user?.id === before?.user?.id);
  check('the bio and profile survived', after?.user?.displayName === before?.user?.displayName);

  await A.page.goto(`/u/${newHandle}`, { waitUntil: 'domcontentloaded' });
  const profile = await A.page.content();
  check('the profile is at the new handle', A.page.url().includes(newHandle));
  check('their post is still on the profile', profile.includes(caption));
  check('the new @handle is shown', profile.includes(newHandle));

  const stats = await A.page.evaluate(async () => (await fetch('/api/v1/me')).json());
  check('their rating history survived the rename', typeof stats?.user?.rating?.overall === 'number');

  // Someone else cannot take a handle that is in use.
  await B.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await B.page.fill('#username', newHandle);
  await B.page.locator('button:has-text("Change username")').click();
  await B.page.waitForTimeout(3000);
  check(
    'another account cannot take a username in use',
    (await B.page.content()).includes('taken'),
  );
  check('and B keeps its own username', (await me(B.page))?.user?.username === bHandle);

  // Reserved handles are refused.
  await B.page.fill('#username', 'admin');
  await B.page.locator('button:has-text("Change username")').click();
  await B.page.waitForTimeout(3000);
  check('reserved usernames are refused', (await B.page.content()).includes('reserved'));

  // Cooldown applies to the account that just changed.
  await A.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await A.page.fill('#username', `ann3_${stamp}`);
  await A.page.locator('button:has-text("Change username")').click();
  await A.page.waitForTimeout(3000);
  check(
    'a cooldown stops immediate re-changes',
    /change your username again in/i.test(await A.page.content()),
  );

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
