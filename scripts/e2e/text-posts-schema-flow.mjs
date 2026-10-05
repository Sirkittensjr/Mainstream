/**
 * Text posts against a database that is behind the code.
 *
 * The bug this exists for: on a Supabase project that had not run 0011, the app
 * quietly dropped a post's kind and colour and stored the words anyway, so a
 * Big Message composed as violet arrived in the feed as a small white Short
 * Message. Every other suite runs on the local JSON driver, which stores
 * whatever it is handed, and could never have shown it.
 *
 * So this runs the app on the SUPABASE driver, against the PostgREST stub, and
 * moves the database underneath one running server: no text columns, then
 * 0011 without 0012, then both. At each step a post either keeps exactly the
 * shape its preview showed, or is refused with the draft left in place. It is
 * never stored as something else.
 *
 *   STUB_PORT=54321 OUTBOX=/tmp/fay-outbox.jsonl node scripts/e2e/gotrue-stub.mjs &
 *   PORT=55300 GOTRUE_PORT=54321 node scripts/e2e/postgrest-stub.mjs &
 *   PORT=3100 SUPABASE_URL=http://127.0.0.1:55300 \
 *     NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55300 \
 *     SUPABASE_ANON_KEY=stub SUPABASE_SERVICE_ROLE_KEY=stub-secret npm start &
 *   BASE_URL=http://localhost:3100 STUB=http://127.0.0.1:55300 \
 *     CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/e2e/text-posts-schema-flow.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const STUB = process.env.STUB || 'http://127.0.0.1:55300';
const OUTBOX = process.env.OUTBOX || '/tmp/fay-outbox.jsonl';
const CHROMIUM = process.env.CHROMIUM_PATH;
const PASSWORD = 'a long enough password';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const section = (name) => console.log(`\n######## ${name} ########`);

const TEXT_COLUMNS = ['posts.text_kind', 'posts.text_title', 'posts.text_style'];

/** Tells the stub which columns this database "does not have". */
async function schema(missing) {
  const response = await fetch(`${STUB}/__missing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ columns: missing }),
  });
  if (!response.ok) throw new Error(`stub refused /__missing: ${response.status}`);
}

/** The posts the database actually holds — the truth, not what a page shows. */
async function storedPosts() {
  return (await (await fetch(`${STUB}/__dump`)).json()).posts ?? [];
}

function confirmationLink(email) {
  const rows = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return [...rows].reverse().find((m) => m.type === 'signup' && m.to === email)?.link;
}

async function account(browser, handle) {
  const context = await browser.newContext({ baseURL: BASE });
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
  // The email links to the configured site URL; this server may be on another
  // port, so the path is followed here rather than the host.
  const { pathname, search } = new URL(link);
  await page.goto(`${pathname}${search}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  return { context, page, handle };
}

/**
 * Composes one text post and presses Post. Answers where it landed: the new
 * post's id, or the error the composer showed and whether the words survived.
 */
async function attempt(page, kind, { title, body, style }) {
  await page.goto(`/create?kind=text&text=${kind}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea#caption', { timeout: 20000 });
  if (title) await page.fill('#text_title', title);
  await page.fill('#caption', body);
  if (style) await page.locator(`[data-big-style="${style}"]`).click();
  await page.locator('[data-post-text]').click();
  await Promise.race([
    page.waitForURL(/\/post\//, { timeout: 30000 }),
    page.waitForSelector('form p.text-fay-soft', { timeout: 30000 }),
  ]);
  if (/\/post\//.test(page.url())) {
    return { id: page.url().split('/post/')[1].split(/[?#]/)[0] };
  }
  return {
    error: await page.locator('form p.text-fay-soft').innerText(),
    kept: (await page.inputValue('#caption')) === body,
    stillComposing: /\/create/.test(page.url()),
  };
}

/** How a posted message is drawn on the home feed. */
async function drawn(page, id) {
  await page.goto('/home', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const card = `[data-text-post][data-post-id="${id}"]`;
  await page.waitForSelector(card, { timeout: 20000 });
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const bubble = root.querySelector('[data-speech-bubble]');
    const body = root.querySelector('[data-text-body]');
    return {
      kind: root.dataset.textPost,
      style: root.dataset.textStyle,
      size: parseFloat(getComputedStyle(body).fontSize),
      bubbleImage: getComputedStyle(bubble).backgroundImage,
      title: root.querySelector('[data-text-title]')?.textContent ?? null,
    };
  }, card);
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROMIUM || undefined });
  const stamp = Math.random().toString(36).slice(2, 7);
  await schema([]);
  const { page } = await account(browser, `sc_${stamp}`);

  /* ================= no 0011: nothing to keep a shape in ================= */
  section('A DATABASE WITHOUT THE TEXT COLUMNS (0011 AND 0012 NOT RUN)');
  await schema(TEXT_COLUMNS);

  const bigWords = `BIG TEST ${stamp}`.toUpperCase();
  const big = await attempt(page, 'big', { body: bigWords, style: 'violet' });
  check('a violet Big Message is refused, not posted as something else', Boolean(big.error), big.error ?? `posted as ${big.id}`);
  check('the composer says it was not posted', /hasn't been posted/.test(big.error ?? ''));
  check('and keeps the words, so nothing typed is lost', big.kept === true && big.stillComposing === true);
  check(
    'nothing reached the database — no white bubble to find in the feed later',
    !(await storedPosts()).some((row) => row.caption === bigWords),
  );

  const glow = await attempt(page, 'big', { body: `GLOW ${stamp}`.toUpperCase(), style: 'glow' });
  check('a Big Message in glow is refused too: without its kind it is a small bubble', Boolean(glow.error));

  const story = await attempt(page, 'story', { title: `Tale ${stamp}`, body: 'Once there was a test.' });
  check('a Story is refused rather than stored without its title', Boolean(story.error), story.error);

  const short = await attempt(page, 'short', { body: `short ${stamp}` });
  check('a Short Message still posts, because kind-less is drawn the same', Boolean(short.id));
  if (short.id) {
    const seen = await drawn(page, short.id);
    check('and is drawn as a Short Message', seen.kind === 'short', seen.kind);
  }

  const health = await (await page.request.get('/api/health')).json();
  const columns = health.schema?.missingColumns ?? [];
  check(
    '/api/health lists the missing text columns',
    TEXT_COLUMNS.every((column) => columns.includes(column)),
    columns.join(', '),
  );
  check(
    'and names both migrations to run',
    /0011_/.test(health.schema?.note ?? '') && /0012_/.test(health.schema?.note ?? ''),
  );

  /* ============== 0011 ran, 0012 did not: kinds but no colours ============= */
  section('A DATABASE WITH 0011 BUT NOT 0012');
  await schema(['posts.text_style']);

  const violet = await attempt(page, 'big', { body: `VIOLET ${stamp}`.toUpperCase(), style: 'violet' });
  check('a violet Big Message is refused rather than reset to glow', Boolean(violet.error), violet.error);

  const plain = await attempt(page, 'big', { body: `PLAIN ${stamp}`.toUpperCase(), style: 'glow' });
  check('a glow Big Message posts, because no colour IS glow', Boolean(plain.id), plain.error);
  if (plain.id) {
    const seen = await drawn(page, plain.id);
    check('and is drawn as a Big Message, not a small one', seen.kind === 'big' && seen.size >= 30, `${seen.kind}, ${seen.size}px`);
  }

  const tale = await attempt(page, 'story', { title: `Tale ${stamp}`, body: 'Once there was a test.' });
  check('a Story posts', Boolean(tale.id), tale.error);
  if (tale.id) {
    const seen = await drawn(page, tale.id);
    check('with its title', seen.kind === 'story' && seen.title === `Tale ${stamp}`, `${seen.kind}: ${seen.title}`);
  }

  /* ========= both ran — under the SAME server, which was not restarted ======== */
  section('THE MIGRATIONS RUN UNDER A SERVER THAT KEEPS GOING');
  await schema([]);

  const after = await attempt(page, 'big', { body: bigWords, style: 'violet' });
  check(
    'the same violet Big Message now posts, with no restart in between',
    Boolean(after.id),
    after.error,
  );
  if (after.id) {
    const row = (await storedPosts()).find((each) => each.id === after.id);
    check(
      'the database holds its kind and its colour',
      row?.text_kind === 'big' && row?.text_style === 'violet',
      `${row?.text_kind} / ${row?.text_style}`,
    );
    const seen = await drawn(page, after.id);
    check(
      'and the feed draws it big, in violet',
      seen.kind === 'big' && seen.style === 'violet' && seen.bubbleImage.includes('gradient') && seen.size >= 30,
      `${seen.kind} ${seen.style} ${seen.size}px`,
    );
  }

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
