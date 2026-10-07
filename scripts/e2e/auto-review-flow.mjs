/**
 * The automatic ten-report temporary review.
 *
 * What this has to prove, in rough order of how badly it would matter if it
 * were wrong:
 *
 *   1. Ten DIFFERENT accounts hide a post. One account cannot, however many
 *      times it reports.
 *   2. Nobody who is not an administrator can undo, redo, count or clear any
 *      of it — asked directly, not by looking for a button.
 *   3. The author is told, and is told it is temporary.
 *   4. It is temporary. The 24 hours expiring brings the post back without a
 *      human and without a scheduler.
 *   5. Nothing is deleted. Clearing the threshold leaves the reports and the
 *      history intact.
 *   6. Nobody learns who reported them.
 *
 *   node scripts/e2e/auto-review-flow.mjs
 *
 * Needs the same setup as the other admin suites: the GoTrue stub, a built
 * app, ADMIN_EMAILS naming the admin address, and Playwright.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const STORE = process.env.FAY_STORE || '.data/faytarra.json';
const CHROMIUM = process.env.CHROMIUM_PATH;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@faytarra.com';
const PASSWORD = 'a long enough password';
const THRESHOLD = 10;

/**
 * The window the APP is running with, which the harness must be told so it can
 * check the right wording and wait the right length of time. Set
 * FAY_REVIEW_WINDOW_MINUTES to the same value for both, or the expiry section
 * will sit there for a day.
 */
const WINDOW_MINUTES = Number(process.env.FAY_REVIEW_WINDOW_MINUTES) || 24 * 60;
const WINDOW_WORDS =
  WINDOW_MINUTES >= 60
    ? `${Math.round(WINDOW_MINUTES / 60)} hour${Math.round(WINDOW_MINUTES / 60) === 1 ? '' : 's'}`
    : `${WINDOW_MINUTES} minute${WINDOW_MINUTES === 1 ? '' : 's'}`;
/** Long enough to sit through the window, when it is short enough to sit through. */
const CAN_WATCH_EXPIRY = WINDOW_MINUTES <= 5;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const mails = () =>
  readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const confirmationLink = (email) =>
  [...mails()].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;

/**
 * Reads the local JSON store from disk.
 *
 * Only ever to CHECK things the product deliberately does not show: that a
 * report row is still there after being cleared, that `cleared_at` was set
 * rather than the row deleted, that the moderation log has a line per
 * decision, that a count was not something the browser sent. Nothing in this
 * suite makes the product DO anything by writing here — every action goes
 * through the real UI or a real HTTP request.
 *
 * The running server holds the store in memory and flushes it on a timer, so a
 * read straight after an action can be a beat behind. `settle()` waits for the
 * flush rather than guessing.
 */
function store() {
  return JSON.parse(readFileSync(STORE, 'utf8'));
}

/** Waits for the server's next flush to land on disk. */
async function settle(predicate, timeout = 8000) {
  const until = Date.now() + timeout;
  for (;;) {
    let snapshot;
    try {
      snapshot = store();
    } catch {
      snapshot = null;
    }
    if (snapshot && predicate(snapshot)) return snapshot;
    if (Date.now() >= until) return snapshot;
    await wait(250);
  }
}

async function signUp(browser, email, handle, viewport) {
  const context = await browser.newContext({ baseURL: BASE, viewport });
  const page = await context.newPage();
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]').first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForTimeout(3200);

  if (/verify-email/.test(page.url())) {
    const link = confirmationLink(email);
    if (!link) throw new Error(`no confirmation email for ${email}`);
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    return { context, page, email, handle };
  }

  // The address exists already — the normal case for the admin across runs.
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', email);
  await page.fill('#password', PASSWORD);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1800);
  if (/\/login/.test(page.url())) {
    throw new Error(`could not create or sign in ${email} — stuck at ${page.url()}`);
  }
  const me = await page.evaluate(async () => (await fetch('/api/v1/me')).json());
  return { context, page, email, handle: me?.user?.username ?? handle };
}

async function publish(actor, body) {
  await actor.page.goto('/create', { waitUntil: 'domcontentloaded' });
  await actor.page.waitForLoadState('networkidle');
  await actor.page.fill('textarea', body);
  await actor.page.locator('form button[type=submit]').last().click();
  await actor.page.waitForURL(/\/post\//, { timeout: 25000 });
  return actor.page.url().split('/post/')[1].split(/[?#]/)[0];
}

/** Files one report through the dialog a real person uses. */
async function report(actor, postId, { reason = 0, note = '' } = {}) {
  await actor.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await actor.page.waitForLoadState('networkidle');
  await actor.page.locator('button[aria-label="More options"]').first().click();
  await actor.page.locator('button:has-text("Report")').first().click();
  await actor.page.waitForSelector('select#reason', { timeout: 10000 });
  await actor.page.selectOption('select#reason', { index: reason });
  if (note) await actor.page.fill('textarea[name=details]', note);
  await actor.page.locator('button:has-text("Submit report")').click();
  await actor.page.waitForTimeout(1400);
  return (await actor.page.content()).includes('we have it');
}

/** Completes the admin second factor, so /admin opens. */
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
  await admin.page.waitForTimeout(1200);
}

/**
 * Is the post reachable from a feed, Discover or search?
 *
 * By a LINK to the post, not by its caption appearing somewhere on the page.
 * Searching for the caption puts it in the page either way — "Nothing matched
 * <caption>" contains the caption — so a text match here reports a hidden post
 * as visible. That is not a hypothetical: it is what the first run of this
 * suite did, and it made three real checks pass and three fail for the wrong
 * reason.
 */
async function visibleInFeed(actor, postId, caption) {
  for (const url of [
    '/home?tab=recommended',
    '/discover',
    `/search?q=${encodeURIComponent(caption)}`,
  ]) {
    await actor.page.goto(url, { waitUntil: 'domcontentloaded' });
    await actor.page.waitForLoadState('networkidle');
    if (await actor.page.locator(`a[href*="/post/${postId}"]`).count()) return url;
  }
  return null;
}

async function run() {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
  const viewport = { width: 1280, height: 900 };

  const admin = await signUp(browser, ADMIN_EMAIL, `fayadm${stamp}`.slice(0, 20), viewport);
  const author = await signUp(browser, `auth_${stamp}@example.com`, `auth_${stamp}`.slice(0, 20), viewport);

  // Ten reporters, plus one more used to prove a single account cannot do this
  // on its own.
  const reporters = [];
  for (let i = 0; i < THRESHOLD; i += 1) {
    reporters.push(
      await signUp(browser, `rep${i}_${stamp}@example.com`, `rep${i}_${stamp}`.slice(0, 20), viewport),
    );
  }
  const [lone] = reporters;

  // ==================== ONE ACCOUNT IS NOT TEN ====================
  section('ONE ACCOUNT CANNOT REACH THE THRESHOLD ALONE');

  const soloCaption = `solo report target ${stamp}`;
  const soloPost = await publish(author, soloCaption);

  // The same account, over and over. The unique index means the later ones
  // update the first rather than stacking, so the count that matters stays 1.
  for (let i = 0; i < THRESHOLD + 2; i += 1) {
    await report(lone, soloPost, { reason: i % 3, note: `attempt ${i}` });
  }
  await settle((snap) => snap.reports.some((r) => r.target_id === soloPost));
  const soloRows = store().reports.filter((r) => r.target_id === soloPost);
  check(
    'twelve reports from one account is one report row',
    soloRows.length === 1,
    `${soloRows.length} rows`,
  );
  const soloPostRow = store().posts.find((p) => p.id === soloPost);
  check(
    'and the post is NOT hidden',
    !soloPostRow?.review_state,
    `review_state=${JSON.stringify(soloPostRow?.review_state ?? null)}`,
  );
  check('it is still in a feed', (await visibleInFeed(admin, soloPost, soloCaption)) !== null);

  // ==================== NINE IS NOT TEN ====================
  section('THE THRESHOLD IS EXACTLY TEN DISTINCT ACCOUNTS');

  const caption = `ten report target ${stamp}`;
  const postId = await publish(author, caption);

  for (let i = 0; i < THRESHOLD - 1; i += 1) {
    await report(reporters[i], postId, { reason: i % 4, note: `reporter ${i} said something` });
  }
  let row = store().posts.find((p) => p.id === postId);
  check(
    'nine different accounts leave it alone',
    !row?.review_state,
    `review_state=${JSON.stringify(row?.review_state ?? null)}`,
  );
  check('and it is still in a feed', (await visibleInFeed(admin, postId, caption)) !== null);

  // The tenth.
  await report(reporters[THRESHOLD - 1], postId, { reason: 0, note: 'the tenth reporter' });
  await settle((snap) => snap.posts.find((p) => p.id === postId)?.review_state);
  row = store().posts.find((p) => p.id === postId);
  check('the tenth hides it', row?.review_state === 'temporary_review', String(row?.review_state));
  check('with the count recorded server-side', row?.review_reports === THRESHOLD, String(row?.review_reports));
  check(
    `and an expiry exactly one window (${WINDOW_WORDS}) later`,
    (() => {
      if (!row?.review_expires_at || !row?.review_started_at) return false;
      const minutes =
        (new Date(row.review_expires_at) - new Date(row.review_started_at)) / 60_000;
      return Math.abs(minutes - WINDOW_MINUTES) < 0.05;
    })(),
    `${row?.review_started_at} → ${row?.review_expires_at}`,
  );

  // ==================== IT IS ACTUALLY HIDDEN ====================
  section('HIDDEN, NOT DELETED');

  check('it is gone from every feed', (await visibleInFeed(admin, postId, caption)) === null);
  const stillThere = store().posts.find((p) => p.id === postId);
  check('but the post row is still there, not removed', stillThere && !stillThere.removed);

  const log = store().moderation_events.filter((e) => e.target_id === postId);
  check(
    'the automatic hide is on the record',
    log.some((e) => e.action === 'auto_review_started'),
    log.map((e) => e.action).join(', '),
  );
  check(
    'and it is recorded as FayTarra, not as a person',
    log.find((e) => e.action === 'auto_review_started')?.actor_id === null,
  );

  // ==================== THE AUTHOR IS TOLD ====================
  section('THE AUTHOR IS TOLD, AND TOLD IT IS TEMPORARY');

  await author.page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await author.page.waitForLoadState('networkidle');
  const told = await author.page.locator('body').innerText();
  check('the author has a notification about it', /being reviewed/i.test(told));
  check('it says the content was hidden because of reports', /temporarily hidden/i.test(told));
  check(
    `and that it is bounded — "up to ${WINDOW_WORDS}"`,
    new RegExp(`up to ${WINDOW_WORDS}`, 'i').test(told),
    told.split('\n').find((line) => /being reviewed/i.test(line))?.trim() ?? 'no line',
  );
  check(
    'it does not name anybody who reported it',
    !reporters.some((r) => told.includes(r.handle)),
  );

  // A notification, not a direct message: the mutual-follow rule is untouched.
  const dms = store().messages.filter((m) => m.recipient_id === author_id(store(), author.handle));
  check('no direct message was created to deliver it', dms.length === 0, `${dms.length} messages`);

  // ==================== NOBODY ELSE CAN TOUCH IT ====================
  section('ONLY AN ADMINISTRATOR CAN ACT ON IT');

  // Asked for directly. A hidden button is not a lock.
  for (const path of ['/admin', '/admin?tab=reports']) {
    await lone.page.goto(path, { waitUntil: 'domcontentloaded' });
    await lone.page.waitForLoadState('networkidle');
    check(
      `a normal account is turned away from ${path}`,
      new URL(lone.page.url()).pathname !== '/admin',
      lone.page.url(),
    );
  }

  // The server actions themselves, called the way the browser calls them. A
  // Next.js server action needs its id, which a normal account's pages never
  // contain — so the strongest thing this can check is that no page served to
  // them carries one, and that the review state is unchanged afterwards.
  const beforeState = store().posts.find((p) => p.id === postId)?.review_state;
  await lone.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  const ownerless = await lone.page.content();
  check(
    'no restore, remove, hold or clear control is served to them',
    !/adminRestoreReviewed|adminRemoveReviewed|adminHoldReviewed|adminClearReports/.test(ownerless),
  );
  check(
    'and the review state is unchanged',
    store().posts.find((p) => p.id === postId)?.review_state === beforeState,
  );

  // The author cannot un-hide their own post either.
  await author.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await author.page.waitForLoadState('networkidle');
  const ownerView = await author.page.locator('body').innerText();
  check(
    'the author is given no way to restore it',
    !/Restore now|Clear reports/i.test(ownerView),
  );

  // The count is not something a client can send, because there is nothing to
  // send it TO: the public API is read-only. Every write-shaped method on the
  // post endpoint is refused, so the only number that exists is the one the
  // server got by counting rows.
  const methods = await lone.page.evaluate(async (id) => {
    const out = {};
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`/api/v1/posts/${id}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ review_reports: 0, review_state: null, removed: false }),
      });
      out[method] = res.status;
    }
    return out;
  }, postId);
  check(
    'the post API refuses every write method, so there is no count to forge',
    Object.values(methods).every((status) => status >= 400),
    JSON.stringify(methods),
  );
  check(
    'and the stored count is untouched',
    store().posts.find((p) => p.id === postId)?.review_reports === THRESHOLD,
    String(store().posts.find((p) => p.id === postId)?.review_reports),
  );

  // A direct link is not a way round the hide either.
  const direct = await lone.page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/posts/${id}`);
    return res.status;
  }, postId);
  check('the API will not serve a post under review', direct === 404, `status ${direct}`);
  await lone.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await lone.page.waitForLoadState('networkidle');
  check(
    'and neither will its page, even with the URL in hand',
    /being reviewed/i.test(await lone.page.locator('body').innerText()),
  );
  check(
    'the caption is not in the response at all',
    !(await lone.page.content()).includes(caption),
  );

  // The author still sees their own, because they were told it exists.
  await author.page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await author.page.waitForLoadState('networkidle');
  check(
    'the author can still open their own post',
    (await author.page.locator('body').innerText()).includes(caption),
  );

  // And it is off their public profile for everybody else.
  await lone.page.goto(`/u/${author.handle}`, { waitUntil: 'domcontentloaded' });
  await lone.page.waitForLoadState('networkidle');
  check(
    'it is gone from the author\u2019s profile as others see it',
    !(await lone.page.locator('body').innerText()).includes(caption),
  );

  // ==================== THE ADMIN QUEUE ====================
  section('THE ADMIN SEES IT, WITHOUT SEEING WHO');

  await stepUp(admin);
  await admin.page.goto('/admin?tab=reports', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const queue = await admin.page.locator('body').innerText();
  check('the reports tab names the automatic system', /Automatic 10-report review/i.test(queue));
  // By the review card, not by the caption: the caption is legitimately further
  // down the same page in the ordinary report list, so a text match cannot tell
  // the two apart.
  check(
    'the post is in the review queue',
    (await admin.page.locator(`[data-review-card="${postId}"]`).count()) === 1,
  );
  check('and the card shows its caption', queue.includes(caption.slice(0, 40)));
  check('with the number of accounts that reported it', /10 accounts reported it/i.test(queue));
  check('and how long is left', /left|No automatic expiry/i.test(queue));
  check('it says removing a post does not suspend its author', /does not suspend its author/i.test(queue));
  check(
    'reporters are never named',
    !reporters.some((r) => queue.includes(r.handle)),
    'no reporter handle on the page',
  );
  check(
    'but what they wrote is shown',
    queue.includes('the tenth reporter'),
  );
  // The dashboard has to say there is something waiting, separately from the
  // report count — a hide with a clock on it is more urgent than a queued
  // report, and burying it in one number loses that.
  await admin.page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const overview = await admin.page.locator('body').innerText();
  check('the overview counts what is under review', /Under review/i.test(overview));
  check(
    'and the reports tab carries its own badge for it',
    await admin.page.locator('[title="Under automatic review"]').count() > 0,
  );

  await admin.page.goto('/admin?tab=reports', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  // The queue itself, not the whole page: the right-hand "People to follow"
  // panel is on every page and suggests new accounts — reporters among them —
  // which says nothing about who reported what. What must not happen is a
  // reporter's id appearing in a report card, in its text or its attributes.
  const queueHtml = await admin.page.locator('[data-admin-reports]').evaluate((node) => node.outerHTML);
  const snapshot = await settle((s) =>
    reporters.every((r) => reporter_id(s, r.handle) !== 'unknown'),
  );
  const reporterIds = reporters.map((r) => reporter_id(snapshot, r.handle));
  const leaked = reporterIds.filter((id) => id !== 'unknown' && queueHtml.includes(id));
  check(
    'and no reporter id is hidden in the markup either',
    // Every reporter must be found in the store first: an id that could not be
    // looked up is 'unknown', and the page containing that WORD is not a leak.
    !reporterIds.includes('unknown') && leaked.length === 0,
    leaked.length
      ? `leaked ${leaked.length}, e.g. …${queueHtml
          .slice(Math.max(0, queueHtml.indexOf(leaked[0]) - 160), queueHtml.indexOf(leaked[0]) + 60)
          .replace(/\s+/g, ' ')}…`
      : `${reporterIds.length} reporters checked`,
  );

  // ==================== RESTORING ====================
  section('AN ADMIN RESTORES IT EARLY');

  await admin.page.locator('button', { hasText: /^Restore now$/ }).first().click();
  await admin.page.waitForTimeout(2500);
  await settle((snap) => !snap.posts.find((p) => p.id === postId)?.review_state);
  const restored = store().posts.find((p) => p.id === postId);
  check('the review is over', !restored?.review_state, String(restored?.review_state));
  check('the post is back in a feed', (await visibleInFeed(admin, postId, caption)) !== null);

  await settle((snap) =>
    snap.reports.filter((r) => r.target_id === postId).every((r) => r.cleared_at),
  );
  const cleared = store().reports.filter((r) => r.target_id === postId);
  check('the reports were NOT deleted', cleared.length === THRESHOLD, `${cleared.length} rows`);
  check('they are marked cleared instead', cleared.every((r) => r.cleared_at));
  check('each still has its reason and reporter', cleared.every((r) => r.reason && r.reporter_id));

  const afterLog = store().moderation_events.filter((e) => e.target_id === postId);
  check(
    'clearing is on the record',
    afterLog.some((e) => e.action === 'admin_cleared_reports'),
    afterLog.map((e) => e.action).join(', '),
  );
  check(
    'so is the restore, attributed to the admin',
    afterLog.some((e) => e.action === 'admin_restored' && e.actor_id),
  );
  check(
    'and the original automatic hide is still in the history',
    afterLog.some((e) => e.action === 'auto_review_started'),
  );

  // ==================== CLEARED REPORTS DO NOT RE-FIRE ====================
  section('CLEARED REPORTS CANNOT HIDE IT AGAIN');

  // One more report. If cleared rows still counted, this would be the eleventh
  // and would hide the post instantly.
  await report(reporters[0], postId, { reason: 1, note: 'again after the clear' });
  await settle((snap) => snap.reports.some((r) => r.target_id === postId && !r.cleared_at));
  const afterOne = store().posts.find((p) => p.id === postId);
  check(
    'a fresh report counts from one, not from eleven',
    !afterOne?.review_state,
    `review_state=${JSON.stringify(afterOne?.review_state ?? null)}`,
  );
  check('the post is still visible', (await visibleInFeed(admin, postId, caption)) !== null);
  // It has to COUNT, though. A cleared threshold must not make a post
  // permanently unreportable by the people who reported it the first time.
  const recounted = store().reports.filter((r) => r.target_id === postId && !r.cleared_at);
  check(
    'and the new report does count — it is active again, not still cleared',
    recounted.length === 1,
    `${recounted.length} active of ${store().reports.filter((r) => r.target_id === postId).length}`,
  );
  check(
    'the other nine stay cleared',
    store().reports.filter((r) => r.target_id === postId && r.cleared_at).length === THRESHOLD - 1,
  );

  // Nine more different accounts take it back over the line, which is the real
  // proof that clearing reset the count rather than disabled it.
  for (let i = 1; i < THRESHOLD; i += 1) {
    await report(reporters[i], postId, { reason: 0, note: `second round ${i}` });
  }
  await settle((snap) => snap.posts.find((p) => p.id === postId)?.review_state);
  check(
    'ten fresh accounts hide it again',
    store().posts.find((p) => p.id === postId)?.review_state === 'temporary_review',
    String(store().posts.find((p) => p.id === postId)?.review_state),
  );
  check(
    'and the first automatic hide is still in the history alongside the second',
    store().moderation_events.filter(
      (e) => e.target_id === postId && e.action === 'auto_review_started',
    ).length === 2,
  );

  // Put it back for the sections that follow.
  await admin.page.goto('/admin?tab=reports', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const second = admin.page.locator(`[data-review-card="${postId}"]`);
  await second.locator('button', { hasText: /^Restore now$/ }).first().click();
  await admin.page.waitForTimeout(2500);
  await settle((snap) => !snap.posts.find((p) => p.id === postId)?.review_state);

  // ==================== EXPIRY ====================
  section('IT COMES BACK ON ITS OWN WHEN THE WINDOW RUNS OUT');

  if (!CAN_WATCH_EXPIRY) {
    console.log(
      `SKIP  the window is ${WINDOW_WORDS}, which is too long to sit through.\n` +
        '      Re-run the app and this suite with FAY_REVIEW_WINDOW_MINUTES=1 to watch it\n' +
        '      expire. The 24-hour default and the clamp are covered by the unit tests in\n' +
        '      src/lib/auto-review-rules.test.ts.',
    );
  } else {
    const expiringCaption = `expiring target ${stamp}`;
    const expiringPost = await publish(author, expiringCaption);
    // Ten DIFFERENT accounts, each once. Reporter 0 has reported other posts in
    // this run, which is fine: the count is per piece of content.
    for (const r of reporters) await report(r, expiringPost, { reason: 2 });
    await settle((snap) => snap.posts.find((p) => p.id === expiringPost)?.review_state);
    const expiring = store().posts.find((p) => p.id === expiringPost);
    check('it is hidden to begin with', expiring?.review_state === 'temporary_review');
    check('and gone from the feed', (await visibleInFeed(admin, expiringPost, expiringCaption)) === null);

    // Wait out the real window. Nothing else runs in here: no sweep, no cron,
    // no admin. That is the point of the check.
    const until = new Date(expiring.review_expires_at).getTime();
    await wait(Math.max(0, until - Date.now()) + 2000);

    check(
      'once the window is up it is in a feed again, with nothing having run',
      (await visibleInFeed(admin, expiringPost, expiringCaption)) !== null,
    );
    await author.page.goto(`/post/${expiringPost}`, { waitUntil: 'domcontentloaded' });
    check('and its page opens normally again', !/being reviewed/i.test(
      await author.page.locator('body').innerText(),
    ));

    // The state is still on the row until somebody looks at the queue — the
    // post is visible because the time passed, not because a job ran.
    check(
      'the row still said temporary_review while nobody had looked',
      store().posts.find((p) => p.id === expiringPost)?.review_state === 'temporary_review',
    );

    await admin.page.goto('/admin?tab=reports', { waitUntil: 'domcontentloaded' });
    await admin.page.waitForLoadState('networkidle');
    await settle((snap) =>
      snap.moderation_events.some(
        (e) => e.target_id === expiringPost && e.action === 'auto_review_expired',
      ),
    );
    const expiredLog = store().moderation_events.filter((e) => e.target_id === expiringPost);
    check(
      'the expiry is recorded as an expiry, not as a decision',
      expiredLog.some((e) => e.action === 'auto_review_expired' && e.actor_id === null),
      expiredLog.map((e) => e.action).join(', '),
    );
    const expiredRow = store().posts.find((p) => p.id === expiringPost);
    check('and the review state is cleared', !expiredRow?.review_state);
    check('the post was never removed', !expiredRow?.removed);
    check(
      'it is out of the review queue',
      (await admin.page.locator(`[data-review-card="${expiringPost}"]`).count()) === 0,
    );
    // Its reports are still in the ordinary list below, which is the point:
    // the review ended, the reports did not stop existing.
    check(
      'while its reports are still listed as reports',
      (await admin.page.locator('body').innerText()).includes(expiringCaption),
    );
    const expiredReports = store().reports.filter((r) => r.target_id === expiringPost);
    check(
      'the reports survive the expiry',
      expiredReports.length === THRESHOLD,
      `${expiredReports.length} rows`,
    );
    check(
      'and they still count, so nothing was silently forgiven',
      expiredReports.every((r) => !r.cleared_at),
    );
  }

  // ==================== HOLD ====================
  section('AN ADMIN CAN HOLD SOMETHING PAST 24 HOURS');

  const heldCaption = `held target ${stamp}`;
  const heldPost = await publish(author, heldCaption);
  for (const r of reporters) await report(r, heldPost, { reason: 3, note: 'serious' });
  await settle((snap) => snap.posts.find((p) => p.id === heldPost)?.review_state);
  check(
    'it is under automatic review first',
    store().posts.find((p) => p.id === heldPost)?.review_state === 'temporary_review',
  );

  await admin.page.goto('/admin?tab=reports', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const heldCard = admin.page.locator(`[data-review-card="${heldPost}"]`);
  await heldCard.locator('button', { hasText: /^Hold past / }).first().click();
  await admin.page.waitForTimeout(2500);
  await settle((snap) => snap.posts.find((p) => p.id === heldPost)?.review_state === 'admin_hold');
  const heldRow = store().posts.find((p) => p.id === heldPost);
  check('it is held', heldRow?.review_state === 'admin_hold', String(heldRow?.review_state));
  check('with no expiry to run out', !heldRow?.review_expires_at, String(heldRow?.review_expires_at));
  check('the hold is on the record', store().moderation_events.some(
    (e) => e.target_id === heldPost && e.action === 'admin_held' && e.actor_id,
  ));
  check('and it stays hidden', (await visibleInFeed(admin, heldPost, heldCaption)) === null);

  // ==================== REMOVAL ====================
  section('AN ADMIN CAN REMOVE IT — WITHOUT BANNING ANYBODY');

  const authorStatusBefore = store().users.find((u) => u.username === author.handle)?.status;
  await admin.page.goto('/admin?tab=reports', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForLoadState('networkidle');
  const removeCard = admin.page.locator(`[data-review-card="${heldPost}"]`);
  await removeCard.locator('button', { hasText: /^Remove permanently$/ }).first().click();
  await admin.page.waitForTimeout(2500);

  await settle((snap) => snap.posts.find((p) => p.id === heldPost)?.removed);
  const removed = store().posts.find((p) => p.id === heldPost);
  check('the post is removed', removed?.removed === true);
  check('and no longer sitting in review', !removed?.review_state, String(removed?.review_state));
  check('with a reason stored', Boolean(removed?.removed_reason), String(removed?.removed_reason));
  check(
    'the removal is attributed to the admin',
    store().moderation_events.some(
      (e) => e.target_id === heldPost && e.action === 'admin_removed' && e.actor_id,
    ),
  );

  // The rule that matters most here.
  const authorAfter = store().users.find((u) => u.username === author.handle);
  check(
    'the author was NOT banned or suspended for it',
    authorAfter?.status === authorStatusBefore && authorAfter?.status === 'active',
    `status ${authorAfter?.status}`,
  );

  await author.page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await author.page.waitForLoadState('networkidle');
  const removalNote = await author.page.locator('body').innerText();
  check('the author is told it was removed', /was removed by FayTarra moderation/i.test(removalNote));
  check(
    'and still not told who reported it',
    !reporters.some((r) => removalNote.includes(r.handle)),
  );

  await browser.close();
}

/** The author's id, read from the store by handle. */
function author_id(snapshot, handle) {
  return snapshot.users.find((u) => u.username === handle)?.id ?? 'unknown';
}
const reporter_id = author_id;

await run();

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
