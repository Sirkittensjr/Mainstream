import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { applyFilters, type Filterable } from './supabase';

/**
 * These build a real PostgREST query and read the URL it produced. Nothing is
 * awaited, so nothing is sent anywhere — a query only becomes a request when
 * somebody waits on it.
 */
const client = createClient('http://127.0.0.1:1/', 'not-a-real-key');

function queryString(
  where: Record<string, unknown> | undefined,
  inFilters?: Record<string, unknown[] | undefined>,
): string {
  const builder = client.from('messages').select('*');
  const filtered = applyFilters(builder as unknown as Filterable, where, inFilters);
  return decodeURIComponent((filtered as unknown as { url: URL }).url.search);
}

describe('translating a query into PostgREST filters', () => {
  it('matches NULL with `is`, never with `eq`', () => {
    // The bug this exists for: `eq.null` asks Postgres to cast the string
    // "null" to a timestamp, which is a 400 and took every signed-in page
    // down once the messages table existed to be queried.
    const search = queryString({ recipient_id: 'u1', read_at: null });
    assert.match(search, /read_at=is\.null/);
    assert.doesNotMatch(search, /read_at=eq\.null/);
  });

  it('still compares ordinary values with `eq`', () => {
    const search = queryString({ recipient_id: 'u1', sender_id: 'u2' });
    assert.match(search, /recipient_id=eq\.u1/);
    assert.match(search, /sender_id=eq\.u2/);
  });

  it('handles false and zero as values, not as absent', () => {
    // `value === null` and nothing looser, or `removed: false` would become
    // `is.null` and quietly select the wrong rows.
    assert.match(queryString({ removed: false }), /removed=eq\.false/);
    assert.match(queryString({ views: 0 }), /views=eq\.0/);
    assert.match(queryString({ body: '' }), /body=eq\./);
  });

  it('passes `in` filters through', () => {
    assert.match(queryString(undefined, { id: ['a', 'b'] }), /id=in\.\(a,b\)/);
  });

  it('leaves an absent `in` list alone', () => {
    assert.equal(queryString(undefined, { id: undefined }), '?select=*');
  });

  it('applies nothing when there is nothing to apply', () => {
    assert.equal(queryString(undefined), '?select=*');
  });
});
