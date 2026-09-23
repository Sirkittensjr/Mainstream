/**
 * Profile colours, end to end.
 *
 * Two accounts: one paints their profile, the other looks at it. The checks
 * are measured rather than eyeballed — the colours are read back off the
 * rendered page with `getComputedStyle`, and readability is a computed WCAG
 * contrast ratio, not an opinion.
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e/profile-colours-flow.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const CHROMIUM = process.env.CHROMIUM_PATH;
const PASSWORD = 'a long enough password';
/**
 * Set when the database behind the app has NOT had migration 0005 run against
 * it. The suite then checks the other half of the contract: the feature says
 * it is off, and nothing else about editing a profile is affected.
 */
const EXPECT_MISSING = process.env.EXPECT_NO_COLOURS === '1';

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

async function createAccount(browser, handle, interest, options = {}) {
  const context = await browser.newContext({ baseURL: BASE, ...options });
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
  return { context, page, handle };
}

/** Picks a swatch in the settings form and waits for the save to land. */
async function pick(page, group, label) {
  await page.locator(`button[aria-label="${group}: ${label}"]`).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Saving…'), undefined, {
    timeout: 20000,
  });
  await page.waitForTimeout(600);
}

/** What the profile is actually painted in, straight off the rendered page. */
const paint = (page) =>
  page.evaluate(() => {
    const skin = document.querySelector('[data-profile-skin="on"]');
    if (!skin) return null;
    const card = skin.querySelector('.card');
    const heading = card?.querySelector('h1');
    const muted = card?.querySelector('[class*="text-white/"]');

    const rgb = (value) => {
      const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
    };
    const channel = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ({ r, g, b }) =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    // Text colours carry alpha; flatten them onto the box before comparing.
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const contrast = (fg, bg) => {
      const a = luminance(over(fg, bg));
      const b = luminance(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };

    const pageBg = rgb(getComputedStyle(skin).backgroundColor);
    const boxBg = card ? rgb(getComputedStyle(card).backgroundColor) : pageBg;

    return {
      background: getComputedStyle(skin).backgroundColor,
      box: card ? getComputedStyle(card).backgroundColor : null,
      headingContrast: heading
        ? contrast(rgb(getComputedStyle(heading).color), boxBg)
        : null,
      mutedContrast: muted ? contrast(rgb(getComputedStyle(muted).color), boxBg) : null,
      pageIsPainted: pageBg.a > 0,
    };
  });

const run = async () => {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = Date.now().toString(36).slice(-6);
  const owner = `paint_${stamp}`;
  const visitor = `look_${stamp}`;

  const A = await createAccount(browser, owner, 'Art');
  const B = await createAccount(browser, visitor, 'Music');
  check('two accounts for the colour tests', true);

  if (EXPECT_MISSING) {
    section('NO MIGRATION — the columns are not there yet');

    await A.page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await A.page.locator('button[aria-label="Background: Purple"]').click();
    await A.page.waitForTimeout(2500);
    const message = await A.page.locator('body').innerText();
    check(
      'M. picking a colour says the feature is not switched on',
      /not switched on/i.test(message),
      message.split('\n').find((line) => /switched on/i.test(line)),
    );

    // The important half: the rest of the profile still saves. The colours are
    // written by their own UPDATE precisely so one missing column cannot cost
    // somebody their display name.
    await A.page.fill('#display_name', 'STILL WORKS');
    await A.page.locator('form button[type=submit]').first().click();
    await A.page.waitForTimeout(2500);
    await A.page.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
    const profile = await A.page.locator('body').innerText();
    check('M. and the rest of the profile still saves', profile.includes('STILL WORKS'));
    check('M. the profile is not painted', (await paint(A.page)) === null);
    check('M. and it did not error', !/Application error|server-side exception/i.test(profile));

    await browser.close();
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  /* ============================== defaults =============================== */
  section('DEFAULT — a profile nobody has painted');

  await A.page.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
  check('0. an unpainted profile carries no skin at all', (await paint(A.page)) === null);

  await A.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  check('0. settings offers the colours', (await A.page.locator('text=Profile colours').count()) > 0);
  for (const label of ['Black', 'Red', 'Yellow', 'Blue', 'Green', 'Orange', 'Purple']) {
    check(
      `0. ${label} is one of the background choices`,
      (await A.page.locator(`button[aria-label="Background: ${label}"]`).count()) === 1,
    );
  }
  const brights = await A.page.locator('button[aria-label^="Background: Bright"]').count();
  check('0. with brighter versions as well', brights >= 6, `${brights} bright swatches`);
  const boxChoices = await A.page.locator('button[aria-label^="Boxes:"]').count();
  check('0. and the boxes are chosen separately', boxChoices >= 8, `${boxChoices} box swatches`);

  /* ============================== painting =============================== */
  section('PAINT — black background, purple boxes');

  await pick(A.page, 'Background', 'Black');
  await pick(A.page, 'Boxes', 'Purple');

  await A.page.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
  const painted = await paint(A.page);
  check('1. the profile is painted', painted !== null);
  check('1. the background is black', painted?.background === 'rgb(7, 7, 12)', painted?.background);
  check('1. the boxes are purple', painted?.box === 'rgb(51, 18, 94)', painted?.box);
  check(
    '1. the profile still has everything on it',
    (await A.page.locator(`a[href="/u/${owner}/followers"]`).count()) === 1 &&
      (await A.page.locator(`a[href="/u/${owner}/following"]`).count()) === 1 &&
      (await A.page.locator('text=Overall').count()) > 0 &&
      (await A.page.locator('a[href="/settings"]').count()) > 0,
  );

  /* ============================== persistence ============================ */
  section('PERSIST — a refresh, and somebody else looking');

  await A.page.reload({ waitUntil: 'domcontentloaded' });
  const afterReload = await paint(A.page);
  check(
    '2. the colours survive a refresh',
    afterReload?.background === 'rgb(7, 7, 12)' && afterReload?.box === 'rgb(51, 18, 94)',
  );

  await B.page.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
  const asVisitor = await paint(B.page);
  check(
    '3. another account sees the same colours',
    asVisitor?.background === 'rgb(7, 7, 12)' && asVisitor?.box === 'rgb(51, 18, 94)',
    `${asVisitor?.background} / ${asVisitor?.box}`,
  );

  await B.page.goto(`/u/${visitor}`, { waitUntil: 'domcontentloaded' });
  check('3. and their own profile is untouched by it', (await paint(B.page)) === null);

  /* ============================== readability ============================ */
  section('READABLE — the bright combinations, measured');

  await A.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await pick(A.page, 'Background', 'Purple');
  await pick(A.page, 'Boxes', 'Bright yellow');
  await A.page.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
  const bright = await paint(A.page);
  check('4. a bright yellow box is yellow', bright?.box === 'rgb(255, 216, 77)', bright?.box);
  check(
    '4. the heading on it passes WCAG AA',
    (bright?.headingContrast ?? 0) >= 4.5,
    `${bright?.headingContrast?.toFixed(1)}:1`,
  );
  check(
    '4. and so does the quieter text',
    (bright?.mutedContrast ?? 0) >= 4.5,
    `${bright?.mutedContrast?.toFixed(1)}:1`,
  );

  await A.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await pick(A.page, 'Background', 'Bright blue');
  await pick(A.page, 'Boxes', 'Orange');
  await A.page.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
  const mixed = await paint(A.page);
  check(
    '4. a dark box on a bright background is readable too',
    (mixed?.headingContrast ?? 0) >= 4.5 && (mixed?.mutedContrast ?? 0) >= 4.5,
    `${mixed?.headingContrast?.toFixed(1)}:1 / ${mixed?.mutedContrast?.toFixed(1)}:1`,
  );

  /* ================================ phone ================================ */
  section('PHONE — the same colours, no broken layout');

  const phone = await browser.newContext({
    baseURL: BASE,
    storageState: await A.context.storageState(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const small = await phone.newPage();
  await small.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
  const onPhone = await paint(small);
  check('5. a phone shows the colours as well', onPhone?.box === 'rgb(107, 46, 5)', onPhone?.box);
  check(
    '5. nothing spills off the side',
    await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  const cardWidth = (await small.locator('.card').first().boundingBox()).width;
  check('5. the profile card still fits the screen', cardWidth <= 390 && cardWidth > 300, `${Math.round(cardWidth)}px`);
  await small.goto('/settings', { waitUntil: 'domcontentloaded' });
  check(
    '5. and the picker is usable on a phone',
    (await small.locator('button[aria-label="Boxes: Purple"]').first().isVisible()),
  );
  await phone.close();

  /* ================================ reset ================================ */
  section('RESET — back to the way it was');

  await A.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await A.page.locator('button', { hasText: 'Reset to default' }).click();
  await A.page.waitForFunction(() => !document.body.innerText.includes('Saving…'), undefined, {
    timeout: 20000,
  });
  await A.page.waitForTimeout(600);
  await A.page.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
  check('6. reset puts the profile back to the default', (await paint(A.page)) === null);

  await B.page.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
  check('6. for everybody else too', (await paint(B.page)) === null);

  /* ============================== the data =============================== */
  section('STORED — it is the database, not the browser');

  const stored = await A.page.evaluate(async () => {
    const response = await fetch('/api/v1/me');
    return response.ok ? await response.json() : null;
  });
  check('7. the reset is what the server holds', stored !== null);

  await A.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await pick(A.page, 'Background', 'Green');
  // A brand new browser, never having touched this account's settings.
  const cold = await browser.newContext({ baseURL: BASE });
  const coldPage = await cold.newPage();
  await coldPage.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
  const signedOut = await paint(coldPage);
  check(
    '7. a signed-out visitor in a clean browser sees the stored colour',
    signedOut?.background === 'rgb(11, 61, 36)',
    signedOut?.background,
  );
  await cold.close();

  /* =========================== nothing broken ============================ */
  section('UNCHANGED — the rest of the profile');

  await A.page.goto(`/u/${owner}?tab=about`, { waitUntil: 'domcontentloaded' });
  check('8. the About tab still works', (await A.page.locator('text=Joined').count()) > 0);
  await A.page.goto(`/u/${owner}/followers`, { waitUntil: 'domcontentloaded' });
  check('8. the followers list still works', /followers/i.test(await A.page.locator('body').innerText()));
  await B.page.goto(`/u/${owner}`, { waitUntil: 'domcontentloaded' });
  // Scoped to the profile header: the suggestions rail has Follow buttons of
  // its own, and counting those proves nothing about this profile.
  const profileHeader = B.page.locator('header.card');
  check(
    '8. the Follow button is still there',
    (await profileHeader.locator('button', { hasText: /^Follow$/ }).count()) === 1,
  );
  check(
    '8. and so is the rating button',
    (await profileHeader.locator('button[aria-label="Rate this"]').count()) === 1,
  );
  check(
    '8. and the message/report menu',
    (await profileHeader.locator('button[aria-label="More options"]').count()) === 1,
  );

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
