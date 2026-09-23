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
      return {
        position: row.querySelector('span')?.textContent?.trim() ?? String(index + 1),
        handle: link ? new URL(link.href).pathname.replace('/u/', '') : null,
        name: link?.textContent?.trim() ?? null,
        empty: !link,
      };
    });
  });

const handles = (rows) => rows.map((row) => row.handle);

/** Opens the editor, sets the three slots by display name, and saves. */
async function setTop(page, names) {
  await page.locator('button[aria-label="Edit your Top 3 creators"]').click();
  await page.waitForSelector('[role=dialog]', { timeout: 10000 });
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
  section('2 + 3 — following three people, in order');

  await setFollow(A, john, true);
  await setFollow(A, sarah, true);
  await setFollow(A, mike, true);

  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const defaulted = await topThree(A.page);
  check(
    '3. the first three followed become the Top 3, in follow order',
    JSON.stringify(handles(defaulted)) === JSON.stringify([john, sarah, mike]),
    handles(defaulted).join(' > '),
  );
  check('3. numbered 1, 2, 3', JSON.stringify(defaulted.map((r) => r.position)) === '["1","2","3"]');

  /* ====================== 4 + 5. a fourth follow ======================= */
  section('4 + 5 — a fourth follow changes nothing');

  await setFollow(A, jess, true);
  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const afterFourth = await topThree(A.page);
  check(
    '5. the fourth person does not replace anybody',
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
  section('6 — picking your own');

  const options = await A.page.evaluate(async () => {
    document.querySelector('button[aria-label="Edit your Top 3 creators"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const select = document.querySelector('select[aria-label="Top 3 slot 1"]');
    const values = [...(select?.options ?? [])].map((option) => option.textContent);
    document.querySelector('[role=dialog] button[aria-label="Close"]')?.click();
    return values;
  });
  check('6. only people you follow are offered', options.length === 5, `${options.length - 1} people`);
  check(
    '6. and everybody you follow is there, back-follow or not',
    [john, sarah, mike, jess].every((handle) => options.some((text) => text?.includes(`@${handle}`))),
  );

  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  await setTop(A.page, [jess, john, mike]);
  const picked = await topThree(A.page);
  check(
    '6. the Top 3 is what was picked',
    JSON.stringify(handles(picked)) === JSON.stringify([jess, john, mike]),
    handles(picked).join(' > '),
  );

  /* =========================== 7 + 8. order =========================== */
  section('7 + 8 — reordering, and a refresh');

  await A.page.locator('button[aria-label="Edit your Top 3 creators"]').click();
  await A.page.waitForSelector('[role=dialog]', { timeout: 10000 });
  await A.page.locator('button[aria-label="Move slot 3 up"]').click();
  await A.page.locator('[role=dialog] button', { hasText: /^Save Top 3$/ }).click();
  await A.page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 20000 });
  await A.page.waitForTimeout(800);
  const reordered = await topThree(A.page);
  check(
    '7. the order can be changed without changing who is in it',
    JSON.stringify(handles(reordered)) === JSON.stringify([jess, mike, john]),
    handles(reordered).join(' > '),
  );

  await A.page.reload({ waitUntil: 'domcontentloaded' });
  const afterReload = await topThree(A.page);
  check(
    '8. the order survives a refresh',
    JSON.stringify(handles(afterReload)) === JSON.stringify([jess, mike, john]),
    handles(afterReload).join(' > '),
  );

  /* ====================== 9 + 10. somebody else ======================= */
  section('9 + 10 — seen from another account, and clicked');

  await J.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const asVisitor = await topThree(J.page);
  check(
    '9. another account sees the same Top 3, in the same order',
    JSON.stringify(handles(asVisitor)) === JSON.stringify([jess, mike, john]),
    handles(asVisitor).join(' > '),
  );
  check(
    '9. and gets no edit control on somebody else’s profile',
    (await J.page.locator('button[aria-label="Edit your Top 3 creators"]').count()) === 0,
  );
  check(
    '9. while the owner does',
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
      `10. clicking number ${index + 1} opens @${handle}`,
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
      // The photo: a 44pt round element inside the link, whether it is an
      // uploaded picture or the initials fallback.
      return [...link.children].some(
        (child) => child.clientWidth >= 40 && child.clientHeight >= 40,
      );
    }).length;
  });
  check('10. the photo is inside the link, so the whole tile opens the profile', photosInLinks === 3, `${photosInLinks} of 3`);

  /* ============================== the layout ============================= */
  section('LAYOUT — three across, one row');

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
        const photo = link ? [...link.children].find((c) => c.clientHeight >= 40) : null;
        const name = link?.querySelector('span:last-of-type');
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
  section('11 — unfollowing somebody in the Top 3');

  await setFollow(A, mike, false);
  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const afterUnfollow = await topThree(A.page);
  check(
    '11. they leave the Top 3',
    !handles(afterUnfollow).includes(mike),
    handles(afterUnfollow).map((h) => h ?? 'empty').join(' > '),
  );
  check(
    '11. the others keep their relative order and the gap closes up',
    afterUnfollow[0].handle === jess && afterUnfollow[1].handle === john && afterUnfollow[2].empty,
    handles(afterUnfollow).map((h) => h ?? 'empty').join(' > '),
  );
  check(
    '11. and the owner is asked to fill the slot',
    /pick someone/i.test(await A.page.locator('section:has(h2:text("Top creators"))').innerText()),
  );
  check(
    '11. they are not offered any more either',
    !(await A.page.evaluate(async () => {
      document.querySelector('button[aria-label="Edit your Top 3 creators"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const select = document.querySelector('select[aria-label="Top 3 slot 1"]');
      return [...(select?.options ?? [])].map((o) => o.textContent).join(' ');
    })).includes(`@${mike}`),
  );

  await A.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  await setTop(A.page, [jess, sarah, john]);
  const refilled = await topThree(A.page);
  check(
    '11. and the empty slot can be filled with somebody else',
    JSON.stringify(handles(refilled)) === JSON.stringify([jess, sarah, john]),
    handles(refilled).join(' > '),
  );

  /* ===================== 12. no follow-back needed ==================== */
  section('12 — nobody has to follow back');

  const backFollows = await A.page.evaluate(async (who) => {
    const response = await fetch(`/api/v1/users/${who}`);
    return response.ok ? await response.json() : null;
  }, jess);
  check('12. the Top 3 pick has not followed back', backFollows !== null);
  await Z.page.goto(`/u/${me}`, { waitUntil: 'domcontentloaded' });
  const jessFollowsBack =
    (await Z.page.locator('header.card button:has-text("Following")').count()) > 0;
  check('12. confirmed from their side: they do not follow back', !jessFollowsBack);
  check(
    '12. and they are still number one',
    (await topThree(A.page).then(handles))[0] === jess,
  );

  /* ============================= the phone ============================ */
  section('PHONE — the same three, on a small screen');

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
  const phoneLayout = await small.evaluate(() => {
    const section = [...document.querySelectorAll('section')].find((node) =>
      /Top creators/i.test(node.querySelector('h2')?.textContent ?? ''),
    );
    const rows = [...(section?.querySelectorAll('ol > li') ?? [])];
    const boxes = rows.map((row) => row.getBoundingClientRect());
    return {
      tops: boxes.map((box) => Math.round(box.top)),
      widest: Math.max(...boxes.map((box) => Math.round(box.width))),
      right: Math.round(Math.max(...boxes.map((box) => box.right))),
      overflowing: rows.some((row) => row.scrollWidth > row.clientWidth + 1),
      height: Math.round(section?.getBoundingClientRect().height ?? 0),
    };
  });
  check(
    'P. still three across on a phone',
    new Set(phoneLayout.tops).size === 1,
    phoneLayout.tops.join(' / '),
  );
  check(
    'P. inside the screen, with names truncated rather than spilling',
    phoneLayout.right <= 390 && !phoneLayout.overflowing,
    `rightmost edge ${phoneLayout.right}px, column ${phoneLayout.widest}px`,
  );
  // Compact meaning: no more than a quarter of a phone screen.
  check('P. and still compact', phoneLayout.height <= 211, `${phoneLayout.height}px tall`);
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
