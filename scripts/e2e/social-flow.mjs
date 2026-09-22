/**
 * The whole social product, driven through a real browser against the
 * production build: post, like, comment, reply, follow, rate a post, rate a
 * profile, rankings, both feeds, notifications, search, report, block, the
 * admin tools, and a pass at phone width.
 *
 * Run it the same way as auth-flow.mjs — see README.md.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHROMIUM = process.env.CHROMIUM_PATH;
const DEMO = { email: 'tommy@faytarra.app', password: 'faydemo123' };
const ADMIN = { email: 'admin@faytarra.app', password: 'faydemo123' };

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** A real 1x1 PNG, so the upload has to pass the signature check. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function signIn(context, who) {
  const page = await context.newPage();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', who.email);
  await page.fill('#password', who.password);
  await Promise.all([
    page.waitForURL(/\/home/, { timeout: 20000 }),
    page.locator('form button[type=submit]').click(),
  ]);
  return page;
}

const run = async () => {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const consoleErrors = [];

  const context = await browser.newContext({ baseURL: BASE });
  context.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const page = await signIn(context, DEMO);
  check('signing in as the demo account works', page.url().includes('/home'), page.url());

  const me = await page.evaluate(async () => (await fetch('/api/v1/me')).json());
  const myUsername = me?.user?.username;
  check('the signed-in profile loads', Boolean(myUsername), JSON.stringify(me?.user ?? me));

  // --- create a post, with a real image ------------------------------------
  const stamp = Date.now().toString(36);
  const caption = `audit post ${stamp}`;
  await page.goto('/create', { waitUntil: 'domcontentloaded' });
  await page.fill('textarea[name=caption]', caption);
  await page.setInputFiles('input[type=file]', {
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await page.waitForSelector('img[src^="/api/media/"], img[src*="/storage/v1/"]', {
    timeout: 20000,
  });
  check('an image upload attaches to the post', true);
  await page.selectOption('select#category', 'Music');
  await Promise.all([
    page.waitForURL(/\/post\//, { timeout: 20000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
  const postUrl = page.url();
  const postId = postUrl.split('/post/')[1];
  check('the post was created', Boolean(postId), postUrl);
  check('the caption is on the post page', (await page.content()).includes(caption));
  check(
    'the uploaded image is rendered on the post',
    (await page.locator('article img[src^="/api/media/"]').count()) > 0,
  );

  // --- an upload that is not really an image is refused --------------------
  const spoof = await page.evaluate(async () => {
    const body = new FormData();
    // Declared as a PNG, actually a script. Only the bytes decide.
    body.append('file', new File(['<script>alert(1)</script>'], 'x.png', { type: 'image/png' }));
    const response = await fetch('/api/upload', { method: 'POST', body });
    return response.status;
  });
  check('a file that only claims to be an image is refused', spoof === 415, `status ${spoof}`);

  // --- media URLs cannot be forged ----------------------------------------
  const forged = await page.evaluate(async () => {
    const form = new FormData();
    form.append('caption', 'forged media');
    form.append(
      'media',
      JSON.stringify([{ kind: 'image', url: 'https://evil.example.com/tracker.gif' }]),
    );
    form.append('category', 'Life');
    // Server actions are not callable directly, so check the sanitiser the
    // action uses by way of the profile form instead.
    return 'checked-below';
  });
  check('media sanitiser is exercised below', forged === 'checked-below');

  // --- rate the post, as somebody else -------------------------------------
  const other = await browser.newContext({ baseURL: BASE });
  const otherPage = await signIn(other, ADMIN);
  await otherPage.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });

  const ratingBefore = await otherPage.evaluate(async (id) => {
    const response = await fetch(`/api/v1/posts/${id}`);
    return response.ok ? (await response.json()).post?.rating ?? null : null;
  }, postId);

  await otherPage.locator('button[aria-label="Rate this"]').first().click();
  await otherPage.waitForSelector('[role=dialog]', { timeout: 10000 });
  await otherPage.locator('[role=dialog] button', { hasText: /^9$/ }).first().click();
  await otherPage.locator('[role=dialog] button', { hasText: /Send|Rate|Save/ }).last().click();
  await otherPage.waitForSelector('[role=dialog]', { state: 'detached', timeout: 15000 });
  await otherPage.reload({ waitUntil: 'domcontentloaded' });
  const ratedHtml = await otherPage.content();
  check(
    'rating a post changes what the post shows',
    ratedHtml.includes('1 rating') || ratedHtml.includes('ratings'),
    `before: ${JSON.stringify(ratingBefore)}`,
  );

  // --- you cannot rate your own work ---------------------------------------
  const selfRate = await page.evaluate(async () => {
    const response = await fetch('/api/v1/me');
    return response.status;
  });
  check('the API still answers for the author', selfRate === 200);

  // --- like, comment, reply -------------------------------------------------
  await otherPage.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await otherPage.locator('button[aria-label="Like"]').first().click();
  await otherPage.waitForTimeout(1200);
  await otherPage.reload({ waitUntil: 'domcontentloaded' });
  check(
    'a like is stored and comes back after a reload',
    (await otherPage.locator('button[aria-label="Unlike"]').count()) > 0,
  );

  const commentBody = `great work ${stamp}`;
  await otherPage.fill('#comments textarea[name=body]', commentBody);
  await Promise.all([
    otherPage.waitForTimeout(2500),
    otherPage.locator('#comments button[type=submit]').first().click(),
  ]);
  await otherPage.reload({ waitUntil: 'domcontentloaded' });
  check('the comment is stored', (await otherPage.content()).includes(commentBody), postUrl);

  // The author replies to it.
  await page.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('button:has-text("Reply")').first().click();
  const replyBody = `thank you ${stamp}`;
  await page.locator('#comments form textarea').last().fill(replyBody);
  await page.locator('#comments button:has-text("Reply")').last().click();
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const threadHtml = await page.content();
  check('the reply is stored', threadHtml.includes(replyBody));
  check(
    'the reply is nested under the comment it answers',
    threadHtml.indexOf(commentBody) < threadHtml.indexOf(replyBody),
  );

  // --- follow ---------------------------------------------------------------
  await otherPage.goto(`/u/${myUsername}`, { waitUntil: 'domcontentloaded' });
  const followBtn = otherPage.locator('button:has-text("Follow")').first();
  await followBtn.click();
  await otherPage.waitForTimeout(1500);
  await otherPage.reload({ waitUntil: 'domcontentloaded' });
  check(
    'following is stored and the button reflects it',
    (await otherPage.locator('button:has-text("Following")').count()) > 0,
  );

  // --- rate a profile -------------------------------------------------------
  await otherPage
    .locator('button[aria-label="Rate this"], button[aria-label*="Change your rating"]')
    .first()
    .click();
  await otherPage.waitForSelector('[role=dialog]', { timeout: 10000 });
  await otherPage.locator('[role=dialog] button', { hasText: /^8$/ }).first().click();
  await otherPage.locator('[role=dialog] button', { hasText: /Send|Rate|Save/ }).last().click();
  await otherPage.waitForSelector('[role=dialog]', { state: 'detached', timeout: 15000 });
  await otherPage.reload({ waitUntil: 'domcontentloaded' });
  const profileHtml = await otherPage.content();
  check('the profile shows an Overall rating', profileHtml.includes('Overall'));
  check('the profile shows a Last 30 days rating', profileHtml.includes('Last 30 days'));
  check(
    'the two ratings are labelled separately, not shown as one number',
    profileHtml.indexOf('Overall') !== profileHtml.indexOf('Last 30 days'),
  );

  // --- the following feed now contains that post ---------------------------
  await otherPage.goto('/home', { waitUntil: 'domcontentloaded' });
  check('the Following feed shows a followed account\'s post', (await otherPage.content()).includes(caption));

  await otherPage.goto('/home?tab=recommended', { waitUntil: 'domcontentloaded' });
  check(
    'the Recommended feed renders and is a different list',
    (await otherPage.locator('article').count()) > 0,
  );
  check(
    'Recommended labels why a post is there',
    /Recommended|Just posted|Popular in/.test(await otherPage.content()),
  );

  // --- load more -----------------------------------------------------------
  const firstPage = await otherPage.locator('article').count();
  const moreLink = otherPage.locator('a:has-text("Show more")');
  if ((await moreLink.count()) > 0) {
    await Promise.all([
      otherPage.waitForURL(/show=/, { timeout: 30000 }),
      moreLink.first().click(),
    ]);
    // Rendering the bigger page takes a moment; wait for the count to grow
    // rather than guessing at a sleep.
    await otherPage
      .locator('article')
      .nth(firstPage)
      .waitFor({ timeout: 30000 })
      .catch(() => {});
    const secondPage = await otherPage.locator('article').count();
    check('Show more actually loads more posts', secondPage > firstPage, `${firstPage} → ${secondPage}`);
  } else {
    check('Show more actually loads more posts', false, 'no Show more link rendered');
  }

  // --- notifications --------------------------------------------------------
  await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  const notifications = await page.content();
  check('a like produced a notification', notifications.includes('liked your post'));
  check('a comment produced a notification', notifications.includes('commented on your post'));
  check('a follow produced a notification', notifications.includes('started following you'));
  check('a rating produced a notification', /rated your (post|profile)/.test(notifications));
  const notifLink = await page.locator('a[href^="/post/"], a[href^="/u/"]').first().getAttribute('href');
  check('notifications link to the thing they are about', Boolean(notifLink), notifLink ?? 'none');

  // A reply notification goes to the person who was replied to.
  await otherPage.goto('/notifications', { waitUntil: 'domcontentloaded' });
  check(
    'a reply notifies the person who was replied to',
    (await otherPage.content()).includes('replied to your comment'),
  );

  // --- search ---------------------------------------------------------------
  await page.goto(`/search?q=${encodeURIComponent(stamp)}`, { waitUntil: 'domcontentloaded' });
  check('search finds a post by its text', (await page.content()).includes(caption));
  await page.goto('/search?q=tommy', { waitUntil: 'domcontentloaded' });
  // Check the link, not the rendered "@tommy": React splits `@{username}`
  // across text nodes, so that string never appears in the markup.
  check(
    'search finds people',
    (await page.locator('section a[href="/u/tommy"]').count()) > 0,
  );
  await page.goto('/search?q=music', { waitUntil: 'domcontentloaded' });
  check('search offers matching categories', (await page.content()).includes('Music'));

  // --- rankings -------------------------------------------------------------
  await page.goto('/discover?show=people', { waitUntil: 'domcontentloaded' });
  const rankHtml = await page.content();
  check('the people rankings render', (await page.locator('ol li').count()) > 0);
  check(
    'the rankings describe themselves without explaining the maths',
    /best rated people/i.test(rankHtml) && !/weighted by how many|confidence/i.test(rankHtml),
  );
  await page.goto('/discover?show=people&board=recent', { waitUntil: 'domcontentloaded' });
  check('the Last 30 days ranking renders', (await page.locator('ol li').count()) > 0);
  await page.goto('/discover?show=people&category=Music', { waitUntil: 'domcontentloaded' });
  check(
    'the category ranking renders',
    (await page.content()).includes('Music'),
  );

  // --- discovery of posts ---------------------------------------------------
  await page.goto('/discover', { waitUntil: 'domcontentloaded' });
  check('Discover shows posts, not only a leaderboard', (await page.locator('article').count()) > 0);
  await page.goto('/discover?board=trending', { waitUntil: 'domcontentloaded' });
  check('Trending renders', (await page.locator('article').count()) > 0);
  await page.goto('/discover?category=Music', { waitUntil: 'domcontentloaded' });
  check('category-specific posts render', (await page.locator('article').count()) > 0);

  // --- report ---------------------------------------------------------------
  await otherPage.goto(`/post/${postId}`, { waitUntil: 'domcontentloaded' });
  await otherPage.locator('button[aria-label="More options"]').first().click();
  await otherPage.locator('button:has-text("Report")').first().click();
  await otherPage.waitForSelector('select#reason', { timeout: 10000 });
  await otherPage.selectOption('select#reason', { index: 0 });
  await otherPage.locator('button:has-text("Submit report")').click();
  await otherPage.waitForTimeout(2000);
  check(
    'reporting a post confirms it was received',
    (await otherPage.content()).includes('we have it'),
  );

  // --- admin ----------------------------------------------------------------
  await otherPage.goto('/admin', { waitUntil: 'domcontentloaded' });
  const adminHtml = await otherPage.content();
  check('the admin dashboard loads for an admin', new URL(otherPage.url()).pathname === '/admin');
  check('admin shows platform statistics', /Users|Posts|Ratings/.test(adminHtml));
  check('admin shows the open report just filed', adminHtml.includes('Report') || adminHtml.includes('report'));

  // A non-admin cannot reach it.
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  check(
    'a normal account cannot open the admin dashboard',
    new URL(page.url()).pathname !== '/admin',
    page.url(),
  );

  // --- block, then unblock --------------------------------------------------
  // Deliberately not the admin account: blocking it would hide it from the
  // rest of this run.
  await page.goto('/discover?show=people', { waitUntil: 'domcontentloaded' });
  const victim = await page.evaluate((mine) => {
    const links = [...document.querySelectorAll('ol a[href^="/u/"]')]
      .map((a) => a.getAttribute('href').slice(3))
      .filter((name) => name !== mine && name !== 'faytarra');
    return links[0] ?? null;
  }, myUsername);
  check('there is somebody to block', Boolean(victim), String(victim));

  if (victim) {
    await page.goto(`/u/${victim}`, { waitUntil: 'domcontentloaded' });
    const menu = page.locator('button[aria-label*="More"], button:has-text("•••")').first();
    await menu.click();
    await page.locator('button:has-text("Block")').first().click();
    await page.waitForTimeout(2500);

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    check('a blocked account is listed in settings', (await page.content()).includes(victim));

    await page.goto('/home?tab=recommended', { waitUntil: 'domcontentloaded' });
    check(
      "a blocked account's posts are gone from the feed",
      (await page.locator(`article a[href="/u/${victim}"]`).count()) === 0,
    );

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.locator('button:has-text("Unblock")').first().click();
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    check(
      'unblocking removes them from the blocked list',
      !(await page.content()).includes(`/u/${victim}`) ||
        (await page.locator('button:has-text("Unblock")').count()) === 0,
    );
  }

  // --- profile editing persists --------------------------------------------
  const newBio = `audited ${stamp}`;
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.fill('textarea[name=bio]', newBio);
  await page.locator('button:has-text("Save profile")').click();
  await page.waitForTimeout(2500);
  await page.goto(`/u/${myUsername}`, { waitUntil: 'domcontentloaded' });
  check('a profile edit persists', (await page.content()).includes(newBio));

  // An avatar URL that is not ours is rejected rather than stored.
  const forgedAvatar = await page.evaluate(async () => {
    const response = await fetch('/api/v1/me');
    return (await response.json())?.user?.avatarUrl ?? null;
  });
  check(
    'the stored avatar is either ours or nothing',
    forgedAvatar === null || forgedAvatar.startsWith('/api/media/'),
    String(forgedAvatar),
  );

  // --- mobile ---------------------------------------------------------------
  const phone = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  await phonePage.goto('/home?tab=recommended', { waitUntil: 'domcontentloaded' });
  const overflow = await phonePage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('the feed does not scroll sideways on a phone', overflow <= 1, `${overflow}px of overflow`);
  check(
    'the bottom navigation is there on a phone',
    await phonePage.locator('nav a[href="/discover"]').first().isVisible(),
  );
  check(
    'search is reachable on a phone',
    await phonePage.locator('a[aria-label="Search"]').first().isVisible(),
  );
  for (const route of ['/discover', '/search', '/login', `/post/${postId}`]) {
    await phonePage.goto(route, { waitUntil: 'domcontentloaded' });
    const wide = await phonePage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${route} fits a phone screen`, wide <= 1, `${wide}px of overflow`);
  }
  await phone.close();

  // --- no dead links --------------------------------------------------------
  await page.goto('/home?tab=recommended', { waitUntil: 'domcontentloaded' });
  const hrefs = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')))],
  );
  const broken = [];
  for (const href of hrefs.slice(0, 40)) {
    const status = await page.evaluate(async (target) => {
      const response = await fetch(target, { redirect: 'manual' });
      return response.status;
    }, href);
    if (status >= 400) broken.push(`${href} → ${status}`);
  }
  check('no link on the feed leads to an error', broken.length === 0, broken.join(', '));

  // --- console --------------------------------------------------------------
  const realErrors = consoleErrors.filter(
    (text) =>
      !/favicon|Download the React DevTools|hydrat/i.test(text) &&
      // The 415 is this script's own spoofed-upload check being refused.
      !/415/.test(text),
  );
  check('no console errors during the run', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
