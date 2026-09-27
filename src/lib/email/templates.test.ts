import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRAND, SENDER, SITE } from './layout';
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
    if (email.slug === 'reauthentication') {
      // The one that carries a code instead of a link.
      assert.match(html, /\{\{ \.Token \}\}/, email.slug);
      assert.match(email.text, /\{\{ \.Token \}\}/, email.slug);
      continue;
    }
    assert.match(html, /\{\{ \.ConfirmationURL \}\}/, email.slug);
    assert.match(email.text, /\{\{ \.ConfirmationURL \}\}/, email.slug);
  }
  const change = rendered.find((entry) => entry.email.slug === 'change-email')!;
  assert.match(change.html, /\{\{ \.Email \}\}/);
  assert.match(change.html, /\{\{ \.NewEmail \}\}/);
});

test('the action link is only ever the Supabase variable, never a URL we built', () => {
  for (const { email } of rendered) {
    if (!email.action) continue;
    assert.equal(email.action.href, '{{ .ConfirmationURL }}', email.slug);
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

test('every message has a plain-text alternative that carries the link', () => {
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
