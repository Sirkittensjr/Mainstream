import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRAND, RULES, SENDER, SITE, SUPPORT, TAGLINE } from './layout';
import { EMAILS, renderEmail } from './templates';

const rendered = EMAILS.map((email) => ({ email, html: renderEmail(email) }));

test('every Supabase template FayTarra uses has a body', () => {
  const slugs = EMAILS.map((email) => email.slug);
  for (const required of ['confirm-signup', 'reset-password', 'change-email'] as const) {
    assert.ok(slugs.includes(required), `missing ${required}`);
  }
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug');
});

test("Supabase's own variables survive rendering", () => {
  for (const { email, html } of rendered) {
    // A template with no button carries a CODE rather than a link: the admin
    // step-up and reauthentication both ask for a typed code.
    if (!email.action) {
      assert.match(html, /\{\{ \.Token \}\}/, email.slug);
      assert.match(email.text, /\{\{ \.Token \}\}/, email.slug);
      continue;
    }
    assert.match(html, /\{\{ \.TokenHash \}\}/, email.slug);
    assert.match(html, /\{\{ \.SiteURL \}\}/, email.slug);
    assert.match(email.text, /\{\{ \.TokenHash \}\}/, email.slug);
  }
  const change = rendered.find((entry) => entry.email.slug === 'change-email')!;
  assert.match(change.html, /\{\{ \.Email \}\}/);
  assert.match(change.html, /\{\{ \.NewEmail \}\}/);
});

/**
 * The regression guard for the confirmation loop.
 *
 * A `{{ .ConfirmationURL }}` link comes back carrying a PKCE code, and
 * exchanging that code needs the verifier cookie from the browser that signed
 * up — so the link fails when the email is opened anywhere else. The token
 * hash has no such tie.
 */
test('every action link is the stateless token_hash form, not a PKCE code link', () => {
  for (const { email } of rendered) {
    if (!email.action) continue;
    assert.doesNotMatch(email.action.href, /ConfirmationURL/, `${email.slug}: still a PKCE link`);
    assert.match(email.action.href, /^\{\{ \.SiteURL \}\}\/auth\/callback\?/, email.slug);
    assert.match(email.action.href, /token_hash=\{\{ \.TokenHash \}\}/, email.slug);
    assert.match(email.action.href, /[?&]type=[a-z_]+/, email.slug);
  }
});

test('each link declares the type that Supabase needs to verify it', () => {
  const expected: Record<string, string> = {
    'confirm-signup': 'signup',
    'reset-password': 'recovery',
    'change-email': 'email_change',
    'magic-link': 'magiclink',
    invite: 'invite',
  };
  for (const { email } of rendered) {
    if (!email.action) continue;
    assert.ok(
      email.action.href.includes(`type=${expected[email.slug]}`),
      `${email.slug}: expected type=${expected[email.slug]}, got ${email.action.href}`,
    );
  }
});

test('query separators are encoded in HTML so a sanitiser cannot drop the type', () => {
  for (const { email, html } of rendered) {
    if (!email.action) continue;
    const found = /href="(\{\{ \.SiteURL \}\}[^"]*)"/.exec(html);
    assert.ok(found, `${email.slug}: no action href`);
    assert.ok(found![1].includes('&amp;type='), `${email.slug}: raw ampersand in href`);
    assert.doesNotMatch(found![1], /[^m]&type=/, email.slug);
    // The plain-text copy is not HTML and must carry the real separator.
    assert.ok(email.text.includes('&type='), `${email.slug}: text link is HTML-encoded`);
  }
});

test('nothing points at localhost or a hardcoded token', () => {
  for (const { email, html } of rendered) {
    assert.doesNotMatch(html, /localhost|127\.0\.0\.1|\.vercel\.app/i, email.slug);
    assert.doesNotMatch(email.text, /localhost|127\.0\.0\.1/i, email.slug);
    // Any absolute link must be FayTarra's own domain.
    for (const [, href] of html.matchAll(/href="(https?:[^"]+)"/g)) {
      assert.ok(href.startsWith(SITE), `${email.slug}: off-domain link ${href}`);
    }
  }
});

test('no secrets, credentials or keys are baked in', () => {
  for (const { email, html } of rendered) {
    assert.doesNotMatch(html, /service_role|SUPABASE_|api[_-]?key|smtp_pass|password=/i, email.slug);
  }
});

test('the HTML is email-safe: no script, no modern layout, no remote assets', () => {
  for (const { email, html } of rendered) {
    assert.doesNotMatch(html, /<script/i, email.slug);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${email.slug}: inline event handler`);
    assert.doesNotMatch(html, /<img/i, `${email.slug}: images are blocked by default in most clients`);
    assert.doesNotMatch(html, /<svg|<link|@import|<iframe/i, email.slug);
    assert.doesNotMatch(html, /display:\s*(flex|grid)|position:\s*(absolute|fixed)/i, email.slug);
    // Layout is tables, and they must be marked so screen readers skip them.
    assert.ok(html.includes('role="presentation"'), email.slug);
  }
});

test('each message states its subject, preheader and sender', () => {
  for (const { email, html } of rendered) {
    assert.ok(email.subject.length > 0 && email.subject.length <= 78, email.slug);
    assert.ok(email.preheader.length > 0, email.slug);
    assert.ok(html.includes(email.preheader), email.slug);
    assert.ok(html.includes(SENDER), email.slug);
    assert.ok(html.includes('FayTarra'), email.slug);
  }
});

test('colours are stated explicitly so a client cannot invert half the message', () => {
  for (const { email, html } of rendered) {
    assert.ok(html.includes(BRAND.ink), `${email.slug}: no page background`);
    assert.ok(html.includes(BRAND.panel), `${email.slug}: no card background`);
    assert.ok(html.includes('color-scheme'), email.slug);
  }
});

test('the brand mark uses FayTarra’s own gradient stops', () => {
  for (const { email, html } of rendered) {
    for (const stop of [BRAND.aura, BRAND.fay, BRAND.solar]) {
      assert.ok(html.includes(stop), `${email.slug}: missing ${stop}`);
    }
  }
});

test('a button is drawn for Outlook as well as everything else', () => {
  for (const { email, html } of rendered) {
    if (!email.action) continue;
    assert.ok(html.includes('v:roundrect'), `${email.slug}: no Outlook button`);
    assert.ok(html.includes('<!--[if !mso]>'), `${email.slug}: no non-Outlook button`);
    // The link has to be readable as text too, for clients that strip buttons.
    assert.ok(html.includes('Copy and paste this link'), email.slug);
  }
});

/**
 * The regression guard for the admin step-up shipping as a sign-in link.
 *
 * Each template's kind is asserted from this table rather than from what the
 * template happens to contain — inferring is what let a code template turn
 * into a link template and still pass.
 */
test('each template is the KIND it is supposed to be', () => {
  const mustBe: Record<string, 'code' | 'link'> = {
    'confirm-signup': 'link',
    'reset-password': 'link',
    'change-email': 'link',
    invite: 'link',
    'magic-link': 'code',
    reauthentication: 'code',
  };

  for (const { email, html } of rendered) {
    const expected = mustBe[email.slug];
    assert.ok(expected, `${email.slug}: no rule — add one`);

    if (expected === 'code') {
      assert.equal(email.action, null, `${email.slug} must not have an action link`);
      assert.match(html, /\{\{ \.Token \}\}/, `${email.slug} must carry the code`);
      assert.doesNotMatch(html, /auth\/callback|TokenHash/, `${email.slug} must not link anywhere`);
    } else {
      assert.ok(email.action, `${email.slug} must have an action link`);
      assert.match(html, /\{\{ \.TokenHash \}\}/, email.slug);
    }
  }
});

test('every rendered template names itself in its source', () => {
  for (const { email, html } of rendered) {
    assert.ok(
      html.includes(`faytarra-template: ${email.slug}`),
      `${email.slug}: no marker, so a stale paste cannot be spotted`,
    );
    assert.ok(html.includes(email.action ? '(link)' : '(code)'), email.slug);
  }
});

test('the admin code email is a code, never a link somebody could forward', () => {
  const magic = rendered.find((entry) => entry.email.slug === 'magic-link')!;
  assert.equal(magic.email.action, null, 'the admin code email must have no action link');
  assert.doesNotMatch(magic.html, /auth\/callback/, 'no sign-in link in the code email');
  assert.match(magic.html, /\{\{ \.Token \}\}/);
  assert.match(magic.email.subject, /admin/i);
  // The wording the admin is actually looking for in their inbox.
  assert.match(magic.email.heading, /verification code/i);
  assert.doesNotMatch(magic.email.subject, /sign.?in link/i, 'this is the old template');
  assert.doesNotMatch(magic.html, />Sign in<|Sign in to FayTarra/, 'this is the old template');
});

test('every message has a plain-text alternative', () => {
  for (const { email } of rendered) {
    assert.ok(email.text.trim().length > 120, email.slug);
    assert.doesNotMatch(email.text, /<[a-z]/i, `${email.slug}: HTML leaked into the text part`);
    assert.ok(email.text.includes('faytarra.com'), email.slug);
  }
});

test('the two emails a person can be sent without asking say so', () => {
  for (const slug of ['confirm-signup', 'reset-password'] as const) {
    const entry = rendered.find((candidate) => candidate.email.slug === slug)!;
    assert.match(entry.html, /safely ignore this email/i, slug);
    assert.match(entry.email.text, /safely ignore this email/i, slug);
  }
});

/* ------------------------------------------------------------ the redesign */

test('every footer says who it is from, where to go, why it came and where to get help', () => {
  for (const { email, html } of rendered) {
    assert.match(html, /Everyone gets <span[^>]*>a say\.<\/span>/, `${email.slug}: tagline`);
    assert.ok(html.includes(`href="${SITE}"`), `${email.slug}: site link`);
    assert.ok(html.includes(`href="${RULES}"`), `${email.slug}: community rules link`);
    assert.ok(html.includes(`href="mailto:${SUPPORT}"`), `${email.slug}: support address`);
    assert.match(email.reason, /^You received this because /, email.slug);
    assert.ok(html.includes(email.reason), `${email.slug}: why you got this`);
    assert.match(html, /automated message/i, email.slug);
    // And the plain-text copy carries the same.
    for (const line of [TAGLINE, RULES, SUPPORT, email.reason, SENDER]) {
      assert.ok(email.text.includes(line), `${email.slug}: text footer missing ${line}`);
    }
  }
});

test('the button is the FayTarra gradient over a solid pink that Outlook and old clients show', () => {
  for (const { email, html } of rendered) {
    if (!email.action) continue;
    const cell = /<td align="center" bgcolor="([^"]+)" style="([^"]*)">\s*<!--\[if mso\]>/.exec(html);
    assert.ok(cell, `${email.slug}: no button cell`);
    assert.equal(cell![1], BRAND.fay, `${email.slug}: solid fallback`);
    assert.ok(cell![2].includes(`background-color:${BRAND.fay}`), email.slug);
    assert.match(cell![2], /background-image:linear-gradient\(120deg, #7C5CFF 0%, #FF3D9A 52%, #FFB443 100%\)/, email.slug);
    // Dark text, as on the site — on the gradient and on the pink fallback alike.
    assert.match(html, new RegExp(`<a href="\\{\\{ \\.SiteURL[^>]*color:${BRAND.ink}`), `${email.slug}: button text`);
    assert.match(html, new RegExp(`fillcolor="${BRAND.fay}"`), `${email.slug}: Outlook fill`);
    assert.match(html, new RegExp(`<center style="color:${BRAND.ink}`), `${email.slug}: Outlook text`);
  }
});

test('the email opens with the violet → pink → amber line, solid stops underneath', () => {
  for (const { email, html } of rendered) {
    const stops = [...html.matchAll(/<td width="33%" height="4" bgcolor="(#[0-9A-F]{6})"/g)].map((m) => m[1]);
    assert.deepEqual(stops, [BRAND.aura, BRAND.fay, BRAND.solar], email.slug);
  }
});

test('the logo is the drawn mark with its spark, and the wordmark reads FayTarra', () => {
  for (const { email, html } of rendered) {
    assert.ok(html.includes(`color:${BRAND.solar};mso-line-height-rule:exactly;">&#10022;</td>`), `${email.slug}: spark`);
    assert.match(html, /class="fay-wordmark"[^>]*>FayTarra<\/td>/, email.slug);
    assert.doesNotMatch(html, /text-transform:\s*uppercase/i, `${email.slug}: wordmark is not shouted`);
  }
});

test('the inbox preview is the preheader and nothing after it', () => {
  for (const { email, html } of rendered) {
    const hidden = /<div style="display:none;[^"]*">([\s\S]*?)<\/div>/.exec(html);
    assert.ok(hidden, email.slug);
    assert.ok(hidden![1].startsWith(email.preheader), email.slug);
    // Padded with invisible characters, so the heading cannot run on into it.
    assert.ok((hidden![1].match(/&zwnj;/g) ?? []).length >= 80, `${email.slug}: preheader not padded`);
  }
});

/**
 * The code has to fit the narrowest phone with NO help from the stylesheet —
 * Gmail can drop a <style> block — so the inline size is checked against the
 * worst case: a 320px screen, the inline paddings, eight digits.
 */
test('an eight-digit code fits a 320px phone on inline styles alone', () => {
  for (const { email, html } of rendered) {
    if (!email.code) continue;
    const style = /class="fay-code" style="([^"]+)"/.exec(html)?.[1] ?? '';
    const size = Number(/font-size:(\d+)px/.exec(style)?.[1]);
    const spacing = Number(/letter-spacing:(\d+)px/.exec(style)?.[1]);
    // A monospace digit is 0.6em wide; letter-spacing follows every character.
    const codeWidth = 8 * (size * 0.6 + spacing);
    // 320 − outer padding 2×16 − card border 2×1 − card padding 2×40 − code box border 2×1 − its padding 2×8.
    const room = 320 - 32 - 2 - 80 - 2 - 16;
    assert.ok(codeWidth <= room, `${email.slug}: ${codeWidth}px of code in ${room}px`);
  }
});

test('phone and dark-mode styling only adds to an email that works without it', () => {
  for (const { email, html } of rendered) {
    const style = /<style>([\s\S]*?)<\/style>\s*<\/head>/.exec(html)?.[1] ?? '';
    assert.match(style, /@media only screen and \(max-width: 520px\)/, email.slug);
    assert.match(style, /\[data-ogsc\]/, `${email.slug}: Outlook.com dark-mode guard`);
    // Everything the message needs is still inline.
    const stripped = html.replace(/<style>[\s\S]*?<\/style>/g, '');
    assert.ok(stripped.includes(`background-color:${BRAND.panel}`), email.slug);
    assert.ok(stripped.includes(email.heading.replace(/&/g, '&amp;')), email.slug);
  }
});

test('the wording that matters did not move: subjects, links and security notes', () => {
  const subjects = Object.fromEntries(EMAILS.map((email) => [email.slug, email.subject]));
  assert.deepEqual(subjects, {
    'confirm-signup': 'Confirm your email address',
    'reset-password': 'Reset your FayTarra password',
    'change-email': 'Confirm your new email address',
    'magic-link': 'Your FayTarra admin verification code',
    invite: 'You have been invited to FayTarra',
    reauthentication: 'Your FayTarra confirmation code',
  });
  const links = Object.fromEntries(EMAILS.map((email) => [email.slug, email.action?.href ?? null]));
  assert.deepEqual(links, {
    'confirm-signup': '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next=/home',
    'reset-password': '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password',
    'change-email': '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email_change&next=/settings',
    'magic-link': null,
    invite: '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/home',
    reauthentication: null,
  });
  const magic = EMAILS.find((email) => email.slug === 'magic-link')!;
  assert.match(magic.footnotes.join(' '), /never ask you for it by email, message or phone/);
  assert.match(magic.footnotes.join(' '), /change the admin password immediately/);
});
