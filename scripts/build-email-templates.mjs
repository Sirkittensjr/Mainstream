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

/**
 * The rules a built template must satisfy before it is written.
 *
 * The admin step-up is the one that earned this: it is only a second factor
 * for as long as the email carries a CODE. A template that carries a sign-in
 * link instead hands whoever opens the inbox a way in with one click, which is
 * the opposite of what the step is for. Refusing to build is cheaper than
 * finding out from production.
 */
/**
 * What each template MUST be, stated here rather than inferred from what it
 * happens to contain. Inferring is what lets a code template quietly become a
 * link template: give it a button and it simply starts being audited as a
 * link, and passes.
 */
const MUST_BE = {
  'confirm-signup': 'link',
  'reset-password': 'link',
  'change-email': 'link',
  invite: 'link',
  // The administrator's second factor. A link here would hand whoever opens
  // the inbox a way in with one click, which is the opposite of the point.
  'magic-link': 'code',
  reauthentication: 'code',
};

function audit(email, html) {
  const expected = MUST_BE[email.slug];
  if (!expected) throw new Error(`${email.slug}: no rule for this template — add one to MUST_BE`);

  const problems = [];
  if (expected === 'code') {
    if (email.action !== null) problems.push('must carry a code, but has an action link');
    if (!html.includes('{{ .Token }}')) problems.push('must carry {{ .Token }}');
    if (/href="\{\{|auth\/callback|TokenHash/.test(html)) {
      problems.push('must not contain a sign-in link');
    }
  } else {
    if (email.action === null) problems.push('must carry an action link');
    if (!html.includes('{{ .TokenHash }}')) problems.push('must carry {{ .TokenHash }}');
  }

  if (problems.length) {
    throw new Error(`${email.slug}: ${problems.join('; ')}`);
  }
}

const written = [];
for (const email of EMAILS) {
  const html = renderEmail(email);
  audit(email, html);
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
      .replace(/\{\{ \.SiteURL \}\}/g, 'https://faytarra.com')
      .replace(/\{\{ \.TokenHash \}\}/g, 'pkce_3f9a1c27e0b84d6f')
      // Eight digits: the project's Email OTP Length — see README.
      .replace(/\{\{ \.Token \}\}/g, '48213907')
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
