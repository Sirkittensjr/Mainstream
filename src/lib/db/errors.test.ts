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

/**
 * The bundler is free to put this module in more than one server chunk, and
 * when it does, the error a service catches was built by a different class
 * object than the one it imported. `instanceof` is then false, and a missing
 * column becomes an unhandled 500 instead of a feature switching itself off —
 * which is what happened to the Top 3 save the first time it met a database
 * without its column.
 */
describe('recognising an error thrown by another copy of this module', () => {
  class OtherCopy extends Error {
    readonly table: string;
    readonly column: string | null;
    constructor(table: string, column: string | null) {
      super(`[supabase:${table}] Could not find the '${column}' column`);
      this.name = 'MissingRelationError';
      this.table = table;
      this.column = column;
    }
  }

  it('is not caught by instanceof, and is caught anyway', () => {
    const error = new OtherCopy('users', 'top_creators');
    assert.equal(error instanceof MissingRelationError, false);
    assert.ok(isMissingRelation(error));
    assert.ok(isMissingColumn(error, 'users', 'top_creators'));
  });

  it('works for a missing table from another copy too', () => {
    const error = new OtherCopy('messages', null);
    assert.ok(isMissingRelation(error));
    assert.equal(isMissingColumn(error, 'messages', 'body'), false);
  });

  it('does not mistake anything else for one', () => {
    assert.equal(isMissingRelation(new Error('nope')), false);
    // A bare object wearing the name is not one: the fields have to be there.
    assert.equal(isMissingRelation({ name: 'MissingRelationError' }), false);
    assert.equal(isMissingRelation(null), false);
    assert.equal(isMissingRelation(undefined), false);
    assert.equal(isMissingRelation('MissingRelationError'), false);
  });
});
