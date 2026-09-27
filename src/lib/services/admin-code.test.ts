import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_CODE_DIGITS, checkCodeShape } from './admin-code';

test('an admin code is exactly eight digits — what Supabase actually mails', () => {
  assert.equal(ADMIN_CODE_DIGITS, 8);
});

test('exactly eight digits is accepted, whole', () => {
  const result = checkCodeShape('13755959');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.digits, '13755959');
});

/**
 * The regression guard that matters. The code Supabase mails is eight digits;
 * all eight must be submitted. Anything that quietly shortened it would throw
 * away entropy AND fail verification, since Supabase compares the whole token.
 */
test('an eight-digit code is never trimmed on its way through', () => {
  const result = checkCodeShape('56338428');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.digits.length, 8);
  assert.equal(result.digits, '56338428');
  assert.notEqual(result.digits, '563384');
});

test('spaces and dashes people paste in are stripped, not rejected', () => {
  for (const typed of ['1375 5959', '1375-5959', ' 13755959 ', '13 75 59 59']) {
    const result = checkCodeShape(typed);
    assert.equal(result.ok, true, typed);
    if (result.ok) assert.equal(result.digits, '13755959', typed);
  }
});

test('a six-digit code is refused — it is not one of ours', () => {
  const result = checkCodeShape('482915');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.tooLong, false);
  assert.match(result.error, /Enter the 8 digits/);
});

test('every length but eight is refused', () => {
  for (const digits of [1, 2, 3, 4, 5, 6, 7, 9, 10, 12]) {
    const result = checkCodeShape('9'.repeat(digits));
    assert.equal(result.ok, false, `${digits} digits was accepted`);
  }
  assert.equal(checkCodeShape('9'.repeat(ADMIN_CODE_DIGITS)).ok, true);
});

test('a longer paste is refused for its length, and says so', () => {
  const result = checkCodeShape('1375595912');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.tooLong, true);
  assert.match(result.error, /8 digits/);
  assert.match(result.error, /has 10/);
});

test('an empty or non-numeric entry is refused without crashing', () => {
  for (const typed of ['', '   ', 'abcdefgh', '--------']) {
    assert.equal(checkCodeShape(typed).ok, false, JSON.stringify(typed));
  }
});
