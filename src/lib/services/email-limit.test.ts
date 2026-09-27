import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkEmailSendLimit, EMAIL_COOLDOWN_SECONDS, resetEmailSendLimits } from './email-limit';

test('a first email to an address is allowed', () => {
  resetEmailSendLimits();
  assert.equal(checkEmailSendLimit('someone@example.com', 0).ok, true);
});

test('a second email inside the cooldown is refused, with the wait', () => {
  resetEmailSendLimits();
  const start = 1_000_000;
  checkEmailSendLimit('someone@example.com', start);

  const soon = checkEmailSendLimit('someone@example.com', start + 5_000);
  assert.equal(soon.ok, false);
  if (soon.ok) return;
  assert.ok(soon.retryAfter > 0 && soon.retryAfter <= EMAIL_COOLDOWN_SECONDS);
  assert.match(soon.error, /wait/i);
});

test('once the cooldown is up, sending is allowed again', () => {
  resetEmailSendLimits();
  const start = 1_000_000;
  checkEmailSendLimit('someone@example.com', start);
  const later = checkEmailSendLimit('someone@example.com', start + EMAIL_COOLDOWN_SECONDS * 1000 + 1);
  assert.equal(later.ok, true);
});

test('the address is normalised, so case and spacing cannot dodge the gate', () => {
  resetEmailSendLimits();
  const start = 1_000_000;
  checkEmailSendLimit('Someone@Example.com', start);
  assert.equal(checkEmailSendLimit('  someone@example.com ', start + 1000).ok, false);
});

test('one address being held does not hold a different one', () => {
  resetEmailSendLimits();
  const start = 1_000_000;
  checkEmailSendLimit('one@example.com', start);
  assert.equal(checkEmailSendLimit('two@example.com', start + 1000).ok, true);
});

test('an hourly ceiling stops a slow drip as well as a fast one', () => {
  resetEmailSendLimits();
  let now = 1_000_000;
  const step = (EMAIL_COOLDOWN_SECONDS + 1) * 1000;
  let allowed = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (checkEmailSendLimit('drip@example.com', now).ok) allowed += 1;
    now += step;
  }
  assert.ok(allowed <= 6, `allowed ${allowed} in an hour`);
  assert.ok(allowed >= 1);
});
