/**
 * Video views and hashtag pages, end to end, in a real browser.
 *
 * Real accounts, a real video uploaded through the real editor, real playback.
 * The view checks read the count from the server after every step — the API,
 * and the HTML each page is rendered with — because "the number on screen went
 * up" is exactly what a counter that never reached the database also does.
 *
 *   ffmpeg -f lavfi -i testsrc=size=640x360:rate=25 -t 4 -c:v libvpx -b:v 400k \
 *     -an /tmp/fay-video-fixtures/landscape.webm
 *   ffmpeg -f lavfi -i color=c=0x7C5CFF:s=800x600 -frames:v 1 /tmp/fay-video-fixtures/photo.jpg
 *   BASE_URL=http://localhost:3000 node scripts/e2e/views-hashtags-flow.mjs
 *
 * (`make-video-fixtures.mjs` makes the same landscape clip without ffmpeg.)
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

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
  await page.waitForFunction(() => location.pathname.startsWith('/verify-email'), undefined, {
    timeout: 30000,
  });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

async function postVideo(page, { title, description, tags }) {
  await page.goto('/create/video?upload=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Post a video', { timeout: 15000 });
  await page.locator('input[type=file]').setInputFiles({
    name: 'landscape.webm',
    mimeType: 'video/webm',
    buffer: readFileSync(path.join(FIXTURES, 'landscape.webm')),
  });
  await page.waitForSelector('#video-title', { timeout: 30000 });
  await page.fill('#video-title', title);
  await page.fill('#video-caption', description);
  // Typed, as a person types them: a space finishes each tag.
  await page.locator('#video-tags').pressSequentially(tags, { delay: 20 });
  await page.selectOption('#video-category', 'Gaming');
  await page.locator('button', { hasText: /^Post video$/ }).click();
  await page.waitForURL(/\/post\//, { timeout: 180000 });
  return page.url().split('/post/')[1];
}

async function postPhoto(page, caption) {
  await page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: readFileSync(path.join(FIXTURES, 'photo.jpg')),
  });
  await page.fill('textarea[name=caption]', caption);
  await page.waitForTimeout(1500);
  await Promise.all([
    page.waitForURL(/\/post\//, { timeout: 60000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
  return page.url().split('/post/')[1];
}

async function postText(page, caption) {
  await page.goto('/create?kind=text&text=short', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea#caption', { timeout: 20000 });
  await page.fill('#caption', caption);
  await Promise.all([
    page.waitForURL(/\/post\//, { timeout: 60000 }),
    page.locator('[data-post-text]').click(),
  ]);
  return page.url().split('/post/')[1];
}

/** The count the server holds, through the public API. */
async function serverViews(context, postId) {
  const response = await context.request.get(`/api/v1/posts/${postId}`);
  const body = await response.json();
  return body.post?.counts?.videoViews ?? null;
}

/** The view count a page was RENDERED with, before any script ran. */
async function renderedViews(context, url) {
  const html = await (await context.request.get(url)).text();
  const match =
    /data-video-views[^>]*?(?:aria-label|title)="([\d,]+) views?"/.exec(html) ??
    /(?:aria-label|title)="([\d,]+) views?"[^>]*?data-video-views/.exec(html);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

/** Waits until the server's count reaches `want`, or gives up and returns what it is. */
async function viewsReach(context, postId, want, timeout = 8000) {
  const end = Date.now() + timeout;
  let now = await serverViews(context, postId);
  while (now < want && Date.now() < end) {
    await sleep(300);
    now = await serverViews(context, postId);
  }
  return now;
}

const run = async () => {
  const browser = await chromium.launch({
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const stamp = Date.now().toString(36).slice(-5);
  const A = await createAccount(browser, `maker_${stamp}`, 'Gaming');
  const B = await createAccount(browser, `poster_${stamp}`, 'Art');
  const C = await createAccount(browser, `watcher_${stamp}`, 'Gaming');

  const errors = [];
  for (const who of [A, B, C]) {
    who.page.on('pageerror', (error) => errors.push(`${who.handle}: ${error.message}`));
    who.page.on('console', (message) => {
      if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
        errors.push(`${who.handle}: ${message.text()}`);
      }
    });
  }

  /* ================================ posts ================================ */
  section('SETUP — a video, a photo and a text post, from two people');
  const tagWord = `Gaming${stamp}`;
  const tag = tagWord.toLowerCase();
  const video = await postVideo(A.page, {
    title: `clutch ${stamp}`,
    description: `first try #ClipOfTheDay${stamp}`,
    tags: `${tagWord} Highlights${stamp}`,
  });
  const photo = await postPhoto(B.page, `new desk #${tag} #Setup${stamp}`);
  const text = await postText(B.page, `#${tagWord.toUpperCase()} night with friends`);
  check('three posts published', Boolean(video && photo && text), `${video} ${photo} ${text}`);

  /* ============================ video views ============================= */
  section('VIEWS — autoplay in the feed');
  const start = await serverViews(C.context, video);
  check('a new video starts at zero', start === 0, String(start));

  await C.page.goto(`/videos?v=${video}`, { waitUntil: 'domcontentloaded' });
  let now = await viewsReach(C.context, video, 1);
  check('autoplay counts one view, in the database', now === 1, String(now));
  await C.page.waitForFunction(
    () => document.querySelector('section[data-index="0"] [data-video-views]')?.textContent?.trim() === '1',
    undefined,
    { timeout: 8000 },
  ).catch(() => undefined);
  const shown = await C.page
    .locator('section[data-index="0"] [data-video-views]')
    .innerText()
    .catch(() => '');
  check('the feed shows it straight away', shown.trim() === '1', shown);

  section('VIEWS — scrolling away and back');
  const slides = await C.page.locator('section[data-index]').count();
  if (slides > 1) {
    await C.page.locator('section[data-index="1"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await sleep(2500);
    await C.page.locator('section[data-index="0"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    now = await viewsReach(C.context, video, 2);
    check('coming back to it is another view', now === 2, String(now));
  } else {
    // The only video on a fresh site: nothing to scroll to. Leave and return.
    await C.page.goto('/home', { waitUntil: 'domcontentloaded' });
    await sleep(2200);
    await C.page.goto(`/videos?v=${video}`, { waitUntil: 'domcontentloaded' });
    now = await viewsReach(C.context, video, 2);
    check('leaving it and coming back is another view', now === 2, String(now));
  }

  section('VIEWS — the loop coming round');
  // A four-second clip, looping. One more loop is one more view.
  await sleep(5200);
  now = await serverViews(C.context, video);
  check('watching it again as it loops is another view', now === 3, String(now));

  section('VIEWS — saved, and shown everywhere');
  await C.page.goto('/home', { waitUntil: 'domcontentloaded' });
  const saved = await serverViews(C.context, video);
  check('still there when asked again', saved === 3, String(saved));
  check(
    'the video feed is rendered with it after a refresh',
    (await renderedViews(C.context, `/videos?v=${video}`)) === saved,
    String(await renderedViews(C.context, `/videos?v=${video}`)),
  );
  // That request rendered the feed, which does not play anything on its own.
  check('rendering a page is not a view', (await serverViews(C.context, video)) === saved);
  check(
    'the post page is rendered with it',
    (await renderedViews(C.context, `/post/${video}`)) === saved,
    String(await renderedViews(C.context, `/post/${video}`)),
  );
  check(
    "the creator's profile is rendered with it",
    (await renderedViews(C.context, `/u/${A.handle}?tab=videos`)) === saved,
    String(await renderedViews(C.context, `/u/${A.handle}?tab=videos`)),
  );

  section('VIEWS — opening it on its own page, and replaying it');
  await C.page.goto(`/post/${video}`, { waitUntil: 'networkidle' });
  const player = C.page.locator('article video').first();
  await player.evaluate((element) => {
    element.muted = true;
    return element.play();
  });
  now = await viewsReach(C.context, video, saved + 1);
  check('pressing play is a view', now === saved + 1, String(now));
  await C.page.waitForFunction(
    (want) => document.querySelector('article [data-video-views]')?.textContent?.trim() === String(want),
    saved + 1,
    { timeout: 8000 },
  ).catch(() => undefined);
  check(
    'and the card shows it straight away',
    (await C.page.locator('article [data-video-views]').innerText()).trim() === String(saved + 1),
  );
  // Let it play to the end: one playback, however long, is one view.
  await player.evaluate((element) => new Promise((resolve) => {
    if (element.ended) resolve();
    else element.addEventListener('ended', () => resolve(), { once: true });
  }));
  check('one playback is one view, however long', (await serverViews(C.context, video)) === saved + 1);
  await player.evaluate((element) => element.play());
  now = await viewsReach(C.context, video, saved + 2);
  check('playing it again after it ended is another view', now === saved + 2, String(now));
  await player.evaluate((element) => element.pause());
  await sleep(500);
  await player.evaluate((element) => element.play());
  await sleep(1500);
  check('pause and play is the same viewing', (await serverViews(C.context, video)) === saved + 2);

  section('VIEWS — somebody not signed in');
  const visitor = await browser.newContext({ baseURL: BASE });
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(`/videos?v=${video}`, { waitUntil: 'domcontentloaded' });
  now = await viewsReach(C.context, video, saved + 3);
  check('a visitor watching is a view too', now === saved + 3, String(now));

  section('VIEWS — the author watching their own');
  const before = await serverViews(A.context, video);
  await A.page.goto(`/post/${video}`, { waitUntil: 'networkidle' });
  await A.page.locator('article video').first().evaluate((element) => {
    element.muted = true;
    return element.play();
  });
  await sleep(2500);
  check('is not a view', (await serverViews(A.context, video)) === before);

  /* =============================== hashtags ============================= */
  section('HASHTAGS — one page per hashtag');
  await C.page.goto(`/tag/${tagWord.toUpperCase()}`, { waitUntil: 'networkidle' });
  check('any capitalisation lands on one address', new URL(C.page.url()).pathname === `/tag/${tag}`, C.page.url());
  const heading = await C.page.locator('[data-hashtag-page] h1').innerText();
  check('the hashtag is the heading, as first written', heading.trim() === `#${tagWord}`, heading);
  const onPage = await C.page.locator('article').count();
  check('it holds the video, the photo and the text post', onPage === 3, String(onPage));
  check('from both people who used it', (await C.page.locator('body').innerText()).includes(B.handle.toUpperCase()) &&
    (await C.page.locator('body').innerText()).includes(A.handle.toUpperCase()));
  check('the video plays in the FayTarra player', (await C.page.locator('article video').count()) === 1);
  check('the photo is the FayTarra photo', (await C.page.locator('article [data-photo-frame]').count()) === 1);
  check('the text post is its bubble', (await C.page.locator('article [data-text-post]').count()) === 1);
  for (const id of [video, photo, text]) {
    check(
      `each post opens from it (${id.slice(0, 8)})`,
      (await C.page.locator(`article a[href^="/post/${id}"]`).count()) > 0,
    );
  }

  section('HASHTAGS — clicking one opens its page, never the post');
  await C.page.goto(`/post/${text}`, { waitUntil: 'networkidle' });
  await C.page.locator(`article a[data-hashtag-link="${tag}"]`).first().click();
  await C.page.waitForURL(/\/tag\//, { timeout: 15000 });
  check('a hashtag in a text post', new URL(C.page.url()).pathname === `/tag/${tag}`, C.page.url());

  await C.page.goto(`/post/${photo}`, { waitUntil: 'networkidle' });
  await C.page.locator(`article a[data-hashtag-link="setup${stamp}"]`).first().click();
  await C.page.waitForURL(/\/tag\//, { timeout: 15000 });
  check('a hashtag in a photo caption', new URL(C.page.url()).pathname === `/tag/setup${stamp}`, C.page.url());
  await C.page.waitForSelector(`[data-hashtag-page="setup${stamp}"]`, { timeout: 15000 });
  check('whose page has that photo', (await C.page.locator(`article a[href="/post/${photo}"]`).count()) > 0);

  await C.page.goto(`/post/${video}`, { waitUntil: 'networkidle' });
  await C.page.locator(`article a[data-hashtag-link="clipoftheday${stamp}"]`).first().click();
  await C.page.waitForURL(/\/tag\//, { timeout: 15000 });
  check('a hashtag in a video description', new URL(C.page.url()).pathname === `/tag/clipoftheday${stamp}`, C.page.url());

  await C.page.goto(`/post/${video}`, { waitUntil: 'networkidle' });
  await C.page.locator(`article a[data-hashtag-link="highlights${stamp}"]`).first().click();
  await C.page.waitForURL(/\/tag\//, { timeout: 15000 });
  check("a video's tag, shown as a chip", new URL(C.page.url()).pathname === `/tag/highlights${stamp}`, C.page.url());

  // On a list, where the caption itself opens the post.
  await C.page.goto(`/u/${B.handle}`, { waitUntil: 'networkidle' });
  await C.page.locator(`article a[data-hashtag-link="setup${stamp}"]`).first().click();
  await C.page.waitForURL(/\/(tag|post)\//, { timeout: 15000 });
  check('on a card whose caption opens the post, the hashtag still wins', new URL(C.page.url()).pathname === `/tag/setup${stamp}`, C.page.url());
  await C.page.goto(`/u/${B.handle}`, { waitUntil: 'networkidle' });
  // Its top-left corner: words, not one of the hashtags, which would (rightly)
  // open the hashtag instead.
  await C.page
    .locator(`article [data-post-caption] a[aria-label="Open post"]`)
    .first()
    .click({ position: { x: 4, y: 4 } });
  await C.page.waitForURL(/\/post\//, { timeout: 15000 });
  check('and the rest of the caption still opens the post', /\/post\//.test(C.page.url()), C.page.url());

  // In the full-screen feed, over a playing video.
  await C.page.goto(`/videos?v=${video}`, { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector(`section[data-index="0"] a[data-hashtag-link="${tag}"]`, { timeout: 15000 });
  await C.page.locator(`section[data-index="0"] a[data-hashtag-link="${tag}"]`).click();
  await C.page.waitForURL(/\/tag\//, { timeout: 15000 });
  check('in the video feed, over the video', new URL(C.page.url()).pathname === `/tag/${tag}`, C.page.url());

  section('HASHTAGS — in comments');
  await C.page.goto(`/post/${photo}`, { waitUntil: 'networkidle' });
  await C.page.fill('textarea[name=body], input[name=body]', `love this #${tagWord}`);
  await C.page.locator('form button[type=submit]').last().click();
  await C.page.waitForSelector(`#comments a[data-hashtag-link="${tag}"], a[data-hashtag-link="${tag}"]:below(article)`, { timeout: 15000 }).catch(() => undefined);
  const commentLinks = await C.page.locator(`a[data-hashtag-link="${tag}"]`).count();
  check('a hashtag in a comment is a link', commentLinks >= 2, String(commentLinks));

  section('SEARCH — finding the hashtag page');
  for (const query of [tagWord, `#${tagWord}`, tag.toUpperCase()]) {
    await C.page.goto(`/search?q=${encodeURIComponent(query)}`, { waitUntil: 'networkidle' });
    const result = C.page.locator(`[data-search-hashtags] a[data-hashtag-result="${tag}"]`);
    check(`"${query}" finds the hashtag page`, (await result.count()) === 1);
    const label = await result.innerText().catch(() => '');
    check(`  and says what is on it`, /3 public posts/.test(label), label.replace(/\s+/g, ' '));
  }
  await C.page.locator(`[data-search-hashtags] a[data-hashtag-result="${tag}"]`).click();
  await C.page.waitForURL(/\/tag\//, { timeout: 15000 });
  check('clicking the result opens the page', new URL(C.page.url()).pathname === `/tag/${tag}`);

  section('HASHTAGS — what is not on a page');
  await B.page.goto(`/post/${text}`, { waitUntil: 'networkidle' });
  await B.page.locator('article button[aria-label="More options"]').click();
  await B.page.locator('article button', { hasText: /^Delete$/ }).first().click();
  await B.page.locator('[data-delete-confirm] button', { hasText: /^Delete$/ }).click();
  await B.page.waitForURL((url) => !url.pathname.startsWith('/post/'), { timeout: 15000 }).catch(() => undefined);
  await sleep(500);
  await C.page.goto(`/tag/${tag}`, { waitUntil: 'networkidle' });
  check('a deleted post is gone from it', (await C.page.locator(`article a[href="/post/${text}"]`).count()) === 0);
  check('and the rest are still there', (await C.page.locator('article').count()) === 2);

  // Typed into the composer and never posted: not a hashtag.
  await A.page.goto('/create?kind=text&text=short', { waitUntil: 'domcontentloaded' });
  await A.page.waitForSelector('textarea#caption', { timeout: 20000 });
  await A.page.fill('#caption', `#Draftonly${stamp} never posted`);
  await sleep(500);
  const preview = await A.page.locator('a[data-hashtag-link]').count();
  check('a draft preview has no hashtag links to leave by', preview === 0, String(preview));
  await C.page.goto(`/search?q=Draftonly${stamp}`, { waitUntil: 'networkidle' });
  check('a hashtag only typed in a draft does not exist', (await C.page.locator('[data-search-hashtags]').count()) === 0);
  await C.page.goto(`/tag/draftonly${stamp}`, { waitUntil: 'networkidle' });
  check('its page is the empty one', /Nothing public uses/.test(await C.page.locator('body').innerText()));
  // The not-found page, as a missing post gets. (Streamed behind the loading
  // skeleton, so — like /post/<missing id> — it arrives with a 200.)
  await C.page.goto('/tag/31', { waitUntil: 'networkidle' });
  check('a number is not a hashtag page', /Nothing here\./.test(await C.page.locator('body').innerText()));

  section('CONSOLE');
  check('no errors in any page', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
