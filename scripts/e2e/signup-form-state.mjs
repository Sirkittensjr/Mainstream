/**
 * A failed signup must not cost the person everything they typed — and a
 * signup with a photo on it must not be refused before it is even read.
 *
 * React resets a `<form action={…}>` once the action settles, so uncontrolled
 * inputs are wiped by any server-side validation failure. These checks are the
 * regression guard for that, at desktop and phone width.
 *
 * The second half is the guard for `Body exceeded 1 MB limit`: signup carries
 * its avatar inside a Server Action, whose body Next.js caps at 1MB, so a
 * photo off any phone used to 413 before `signupAction` ran at all. The checks
 * below submit a picture several times that size and prove that what leaves
 * the browser is the shrunk copy.
 */
import { chromium } from 'playwright';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHROMIUM = process.env.CHROMIUM_PATH;

/** Next.js's own Server Action body ceiling, and what all of this is about. */
const ACTION_BODY_LIMIT = 1024 * 1024;
/** Kept in step with AVATAR_BUDGET_BYTES in src/lib/media/avatar-image.ts. */
const AVATAR_BUDGET_BYTES = 256 * 1024;

const CRC = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}

/**
 * A real, decodable PNG of random pixels.
 *
 * Noise so it cannot be compressed away: the point of the fixture is to weigh
 * more than the limit, the way a photograph does.
 */
function bigPng(side) {
  const raw = Buffer.alloc(side * (side * 3 + 1));
  for (let y = 0, at = 0; y < side; y += 1) {
    raw[at] = 0; // no per-row filter
    at += 1;
    for (let x = 0; x < side * 3; x += 1, at += 1) raw[at] = (Math.random() * 256) | 0;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FIXTURES = mkdtempSync(path.join(tmpdir(), 'fay-avatar-'));
const BIG_PHOTO = path.join(FIXTURES, 'big-photo.png');
writeFileSync(BIG_PHOTO, bigPng(1200));
const BIG_PHOTO_BYTES = statSync(BIG_PHOTO).size;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const read = (page) =>
  page.evaluate(() => ({
    email: document.querySelector('#email')?.value ?? null,
    username: document.querySelector('#username')?.value ?? null,
    password: document.querySelector('#password')?.value ?? null,
    displayName: document.querySelector('#display_name')?.value ?? null,
    bio: document.querySelector('textarea[name=bio]')?.value ?? null,
    location: document.querySelector('input[name=location]')?.value ?? null,
    interests: [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) =>
      b.textContent.trim(),
    ),
  }));

async function fill(page, values) {
  await page.fill('#email', values.email);
  await page.fill('#username', values.username);
  await page.fill('#password', values.password);
  await page.fill('#display_name', values.displayName);
  await page.fill('textarea[name=bio]', values.bio);
  await page.fill('input[name=location]', values.location);
}

async function run(label, viewport, isMobile) {
  console.log(`\n######## ${label} ########`);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const context = await browser.newContext({ baseURL: BASE, viewport, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  const stamp = Date.now().toString(36);

  const typed = {
    email: `keep_${stamp}@example.com`,
    username: `keep_${stamp}`.slice(0, 20),
    password: 'a long enough password',
    displayName: 'Keep Me',
    bio: 'this bio should survive',
    location: 'Leeds',
  };

  // --- 1-5. everything filled in EXCEPT an interest, then submit ----------
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await fill(page, typed);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForTimeout(3500);

  // --- 6. the validation error appears, next to the interests ------------
  const interestError = page.locator('fieldset', { hasText: 'What are you into?' }).locator('[role=alert]');
  check(
    'the error appears beside the interests, not only in a banner',
    (await interestError.count()) > 0 && /Pick at least one/i.test(await interestError.first().innerText()),
  );

  // --- 7. everything else is still there ---------------------------------
  let now = await read(page);
  check('email is still filled in', now.email === typed.email, JSON.stringify(now.email));
  check('username is still filled in', now.username === typed.username, JSON.stringify(now.username));
  check('display name is still filled in', now.displayName === typed.displayName);
  check('bio is still filled in', now.bio === typed.bio);
  check('location is still filled in', now.location === typed.location);
  check('password was cleared, deliberately', now.password === '', JSON.stringify(now.password));

  // --- and a second failure keeps them too -------------------------------
  await page.locator('button[aria-pressed]', { hasText: 'Music' }).first().click();
  await page.locator('button[aria-pressed]', { hasText: 'Art' }).first().click();
  await page.fill('#username', 'tommy'); // taken: fails server-side, not in the browser
  await page.fill('#password', typed.password);
  await page.locator('form button[type=submit]').last().click();
  await page.waitForTimeout(3500);

  const taken = page.locator('#username-error');
  check(
    'a taken username reports beside the username field',
    (await taken.count()) > 0 && /taken/i.test(await taken.innerText()),
  );
  now = await read(page);
  check('email survived the second failure', now.email === typed.email);
  check('bio survived the second failure', now.bio === typed.bio);
  check('location survived the second failure', now.location === typed.location);
  check(
    'chosen interests are still selected',
    now.interests.includes('Music') && now.interests.includes('Art'),
    now.interests.join(', '),
  );

  // --- fixing the one bad field is now enough to get through -------------
  await page.fill('#username', `keep2_${stamp}`.slice(0, 20));
  await page.fill('#password', typed.password);
  await Promise.all([
    page.waitForURL(/verify-email|home/, { timeout: 25000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
  check(
    'correcting only the bad field completes the signup',
    /verify-email|home/.test(page.url()),
    page.url(),
  );

  await browser.close();
}

/**
 * Signing up WITH a photo, which is the case that used to 413.
 *
 * The fixture is a 1200x1200 PNG of noise — several megabytes, the weight of a
 * real camera photo and far past the Server Action ceiling.
 */
async function runAvatar(label, viewport, isMobile) {
  console.log(`\n######## ${label} ########`);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const context = await browser.newContext({ baseURL: BASE, viewport, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  const stamp = Date.now().toString(36);

  // Nothing in a working signup may come back 413, whatever the reason.
  const refused = [];
  page.on('response', (response) => {
    if (response.status() === 413) refused.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await fill(page, {
    email: `photo_${stamp}@example.com`,
    username: `photo_${stamp}`.slice(0, 20),
    password: 'a long enough password',
    displayName: 'Photo Person',
    bio: 'signing up with a picture',
    location: 'Leeds',
  });
  await page.locator('button[aria-pressed]', { hasText: 'Music' }).first().click();

  // --- the picker cannot submit the original ------------------------------
  check(
    'the visible file picker carries no name, so the raw photo is never a form field',
    (await page.getAttribute('#avatar', 'name')) === null,
    JSON.stringify(await page.getAttribute('#avatar', 'name')),
  );

  await page.setInputFiles('#avatar', BIG_PHOTO);
  await page.waitForFunction(
    () => document.querySelector('input[name=avatar]')?.files?.length > 0,
    undefined,
    { timeout: 20000 },
  );

  const attached = await page.evaluate(() => {
    const file = document.querySelector('input[name=avatar]')?.files?.[0];
    return file ? { name: file.name, size: file.size, type: file.type } : null;
  });

  check(
    'the fixture really is bigger than a Server Action body',
    BIG_PHOTO_BYTES > ACTION_BODY_LIMIT,
    `${(BIG_PHOTO_BYTES / (1024 * 1024)).toFixed(1)}MB`,
  );
  check('a prepared photo is attached to the form', attached !== null, JSON.stringify(attached));
  check(
    'the attached photo is inside the avatar budget',
    attached !== null && attached.size <= AVATAR_BUDGET_BYTES,
    attached ? `${(attached.size / 1024).toFixed(0)}KB` : 'nothing attached',
  );
  check(
    'the attached photo is well under the 1MB action limit',
    attached !== null && attached.size < ACTION_BODY_LIMIT / 2,
    attached ? `${(attached.size / 1024).toFixed(0)}KB` : 'nothing attached',
  );
  check(
    'it was re-encoded to a format the server can identify',
    attached !== null && ['image/webp', 'image/jpeg'].includes(attached.type),
    attached?.type,
  );
  check('a preview of the photo is shown', (await page.locator('label[for=avatar] img').count()) > 0);

  // --- and the signup goes through ----------------------------------------
  await Promise.all([
    page.waitForURL(/verify-email|home/, { timeout: 25000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
  check(
    'signing up with a multi-megabyte photo completes',
    /verify-email|home/.test(page.url()),
    page.url(),
  );
  check('nothing in the signup was refused with 413', refused.length === 0, refused.join('; '));

  await browser.close();
}

/** The same form with no photo at all still has to be the simple case. */
async function runNoAvatar(label, viewport, isMobile) {
  console.log(`\n######## ${label} ########`);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const context = await browser.newContext({ baseURL: BASE, viewport, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  const stamp = Date.now().toString(36);

  const refused = [];
  page.on('response', (response) => {
    if (response.status() === 413) refused.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await fill(page, {
    email: `plain_${stamp}@example.com`,
    username: `plain_${stamp}`.slice(0, 20),
    password: 'a long enough password',
    displayName: 'Plain Person',
    bio: '',
    location: '',
  });
  await page.locator('button[aria-pressed]', { hasText: 'Music' }).first().click();
  await Promise.all([
    page.waitForURL(/verify-email|home/, { timeout: 25000 }),
    page.locator('form button[type=submit]').last().click(),
  ]);
  check(
    'email, username, password, display name and one interest is enough',
    /verify-email|home/.test(page.url()),
    page.url(),
  );
  check('nothing was refused with 413', refused.length === 0, refused.join('; '));

  await browser.close();
}

await run('DESKTOP 1440x900', { width: 1440, height: 900 }, false);
await run('MOBILE 390x844', { width: 390, height: 844 }, true);
await runAvatar('AVATAR — DESKTOP 1440x900', { width: 1440, height: 900 }, false);
await runAvatar('AVATAR — MOBILE 390x844', { width: 390, height: 844 }, true);
await runNoAvatar('NO PHOTO — MOBILE 390x844', { width: 390, height: 844 }, true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
