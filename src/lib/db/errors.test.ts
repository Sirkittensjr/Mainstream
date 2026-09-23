import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MissingRelationError, isMissingColumn, isMissingRelation, throwQueryError } from './errors';

describe('telling a missing relation from a broken query', () => {
  it('recognises a missing table', () => {
    assert.throws(
      () => throwQueryError('messages', { message: 'no such table', code: 'PGRST205' }),
      (error: unknown) => isMissingRelation(error) && error.column === null,
    );
  });

  it('recognises a missing column, and names it', () => {
    assert.throws(
      () =>
        throwQueryError('users', {
          message: "Could not find the 'top_creators' column of 'users' in the schema cache",
          code: 'PGRST204',
        }),
      (error: unknown) =>
        isMissingRelation(error) && isMissingColumn(error, 'users', 'top_creators'),
    );
  });

  it('leaves a genuine query failure as a plain error', () => {
    assert.throws(
      () => throwQueryError('posts', { message: 'syntax error', code: '42601' }),
      (error: unknown) => error instanceof Error && !isMissingRelation(error),
    );
  });

  /**
   * The bundler can give a server chunk its own copy of this module, and then
   * the error a service catches was built by a different class object than the
   * one it imported. It still has to be recognised, or a missing column
   * becomes a 500 instead of a feature switching itself off.
   */
  it('recognises one thrown by another copy of this module', () => {
    class OtherCopy extends Error {
      readonly table = 'users';
      readonly column: string | null = 'profile_bg';
      constructor() {
        super('[supabase:users] Could not find the column');
        this.name = 'MissingRelationError';
      }
    }
    const error = new OtherCopy();
    assert.equal(error instanceof MissingRelationError, false);
    assert.equal(isMissingRelation(error), true);
    assert.equal(isMissingColumn(error, 'users', 'profile_bg'), true);
  });

  it('does not mistake anything else for one', () => {
    assert.equal(isMissingRelation(new Error('nope')), false);
    assert.equal(isMissingRelation({ name: 'MissingRelationError' }), false);
    assert.equal(isMissingRelation(null), false);
  });
});
