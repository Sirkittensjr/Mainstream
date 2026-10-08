/**
 * The authentication emails, rendered in a real browser at real widths.
 *
 * Each of the six templates, with Supabase's variables filled in the way they
 * arrive (an eight-digit code — the project's Email OTP Length), at phone and
 * desktop widths, three ways:
 *
 *   styled    the email as written, stylesheet and all
 *   stripped  with the <style> block removed, as Gmail does in some contexts
 *             — the inline styles alone must still hold the layout
 *   solid     with every background-image removed, as Outlook for Windows and
 *             older Gmail apps draw it — the solid fallbacks must still be
 *             FayTarra, and the button text must still read
 *
 * Checked: nothing scrolls sideways, the code fits its box on one line, the
 * button is on screen and its text is the dark ink, and the card is as wide as
 * the screen allows. With PREVIEW_DIR set, screenshots are written there.
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium PREVIEW_DIR=/tmp/email-previews \
 *     node --import tsx scripts/e2e/email-layout-flow.mjs
 *
 * Needs no server: it renders the templates from source.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { EMAILS, renderEmail } from '../../src/lib/email/templates.ts';

const CHROMIUM = process.env.CHROMIUM_PATH;
const PREVIEW = process.env.PREVIEW_DIR;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const sample = (html) =>
  html
    .replace(/\{\{ \.SiteURL \}\}/g, 'https://faytarra.com')
    .replace(/\{\{ \.TokenHash \}\}/g, 'pkce_3f9a1c27e0b84d6f')
    .replace(/\{\{ \.Token \}\}/g, '48213907')
    .replace(/\{\{ \.Email \}\}/g, 'old.address@example.com')
    .replace(/\{\{ \.NewEmail \}\}/g, 'new.address@example.com');

const VARIANTS = {
  styled: (html) => html,
  stripped: (html) => html.replace(/<style>[\s\S]*?<\/style>/g, ''),
  solid: (html) => html.replace(/background-image:[^;"]+;?/g, ''),
};

const WIDTHS = [
  ['phone-320', 320],
  ['phone-375', 375],
  ['phone-414', 414],
  ['desktop', 720],
];

async function run() {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  if (PREVIEW) mkdirSync(PREVIEW, { recursive: true });

  for (const email of EMAILS) {
    console.log(`\n######## ${email.slug} — ${email.subject} ########`);
    for (const [variant, transform] of Object.entries(VARIANTS)) {
      const html = transform(sample(renderEmail(email)));
      for (const [label, width] of WIDTHS) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          deviceScaleFactor: label === 'desktop' ? 1 : 2,
        });
        await page.setContent(html, { waitUntil: 'load' });
        const m = await page.evaluate(() => {
          const code = document.querySelector('.fay-code');
          const box = code?.parentElement;
          const link = document.querySelector('.fay-btn a');
          const card = document.querySelector('.fay-card');
          return {
            sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            codeFits: code ? code.scrollWidth <= box.clientWidth && code.getBoundingClientRect().height < 60 : null,
            button: link
              ? (() => {
                  const r = link.getBoundingClientRect();
                  return { on: r.left >= 0 && r.right <= innerWidth && r.height >= 44, ink: getComputedStyle(link).color };
                })()
              : null,
            card: card ? Math.round(card.getBoundingClientRect().width) : 0,
          };
        });
        const where = `${variant} @ ${width}px`;
        check(`${where}: nothing scrolls sideways`, m.sideways === 0, `${m.sideways}px`);
        if (m.codeFits !== null) check(`${where}: the code fits on one line`, m.codeFits);
        if (m.button) {
          check(`${where}: the button is on screen and tappable`, m.button.on);
          check(`${where}: the button text is dark ink`, m.button.ink === 'rgb(6, 6, 10)', m.button.ink);
        }
        check(`${where}: the card uses the width`, m.card >= Math.min(width - 40, 560), `${m.card}px`);
        if (PREVIEW && variant !== 'stripped' && (label === 'desktop' || label === 'phone-375')) {
          await page.screenshot({
            path: path.join(PREVIEW, `${email.slug}-${label}${variant === 'solid' ? '-solid-fallback' : ''}.png`),
            fullPage: true,
          });
        }
        await page.close();
      }
    }
    if (PREVIEW) writeFileSync(path.join(PREVIEW, `${email.slug}.html`), sample(renderEmail(email)));
  }

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
