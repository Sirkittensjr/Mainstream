/**
 * Writes the authentication email templates out for pasting into Supabase.
 *
 *   npm run email:build          # regenerate supabase/templates/
 *   npm run email:build preview  # also write a single preview page
 *
 * The HTML that Supabase actually sends lives in the Supabase dashboard, not in
 * this repository, so these files are the source of truth for what gets pasted
 * there. Regenerate and re-paste after any change — supabase/templates/README.md
 * says exactly where each file goes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EMAILS, renderEmail } from '../src/lib/email/templates.ts';

const OUT = path.join(process.cwd(), 'supabase', 'templates');
mkdirSync(OUT, { recursive: true });

const written = [];
for (const email of EMAILS) {
  const html = renderEmail(email);
  writeFileSync(path.join(OUT, `${email.slug}.html`), html, 'utf8');
  writeFileSync(path.join(OUT, `${email.slug}.txt`), `${email.text}\n`, 'utf8');
  written.push(`${email.slug.padEnd(18)} ${String(html.length).padStart(6)} bytes  →  "${email.dashboardTemplate}"  ·  ${email.subject}`);
}

writeFileSync(
  path.join(OUT, 'subjects.json'),
  `${JSON.stringify(
    Object.fromEntries(EMAILS.map((email) => [email.dashboardTemplate, email.subject])),
    null,
    2,
  )}\n`,
  'utf8',
);

if (process.argv[2] === 'preview') {
  // Every template on one page, with the Supabase variables filled in by
  // plausible values, so the design can be looked at in a browser.
  const sample = (html) =>
    html
      .replace(/\{\{ \.ConfirmationURL \}\}/g, 'https://faytarra.com/auth/callback?code=example-code')
      .replace(/\{\{ \.Token \}\}/g, '482915')
      .replace(/\{\{ \.Email \}\}/g, 'old@example.com')
      .replace(/\{\{ \.NewEmail \}\}/g, 'new@example.com');

  const page = EMAILS.map(
    (email) => `<section style="margin:0 0 40px;">
  <p style="font:600 13px -apple-system,sans-serif;color:#77778A;padding:8px 16px;margin:0;">${email.dashboardTemplate} — ${email.subject}</p>
  <iframe title="${email.slug}" srcdoc="${sample(renderEmail(email)).replace(/"/g, '&quot;')}" style="width:100%;height:780px;border:0;"></iframe>
</section>`,
  ).join('\n');

  const target = path.join(OUT, 'preview.html');
  writeFileSync(
    target,
    `<!doctype html><meta charset="utf-8"><title>FayTarra auth emails</title><body style="margin:0;background:#000;">\n${page}\n</body>`,
    'utf8',
  );
  written.push(`preview           →  ${target}`);
}

console.log(written.join('\n'));
