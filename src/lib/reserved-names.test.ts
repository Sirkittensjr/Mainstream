import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isReservedDisplayName, normaliseDisplayName } from './reserved-names';

test('the reserved name itself is reserved', () => {
  assert.equal(isReservedDisplayName('FayTarra Admin'), true);
});

test('casing does not matter', () => {
  for (const typed of ['faytarra admin', 'FAYTARRA ADMIN', 'FaYtArRa AdMiN', 'Faytarra admin']) {
    assert.equal(isReservedDisplayName(typed), true, typed);
  }
});

test('whitespace tricks do not get through', () => {
  for (const typed of [
    '  FayTarra Admin  ',
    'FayTarra  Admin',
    'FayTarraAdmin',
    'Fay Tarra Admin',
    'F a y T a r r a  A d m i n',
    'FayTarra\tAdmin',
    'FayTarra\nAdmin',
    'FayTarra Admin',
  ]) {
    assert.equal(isReservedDisplayName(typed), true, JSON.stringify(typed));
  }
});

test('punctuation between the words does not get through', () => {
  for (const typed of ['FayTarra-Admin', 'FayTarra_Admin', 'FayTarra.Admin', '[FayTarra Admin]', '*FayTarra Admin*', 'FayTarra·Admin']) {
    assert.equal(isReservedDisplayName(typed), true, typed);
  }
});

test('invisible characters do not get through', () => {
  for (const typed of [
    'FayTarra​Admin',
    'Fay‌Tarra Admin',
    'FayTarra Ad­min',
    '﻿FayTarra Admin',
  ]) {
    assert.equal(isReservedDisplayName(typed), true, JSON.stringify(typed));
  }
});

/**
 * Letters that are not the letters they look like. Cyrillic а renders exactly
 * as Latin a, so this is the bypass somebody actually reaches for.
 */
test('lookalike letters from other alphabets do not get through', () => {
  for (const typed of [
    'FаyTarra Admin', // Cyrillic а
    'FayTarra Admin'.replace('o', 'ο'), // harmless here, kept for shape
    'FayTаrrа Admin',
    'FayTarra Аdmin', // Cyrillic А
  ]) {
    assert.equal(isReservedDisplayName(typed), true, JSON.stringify(typed));
  }
});

test('fullwidth and decorative forms do not get through', () => {
  assert.equal(isReservedDisplayName('ＦａｙＴａｒｒａ　Ａｄｍｉｎ'), true);
});

test('digits standing in for letters do not get through', () => {
  for (const typed of ['F4yTarra Admin', 'FayTarra Adm1n', 'FayT4rr4 4dm1n']) {
    assert.equal(isReservedDisplayName(typed), true, typed);
  }
});

/**
 * Only the one name asked for is reserved. These are the near misses that are
 * deliberately still allowed — widening the set is a one-line change, but each
 * entry can catch somebody's real name, so it is a decision to take on purpose
 * rather than by accident.
 */
test('near misses are NOT reserved — the set is exactly one name', () => {
  for (const typed of ['FayTarra Support', 'FayTarra Staff', 'FayTarra Team', 'FayTarra Official', 'FayTarra Administrator']) {
    assert.equal(isReservedDisplayName(typed), false, typed);
  }
});

/**
 * The half that matters more. Matching is exact after normalising precisely so
 * that ordinary names keep working — a rule that blocks anything containing
 * "admin" would break more real people than it protects.
 */
test('ordinary names are left alone', () => {
  for (const name of [
    'Admin',
    'admin',
    'Sysadmin',
    'The Admin',
    'Admin Assistant',
    'Adminah',
    'Fay',
    'Tarra',
    'FayTarra',
    'FayTarra Fan',
    'FayTarra Fan Club',
    'I love FayTarra',
    'Tarra Admin Services',
    'Fay Tarrant',
    'Faytarra Adminson',
    'Jane Admin',
    'admin@example.com',
    '管理者',
    'Мария',
  ]) {
    assert.equal(isReservedDisplayName(name), false, `${name} was wrongly reserved`);
  }
});

test('an empty name is not "reserved" — that is a different complaint', () => {
  for (const nothing of ['', '   ', '​', '---']) {
    assert.equal(isReservedDisplayName(nothing), false, JSON.stringify(nothing));
  }
});

test('normalising is what does the work, and it is stable', () => {
  assert.equal(normaliseDisplayName('FayTarra Admin'), 'faytarraadmin');
  assert.equal(normaliseDisplayName('  Fay-Tarra_Admin  '), 'faytarraadmin');
  assert.equal(normaliseDisplayName('Ordinary Person'), 'ordinaryperson');
  assert.equal(normaliseDisplayName(''), '');
});
