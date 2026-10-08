/**
 * Deleting your own posts, end to end, on a desktop and on a phone.
 *
 *   A posts one of every kind — a photo, a video, a Short, a Story and a Big
 *   message — plus one that stays. B follows A, likes, comments on and rates
 *   A's photo, and posts something of their own.
 *
 * Then:
 *   - Delete is in the ••• menu of A's own posts and of nobody else's;
 *   - the confirmation says "Delete this post?" / "This can't be undone.", and
 *     Cancel changes nothing;
 *   - Delete takes the post off the screen at once, with no reload, from the
 *     profile (each tab) and from the post's own page;
 *   - a request rewritten to carry B's post id is refused by the server, and
 *     B's post is still there;
 *   - afterwards the post is in none of: A's profile tabs, B's Following,
 *     Recommended and Discover, Search, the Videos feed, A's notifications; its
 *     page is a 404, the API says it is gone, and its files (the video, its
 *     poster, the photo) are no longer served;
 *   - what A has left still works.
 *
 *   node scripts/e2e/make-video-fixtures.mjs /tmp/fay-video-fixtures
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/post-delete-flow.mjs
 *
 * Needs the GoTrue stub and a built app, against an EMPTY store.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const FIXTURES = process.env.FIXTURES || '/tmp/fay-video-fixtures';
const CHROMIUM = process.env.CHROMIUM_PATH;
const PASSWORD = 'a long enough password';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function account(browser, handle) {
  const email = `${handle}@example.com`;
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]').first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/verify-email/, { timeout: 25000 });
  const link = [...mails()].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

const idFrom = (page) => page.url().split('/post/')[1].split(/[?#]/)[0];

async function postText(page, kind, body, title) {
  await page.goto(`/create?kind=text&text=${kind}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea#caption', { timeout: 20000 });
  if (title) await page.fill('#text_title', title);
  await page.fill('#caption', body);
  await page.locator('[data-post-text]').click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
  return idFrom(page);
}

async function postPhoto(page, caption) {
  await page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  const jpeg = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 700;
    const g = c.getContext('2d');
    g.fillStyle = '#ff3d9a';
    g.fillRect(0, 0, 900, 700);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(jpeg, 'base64'),
  });
  await page.waitForSelector('form img, [data-media-preview] img', { timeout: 20000 }).catch(() => {});
  await page.fill('textarea[name=caption]', caption);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
  return idFrom(page);
}

async function postVideo(page, title) {
  await page.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Post a video', { timeout: 15000 });
  await page.locator('input[type=file]').setInputFiles({
    name: 'square.webm',
    mimeType: 'video/webm',
    buffer: readFileSync(path.join(FIXTURES, 'square.webm')),
  });
  await page.waitForSelector('#video-title', { timeout: 30000 });
  await page.fill('#video-title', title);
  await page.selectOption('#video-category', 'Music');
  await page.locator('button', { hasText: /^Post video$/ }).click();
  await page.waitForURL(/\/post\//, { timeout: 180000 });
  return idFrom(page);
}

/** The post's JSON from the API, as whoever this page is signed in as. */
const apiPost = (page, id) =>
  page.evaluate(async (postId) => {
    const response = await fetch(`/api/v1/posts/${postId}`, { cache: 'no-store' });
    return { status: response.status, body: response.ok ? await response.json() : null };
  }, id);

const status = (page, url) =>
  page.evaluate(async (target) => (await fetch(target, { cache: 'no-store' })).status, url);

/** The card on screen carrying this text. */
const card = (page, text) => page.locator('article', { hasText: text }).first();

async function openMenu(page, text) {
  const target = card(page, text);
  await target.scrollIntoViewIfNeeded();
  await target.locator('button[aria-label="More options"]').click();
  return target;
}

async function run() {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = Date.now().toString(36).slice(-6);
  const A = await account(browser, `pd_a_${stamp}`);
  const B = await account(browser, `pd_b_${stamp}`);
  const me = `/u/${A.handle}`;

  const C = {
    photo: `Delete photo ${stamp}`,
    video: `Delete video ${stamp}`,
    short: `Delete short ${stamp}`,
    story: `Delete story ${stamp}`,
    big: `Delete big ${stamp}`,
    keeper: `Keeper ${stamp}`,
    theirs: `Theirs ${stamp}`,
  };

  /* -------------------------------------------------------------- content */
  section('CONTENT');
  const id = {};
  id.keeper = await postText(A.page, 'short', C.keeper);
  id.short = await postText(A.page, 'short', C.short);
  id.story = await postText(A.page, 'story', C.story, `Story title ${stamp}`);
  id.big = await postText(A.page, 'big', C.big);
  id.photo = await postPhoto(A.page, C.photo);
  id.video = await postVideo(A.page, C.video);
  id.theirs = await postPhoto(B.page, C.theirs);
  check('A posted a photo, a video, a Short, a Story, a Big message and one to keep', Object.values(id).every(Boolean));

  const photoPost = (await apiPost(A.page, id.photo)).body?.post;
  const videoPost = (await apiPost(A.page, id.video)).body?.post;
  const files = {
    photo: photoPost?.media?.[0]?.url,
    video: videoPost?.media?.[0]?.url,
    poster: videoPost?.media?.[0]?.poster,
  };
  check('the photo and the video each have their files', Boolean(files.photo && files.video), JSON.stringify(files));
  for (const [name, url] of Object.entries(files)) {
    if (url) check(`${name} file is served before the delete`, (await status(A.page, url)) === 200, url);
  }

  // B follows A, and reacts to the photo: a like, a comment, a rating.
  await B.page.goto(me, { waitUntil: 'networkidle' });
  await B.page
    .locator('[data-profile-actions] button', { hasText: /^Follow$/ })
    .first()
    .click();
  await B.page.waitForTimeout(800);
  await B.page.goto(`/post/${id.photo}`, { waitUntil: 'networkidle' });
  await card(B.page, C.photo).locator('button[aria-label="Like"]').click();
  await B.page.waitForTimeout(600);
  await B.page.fill('textarea[name=body]', `nice one ${stamp}`);
  await B.page.locator('form', { has: B.page.locator('textarea[name=body]') }).locator('button[type=submit]').click();
  await B.page.waitForTimeout(1500);
  await A.page.goto('/notifications', { waitUntil: 'networkidle' });
  const notesBefore = await A.page.locator('body').innerText();
  check(
    'A was notified that B liked and commented on the photo',
    notesBefore.includes(`@${B.handle} liked your post`) && /commented on your post/.test(notesBefore),
  );

  section('BEFORE: WHERE A’S POSTS SHOW UP FOR B');
  await B.page.goto('/home?tab=following', { waitUntil: 'networkidle' });
  check('B’s Following shows A’s photo', (await B.page.content()).includes(C.photo));
  await B.page.goto(`/search?q=${encodeURIComponent(stamp)}`, { waitUntil: 'networkidle' });
  check('Search finds A’s posts', (await B.page.content()).includes(C.short));

  /* ------------------------------------------------- whose menu has Delete */
  section('DELETE IS ONLY ON YOUR OWN POSTS');
  const page = A.page;
  await page.goto(me, { waitUntil: 'networkidle' });
  let target = await openMenu(page, C.keeper);
  check('A’s own post: the ••• menu has Delete', (await target.locator('[data-delete-post]').count()) === 1);
  await page.keyboard.press('Escape');
  await page.goto(`/u/${B.handle}`, { waitUntil: 'networkidle' });
  target = await openMenu(page, C.theirs);
  check(
    'B’s post, seen by A: no Delete, only Report',
    (await target.locator('[data-delete-post]').count()) === 0 &&
      (await target.locator('button', { hasText: 'Report' }).count()) === 1,
  );
  await B.page.goto(me, { waitUntil: 'networkidle' });
  target = await openMenu(B.page, C.keeper);
  check('and A’s post, seen by B: no Delete', (await target.locator('[data-delete-post]').count()) === 0);

  /* --------------------------------------------------------------- cancel */
  section('CANCEL CHANGES NOTHING');
  await page.goto(me, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__fayMarker = 'same document';
  });
  target = await openMenu(page, C.photo);
  await target.locator('[data-delete-post]').click();
  const dialog = page.locator('[data-delete-confirm]');
  await dialog.waitFor({ timeout: 5000 });
  const dialogText = await dialog.innerText();
  check(
    'the confirmation asks first',
    dialogText.includes('Delete this post?') && dialogText.includes("This can't be undone."),
    dialogText.replace(/\n/g, ' | '),
  );
  const buttons = await dialog.locator('button').evaluateAll((nodes) =>
    nodes.map((n) => ({ text: n.textContent.trim(), bg: getComputedStyle(n).backgroundColor })),
  );
  check(
    'Cancel and Delete, and Delete looks different',
    buttons.map((b) => b.text).join() === 'Cancel,Delete' && buttons[0].bg !== buttons[1].bg,
    JSON.stringify(buttons),
  );
  await dialog.locator('[data-delete-cancel]').click();
  await page.waitForTimeout(400);
  check('Cancel closes it', (await page.locator('[data-delete-confirm]').count()) === 0);
  check('and the menu it came from', (await page.locator('[data-delete-post]').count()) === 0);
  check('and the photo is still on the profile', (await card(page, C.photo).count()) === 1);
  check('and still on the server', (await apiPost(page, id.photo)).status === 200);
  // The backdrop and Escape are Cancel too.
  target = await openMenu(page, C.photo);
  await target.locator('[data-delete-post]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Escape cancels as well', (await page.locator('[data-delete-confirm]').count()) === 0 && (await apiPost(page, id.photo)).status === 200);

  /* --------------------------------------------- a forged request is refused */
  section('THE SERVER REFUSES ANOTHER ACCOUNT’S POST');
  // A presses Delete on their own photo, and the request is rewritten on its
  // way out to carry B's post id instead — what somebody editing the request
  // by hand would do.
  let rewritten = 0;
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action'] && request.postData()?.includes(id.photo)) {
      rewritten += 1;
      return route.continue({ postData: request.postData().replaceAll(id.photo, id.theirs) });
    }
    return route.continue();
  });
  target = await openMenu(page, C.photo);
  await target.locator('[data-delete-post]').click();
  await page.locator('[data-delete-confirm-button]').click();
  await page.locator('[data-delete-confirm]', { hasText: 'only delete your own' }).waitFor({ timeout: 10000 }).catch(() => {});
  const refusal = await page.locator('[data-delete-confirm]').innerText().catch(() => '');
  await page.unroute('**/*');
  check('the rewritten request went out', rewritten === 1, `${rewritten}`);
  check('and was refused, and said so', /only delete your own posts/i.test(refusal), refusal.replace(/\n/g, ' | '));
  check('B’s post is still there', (await apiPost(B.page, id.theirs)).status === 200);
  check('and so is A’s photo — nothing was deleted', (await apiPost(page, id.photo)).status === 200);
  await page.locator('[data-delete-cancel]').click();

  /* ------------------------------------------------- delete, on a desktop */
  async function deleteFrom(page, label, tab, caption) {
    await page.goto(tab === 'posts' ? me : `${me}?tab=${tab}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.__fayMarker = 'same document';
    });
    const countBefore = await page.locator(`[data-profile-tab="${tab}"]`).innerText();
    const url = page.url();
    const target = await openMenu(page, caption);
    await target.locator('[data-delete-post]').click();
    await page.locator('[data-delete-confirm-button]').click();
    await page.waitForFunction(
      (text) => ![...document.querySelectorAll('article')].some((a) => a.textContent.includes(text)),
      caption,
      { timeout: 10000 },
    ).catch(() => {});
    await page.waitForTimeout(800);
    const still = await card(page, caption).count();
    const marker = await page.evaluate(() => window.__fayMarker ?? null);
    const countAfter = await page.locator(`[data-profile-tab="${tab}"]`).innerText();
    check(`${label}: off the screen, no reload, same page`, still === 0 && marker === 'same document' && page.url() === url, `${still} left, marker=${marker}`);
    check(`${label}: the tab count went down`, countBefore !== countAfter, `${countBefore} → ${countAfter}`);
    check(`${label}: the confirmation is closed`, (await page.locator('[data-delete-confirm]').count()) === 0);
  }

  section('DELETE — DESKTOP');
  await deleteFrom(page, 'photo, from Posts', 'posts', C.photo);
  await deleteFrom(page, 'video, from Videos', 'videos', C.video);

  // From the post's own page: there is nothing left there, so it goes to the
  // profile, as a client navigation that replaces the post in the history.
  await page.goto(me, { waitUntil: 'networkidle' });
  await page.goto(`/post/${id.short}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__fayMarker = 'same document';
  });
  target = await openMenu(page, C.short);
  await target.locator('[data-delete-post]').click();
  await page.locator('[data-delete-confirm-button]').click();
  await page.waitForURL((u) => u.pathname === me, { timeout: 15000 }).catch(() => {});
  check(
    'Short, from its own page: lands on the profile without a reload',
    new URL(page.url()).pathname === me && (await page.evaluate(() => window.__fayMarker ?? null)) === 'same document',
    page.url(),
  );
  check('and the profile no longer has it', (await card(page, C.short).count()) === 0);
  await page.goBack();
  await page.waitForTimeout(1200);
  check('Back does not return to the deleted post', !page.url().includes(id.short), page.url());

  /* --------------------------------------------------- delete, on a phone */
  section('DELETE — PHONE');
  const phone = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    storageState: await A.context.storageState(),
  });
  const handset = await phone.newPage();
  // Cancel on the phone too, then the two deletes.
  await handset.goto(`${me}?tab=text`, { waitUntil: 'networkidle' });
  target = await openMenu(handset, C.story);
  await target.locator('[data-delete-post]').tap();
  await handset.locator('[data-delete-cancel]').tap();
  check('phone: Cancel keeps the Story', (await card(handset, C.story).count()) === 1 && (await apiPost(handset, id.story)).status === 200);
  const sheet = await (async () => {
    target = await openMenu(handset, C.story);
    await target.locator('[data-delete-post]').tap();
    const box = await handset.locator('[data-delete-confirm]').boundingBox();
    await handset.locator('[data-delete-cancel]').tap();
    return box;
  })();
  check('phone: the confirmation fits the screen', Boolean(sheet && sheet.x >= 0 && sheet.x + sheet.width <= 390.5), JSON.stringify(sheet));
  await deleteFrom(handset, 'phone: Story, from Text', 'text', C.story);
  await deleteFrom(handset, 'phone: Big message, from Text', 'text', C.big);
  const sideways = await handset.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('phone: nothing scrolls sideways', sideways === 0, `${sideways}px`);
  await phone.close();

  /* ------------------------------------------------------- gone everywhere */
  section('AFTER: GONE EVERYWHERE');
  const deleted = ['photo', 'video', 'short', 'story', 'big'];
  for (const kind of deleted) {
    check(`${kind}: the API says it is gone`, (await apiPost(page, id[kind])).status === 404);
    // The post page streams (it has a loading state), so the status line has
    // gone out before the page knows; what it shows is the not-found page.
    await page.goto(`/post/${id[kind]}`, { waitUntil: 'networkidle' });
    const shown = await page.locator('body').innerText();
    check(
      `${kind}: its page says it is not there`,
      shown.includes('Nothing here.') && !(await page.content()).includes(C[kind]),
    );
  }
  for (const [name, url] of Object.entries(files)) {
    if (url) check(`${name} file is no longer served`, (await status(page, url)) === 404, url);
  }
  const surfaces = [
    [A.page, 'A’s Posts', me],
    [A.page, 'A’s Videos', `${me}?tab=videos`],
    [A.page, 'A’s Text', `${me}?tab=text`],
    [B.page, 'B’s Following', '/home?tab=following'],
    [B.page, 'B’s Recommended', '/home?tab=recommended'],
    [B.page, 'B’s Discover', '/home?tab=discover'],
    [B.page, 'the Discover page', '/discover'],
    [B.page, 'Search', `/search?q=${encodeURIComponent(stamp)}`],
    [B.page, 'the Videos feed', '/videos'],
    [B.page, 'A’s profile, seen by B', me],
  ];
  for (const [who, label, url] of surfaces) {
    await who.goto(url, { waitUntil: 'networkidle' });
    const html = await who.content();
    const found = deleted.filter((kind) => html.includes(C[kind]));
    check(`${label}: none of the deleted posts`, found.length === 0, found.join(', '));
  }
  await A.page.goto('/notifications', { waitUntil: 'networkidle' });
  const notesAfter = await A.page.locator('body').innerText();
  check(
    'A’s notifications about the deleted photo are gone',
    !notesAfter.includes(`@${B.handle} liked your post`) && !/commented on your post/.test(notesAfter),
  );

  /* ------------------------------------------------------- what is left */
  section('WHAT A HAS LEFT STILL WORKS');
  await page.goto(me, { waitUntil: 'networkidle' });
  const tabs = await page
    .locator('[data-profile-tab]')
    .evaluateAll((nodes) => nodes.map((n) => n.textContent.trim()));
  check('the counts: Posts 1, Videos none, Text 1', JSON.stringify(tabs) === JSON.stringify(['posts1', 'videos', 'text1', 'about']), tabs.join(' | '));
  check('the post A kept is there', (await card(page, C.keeper).count()) === 1);
  await page.locator('[data-profile-tab="videos"]').click();
  await page.waitForSelector('[data-profile-shelf="videos"]');
  check('Videos is empty, and says so', (await page.locator('[data-profile-shelf]').innerText()).includes('No videos yet'));
  await page.locator('[data-profile-tab="posts"]').click();
  await page.waitForSelector('[data-profile-shelf="posts"]');
  await B.page.goto(`/post/${id.keeper}`, { waitUntil: 'networkidle' });
  await card(B.page, C.keeper).locator('button[aria-label="Like"]').click();
  await B.page.waitForTimeout(800);
  await B.page.reload({ waitUntil: 'networkidle' });
  check(
    'the kept post can still be liked',
    (await card(B.page, C.keeper).locator('button[aria-label="Unlike"]').count()) === 1,
  );
  check('B’s own post was never touched', (await apiPost(B.page, id.theirs)).status === 200);

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
