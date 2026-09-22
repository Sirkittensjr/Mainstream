import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MissingRelationError, isMissingColumn, isMissingRelation, throwQueryError } from './errors';

/** The shape @supabase/supabase-js hands back in `error`. */
const pgrst = (code: string, message: string) => ({ code, message });

function thrownBy(table: string, error: { code: string; message: string }): unknown {
  try {
    throwQueryError(table, error);
  } catch (caught) {
    return caught;
  }
  throw new Error('throwQueryError returned instead of throwing');
}

describe('throwQueryError', () => {
  it('reads a missing table as a schema that is behind the code', () => {
    const error = thrownBy(
      'messages',
      pgrst('PGRST205', "Could not find the table 'public.messages' in the schema cache"),
    );
    assert.ok(isMissingRelation(error));
    assert.equal((error as MissingRelationError).table, 'messages');
    assert.equal((error as MissingRelationError).column, null);
  });

  it('names the column when only the column is missing', () => {
    const error = thrownBy(
      'users',
      pgrst(
        'PGRST204',
        "Could not find the 'username_changed_at' column of 'users' in the schema cache",
      ),
    );
    assert.ok(isMissingColumn(error, 'users', 'username_changed_at'));
    assert.equal(isMissingColumn(error, 'users', 'bio'), false);
    assert.equal(isMissingColumn(error, 'posts', 'username_changed_at'), false);
  });

  it('accepts the raw Postgres codes as well as PostgREST-s', () => {
    assert.ok(isMissingRelation(thrownBy('messages', pgrst('42P01', 'relation does not exist'))));
    assert.ok(isMissingRelation(thrownBy('users', pgrst('42703', 'column does not exist'))));
  });

  it('leaves every other failure a plain error, so nothing swallows a real bug', () => {
    for (const error of [
      pgrst('23505', 'duplicate key value violates unique constraint'),
      pgrst('42501', 'permission denied for table users'),
      pgrst('', 'TypeError: fetch failed'),
    ]) {
      const thrown = thrownBy('users', error);
      assert.ok(thrown instanceof Error);
      assert.equal(isMissingRelation(thrown), false);
    }
  });

  it('keeps the table and Supabase-s own words in the message', () => {
    const thrown = thrownBy('messages', pgrst('PGRST205', 'no such table')) as Error;
    assert.equal(thrown.message, '[supabase:messages] no such table');
  });
});
