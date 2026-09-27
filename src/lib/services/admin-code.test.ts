import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_CODE_DIGITS, checkCodeShape } from './admin-code';

test('an admin code is exactly six digits', () => {
  assert.equal(ADMIN_CODE_DIGITS, 6);
});

test('exactly six digits is accepted', () => {
  const result = checkCodeShape('482915');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.digits, '482915');
});

test('spaces and dashes people paste in are stripped, not rejected', () => {
  for (const typed of ['482 915', '482-915', ' 482915 ', '48 29 15']) {
    const result = checkCodeShape(typed);
    assert.equal(result.ok, true, typed);
    if (result.ok) assert.equal(result.digits, '482915', typed);
  }
});

/**
 * The one that matters. Supabase's "Email OTP Length" can be set as high as
 * 10, and a project set to 8 mails eight digits. Cutting those down to six
 * would throw away two digits of entropy — a hundredth of the search space —
 * so an eight-digit code is REFUSED, never trimmed to fit.
 */
test('an eight-digit code is refused, not truncated', () => {
  const result = checkCodeShape('56338428');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.tooLong, true);
  assert.match(result.error, /6 digits/);
  assert.match(result.error, /has 8/);
  // Nothing anywhere returns the first six digits of it.
  assert.doesNotMatch(result.error, /563384/);
});

test('every length but six is refused', () => {
  for (const digits of [1, 2, 3, 4, 5, 7, 8, 9, 10]) {
    const result = checkCodeShape('9'.repeat(digits));
    assert.equal(result.ok, false, `${digits} digits was accepted`);
  }
  assert.equal(checkCodeShape('9'.repeat(ADMIN_CODE_DIGITS)).ok, true);
});

test('an empty or non-numeric entry is refused without crashing', () => {
  for (const typed of ['', '   ', 'abcdef', '------']) {
    assert.equal(checkCodeShape(typed).ok, false, JSON.stringify(typed));
  }
});

test('a too-short code is told to enter the code, not scolded for length', () => {
  const result = checkCodeShape('4829');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.tooLong, false);
  assert.match(result.error, /Enter the 6 digits/);
});
