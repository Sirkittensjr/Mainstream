import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_BADGE_LABEL, isAdminRole } from './admin-badge';

test('the badge says the same thing everywhere', () => {
  assert.equal(ADMIN_BADGE_LABEL, 'FayTarra Admin');
});

test('an account with role admin gets the badge', () => {
  assert.equal(isAdminRole('admin'), true);
});

test('a normal account does not', () => {
  assert.equal(isAdminRole('user'), false);
});

/**
 * The badge is granted by one exact string in one column. Nothing a person can
 * type into a profile — a display name, a bio, a location — is consulted, and
 * `role` is not a column the API roles may UPDATE, so this cannot be written
 * from a browser either (see admin-checks.sql).
 */
test('nothing that merely looks like admin counts', () => {
  for (const pretender of [
    'Admin',
    'ADMIN',
    ' admin',
    'admin ',
    'administrator',
    'admin​',
    'superadmin',
    'admin;--',
    'role=admin',
    'moderator',
    'true',
    '1',
  ]) {
    assert.equal(isAdminRole(pretender), false, `${JSON.stringify(pretender)} was treated as admin`);
  }
});

test('a missing, null or undefined role is not an admin', () => {
  assert.equal(isAdminRole(null), false);
  assert.equal(isAdminRole(undefined), false);
  assert.equal(isAdminRole(''), false);
});

test('the check is a boolean, never the role itself', () => {
  // What reaches a client component is `true`/`false`, so there is nothing
  // there to read a role out of or to tamper with into meaning something else.
  assert.equal(typeof isAdminRole('admin'), 'boolean');
  assert.equal(typeof isAdminRole('user'), 'boolean');
});
