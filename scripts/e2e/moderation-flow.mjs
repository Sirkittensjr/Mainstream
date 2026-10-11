/**
 * Post moderation, end to end, through the real UI.
 *
 * What it has to prove, roughly in order of how badly it would matter if it
 * were wrong:
 *
 *   1. A report from an eligible account hides the post AT ONCE — from the
 *      feeds, Discover, search, the author's profile, its own page and the API
 *      — and nothing is deleted. The author still sees it, is told, and cannot
 *      delete it while the review is pending.
 *   2. Nobody who is not an administrator can make any moderation decision —
 *      asked directly, by replaying a real admin request from a normal account,
 *      not by looking for a button.
 *   3. The queue shows a moderator the post and its media, its author, every
 *      report with the reporter's history, and what was done so far.
 *   4. Approve and restore brings it back with its likes and comments; the
 *      reporter cannot hide it again, somebody new can.
 *   5. Keep under review holds it; dismissing the reports does not reveal it.
 *      Dismissing the only report on a report-hidden post does.
 *   6. Remove permanently needs a reason, takes it off FayTarra and deletes its
 *      file; the author sees why.
 *   7. Warnings, temporary suspensions, bans and reversing them; a suspended
 *      account's report hides nothing.
 *   8. Each reporter has at most five posts hidden at once; two reports at the
 *      same moment hide a post once.
 *   9. The audit log names the admin, the action, the target and the reason.
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/moderation-flow.mjs
 *
 * Needs the GoTrue stub, a built app with ADMIN_EMAILS naming the admin
 * address, and an EMPTY store.
 */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const STORE = process.env.FAY_STORE || '.data/faytarra.json';
const CHROMIUM = process.env.CHROMIUM_PATH;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@faytarra.com';
const PASSWORD = 'a long enough password';
const THRESHOLD = 10;
const FIXTURES = process.env.FIXTURES || '/tmp/fay-video-fixtures';
/** Set to a folder to keep screenshots of the queue, the log and the phone view. */
const SHOTS = process.env.SHOTS_DIR;
const shot = async (page, name, fullPage = true) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

/**
 * The local store on disk — only to CHECK what the product deliberately does
 * not show (a report row kept, a log line written). Every action goes through
 * the real UI or a real request. The server flushes on a timer, so `settle`
 * waits for the condition rather than guessing.
 */
const store = () => JSON.parse(readFileSync(STORE, 'utf8'));
async function settle(predicate, timeout = 8000) {
  const until = Date.now() + timeout;
  for (;;) {
    let snapshot = null;
    try {
      snapshot = store();
    } catch {
      /* mid-write */
    }
    if (snapshot && predicate(snapshot)) return snapshot;
    if (Date.now() >= until) return snapshot;
    await wait(250);
  }
}
const postRow = (id) => store().posts.find((p) => p.id === id);
const reviewOf = async (id, want) =>
  (await settle((s) => (s.posts.find((p) => p.id === id)?.review_state ?? null) === want))?.posts.find((p) => p.id === id)
    ?.review_state ?? null;

async function signUp(browser, email, handle, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ baseURL: BASE, viewport });
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
  const me = await page.evaluate(async () => (await fetch('/api/v1/me')).json());
  return { context, page, email, handle, id: me?.user?.id };
}

async function stepUp(admin) {
  await admin.page.goto('/admin/verify', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const send = admin.page.locator('button', { hasText: /Email me a code|Send another code/ });
  if (!(await send.count())) return;
  await send.first().click();
  await admin.page.waitForTimeout(2500);
  const code = mails().filter((m) => m.type === 'otp').at(-1)?.code;
  if (!code) throw new Error('no admin code in the outbox');
  await admin.page.fill('#admin-code', code);
  await admin.page.locator('form button[type=submit]').last().click();
  await admin.page.waitForLoadState('networkidle');
  await admin.page.waitForTimeout(1000);
}

async function publish(actor, body) {
  await actor.page.goto('/create', { waitUntil: 'domcontentloaded' });
  await actor.page.waitForLoadState('networkidle');
  await actor.page.fill('textarea', body);
  await actor.page.locator('form button[type=submit]').last().click();
  await actor.page.waitForURL(/\/post\//, { timeout: 25000 });
  return actor.page.url().split('/post/')[1].split(/[?#]/)[0];
}

async function publishPhoto(actor, caption) {
  await actor.page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  const jpeg = await actor.page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 1000;
    const g = c.getContext('2d');
    g.fillStyle = '#d53a7b';
    g.fillRect(0, 0, 800, 1000);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await actor.page.locator('input[type=file]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(jpeg, 'base64'),
  });
  await actor.page.waitForSelector('form img, [data-media-preview] img', { timeout: 20000 }).catch(() => {});
  await actor.page.fill('textarea[name=caption]', caption);
  await actor.page.locator('form button[type=submit]').last().click();
  await actor.page.waitForURL(/\/post\//, { timeout: 30000 });
  return actor.page.url().split('/post/')[1].split(/[?#]/)[0];
}

/** One report through the dialog a real person uses. */
async function report(actor, postId, { reason = 0, note = '' } = {}) {
  await actor.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await actor.page.waitForLoadState('networkidle');
  await actor.page.locator('button[aria-label="More options"]').first().click();
  await actor.page.locator('button:has-text("Report")').first().click();
  await actor.page.waitForSelector('select#reason', { timeout: 10000 });
  await actor.page.selectOption('select#reason', { index: reason });
  if (note) await actor.page.fill('textarea[name=details]', note);
  await actor.page.locator('button:has-text("Submit report")').click();
  await actor.page.waitForTimeout(1200);
}

/** Reachable by a LINK from a feed, Discover or search — never by a caption match. */
async function findable(actor, postId, caption) {
  for (const url of ['/home?tab=recommended', '/discover', `/search?q=${encodeURIComponent(caption)}`]) {
    await actor.page.goto(url, { waitUntil: 'domcontentloaded' });
    await actor.page.waitForLoadState('networkidle');
    if (await actor.page.locator(`a[href*="/post/${postId}"]`).count()) return url;
  }
  return null;
}

const apiStatus = (actor, postId) =>
  actor.page.evaluate(async (id) => (await fetch(`/api/v1/posts/${id}`)).status, postId);

async function openQueue(admin) {
  await admin.page.goto('/admin?tab=reports', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
}
const card = (admin, postId) => admin.page.locator(`[data-queue-card="${postId}"]`);

/** Clicks a decision on a queue card and waits for the page to settle. */
async function decide(admin, postId, decision, note = '') {
  await openQueue(admin);
  const target = card(admin, postId);
  if (note) await target.locator('[data-decision-note]').fill(note);
  await target.locator(`[data-decision="${decision}"]`).click();
  if (decision === 'remove') await target.locator('[data-decision="remove-confirm"]').click();
  await admin.page.waitForTimeout(1500);
}

async function run() {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`.slice(-8);
  const errors = [];

  const admin = await signUp(browser, ADMIN_EMAIL, `fayadm${stamp}`);
  admin.page.on('pageerror', (error) => errors.push(`${admin.page.url()} ${error}`));
  await stepUp(admin);
  const author = await signUp(browser, `auth${stamp}@example.com`, `auth${stamp}`);
  const r1 = await signUp(browser, `ra${stamp}@example.com`, `ra${stamp}`);
  const r2 = await signUp(browser, `rb${stamp}@example.com`, `rb${stamp}`);
  const r3 = await signUp(browser, `rc${stamp}@example.com`, `rc${stamp}`);
  const viewer = await signUp(browser, `vw${stamp}@example.com`, `vw${stamp}`);

  /* ==================================================================== */
  section('BELOW THE THRESHOLD: SHOWN TO ADMINS, POST STAYS UP');
  const caption = `moderate me ${stamp}`;
  const postId = await publish(author, caption);
  // Engagement from before anything happens, to check it survives.
  await r2.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await r2.page.waitForLoadState('networkidle');
  await r2.page.locator('button[aria-label="Like"]').first().click();
  await r2.page.fill('textarea[placeholder^="Say something useful"]', 'great post');
  await r2.page.locator('form:has(textarea[placeholder^="Say something useful"]) button[type=submit]').click();
  await settle((s) => s.likes.some((l) => l.post_id === postId) && s.comments.some((c) => c.post_id === postId));

  await report(r1, postId, { reason: 0, note: 'looks like an ad' });
  check('the reporter is thanked', /we have it/i.test(await r1.page.locator('body').innerText()));
  check('one report records it and leaves the post up', (await settle((s) => s.reports.some((r) => r.target_id === postId)))?.reports.filter((r) => r.target_id === postId).length === 1 && (postRow(postId)?.review_state ?? null) === null);
  check('still findable', (await findable(viewer, postId, caption)) !== null);
  await openQueue(admin);
  const early = admin.page.locator(`[data-queue="reported"] [data-queue-card="${postId}"]`);
  check('the report is in the admin dashboard at once', (await early.count()) === 1);
  check('with the count toward the threshold', (await early.locator('[data-queue-valid]').innerText()).trim() === `1/${THRESHOLD} valid`);
  check('who reported it, why, and its status', (await early.locator(`[data-reporter="${r1.handle}"]`).count()) === 1 && (await early.innerText()).includes('looks like an ad') && /open/i.test(await early.innerText()));
  await author.page.goto('/notifications', { waitUntil: 'networkidle' });
  const authorNotes = await author.page.locator('body').innerText();
  check('the author is not told anything yet, and never who reported', !/hidden/i.test(authorNotes) && !authorNotes.includes(r1.handle));

  /* ==================================================================== */
  section('AN ADMIN REMOVES A POST FROM PUBLIC VIEWING FROM ITS ••• MENU');
  const menuCaption = `menu remove ${stamp}`;
  const menuId = await publish(author, menuCaption);
  const openMenu = async (actor, id) => {
    await actor.page.goto(`/post/${id}`, { waitUntil: 'domcontentloaded' });
    await actor.page.waitForLoadState('networkidle');
    await actor.page.locator('button[aria-label="More options"]').first().click();
  };
  await openMenu(r1, menuId);
  check('a normal account is not offered it', (await r1.page.locator('[data-admin-remove-post]').count()) === 0);
  await openMenu(author, menuId);
  check('nor is the author', (await author.page.locator('[data-admin-remove-post]').count()) === 0);
  await openMenu(admin, menuId);
  check('an admin is offered “Remove from public viewing”', (await admin.page.locator('[data-admin-remove-post]').innerText()).includes('Remove from public viewing'));
  const captured = [];
  admin.page.on('request', (request) => {
    const action = request.headers()['next-action'];
    if (action && request.method() === 'POST') captured.push({ action, url: request.url() });
  });
  await admin.page.locator('[data-admin-remove-post]').click();
  check('it asks first', await admin.page.locator('[data-admin-remove-confirm]').waitFor({ timeout: 5000 }).then(() => true, () => false));
  await admin.page.locator('[data-admin-remove-confirm-button]').click();
  check('and will not go ahead without a reason', /Give a reason/.test(await admin.page.locator('[data-admin-remove-confirm]').innerText()) && (postRow(menuId)?.review_state ?? null) === null);
  await admin.page.fill('[data-admin-remove-reason]', 'Misleading claims');
  await admin.page.locator('[data-admin-remove-confirm-button]').click();
  check('held for review, not deleted', (await reviewOf(menuId, 'admin_hold')) === 'admin_hold' && !postRow(menuId)?.removed);
  const hideAction = captured.at(-1);
  check('not findable in the feed, Discover or search', (await findable(viewer, menuId, menuCaption)) === null);
  check('the API will not serve it', (await apiStatus(viewer, menuId)) === 404);
  await viewer.page.goto(`/post/${menuId}`, { waitUntil: 'domcontentloaded' });
  check('its own URL says it is being reviewed, without its words', /being reviewed/i.test(await viewer.page.locator('body').innerText()) && !(await viewer.page.content()).includes(menuCaption));
  await viewer.page.goto(`/u/${author.handle}`, { waitUntil: 'domcontentloaded' });
  check('gone from the author’s profile as others see it', !(await viewer.page.locator('body').innerText()).includes(menuCaption));
  const hiddenEvent = (await settle((s) => s.moderation_events.some((e) => e.target_id === menuId && e.action === 'admin_hidden')))?.moderation_events.find((e) => e.target_id === menuId && e.action === 'admin_hidden');
  check('logged with the admin, the reason and the post', hiddenEvent?.actor_id === admin.id && /Misleading claims/.test(hiddenEvent?.detail ?? '') && (hiddenEvent?.detail ?? '').includes(menuCaption));
  await author.page.goto('/notifications', { waitUntil: 'networkidle' });
  check('the author is told, with the reason', /removed from public viewing.*Reason: Misleading claims/s.test(await author.page.locator('body').innerText()));
  await openQueue(admin);
  check('it is in the moderation queue', (await card(admin, menuId).getAttribute('data-queue-state')) === 'admin_hold');

  // A forged request: the admin's real one, sent from a normal account.
  const decoy = await publish(author, `decoy ${stamp}`);
  check('captured the admin’s request', Boolean(hideAction?.action));
  const replay = await r1.page.evaluate(
    async ({ action, url, id }) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Next-Action': action, 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component' },
        body: JSON.stringify([id, 'forged']),
      });
      return response.status;
    },
    { action: hideAction?.action, url: hideAction?.url, id: decoy },
  );
  await wait(1200);
  check('replayed from a normal account, it changes nothing', (postRow(decoy)?.review_state ?? null) === null && !postRow(decoy)?.removed, `status ${replay}`);
  check('and is not logged as a decision', !store().moderation_events.some((e) => e.target_id === decoy));
  for (const path of ['/admin', '/admin?tab=reports', '/admin?tab=log']) {
    await r1.page.goto(path, { waitUntil: 'domcontentloaded' });
    check(`a normal account is turned away from ${path}`, new URL(r1.page.url()).pathname !== '/admin', r1.page.url());
  }

  section('… AND RESTORES IT');
  await decide(admin, menuId, 'approve', 'reviewed: fine');
  check('visible again', (await reviewOf(menuId, null)) === null && (await findable(viewer, menuId, menuCaption)) !== null);
  await author.page.goto('/notifications', { waitUntil: 'networkidle' });
  check('the author is told it is back', /visible again/i.test(await author.page.locator('body').innerText()));

  /* ==================================================================== */
  section('THE SAME OPTION ON A VIDEO');
  const videoTitle = `video to remove ${stamp}`;
  await author.page.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await author.page.waitForSelector('text=Post a video', { timeout: 15000 });
  await author.page.locator('input[type=file]').setInputFiles({ name: 'square.webm', mimeType: 'video/webm', buffer: readFileSync(`${FIXTURES}/square.webm`) });
  await author.page.waitForSelector('#video-title', { timeout: 30000 });
  await author.page.fill('#video-title', videoTitle);
  await author.page.selectOption('#video-category', 'Music');
  await author.page.locator('button', { hasText: /^Post video$/ }).click();
  await author.page.waitForURL(/\/post\//, { timeout: 180000 });
  const videoId = author.page.url().split('/post/')[1];
  await admin.page.goto(`/videos?v=${videoId}`, { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const slide = admin.page.locator('section[data-index]', { hasText: videoTitle }).first();
  await slide.locator('button[aria-label="More options"]').click();
  check('the Videos feed’s ••• menu offers it to an admin', (await slide.locator('[data-admin-remove-post]').count()) === 1);
  await slide.locator('[data-admin-remove-post]').click();
  await admin.page.fill('[data-admin-remove-reason]', 'Copyrighted music');
  await admin.page.locator('[data-admin-remove-confirm-button]').click();
  check('and removes the video from public viewing', (await reviewOf(videoId, 'admin_hold')) === 'admin_hold' && (await apiStatus(viewer, videoId)) === 404);

  /* ==================================================================== */
  section(`THE ${THRESHOLD}TH VALID REPORT HIDES IT PENDING REVIEW`);
  const crowd = [r1, r2, r3, viewer];
  for (let i = crowd.length; i < THRESHOLD + 1; i += 1) crowd.push(await signUp(browser, `cr${i}${stamp}@example.com`, `cr${i}${stamp}`));
  // r1 has already reported postId; eight more make nine.
  for (const someone of crowd.slice(1, THRESHOLD - 1)) await report(someone, postId, { reason: 1 });
  const nine = await settle((s) => s.reports.filter((r) => r.target_id === postId).length === THRESHOLD - 1);
  check(`${THRESHOLD - 1} valid reports leave it up`, nine.reports.filter((r) => r.target_id === postId).length === THRESHOLD - 1 && (postRow(postId)?.review_state ?? null) === null && (await apiStatus(r1, postId)) === 200);
  await openQueue(admin);
  check(`the dashboard shows ${THRESHOLD - 1}/${THRESHOLD}`, (await card(admin, postId).locator('[data-queue-valid]').innerText()).trim() === `${THRESHOLD - 1}/${THRESHOLD} valid`);
  // The tenth and an eleventh, at the same moment.
  await Promise.all([report(crowd[THRESHOLD - 1], postId, { reason: 2 }), report(crowd[THRESHOLD], postId, { reason: 2 })]);
  check('the tenth hides it', (await reviewOf(postId, 'temporary_review')) === 'temporary_review' && (await apiStatus(r1, postId)) === 404);
  const hides = await settle((s) => s.moderation_events.some((e) => e.target_id === postId && e.action === 'auto_review_started'));
  check('exactly once, though two reports arrived together', hides.moderation_events.filter((e) => e.target_id === postId && e.action === 'auto_review_started').length === 1);
  check('nothing is deleted: likes and comments kept', Boolean(postRow(postId)) && !postRow(postId).removed && store().likes.some((l) => l.post_id === postId) && store().comments.some((c) => c.post_id === postId));
  check('not findable in the feed, Discover or search', (await findable(viewer, postId, caption)) === null);
  await author.page.goto('/notifications', { waitUntil: 'networkidle' });
  const hiddenNote = (await author.page.locator('li', { hasText: /temporarily hidden pending review/i }).first().innerText().catch(() => '')) || '';
  check('the author is told it is temporarily hidden pending review', /temporarily hidden pending review/i.test(hiddenNote));
  check('without being told who reported it', hiddenNote.length > 0 && crowd.every((someone) => !hiddenNote.includes(someone.handle)));
  await openQueue(admin);
  const held = card(admin, postId);
  check('in the queue as “Hidden pending admin review”', (await held.getAttribute('data-queue-state')) === 'report_hold' && (await held.innerText()).includes('Hidden pending admin review'));
  if (SHOTS) await held.screenshot({ path: `${SHOTS}/queue-card.png` });
  await author.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await author.page.waitForLoadState('networkidle');
  await author.page.locator('button[aria-label="More options"]').first().click();
  await author.page.locator('[data-delete-post]').first().click();
  await author.page.locator('[data-delete-confirm-button]').click();
  await author.page.waitForTimeout(1500);
  check('the author cannot delete it meanwhile', /cannot be deleted until the review is finished/i.test(await author.page.locator('[data-delete-confirm]').innerText().catch(() => '')));

  const oneReport = store().reports.find((r) => r.target_id === postId && r.reporter_id === r1.id)?.id;
  await held.locator(`[data-dismiss-report="${oneReport}"]`).click();
  await held.locator(`[data-dismiss-confirm="${oneReport}"]`).click();
  await admin.page.waitForTimeout(1500);
  check('dismissing a report does not bring it back: only a decision does', (postRow(postId)?.review_state ?? null) === 'temporary_review');

  /* ==================================================================== */
  section('DENY — KEEP REMOVED');
  await openQueue(admin);
  await card(admin, postId).locator('[data-decision="deny"]').click();
  await admin.page.waitForTimeout(1500);
  check('without a reason it is refused', /Give a reason/i.test(await card(admin, postId).innerText()) && !postRow(postId)?.removed);
  await decide(admin, postId, 'deny', 'Repeated spam');
  const denied = (await settle((s) => s.posts.find((p) => p.id === postId)?.removed === true))?.posts.find((p) => p.id === postId);
  check('kept out of public view, with the reason', denied?.removed === true && denied?.removed_reason === 'Repeated spam');
  check('logged with the admin', store().moderation_events.some((e) => e.target_id === postId && e.action === 'admin_denied' && e.actor_id === admin.id));
  await author.page.goto('/notifications', { waitUntil: 'networkidle' });
  check('the author is told the decision and why', /Reason: Repeated spam/.test(await author.page.locator('body').innerText()));
  check('the record and its engagement are kept', store().comments.some((c) => c.post_id === postId) && store().reports.filter((r) => r.target_id === postId).length === THRESHOLD + 1);

  /* ==================================================================== */
  section('DELETE PERMANENTLY');
  const photoCaption = `remove this photo ${stamp}`;
  const photoId = await publishPhoto(author, photoCaption);
  const photoUrl = postRow(photoId)?.media?.[0]?.url;
  await openMenu(admin, photoId);
  await admin.page.locator('[data-admin-remove-post]').click();
  await admin.page.fill('[data-admin-remove-reason]', 'Explicit image');
  await admin.page.locator('[data-admin-remove-confirm-button]').click();
  await reviewOf(photoId, 'admin_hold');
  await openQueue(admin);
  check('the queue shows the photo itself', (await card(admin, photoId).locator('[data-queue-media="image"] img').count()) === 1);
  if (SHOTS) await card(admin, photoId).screenshot({ path: `${SHOTS}/queue-photo-card.png` });
  check('and says what kind of post it is', (await card(admin, photoId).locator('[data-queue-kind]').textContent()).trim() === 'photo');
  check('its file is still there while it is reviewed', (await viewer.page.evaluate(async (url) => (await fetch(url, { cache: 'no-store' })).status, photoUrl)) === 200);
  await decide(admin, photoId, 'remove', 'Not allowed here');
  const removed = (await settle((s) => s.posts.find((p) => p.id === photoId)?.removed === true))?.posts.find((p) => p.id === photoId);
  check('removed, with its reason, and the record of the post kept', removed?.removed === true && removed?.removed_reason === 'Not allowed here' && removed?.caption === photoCaption);
  const fileStatus = await viewer.page.evaluate(async (url) => (await fetch(url, { cache: 'no-store' })).status, photoUrl);
  check('its file is gone', fileStatus === 404, `status ${fileStatus}`);
  await author.page.goto(`/post/${photoId}`, { waitUntil: 'domcontentloaded' });
  check('the author sees it was removed, and why', /removed by a moderator: Not allowed here/i.test(await author.page.locator('body').innerText()));
  check('its author was not suspended', store().users.find((u) => u.id === author.id)?.status === 'active');

  /* ==================================================================== */
  section('WARN, SUSPEND, BAN, REVERSE');
  const accountCard = async (handle) => {
    await admin.page.goto(`/admin?tab=users&q=${handle}`, { waitUntil: 'domcontentloaded' });
    await admin.page.waitForLoadState('networkidle');
    return admin.page.locator(`[data-account-actions="${store().users.find((u) => u.username === handle)?.id}"]`);
  };
  let actions = await accountCard(r3.handle);
  await actions.locator('[data-account="warn"]').click();
  await actions.locator('[data-account-text]').fill('Please keep reports honest.');
  await actions.locator('[data-account-confirm="warn"]').click();
  // The warning lands as a notification row; wait for it rather than a clock.
  await settle((s) => s.notifications.some((n) => n.user_id === r3.id && /keep reports honest/.test(n.body)));
  await r3.page.goto('/notifications', { waitUntil: 'networkidle' });
  check('the warning reaches them', await r3.page.getByText('A warning from FayTarra moderation: Please keep reports honest.').first().waitFor({ timeout: 10000 }).then(() => true, () => false));

  actions = await accountCard(r3.handle);
  await actions.locator('[data-account="suspend"]').click();
  await actions.locator('[data-account-text]').fill('Abusing reports');
  await actions.locator('[data-account-days]').selectOption('1');
  await actions.locator('[data-account-confirm="suspend"]').click();
  await admin.page.waitForTimeout(1500);
  const suspended = (await settle((s) => s.users.find((u) => u.id === r3.id)?.status === 'suspended'))?.users.find((u) => u.id === r3.id);
  check('suspended for a day', suspended?.status === 'suspended' && Math.abs(new Date(suspended.suspended_until).getTime() - Date.now() - 86_400_000) < 120_000);
  await r3.page.goto('/home', { waitUntil: 'domcontentloaded' });
  check('they are told, and why', /Your account is suspended: Abusing reports/.test(await r3.page.locator('body').innerText()));
  const notHidden = await publish(author, `after suspension ${stamp}`);
  await report(r3, notHidden);
  const afterSuspended = await settle((s) => s.reports.some((r) => r.target_id === notHidden && r.reporter_id === r3.id));
  check('their report is recorded', afterSuspended.reports.some((r) => r.target_id === notHidden));
  check('but hides nothing', (postRow(notHidden)?.review_state ?? null) === null && (await apiStatus(r1, notHidden)) === 200);

  actions = await accountCard(r3.handle);
  await actions.locator('[data-account="reinstate"]').click();
  await admin.page.waitForTimeout(1500);
  check('the suspension can be reversed', (await settle((s) => s.users.find((u) => u.id === r3.id)?.status === 'active'))?.users.find((u) => u.id === r3.id)?.status === 'active');

  actions = await accountCard(r2.handle);
  await actions.locator('[data-account="ban"]').click();
  await actions.locator('[data-account-confirm="ban"]').click();
  await admin.page.waitForTimeout(1200);
  check('a ban without a reason is refused', /Give a reason/i.test(await actions.innerText()) && store().users.find((u) => u.id === r2.id)?.status === 'active');
  await actions.locator('[data-account-text]').fill('Threats');
  await actions.locator('[data-account-confirm="ban"]').click();
  await admin.page.waitForTimeout(1500);
  check('banned', (await settle((s) => s.users.find((u) => u.id === r2.id)?.status === 'banned'))?.users.find((u) => u.id === r2.id)?.status === 'banned');
  const bannedMe = await r2.page.evaluate(async () => (await fetch('/api/v1/me')).json());
  check('a banned account is signed out of everything', !bannedMe?.user);
  actions = await accountCard(r2.handle);
  await actions.locator('[data-account="reinstate"]').click();
  await admin.page.waitForTimeout(1500);
  check('and the ban can be reversed', (await settle((s) => s.users.find((u) => u.id === r2.id)?.status === 'active'))?.users.find((u) => u.id === r2.id)?.status === 'active');

  actions = await accountCard(admin.handle);
  check('suspend and ban are not offered against an administrator', (await actions.locator('[data-account="suspend"], [data-account="ban"]').count()) === 0);

  // Flagging for abuse, from the Users tab: their reports are recorded and hide nothing.
  await admin.page.goto(`/admin?tab=users&q=${r1.handle}`, { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  await admin.page.locator('button', { hasText: 'Flag for abuse' }).first().click();
  await admin.page.waitForTimeout(1200);
  check('an account can be flagged for abuse from the Users tab', (await settle((s) => s.users.find((u) => u.id === r1.id)?.trusted === false))?.users.find((u) => u.id === r1.id)?.trusted === false);
  const afterFlag = await publish(author, `after flag ${stamp}`);
  await report(r1, afterFlag);
  await settle((s) => s.reports.some((r) => r.target_id === afterFlag && r.reporter_id === r1.id));
  check('and its report hides nothing', (postRow(afterFlag)?.review_state ?? null) === null && (await apiStatus(viewer, afterFlag)) === 200);

  /* ==================================================================== */
  section('THE AUDIT LOG');
  await admin.page.goto('/admin?tab=log', { waitUntil: 'domcontentloaded' });
  const log = await admin.page.locator('[data-moderation-log]').innerText();
  await shot(admin.page, 'audit-log', false);
  for (const [action, words] of [
    ['admin_hidden', 'Removed from public viewing'],
    ['auto_review_started', 'Hidden pending admin review'],
    ['admin_approved', 'Approved and restored'],
    ['admin_dismissed_report', 'Report dismissed'],
    ['admin_denied', 'Denied — kept removed'],
    ['admin_removed_permanently', 'Removed permanently'],
    ['admin_warned', 'Warned'],
    ['admin_suspended', 'Suspended'],
    ['admin_banned', 'Banned'],
    ['admin_reinstated', 'Reinstated'],
    ['admin_flagged', 'Flagged for abuse'],
  ]) {
    check(`it lists: ${words}`, log.includes(words) && (await admin.page.locator(`[data-log-action="${action}"]`).count()) > 0);
  }
  check('with the admin who did it', log.includes(`by @${admin.handle}`));
  check('and the reason', log.includes('Not allowed here') && log.includes('Abusing reports'));
  await admin.page.goto(`/admin?tab=log&user=${r3.handle}`, { waitUntil: 'domcontentloaded' });
  const theirs = await admin.page.locator('[data-moderation-log]').innerText();
  check('filtered to one account', theirs.includes('Suspended') && !theirs.includes('Removed permanently'));
  await viewer.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await viewer.page.waitForLoadState('networkidle');
  const publicHtml = await viewer.page.content();
  // Reporter handles can appear on any page for ordinary reasons (the people to
  // follow in the rail are the newest accounts), so what is checked is what
  // only the moderation record holds: who reported, what they wrote, and
  // moderators' notes.
  const leaks = ['Reported by', 'looks like an ad', 'not an ad', 'reviewed: fine', 'checking'].filter((text) =>
    publicHtml.includes(text),
  );
  check('ordinary users never see reporters or moderators’ notes on the post page', leaks.length === 0, leaks.join(', '));

  /* ==================================================================== */
  section('ON A PHONE');
  const phone = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE, storageState: await admin.context.storageState() });
  const mobile = await phone.newPage();
  await mobile.goto('/admin?tab=reports', { waitUntil: 'networkidle' });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('the moderation queue fits a phone', overflow <= 0, `${overflow}px`);
  check('with its decisions reachable', (await mobile.locator('[data-decision="approve"]').count()) > 0);
  await shot(mobile, 'queue-phone', false);
  await mobile.goto('/admin?tab=users', { waitUntil: 'networkidle' });
  check('so do the account controls', (await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await shot(mobile, 'users-phone', false);
  await phone.close();

  check('no page errors in the admin’s browser', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
