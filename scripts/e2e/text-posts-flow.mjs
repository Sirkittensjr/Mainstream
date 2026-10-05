/**
 * Text posts, end to end: three kinds, one bubble.
 *
 * Covers what the feature actually promises — that a short message, a long one
 * and a big one are the same speech bubble with different amounts of room, that
 * the bubble points at its author, that a long message is previewed in the feed
 * and whole on its own page, that the limits hold against a request that never
 * went near the composer, and that a text post written before any of this
 * existed still works and gains the bubble.
 *
 *   OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e/text-posts-flow.mjs
 *
 * Needs the GoTrue stub and a built app, same as the other app-side suites.
 */
import { chromium, devices } from 'playwright';
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

async function account(browser, handle, options = {}) {
  const context = await browser.newContext({ baseURL: BASE, ...options });
  const page = await context.newPage();
  const email = `${handle}@example.com`;
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#username', handle);
  await page.fill('#password', PASSWORD);
  await page.fill('#display_name', handle.toUpperCase());
  await page.locator('button[aria-pressed]').first().click();
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/verify-email/, { timeout: 30000 });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

/** Writes one text post of the given kind and returns its post id. */
async function post(page, kind, { title, body, category }) {
  await page.goto(`/create?kind=text&text=${kind}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea#caption', { timeout: 20000 });
  if (title) await page.fill('#text_title', title);
  await page.fill('#caption', body);
  if (category) await page.selectOption('#category', category);
  await page.locator('[data-post-text]').click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
  return page.url().split('/post/')[1].split(/[?#]/)[0];
}

/** Where the bubble's tail is, and where the avatar is, on screen. */
const tailAndAvatar = (page) =>
  page.evaluate(() => {
    const tail = document.querySelector('[data-speech-tail]')?.getBoundingClientRect();
    // The avatar is an <Image> for somebody who uploaded one and a span of
    // initials for everybody else; the link around both is what is always there.
    const avatar = document
      .querySelector('article header a[aria-label$="profile"]')
      ?.getBoundingClientRect();
    const bubble = document.querySelector('[data-speech-bubble]')?.getBoundingClientRect();
    return {
      tail: tail ? { x: tail.left + tail.width / 2, y: tail.top + tail.height / 2 } : null,
      avatar: avatar
        ? { x: avatar.left + avatar.width / 2, y: avatar.top + avatar.height / 2 }
        : null,
      bubble: bubble
        ? { left: bubble.left, right: bubble.right, top: bubble.top, width: bubble.width }
        : null,
      vw: window.innerWidth,
    };
  });

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM || undefined });
  const stamp = Math.random().toString(36).slice(2, 8);
  const me = await account(browser, `tx_${stamp}`);
  const { page } = me;

  /* ===================== choosing a kind ===================== */
  section('CREATE POST -> TEXT OFFERS THREE KINDS');

  await page.goto('/create?kind=text', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-text-chooser]', { timeout: 20000 });
  const offered = await page
    .locator('[data-text-kind]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.textKind));
  check(
    'it asks which kind first, rather than opening a composer',
    JSON.stringify(offered) === JSON.stringify(['short', 'long', 'big']),
    offered.join(' / '),
  );
  const chooser = await page.locator('[data-text-chooser]').innerText();
  check(
    'and each one says what it is for',
    /Share a quick thought/.test(chooser) &&
      /Tell the full story/.test(chooser) &&
      /Make a statement/.test(chooser),
    chooser.replace(/\n+/g, ' | '),
  );
  check(
    'every option is a comfortable tap target',
    await page
      .locator('[data-text-kind]')
      .evaluateAll((nodes) => nodes.every((n) => n.getBoundingClientRect().height >= 44)),
  );

  /* ===================== short ===================== */
  section('A SHORT MESSAGE');

  const shortBody = `Hey! What is up? ${stamp}`;
  const shortId = await post(page, 'short', { body: shortBody });
  check('a short message posts', Boolean(shortId), shortId);
  check(
    'and is drawn as a speech bubble',
    (await page.locator('[data-text-post="short"] [data-speech-bubble]').count()) === 1,
  );
  check(
    'with the words in it',
    (await page.locator('[data-text-body]').innerText()).includes(shortBody),
  );

  const placed = await tailAndAvatar(page);
  check(
    'the bubble has a tail',
    placed.tail !== null && placed.avatar !== null,
    placed.tail ? `tail at ${Math.round(placed.tail.x)},${Math.round(placed.tail.y)}` : 'missing',
  );
  check(
    // The bubble sits under the header, so its tail points UP at the avatar:
    // below it on screen, and lined up with it across.
    'and it points up at the author’s avatar',
    placed.tail.y > placed.avatar.y && Math.abs(placed.tail.x - placed.avatar.x) < 60,
    `tail x=${Math.round(placed.tail.x)} y=${Math.round(placed.tail.y)}, avatar x=${Math.round(
      placed.avatar.x,
    )} y=${Math.round(placed.avatar.y)}`,
  );
  check(
    // It hugs its words: a four-word message does not make a card-wide box.
    'the bubble sizes to its words rather than filling the card',
    placed.bubble.width < placed.vw * 0.9,
    `${Math.round(placed.bubble.width)}px of ${placed.vw}px`,
  );

  /* ===================== long ===================== */
  section('A LONG MESSAGE: TITLE, PREVIEW, READ MORE');

  const longTitle = `The whole story ${stamp.slice(0, 3)}`;
  const longBody =
    'It started on a Tuesday and by the end of the week everything about the plan had changed, ' +
    'which is the part nobody warns you about when they tell you to just start. ' +
    'a'.repeat(300);
  const longId = await post(page, 'long', { title: longTitle, body: longBody });
  check('a long message posts', Boolean(longId), longId);

  // Its own page shows all of it.
  check(
    'its own page shows the title',
    (await page.locator('[data-text-title]').innerText()).includes(longTitle.slice(0, 20)),
  );
  const whole = await page.locator('[data-text-post="long"] [data-text-body]').innerText();
  check(
    'and the whole body, not a preview',
    whole.length > 300,
    `${whole.length} characters shown`,
  );
  check(
    'with no Read more on the page the reading happens on',
    (await page.locator('[data-read-more]').count()) === 0,
  );
  check(
    'and the title stands out from the body',
    await page.evaluate(() => {
      const title = getComputedStyle(document.querySelector('[data-text-title]'));
      const body = getComputedStyle(document.querySelector('[data-text-body]'));
      return (
        parseFloat(title.fontSize) > parseFloat(body.fontSize) &&
        parseInt(title.fontWeight, 10) > parseInt(body.fontWeight, 10)
      );
    }),
  );

  // The feed shows a preview and a way in.
  await page.goto('/home', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const card = page.locator(`article:has([data-text-post="long"])`).first();
  const feedBody = await card.locator('[data-text-body]').innerText();
  check(
    'the feed shows only the first 50 characters or so',
    feedBody.length <= 56,
    `${feedBody.length} characters: ${feedBody}`,
  );
  check('and says there is more', (await card.locator('[data-read-more]').count()) === 1);
  check('the feed shows the title too', (await card.locator('[data-text-title]').count()) === 1);

  await card.locator('[data-read-more]').click();
  await page.waitForURL(new RegExp(`/post/${longId}`), { timeout: 20000 });
  check('Read more opens the whole message', true);
  check(
    'where the body is complete again',
    (await page.locator('[data-text-post="long"] [data-text-body]').innerText()).length > 300,
  );
  check(
    'and it is still the same bubble, with the author above it',
    (await page.locator('[data-speech-bubble]').count()) === 1 &&
      (await page.locator('[data-speech-tail]').count()) === 1,
  );

  /* ===================== big ===================== */
  section('A BIG MESSAGE');

  const bigBody = `LET US GO ${stamp.slice(0, 2)}`;
  const bigId = await post(page, 'big', { body: bigBody });
  check('a big message posts', Boolean(bigId), bigId);
  const big = await page.evaluate(() => {
    const node = document.querySelector('[data-text-post="big"] [data-text-body]');
    const style = getComputedStyle(node);
    const bubble = document.querySelector('[data-speech-bubble]').getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return {
      size: parseFloat(style.fontSize),
      family: style.fontFamily,
      align: style.textAlign,
      step: node.dataset.bigStep,
      insideBubble: box.left >= bubble.left - 1 && box.right <= bubble.right + 1,
      vw: window.innerWidth,
    };
  });
  check('it is set very large', big.size >= 28, `${Math.round(big.size)}px`);
  check('in Bebas Neue, not a system substitute', /Bebas/i.test(big.family), big.family);
  check('centred in the bubble', big.align === 'center');
  check('and it does not overflow the bubble', big.insideBubble);
  check(
    'it is still the same speech bubble as the other two',
    (await page.locator('[data-text-post="big"] [data-speech-tail]').count()) === 1,
  );

  // Thirty characters is the worst case: it must step down rather than spill.
  const longestBig = await post(page, 'big', { body: 'A'.repeat(30) });
  const stepped = await page.evaluate(() => {
    const node = document.querySelector('[data-text-post="big"] [data-text-body]');
    const bubble = document.querySelector('[data-speech-bubble]').getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return {
      step: node.dataset.bigStep,
      size: parseFloat(getComputedStyle(node).fontSize),
      inside: box.right <= bubble.right + 1 && box.left >= bubble.left - 1,
      noSideScroll:
        document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0,
    };
  });
  check('a 30-character statement steps down a size', stepped.step === 's', stepped.step);
  check('and still fits inside the bubble', stepped.inside && stepped.noSideScroll);
  check('the longest one still posts', Boolean(longestBig));

  /* ===================== the limits ===================== */
  section('THE LIMITS HOLD WITHOUT THE COMPOSER');

  await page.goto('/create?kind=text&text=short', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea#caption', { timeout: 20000 });
  check(
    'the composer counts down',
    /0\/200/.test(await page.locator('[data-text-counter="body"]').innerText()),
    await page.locator('[data-text-counter="body"]').innerText(),
  );
  await page.fill('#caption', 'x'.repeat(400));
  check(
    'and will not take more than the limit',
    (await page.locator('#caption').inputValue()).length === 200,
    `${(await page.locator('#caption').inputValue()).length} characters`,
  );

  // THE ONE THAT MATTERS: the limit with the composer taken out of the way.
  // `maxLength` is removed from the field and the over-length text is set on it
  // directly, so what reaches the server action is exactly what a hand-made
  // request would send. There is no POST /api/v1/posts to aim at — the action
  // IS the endpoint — so this is the real bypass, not a simulated one.
  for (const [kind, over, cap] of [
    ['short', 900, 200],
    ['big', 400, 30],
    ['long', 4000, 1000],
  ]) {
    await page.goto(`/create?kind=text&text=${kind}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea#caption', { timeout: 20000 });
    if (kind === 'long') {
      await page.evaluate(() => {
        document.querySelector('#text_title')?.removeAttribute('maxlength');
      });
      await page.fill('#text_title', 'T'.repeat(200));
    }
    await page.evaluate(
      ({ howMany }) => {
        const field = document.querySelector('#caption');
        field.removeAttribute('maxlength');
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        ).set;
        setter.call(field, 'z'.repeat(howMany));
        field.dispatchEvent(new Event('input', { bubbles: true }));
      },
      { howMany: over },
    );
    check(
      `the ${kind} field really is over its limit before posting`,
      (await page.locator('#caption').inputValue()).length === over,
      `${(await page.locator('#caption').inputValue()).length} characters typed`,
    );
    await page.locator('[data-post-text]').click();
    await page.waitForURL(/\/post\//, { timeout: 30000 });
    const id = page.url().split('/post/')[1].split(/[?#]/)[0];
    const stored = await page.evaluate(async (postId) => {
      const response = await fetch(`/api/v1/posts/${postId}`);
      if (!response.ok) return null;
      const json = await response.json();
      return {
        caption: json?.post?.caption?.length ?? 0,
        title: json?.post?.textTitle?.length ?? 0,
        kind: json?.post?.textKind ?? null,
      };
    }, id);
    check(
      `an over-length ${kind} message is clamped by the server, not stored whole`,
      stored !== null && stored.caption === cap,
      stored ? `${stored.caption} characters against a ${cap} limit` : 'could not read it back',
    );
    if (kind === 'long') {
      check(
        'and its title is clamped to 30 as well',
        stored.title === 30,
        `${stored.title} characters`,
      );
    }
  }

  /* ===================== posts written before all this ===================== */
  section('TEXT POSTS THAT ALREADY EXISTED');

  // A post made through the ORIGINAL composer, which sends no `text_kind` at
  // all — exactly the shape of every text post already in the database. It must
  // still post, still render, and gain the bubble like everything else.
  await page.goto('/create?kind=photo', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea[name="caption"]', { timeout: 20000 });
  const legacyBody = `written the old way ${stamp}`;
  await page.fill('textarea[name="caption"]', legacyBody);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForURL(/\/post\//, { timeout: 30000 });
  const legacyId = page.url().split('/post/')[1].split(/[?#]/)[0];

  const legacyRow = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/posts/${id}`);
    const json = await response.json();
    return { kind: json?.post?.textKind ?? null, caption: json?.post?.caption ?? '' };
  }, legacyId);
  check(
    'a post written the old way stores no kind at all',
    legacyRow.kind === null,
    `text_kind: ${JSON.stringify(legacyRow.kind)}`,
  );
  check('and keeps its words', legacyRow.caption === legacyBody);
  check(
    'but is still drawn in the bubble, as a short message',
    (await page.locator('[data-text-post="short"] [data-speech-bubble]').count()) === 1,
  );
  check(
    'with a tail pointing at its author',
    (await page.locator('[data-speech-tail]').count()) === 1,
  );

  /* ===================== every surface ===================== */
  section('THE SAME BUBBLE EVERYWHERE');

  // Discover's boards are ranked by rating and by recent reaction, so a brand
  // new post is not on either until somebody reacts to it. Somebody does, and
  // the check below is then a real one rather than one that could only pass.
  // ...and Discover deliberately leaves out your OWN posts, so it is checked
  // from the reader's eyes rather than the author's, which is how anybody would
  // actually meet one of these.
  const reader = await account(browser, `rd_${stamp}`);
  await reader.page.goto(`/post/${shortId}`, { waitUntil: 'domcontentloaded' });
  await reader.page.waitForLoadState('networkidle');
  await reader.page.locator('button[aria-label="Like"]').first().click();
  await reader.page.waitForTimeout(600);
  check(
    'another account sees the bubble on the post page too',
    (await reader.page.locator('[data-speech-bubble]').count()) === 1,
  );

  // Discover's two boards are ranked, and its thirty slots fill with rated
  // posts before a new one gets a look in — so this is checked inside a quieter
  // category, where a new post really is on the page.
  const discoverBody = `found on discover ${stamp}`;
  await post(page, 'short', { body: discoverBody, category: 'Music' });

  for (const [where, url, who] of [
    ['Home', '/home', page],
    ['Following', '/home?feed=following', page],
    ['Recommended', '/home?feed=recommended', page],
    ['Discover', '/discover?category=Music', reader.page],
    // Text posts live on the profile's Text shelf, which is what the shelves
    // are for; the Posts shelf is media.
    ['the profile', `/u/${me.handle}?tab=text`, page],
    ['Search', `/search?q=${stamp}`, page],
  ]) {
    await who.goto(url, { waitUntil: 'domcontentloaded' });
    await who.waitForLoadState('networkidle');
    const seen = await who.evaluate(() => ({
      bubbles: document.querySelectorAll('[data-speech-bubble]').length,
      tails: document.querySelectorAll('[data-speech-tail]').length,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    check(
      `${where} shows text posts in the bubble`,
      seen.bubbles > 0 && seen.tails === seen.bubbles,
      `${seen.bubbles} bubbles, ${seen.tails} tails`,
    );
    if (where === 'Discover') {
      check(
        'and it really is one of ours, not just any bubble on the page',
        (await who.locator(`[data-text-body]:has-text("${discoverBody}")`).count()) === 1,
      );
    }
    check(`${where} does not scroll sideways`, seen.sideways <= 0, `${seen.sideways}px`);
  }

  /* ===================== a phone ===================== */
  section('ON A PHONE');

  const phone = await browser.newContext({
    ...devices['iPhone 13'],
    userAgent: undefined,
    baseURL: BASE,
    storageState: await me.context.storageState(),
  });
  const small = await phone.newPage();
  await small.goto(`/post/${bigId}`, { waitUntil: 'domcontentloaded' });
  await small.waitForLoadState('networkidle');
  const onPhone = await small.evaluate(() => {
    const node = document.querySelector('[data-text-post="big"] [data-text-body]');
    const bubble = document.querySelector('[data-speech-bubble]').getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return {
      fits: box.right <= bubble.right + 1,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      size: parseFloat(getComputedStyle(node).fontSize),
      vw: window.innerWidth,
    };
  });
  check('a big message fits a phone', onPhone.fits && onPhone.sideways <= 0, `${onPhone.vw}px wide`);
  check('and is still large on it', onPhone.size >= 24, `${Math.round(onPhone.size)}px`);

  await small.goto(`/post/${longId}`, { waitUntil: 'domcontentloaded' });
  await small.waitForLoadState('networkidle');
  const longOnPhone = await small.evaluate(() => ({
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bubbleWithin: (() => {
      const bubble = document.querySelector('[data-speech-bubble]').getBoundingClientRect();
      return bubble.left >= 0 && bubble.right <= window.innerWidth + 1;
    })(),
  }));
  check(
    'and a long one stays inside the screen',
    longOnPhone.bubbleWithin && longOnPhone.sideways <= 0,
  );

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
