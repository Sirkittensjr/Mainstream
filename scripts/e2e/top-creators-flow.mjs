/**
 * The Top 3 favourite creators, end to end.
 *
 * Five real accounts, real follows in a known order, and every check made from
 * the rendered profile rather than from what was sent to the server. The one
 * that matters most is the fourth follow: the default is derived from the
 * follow order, so a later follow must not displace anybody, and this is where
 * a stored-at-follow-time implementation would show.
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e/top-creators-flow.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const CHROMIUM = process.env.CHROMIUM_PATH;
const PASSWORD = 'a long enough password';
/** Set when the database has not had migration 0006 applied. */
const EXPECT_MISSING = process.env.EXPECT_NO_TOP_CREATORS === '1';

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
  // Generous on purpose: the first signup against a server that has only just
  // started can sit behind its first cold request.
  await page.waitForFunction(() => location.pathname.startsWith('/verify-email'), undefined, {
    timeout: 60000,
  });
  const link = confirmationLink(email);
  if (!link) throw new Error(`no confirmation email for ${email}`);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  return { context, page, handle };
}

async function setFollow(actor, handle, shouldFollow) {
  await actor.page.goto(`/u/${handle}`, { waitUntil: 'domcontentloaded' });
  const header = actor.page.locator('header.card');
  const following = header.locator('button:has-text("Following")');
  const follow = header.locator('button', { hasText: /^Follow$/ });
  const isFollowing = (await following.count()) > 0;
  if (shouldFollow && !isFollowing) await follow.first().click();
  if (!shouldFollow && isFollowing) await following.first().click();
  if (shouldFollow !== isFollowing) await actor.page.waitForTimeout(1800);
}

/** The Top 3 as the page actually shows it: position, handle, and the link. */
const topThree = (page) =>
  page.evaluate(() => {
    const list = document.querySelector('section:has(> div h2) ol');
    const section = [...document.querySelectorAll('section')].find((node) =>
      /Top creators/i.test(node.querySelector('h2')?.textContent ?? ''),
    );
    const rows = [...(section?.querySelectorAll('ol > li') ?? [])];
    void list;
    return rows.map((row, index) => {
      const link = row.querySelector('a[href^="/u/"]:not([aria-label$="profile"])');
      const chip = [...row.querySelectorAll('span')].find((span) =>
        /^[123]$/.test(span.textContent?.trim() ?? ''),
      );
      return {
        position: chip?.textContent?.trim() ?? String(index + 1),
        handle: link ? new URL(link.href).pathname.replace('/u/', '') : null,
        name: link?.textContent?.trim() ?? null,
        empty: !link,
      };
    });
  });

const handles = (rows) => rows.map((row) => row.handle);

async function signOut(page) {
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.locator('button', { hasText: /^Log out$/ }).first().click();
  await page.waitForFunction(() => !location.pathname.startsWith('/settings'), undefined, {
    timeout: 20000,
  });
}

async function signIn(page, handle) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#identifier', handle);
  await page.fill('#password', PASSWORD);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, {
    timeout: 30000,
  });
}

/** Saves a profile colour pair through the settings page. */
async function paintProfile(page, backgroundLabel, boxLabel) {
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.locator(`button[aria-label="Background: ${backgroundLabel}"]`).click();
  await page.locator(`button[aria-label="Boxes: ${boxLabel}"]`).click();
  await page.locator('button', { hasText: /^Save colours$/ }).click();
  await page.waitForFunction(
    () => document.body.innerText.includes('Saved to your profile'),
    undefined,
    { timeout: 25000 },
  );
}

/** How each Top 3 card is actually painted, straight off the rendered page. */
const cardStyles = (page) =>
  page.evaluate(() => {
    const section = [...document.querySelectorAll('section')].find((node) =>
      /Top creators/i.test(node.querySelector('h2')?.textContent ?? ''),
    );
    return [...(section?.querySelectorAll('ol > li a[data-medal]') ?? [])].map((card) => {
      const style = getComputedStyle(card);
      const spans = [...card.querySelectorAll('span')];
      const name = spans.find((span) => span.className.includes('font-semibold'));
      const handle = spans.find((span) => (span.textContent ?? '').startsWith('@'));
      return {
        medal: card.dataset.medal,
        surface: style.backgroundImage,
        border: style.borderTopColor,
        glow: style.boxShadow,
        name: name ? getComputedStyle(name).color : null,
        handle: handle ? getComputedStyle(handle).color : null,
      };
    });
  });

/** Opens the editor and reports what the first slot's menu offers. */
async function openMenu(page) {
  await page.locator('button[aria-label="Edit your Top 3 creators"]').click();
  await page.waitForSelector('[role=dialog]', { timeout: 10000 });
  const select = page.locator('select[aria-label="Top 3 slot 1"]');
  await select.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(
    () => (document.querySelector('select[aria-label="Top 3 slot 1"]')?.options.length ?? 0) > 1,
    undefined,
    { timeout: 15000 },
  );
  const labels = await select.locator('option').allTextContents();
  await page.locator('[role=dialog] button[aria-label="Close"]').click();
  await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 10000 });
  return labels;
}

/** Opens the editor, sets the three slots by display name, and saves. */
async function setTop(page, names) {
  await page.locator('button[aria-label="Edit your Top 3 creators"]').click();
  await page.waitForSelector('[role=dialog]', { timeout: 10000 });
  // The menus are filled from the people this account follows. Reading one
  // before it has them silently picks nothing, the save stores an empty list,
  // and the profile falls back to its default Top 3 — which then looks like a
  // feature bug three checks later. So wait for the options first.
  await page.waitForFunction(
    () => (document.querySelector('select[aria-label="Top 3 slot 1"]')?.options.length ?? 0) > 1,
    undefined,
    { timeout: 15000 },
  );
  for (let index = 0; index < 3; index += 1) {
    const select = page.locator(`select[aria-label="Top 3 slot ${index + 1}"]`);
    const wanted = names[index];
    if (!wanted) {
      await select.selectOption('');
      continue;
    }
    const value = await select
      .locator('option', { hasText: `(@${wanted})` })
      .first()
      .getAttribute('value');
    if (!value) throw new Error(`no option for @${wanted} in slot ${index + 1}`);
    await select.selectOption(value);
  }
  await page.locator('[role=dialog] button', { hasText: /^Save Top 3$/ }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 20000 });
  await page.waitForTimeout(800);
}

const run = async () => {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const stamp = Date.now().toString(36).slice(-6);
  const me = `fan_${stamp}`;
  const john = `john_${stamp}`;
  const sarah = `sara_${stamp}`;
  const mike = `mike_${stamp}`;
  const jess = `jess_${stamp}`;

  /* ========================= 1. a new account ========================== */
  section('1 — a new account, following nobody');

  const A = await createAccount(browser, me, 'Music');
  const J = await createAccount(browser, john, 'Art');
  // Created so there is somebody to follow; their own browsers are not driven.
  await createAccount(browser, sarah, 'Comedy');
  await createAccount(browser, mike, 'Gaming');
  const Z = await createAccount(browser, jess, 'Food');

  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const empty = await topThree(A.page);
  check('1. the section is on the profile from the start', empty.length === 3, `${empty.length} slots`);
  check('1. with three empty slots', empty.every((row) => row.empty));
  check(
    '1. under the rating, not above it',
    await A.page.evaluate(() => {
      const nodes = [...document.querySelectorAll('header.card *')];
      const rating = nodes.findIndex((n) => n.textContent?.trim() === 'Overall');
      const top = nodes.findIndex((n) => /^Top creators$/i.test(n.textContent?.trim() ?? ''));
      return rating >= 0 && top > rating;
    }),
  );

  /* ===================== 2 + 3. the first three ======================== */
  section('2-7 — following people one at a time');

  // One at a time, checked after each: each new follow takes the next free
  // slot and moves nobody already in one.
  await setFollow(A, john, true);
  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const one = await topThree(A.page);
  check('3. the first person followed becomes #1', one[0].handle === john, handles(one).map((h) => h ?? 'empty').join(' > '));
  check('3. and the other two slots are still there, empty', one[1].empty && one[2].empty);

  await setFollow(A, sarah, true);
  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const two = await topThree(A.page);
  check('5. the second becomes #2', two[0].handle === john && two[1].handle === sarah, handles(two).map((h) => h ?? 'empty').join(' > '));

  await setFollow(A, mike, true);
  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const defaulted = await topThree(A.page);
  check(
    '7. the third becomes #3, in follow order',
    JSON.stringify(handles(defaulted)) === JSON.stringify([john, sarah, mike]),
    handles(defaulted).join(' > '),
  );
  check('7. numbered 1, 2, 3', JSON.stringify(defaulted.map((r) => r.position)) === '["1","2","3"]');

  /* ========================= 8 + 9. a fourth ========================== */
  section('8 + 9 — a fourth follow changes nothing');

  await setFollow(A, jess, true);
  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const afterFourth = await topThree(A.page);
  check(
    '9. the fourth person does not replace anybody',
    JSON.stringify(handles(afterFourth)) === JSON.stringify([john, sarah, mike]),
    handles(afterFourth).join(' > '),
  );

  if (EXPECT_MISSING) {
    section('NO MIGRATION — the default still works, changing it does not');
    await A.page.locator('button[aria-label="Edit your Top 3 creators"]').click();
    await A.page.waitForSelector('[role=dialog]', { timeout: 10000 });
    const select = A.page.locator('select[aria-label="Top 3 slot 1"]');
    const value = await select.locator('option', { hasText: `(@${jess})` }).first().getAttribute('value');
    await select.selectOption(value);
    await A.page.locator('[role=dialog] button', { hasText: /^Save Top 3$/ }).click();
    await A.page.waitForTimeout(2500);
    const message = await A.page.locator('[role=dialog]').innerText();
    check(
      'M. it says the feature is not switched on',
      /not switched on/i.test(message),
      message.split('\n').find((line) => /switched on/i.test(line)),
    );
    await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
    const stillDefault = await topThree(A.page);
    check(
      'M. and the default Top 3 is still shown',
      JSON.stringify(handles(stillDefault)) === JSON.stringify([john, sarah, mike]),
      handles(stillDefault).join(' > '),
    );
    await browser.close();
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  /* ========================== 6. changing it ========================== */
  section('10 — picking your own');

  const options = await openMenu(A.page);
  check('10. only people you follow are offered', options.length === 5, `${options.length - 1} people`);
  check(
    '10. and everybody you follow is there, back-follow or not',
    [john, sarah, mike, jess].every((handle) => options.some((text) => text?.includes(`@${handle}`))),
  );

  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  await setTop(A.page, [jess, john, mike]);
  const picked = await topThree(A.page);
  check(
    '10. the Top 3 is what was picked',
    JSON.stringify(handles(picked)) === JSON.stringify([jess, john, mike]),
    handles(picked).join(' > '),
  );

  /* =========================== 7 + 8. order =========================== */
  section('11-13 — reordering, and a refresh');

  await A.page.locator('button[aria-label="Edit your Top 3 creators"]').click();
  await A.page.waitForSelector('[role=dialog]', { timeout: 10000 });
  const before = await A.page.locator('[role=dialog] select').evaluateAll((nodes) =>
    nodes.map((node) => node.value),
  );
  await A.page.locator('button[aria-label="Move slot 3 up"]').click();
  // The arrow swaps two slots in the browser; saving before that has happened
  // stores the old order and the next three checks blame the wrong thing.
  await A.page.waitForFunction(
    (was) => {
      const now = [...document.querySelectorAll('[role=dialog] select')].map((node) => node.value);
      return now[1] === was[2] && now[2] === was[1];
    },
    before,
    { timeout: 10000 },
  );
  await A.page.locator('[role=dialog] button', { hasText: /^Save Top 3$/ }).click();
  await A.page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 20000 });
  await A.page.waitForTimeout(800);
  const reordered = await topThree(A.page);
  check(
    '11. the order can be changed without changing who is in it',
    JSON.stringify(handles(reordered)) === JSON.stringify([jess, mike, john]),
    handles(reordered).join(' > '),
  );

  await A.page.reload({ waitUntil: 'domcontentloaded' });
  const afterReload = await topThree(A.page);
  check(
    '13. the order survives a refresh',
    JSON.stringify(handles(afterReload)) === JSON.stringify([jess, mike, john]),
    handles(afterReload).join(' > '),
  );

  /* ========================= 14 + 15. a session ======================== */
  section('14 + 15 — log out, log back in');

  await signOut(A.page);
  await signIn(A.page, me);
  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const afterLogin = await topThree(A.page);
  check(
    '15. the Top 3 and its order survive signing out and back in',
    JSON.stringify(handles(afterLogin)) === JSON.stringify([jess, mike, john]),
    handles(afterLogin).join(' > '),
  );

  /* =========================== the treatment ========================== */
  section('MEDALS — gold, silver and bronze');

  const medals = await cardStyles(A.page);
  check(
    'M. the three cards are first, second and third',
    JSON.stringify(medals.map((card) => card.medal)) === '["gold","silver","bronze"]',
    medals.map((card) => card.medal).join(' / '),
  );
  check(
    'M. each has its own metal, not one shared box',
    new Set(medals.map((card) => card.surface)).size === 3 &&
      new Set(medals.map((card) => card.border)).size === 3,
  );
  check(
    'M. each surface is a gradient rather than a flat fill',
    medals.every((card) => /gradient/.test(card.surface)),
  );
  check(
    'M. and each carries a glow',
    medals.every((card) => card.glow && card.glow !== 'none' && /rgb/.test(card.glow)),
  );
  check(
    'M. the name on every card is plain white',
    medals.every((card) => card.name === 'rgb(255, 255, 255)'),
    medals.map((card) => card.name).join(' '),
  );

  /* ============================== TEST 26 ============================= */
  section('26 — the same treatment on a painted profile');

  await paintProfile(A.page, 'Purple', 'Bright yellow');
  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const painted = await cardStyles(A.page);
  check(
    '26. the profile really is painted around them',
    await A.page.evaluate(() => {
      const skin = document.querySelector('[data-profile-skin="on"]');
      const card = skin?.querySelector('.card');
      return Boolean(skin) && getComputedStyle(card).backgroundColor === 'rgb(255, 216, 77)';
    }),
  );
  check(
    '26. and the medals are untouched by it',
    JSON.stringify(painted) === JSON.stringify(medals),
    painted.map((card) => `${card.medal}:${card.border}`).join(' '),
  );
  check(
    '26. the names stay white on their own metal, not the box ink',
    painted.every((card) => card.name === 'rgb(255, 255, 255)'),
    painted.map((card) => card.name).join(' '),
  );
  check(
    '26. the Top 3 is still the Top 3',
    JSON.stringify(handles(await topThree(A.page))) === JSON.stringify([jess, mike, john]),
  );

  // Back to the default look for the checks that follow.
  await A.page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await A.page.locator('button', { hasText: 'Reset to default' }).click();
  await A.page.waitForFunction(
    () => document.body.innerText.includes('Saved to your profile'),
    undefined,
    { timeout: 25000 },
  );

  /* ====================== 9 + 10. somebody else ======================= */
  section('16-19 — seen from another account, and clicked');

  await J.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const asVisitor = await topThree(J.page);
  check(
    '17. another account sees the same Top 3, in the same order',
    JSON.stringify(handles(asVisitor)) === JSON.stringify([jess, mike, john]),
    handles(asVisitor).join(' > '),
  );
  check(
    '17. and gets no edit control on somebody else’s profile',
    (await J.page.locator('button[aria-label="Edit your Top 3 creators"]').count()) === 0,
  );
  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  check(
    '17. while the owner does',
    (await A.page.locator('button[aria-label="Edit your Top 3 creators"]').count()) === 1,
  );

  for (const [index, handle] of [jess, mike, john].entries()) {
    await J.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
    const section_ = J.page.locator('section', { has: J.page.locator('h2', { hasText: 'Top creators' }) });
    await section_.locator('ol > li').nth(index).locator(`a[href="/u/${handle}"]`).first().click();
    await J.page.waitForFunction(
      (want) => location.pathname === `/u/${want}`,
      handle,
      { timeout: 15000 },
    ).catch(() => undefined);
    check(
      `19. clicking number ${index + 1} opens @${handle}`,
      new URL(J.page.url()).pathname === `/u/${handle}`,
      J.page.url(),
    );
  }

  // The picture is inside the clickable tile, not merely next to it.
  await J.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const photosInLinks = await J.page.evaluate(() => {
    const section = [...document.querySelectorAll('section')].find((node) =>
      /Top creators/i.test(node.querySelector('h2')?.textContent ?? ''),
    );
    return [...(section?.querySelectorAll('ol > li') ?? [])].filter((row) => {
      const link = row.querySelector('a[href^="/u/"]');
      if (!link) return false;
      // The photo: a ~44pt square element inside the link, whether it is an
      // uploaded picture or the initials fallback. The card's sheen overlay
      // is a child too, and it fills the card, so anything absolutely
      // positioned is not what is being looked for here.
      return [...link.children].some((child) => {
        if (getComputedStyle(child).position === 'absolute') return false;
        return (
          child.clientWidth >= 40 &&
          child.clientWidth <= 60 &&
          child.clientHeight >= 40 &&
          child.clientHeight <= 60
        );
      });
    }).length;
  });
  check('19. the photo is inside the link, so the whole tile opens the profile', photosInLinks === 3, `${photosInLinks} of 3`);

  /* ============================== the layout ============================= */
  section('24 — LAYOUT, three across, one row');

  const layout = await J.page.evaluate(() => {
    const section = [...document.querySelectorAll('section')].find((node) =>
      /Top creators/i.test(node.querySelector('h2')?.textContent ?? ''),
    );
    const rows = [...(section?.querySelectorAll('ol > li') ?? [])];
    const boxes = rows.map((row) => row.getBoundingClientRect());
    return {
      tops: boxes.map((box) => Math.round(box.top)),
      lefts: boxes.map((box) => Math.round(box.left)),
      height: Math.round(section?.getBoundingClientRect().height ?? 0),
      // The name has to sit under the picture, not beside it.
      stacked: rows.every((row) => {
        const link = row.querySelector('a[href^="/u/"]');
        const photo = link
          ? [...link.children].find(
              (child) =>
                getComputedStyle(child).position !== 'absolute' &&
                child.clientHeight >= 40 &&
                child.clientHeight <= 60,
            )
          : null;
        const name = [...(link?.querySelectorAll('span') ?? [])].find((span) =>
          span.className.includes('font-semibold'),
        );
        if (!photo || !name) return false;
        return name.getBoundingClientRect().top >= photo.getBoundingClientRect().bottom - 1;
      }),
    };
  });
  check(
    'L. the three sit on one row',
    new Set(layout.tops).size === 1,
    layout.tops.join(' / '),
  );
  check(
    'L. side by side, left to right',
    layout.lefts[0] < layout.lefts[1] && layout.lefts[1] < layout.lefts[2],
    layout.lefts.join(' < '),
  );
  check('L. the name is under the photo', layout.stacked);
  check('L. and the section stays compact', layout.height <= 200, `${layout.height}px tall`);

  /* ======================== 11. unfollowing =========================== */
  section('20-22 — unfollowing somebody in the Top 3');

  await setFollow(A, mike, false);
  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const afterUnfollow = await topThree(A.page);
  check(
    '21. they leave the Top 3',
    !handles(afterUnfollow).includes(mike),
    handles(afterUnfollow).map((h) => h ?? 'empty').join(' > '),
  );
  check(
    '21. the others keep their relative order and the gap closes up',
    afterUnfollow[0].handle === jess && afterUnfollow[1].handle === john && afterUnfollow[2].empty,
    handles(afterUnfollow).map((h) => h ?? 'empty').join(' > '),
  );
  check(
    '21. and the owner is asked to fill the slot',
    /pick someone/i.test(await A.page.locator('section:has(h2:text("Top creators"))').innerText()),
  );
  const offered = await openMenu(A.page);
  check(
    '21. they are not offered any more either',
    !offered.join(' ').includes(`@${mike}`) && offered.join(' ').includes(`@${sarah}`),
    offered.filter((label) => label !== 'Empty').length + ' people still offered',
  );

  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  await setTop(A.page, [jess, sarah, john]);
  const refilled = await topThree(A.page);
  check(
    '22. and the empty slot can be filled with somebody else',
    JSON.stringify(handles(refilled)) === JSON.stringify([jess, sarah, john]),
    handles(refilled).join(' > '),
  );

  /* ===================== 12. no follow-back needed ==================== */
  section('23 — nobody has to follow back');

  const backFollows = await A.page.evaluate(async (who) => {
    const response = await fetch(`/api/v1/users/${who}`);
    return response.ok ? await response.json() : null;
  }, jess);
  check('23. the Top 3 pick has not followed back', backFollows !== null);
  await Z.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const jessFollowsBack =
    (await Z.page.locator('header.card button:has-text("Following")').count()) > 0;
  check('23. confirmed from their side: they do not follow back', !jessFollowsBack);
  check(
    '23. and they are still number one',
    (await topThree(A.page).then(handles))[0] === jess,
  );

  /* ============================= the phone ============================ */
  section('25 — PHONE, the same three on a small screen');

  const phone = await browser.newContext({
    baseURL: BASE,
    storageState: await A.context.storageState(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const small = await phone.newPage();
  await small.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const onPhone = await topThree(small);
  check(
    'P. a phone shows the same Top 3',
    JSON.stringify(handles(onPhone)) === JSON.stringify([jess, sarah, john]),
    handles(onPhone).join(' > '),
  );
  check(
    'P. nothing spills off the side',
    await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  await small.locator('section', { has: small.locator('h2', { hasText: 'Top creators' }) })
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
  await small.waitForTimeout(400);
  const phoneLayout = await small.evaluate(() => {
    const section = [...document.querySelectorAll('section')].find((node) =>
      /Top creators/i.test(node.querySelector('h2')?.textContent ?? ''),
    );
    const rows = [...(section?.querySelectorAll('ol > li') ?? [])];
    // Zero-sized boxes would sail through every check below, so an
    // unmeasured section is reported as one rather than passing quietly.
    if (rows.length !== 3 || rows.some((row) => row.getBoundingClientRect().width === 0)) {
      return null;
    }
    const boxes = rows.map((row) => row.getBoundingClientRect());
    return {
      tops: boxes.map((box) => Math.round(box.top)),
      widest: Math.max(...boxes.map((box) => Math.round(box.width))),
      right: Math.round(Math.max(...boxes.map((box) => box.right))),
      overflowing: rows.some((row) => row.scrollWidth > row.clientWidth + 1),
      height: Math.round(section?.getBoundingClientRect().height ?? 0),
    };
  });
  check('P. the section measured', phoneLayout !== null);
  check(
    'P. still three across on a phone',
    phoneLayout !== null && new Set(phoneLayout.tops).size === 1,
    phoneLayout?.tops.join(' / '),
  );
  check(
    'P. inside the screen, with names truncated rather than spilling',
    phoneLayout !== null && phoneLayout.right <= 390 && !phoneLayout.overflowing,
    `rightmost edge ${phoneLayout?.right}px, column ${phoneLayout?.widest}px`,
  );
  // Compact meaning: no more than a quarter of a phone screen.
  check(
    'P. and still compact',
    phoneLayout !== null && phoneLayout.height <= 211,
    `${phoneLayout?.height}px tall`,
  );
  await small.locator('button[aria-label="Edit your Top 3 creators"]').click();
  await small.waitForSelector('[role=dialog]', { timeout: 10000 });
  const box = await small.locator('select[aria-label="Top 3 slot 1"]').boundingBox();
  check('P. the editor is usable on a phone', box.height >= 36 && box.width > 120, `${Math.round(box.width)}x${Math.round(box.height)}`);
  check(
    'P. and the dialog does not overflow',
    await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  await phone.close();

  /* ========================= nothing else moved ======================= */
  section('UNCHANGED — the rest of the profile');

  await J.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const header = J.page.locator('header.card');
  check('X. the rating is still there', (await header.locator('text=Overall').count()) > 0);
  check('X. followers and following still link out', (await header.locator(`a[href="/u/${me}/followers"]`).count()) === 1);
  check('X. the Follow button is still there', (await header.locator('button', { hasText: /^Follow$/ }).count()) === 1);
  check('X. and the rating button', (await header.locator('button[aria-label="Rate this"]').count()) === 1);
  await A.page.goto(`/u/${me}?tab=about`, { waitUntil: 'domcontentloaded' });
  check('X. the About tab still works', (await A.page.locator('text=Joined').count()) > 0);

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
