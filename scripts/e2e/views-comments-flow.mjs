/**
 * Video views and deleting comments, end to end, through the real UI.
 *
 * VIEWS — one per playback session, counted the moment playback starts:
 *   autoplay in the feed counts; pausing and resuming does not; the video
 *   looping round, scrolling away and back, refreshing, and replaying after
 *   it ended each count again; a player that only rendered counts nothing;
 *   a report that failed on the way back is retried without counting twice;
 *   visitors count; the number shows on the feed, the post page and the
 *   profile, on a phone and a desktop, and survives a refresh.
 *
 * COMMENTS — deleted by their author or by the owner of the post they are on,
 *   on text, photo and video posts, on the post page and in the Videos feed's
 *   comment sheet; nobody else is offered Delete, and a request replayed with
 *   somebody else's comment id changes nothing. Deleting asks first, takes
 *   replies with it, updates the list and the counts at once, and shows an
 *   error when it fails.
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     FIXTURES=/tmp/fay-video-fixtures node scripts/e2e/views-comments-flow.mjs
 *
 * Needs the GoTrue stub, a built app, an EMPTY store and the fixtures from
 * make-video-fixtures.mjs.
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const STORE = process.env.FAY_STORE || '.data/faytarra.json';
const CHROMIUM = process.env.CHROMIUM_PATH;
const FIXTURES = process.env.FIXTURES || '/tmp/fay-video-fixtures';
const PASSWORD = 'a long enough password';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const store = () => {
  for (;;) {
    try {
      return JSON.parse(readFileSync(STORE, 'utf8'));
    } catch {
      /* mid-write */
    }
  }
};
async function settle(predicate, timeout = 10000) {
  const until = Date.now() + timeout;
  for (;;) {
    const snapshot = store();
    if (predicate(snapshot)) return snapshot;
    if (Date.now() >= until) return snapshot;
    await wait(200);
  }
}
const viewsOf = (id) => store().posts.find((p) => p.id === id)?.video_views ?? 0;
const viewsBecome = async (id, n, timeout = 10000) =>
  (await settle((s) => (s.posts.find((p) => p.id === id)?.video_views ?? 0) >= n, timeout)).posts.find((p) => p.id === id)
    ?.video_views ?? 0;
const commentExists = (id) => store().comments.some((c) => c.id === id);
const commentId = (body) => store().comments.find((c) => c.body === body)?.id;

async function signUp(browser, email, handle, options = {}) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, ...options });
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

async function postVideo(actor, title, file) {
  const { page } = actor;
  await page.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Post a video', { timeout: 15000 });
  await page.locator('input[type=file]').setInputFiles({ name: file, mimeType: 'video/webm', buffer: readFileSync(`${FIXTURES}/${file}`) });
  await page.waitForSelector('#video-title', { timeout: 30000 });
  await page.fill('#video-title', title);
  await page.selectOption('#video-category', 'Gaming');
  await page.locator('button', { hasText: /^Post video$/ }).click();
  await page.waitForURL(/\/post\//, { timeout: 180000 });
  return page.url().split('/post/')[1].split(/[?#]/)[0];
}

async function postPhotoOrText(actor, caption, withPhoto) {
  const { page } = actor;
  await page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  if (withPhoto) {
    const jpeg = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 300;
      c.getContext('2d').fillRect(0, 0, 400, 300);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    });
    await page.locator('input[type=file]').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
    await page.waitForSelector('form img', { timeout: 20000 });
  }
  await page.fill('textarea[name=caption]', caption);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
  return page.url().split('/post/')[1].split(/[?#]/)[0];
}

async function comment(actor, postId, body, replyToBody = null) {
  const { page } = actor;
  await page.goto(`/post/${postId}`, { waitUntil: 'networkidle' });
  if (replyToBody) {
    const row = page.locator('li[data-comment-id]', { hasText: replyToBody }).first();
    await row.locator('button', { hasText: /^Reply$/ }).first().click();
    await row.locator('textarea[name=body]').fill(body);
    await row.locator('form button[type=submit]').click();
  } else {
    await page.locator('#comments textarea[name=body]').first().fill(body);
    await page.locator('#comments form button[type=submit]').first().click();
  }
  await settle((s) => s.comments.some((c) => c.body === body));
  return commentId(body);
}

/** On the post page: does this comment — not a reply under it — offer Delete? */
const offersDelete = (page, id) =>
  page.locator(`li[data-comment-id="${id}"] > div > div > [data-comment-delete]`).count();
const headerCount = async (page) => Number((await page.locator('[data-comment-count]').innerText()).trim());

async function run() {
  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`.slice(-7);
  const A = await signUp(browser, `va${stamp}@example.com`, `va${stamp}`);
  const C = await signUp(browser, `vc${stamp}@example.com`, `vc${stamp}`);
  const S = await signUp(browser, `vs${stamp}@example.com`, `vs${stamp}`);
  const errors = [];
  for (const actor of [A, C, S]) actor.page.on('pageerror', (e) => errors.push(`${actor.page.url()} ${e}`));

  const x1 = await postVideo(A, `long clip ${stamp}`, 'landscape.webm'); // 4s
  const x2 = await postVideo(A, `short clip ${stamp}`, 'portrait.webm'); // 3s

  /* ==================================================================== */
  section('VIEWS: ONE PER PLAYBACK SESSION');
  const page = C.page;
  await page.goto(`/videos?v=${x1}`, { waitUntil: 'domcontentloaded' });
  check('autoplay in the feed counts a view', (await viewsBecome(x1, 1)) === 1, String(viewsOf(x1)));
  await page.locator('section[data-index="0"] button[aria-label="Pause video"]').click();
  await wait(1500);
  check('pausing is not another view', viewsOf(x1) === 1);
  await page.locator('section[data-index="0"] button[aria-label="Play video"]').click();
  await wait(1200);
  check('nor is resuming the same viewing', viewsOf(x1) === 1);
  check('looping round to the start is watching it again', (await viewsBecome(x1, 2, 9000)) === 2, String(viewsOf(x1)));
  const shown = Number(await page.locator('section[data-index="0"] [data-video-views]').getAttribute('data-video-views'));
  check('the feed shows the count the server holds', shown === viewsOf(x1), `${shown} vs ${viewsOf(x1)}`);

  await page.locator('section[data-index="1"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  check('scrolling to the next video counts that one', (await viewsBecome(x2, 1)) === 1);
  const whileAway = viewsOf(x1);
  await wait(2000);
  check('the one scrolled away from stops counting', viewsOf(x1) === whileAway, `${whileAway} → ${viewsOf(x1)}`);
  await page.locator('section[data-index="0"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  check('scrolling back to it counts again', (await viewsBecome(x1, whileAway + 1)) === whileAway + 1, String(viewsOf(x1)));
  // Leave the feed before the loops add more: the next checks count exactly.
  await page.goto('/home', { waitUntil: 'domcontentloaded' });
  await wait(800);
  const beforeRefresh = viewsOf(x1);
  await page.goto(`/videos?v=${x1}`, { waitUntil: 'domcontentloaded' });
  check('opening it again (a refresh) counts again', (await viewsBecome(x1, beforeRefresh + 1)) === beforeRefresh + 1);
  await page.locator('section[data-index="0"] button[aria-label="Pause video"]').click();

  section('VIEWS: THE POST PAGE');
  await page.goto(`/post/${x1}`, { waitUntil: 'networkidle' });
  const opened = viewsOf(x1);
  await wait(2500);
  check('a player that only rendered counts nothing', viewsOf(x1) === opened);
  const player = page.locator('article video').first();
  await player.evaluate((v) => v.play());
  check('pressing play counts', (await viewsBecome(x1, opened + 1)) === opened + 1);
  await page.waitForFunction(() => document.querySelector('article video')?.ended === true, null, { timeout: 12000 }).catch(() => {});
  await wait(500);
  check('watching to the end is still one view', viewsOf(x1) === opened + 1);
  await player.evaluate((v) => v.play());
  check('playing it again after it ended is another', (await viewsBecome(x1, opened + 2)) === opened + 2);
  await player.evaluate((v) => v.pause());

  section('VIEWS: A REPORT THAT FAILS IS RETRIED, NOT DOUBLED');
  const beforeFailure = viewsOf(x2);
  let attempts = 0;
  await page.route('**/*', async (route) => {
    const request = route.request();
    // A view report: POST /api/v1/posts/<id>/views (see lib/video/view-reports.ts).
    if (request.method() === 'POST' && request.url().endsWith(`/api/v1/posts/${x2}/views`)) {
      attempts += 1;
      if (attempts === 1) {
        // The server counts it, and the answer is lost on the way back.
        await route.fetch().catch(() => undefined);
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await page.goto(`/videos?v=${x2}`, { waitUntil: 'domcontentloaded' });
  await viewsBecome(x2, beforeFailure + 1);
  // Paused, so the clip looping round — a real new view — cannot add to this.
  await page.locator('section[data-index="0"] button[aria-label="Pause video"]').click().catch(() => {});
  await wait(7000); // both retries' worth
  check('it was retried', attempts >= 2, `${attempts} reports`);
  check('and counted exactly once', viewsOf(x2) === beforeFailure + 1, `${beforeFailure} → ${viewsOf(x2)}`);
  await page.unroute('**/*');

  const visitor = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const vpage = await visitor.newPage();
  const beforeVisitor = viewsOf(x2);
  await vpage.goto(`/videos?v=${x2}`, { waitUntil: 'domcontentloaded' });
  check('a visitor who is not signed in counts too', (await viewsBecome(x2, beforeVisitor + 1)) === beforeVisitor + 1);
  await visitor.close();

  section('VIEWS: SHOWN EVERYWHERE, AND AFTER A REFRESH');
  for (const [device, options] of [
    ['phone', { ...devices['iPhone 13'] }],
    ['desktop', { viewport: { width: 1440, height: 900 } }],
  ]) {
    const context = await browser.newContext({ ...options, baseURL: BASE });
    const p = await context.newPage();
    const total = viewsOf(x1);
    for (const [where, url] of [['post page', `/post/${x1}`], ['profile', `/u/${A.handle}`]]) {
      await p.goto(url, { waitUntil: 'networkidle' });
      const badge = p.locator(`article:has(a[href="/post/${x1}"]) [data-video-views]`).first();
      const value = Number(await badge.getAttribute('data-video-views').catch(() => -1));
      check(`${device} ${where}: shows ${total} views, on screen`, value === total && (await badge.isVisible()), `${value}`);
    }
    await context.close();
  }

  /* ==================================================================== */
  section('COMMENTS: SETTING UP');
  const textPost = await postPhotoOrText(A, `a text post ${stamp}`, false);
  const photoPost = await postPhotoOrText(A, `a photo post ${stamp}`, true);
  const cText = await comment(C, textPost, `c on text ${stamp}`);
  const cPhoto = await comment(C, photoPost, `c on photo ${stamp}`);
  const cVideo = await comment(C, x1, `c on video ${stamp}`);
  const sText = await comment(S, textPost, `s on text ${stamp}`);
  const sPhoto = await comment(S, photoPost, `s on photo ${stamp}`);
  const sVideo = await comment(S, x1, `s on video ${stamp}`);
  const sReply1 = await comment(S, textPost, `s reply one ${stamp}`, `c on text ${stamp}`);
  const sReply2 = await comment(S, textPost, `s reply two ${stamp}`, `c on text ${stamp}`);
  const aVideo = await comment(A, x1, `owner on video ${stamp}`);
  check('every comment and reply is stored', [cText, cPhoto, cVideo, sText, sPhoto, sVideo, sReply1, sReply2, aVideo].every(Boolean));

  section('COMMENTS: THE AUTHOR, ON SOMEBODY ELSE’S POST');
  await S.page.goto(`/post/${textPost}`, { waitUntil: 'networkidle' });
  check('Delete is offered on their own comment and reply', (await offersDelete(S.page, sText)) === 1 && (await offersDelete(S.page, sReply1)) === 1);
  check('and not on anybody else’s', (await offersDelete(S.page, cText)) === 0);
  const sCountBefore = await headerCount(S.page);
  const captured = [];
  S.page.on('request', (request) => {
    const action = request.headers()['next-action'];
    if (action && request.method() === 'POST') captured.push({ action, url: request.url(), body: request.postData() ?? '' });
  });
  const replyRow = S.page.locator(`li[data-comment-id="${sReply1}"]`);
  await replyRow.locator('[data-comment-delete]').first().click();
  check('it asks first', await replyRow.locator('[data-comment-confirm-delete]').first().isVisible());
  await replyRow.locator('[data-comment-delete-confirm]').first().click();
  await S.page.locator(`li[data-comment-id="${sReply1}"]`).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  check('their reply is gone from the page at once, and the count with it', (await S.page.locator(`li[data-comment-id="${sReply1}"]`).count()) === 0 && (await headerCount(S.page)) === sCountBefore - 1);
  check('and from the database; the comment it answered stays', !commentExists(sReply1) && commentExists(cText));
  const deleteAction = captured.find((entry) => entry.body.includes(sReply1));

  section('COMMENTS: NOBODY ELSE, HOWEVER THEY ASK');
  check('captured the real delete request', Boolean(deleteAction?.action));
  const replay = (actorPage, id) =>
    actorPage.evaluate(
      async ({ action, url, id }) =>
        (await fetch(url, { method: 'POST', headers: { 'Next-Action': action, 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component' }, body: JSON.stringify([id]) })).status,
      { action: deleteAction.action, url: deleteAction.url, id },
    );
  await replay(S.page, cText);
  await replay(S.page, cPhoto);
  await wait(800);
  check('replayed with somebody else’s comment id, it deletes nothing', commentExists(cText) && commentExists(cPhoto));
  const outsider = await browser.newContext({ baseURL: BASE });
  const outsiderPage = await outsider.newPage();
  await outsiderPage.goto('/', { waitUntil: 'domcontentloaded' });
  await replay(outsiderPage, sText);
  await wait(800);
  check('nor signed out', commentExists(sText));
  await outsiderPage.goto(`/post/${textPost}`, { waitUntil: 'networkidle' });
  check('and nobody signed out is offered Delete', (await outsiderPage.locator('[data-comment-delete]').count()) === 0);
  await outsider.close();

  section('COMMENTS: THE POST’S OWNER');
  await A.page.goto(`/post/${photoPost}`, { waitUntil: 'networkidle' });
  check('is offered Delete on everybody’s comments on their photo', (await offersDelete(A.page, cPhoto)) === 1 && (await offersDelete(A.page, sPhoto)) === 1);
  const photoCount = await headerCount(A.page);
  const cRow = A.page.locator(`li[data-comment-id="${cPhoto}"]`);
  await cRow.locator('[data-comment-delete]').first().click();
  await cRow.locator('[data-comment-delete-confirm]').first().click();
  await A.page.locator(`li[data-comment-id="${cPhoto}"]`).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  check('deletes somebody else’s comment on their photo, at once', (await A.page.locator(`li[data-comment-id="${cPhoto}"]`).count()) === 0 && (await headerCount(A.page)) === photoCount - 1 && !commentExists(cPhoto));
  await A.page.reload({ waitUntil: 'networkidle' });
  check('still gone after a refresh, with the count to match', (await A.page.locator(`li[data-comment-id="${cPhoto}"]`).count()) === 0 && (await headerCount(A.page)) === photoCount - 1);
  const cardCount = await A.page.locator('article footer a[href$="#comments"]').first().innerText().catch(() => '');
  check('and the post’s own count agrees', cardCount.trim() === String(photoCount - 1), cardCount);

  await A.page.goto(`/post/${textPost}`, { waitUntil: 'networkidle' });
  const threadRow = A.page.locator(`li[data-comment-id="${cText}"]`);
  const textCount = await headerCount(A.page);
  await threadRow.locator('[data-comment-delete]').first().click();
  const prompt = await threadRow.locator('[data-comment-confirm-delete]').first().innerText();
  check('deleting a comment with a reply says the reply goes too', /and its reply/.test(prompt), prompt);
  await threadRow.locator('[data-comment-delete-confirm]').first().click();
  await A.page.locator(`li[data-comment-id="${cText}"]`).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  check('both are gone, and nothing is left replying to nothing', !commentExists(cText) && !commentExists(sReply2) && (await headerCount(A.page)) === textCount - 2, `${textCount} → ${await headerCount(A.page)}`);

  section('COMMENTS: IN THE VIDEOS FEED');
  await A.page.goto(`/videos?v=${x1}`, { waitUntil: 'domcontentloaded' });
  const slide = A.page.locator('section[data-index="0"]');
  await slide.locator('button[aria-label="Comments"]').click();
  await A.page.locator(`li[data-comment-id="${sVideo}"]`).waitFor({ timeout: 10000 });
  check('the owner is offered Delete on every comment on their video', (await A.page.locator(`li[data-comment-id] [data-comment-delete]`).count()) === 3);
  const slideCountBefore = Number((await slide.locator('button[aria-label="Comments"]').innerText()).trim());
  await A.page.locator(`li[data-comment-id="${sVideo}"] [data-comment-delete]`).click();
  await A.page.locator(`li[data-comment-id="${sVideo}"] [data-comment-delete-confirm]`).click();
  await A.page.locator(`li[data-comment-id="${sVideo}"]`).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  const slideCountAfter = Number((await slide.locator('button[aria-label="Comments"]').innerText()).trim());
  check('deletes it from the sheet at once', (await A.page.locator(`li[data-comment-id="${sVideo}"]`).count()) === 0 && !commentExists(sVideo));
  check('and the video’s comment count goes down with it', slideCountAfter === slideCountBefore - 1, `${slideCountBefore} → ${slideCountAfter}`);

  for (const [device, options] of [
    ['phone', { ...devices['iPhone 13'] }],
    ['desktop', { viewport: { width: 1440, height: 900 } }],
  ]) {
    const context = await browser.newContext({ ...options, baseURL: BASE, storageState: await C.context.storageState() });
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(`${p.url()} ${e}`));
    await p.goto(`/videos?v=${x1}`, { waitUntil: 'domcontentloaded' });
    await p.locator('section[data-index="0"] button[aria-label="Comments"]').click();
    await p.locator(`li[data-comment-id="${aVideo}"]`).waitFor({ timeout: 10000 });
    check(`${device}: in the sheet, a commenter is offered Delete only on their own`, (await p.locator(`li[data-comment-id="${cVideo}"] [data-comment-delete]`).count()) === 1 && (await p.locator(`li[data-comment-id="${aVideo}"] [data-comment-delete]`).count()) === 0);
    const box = await p.locator(`li[data-comment-id="${cVideo}"] [data-comment-delete]`).boundingBox();
    const width = await p.evaluate(() => window.innerWidth);
    check(`${device}: the Delete button is on screen and big enough to tap`, Boolean(box) && box.x >= 0 && box.x + box.width <= width && box.height >= 24, JSON.stringify(box));
    await context.close();
  }

  section('COMMENTS: WHEN DELETING FAILS');
  await C.page.goto(`/post/${x1}`, { waitUntil: 'networkidle' });
  await C.page.route('**/*', (route) =>
    route.request().method() === 'POST' && route.request().headers()['next-action'] ? route.abort('failed') : route.continue(),
  );
  const failRow = C.page.locator(`li[data-comment-id="${cVideo}"]`);
  await failRow.locator('[data-comment-delete]').first().click();
  await failRow.locator('[data-comment-delete-confirm]').first().click();
  await C.page.waitForTimeout(1500);
  check('it says so, and the comment stays', /could not be deleted/i.test(await C.page.locator('#comments').innerText()) && (await failRow.count()) === 1 && commentExists(cVideo));
  await C.page.unroute('**/*');
  await failRow.locator('[data-comment-delete]').first().click();
  await failRow.locator('[data-comment-delete-confirm]').first().click();
  await C.page.locator(`li[data-comment-id="${cVideo}"]`).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  check('and trying again works', !commentExists(cVideo));

  const real = errors.filter((e) => !/Minified React error #418/.test(e));
  check('no page errors', real.length === 0, real[0] ?? '');
  await browser.close();
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
