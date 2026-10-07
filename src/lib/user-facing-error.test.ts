import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONNECTION_LOST, userFacingError } from './user-facing-error';

const FALLBACK = 'The post did not go through.';

describe('what somebody is told when something fails', () => {
  it('shows FayTarra’s own sentences as they are', () => {
    const own = 'That clip is 3.2s and only 1.1s of room is left.';
    assert.equal(userFacingError(new Error(own), FALLBACK), own);
  });

  it('turns a dropped connection into something to do, in every browser’s wording', () => {
    for (const raw of ['Load failed', 'Failed to fetch', 'NetworkError when attempting to fetch resource.']) {
      assert.equal(userFacingError(new TypeError(raw), FALLBACK), CONNECTION_LOST, raw);
    }
    assert.equal(userFacingError(new Error('Network request failed'), FALLBACK), CONNECTION_LOST);
  });

  it('never shows a stack-trace sentence', () => {
    for (const raw of [
      "Cannot read properties of undefined (reading 'id')",
      'x.map is not a function',
      "Failed to execute 'start' on 'MediaRecorder'",
      'Unexpected token < in JSON at position 0',
      'The upload failed (500).',
    ]) {
      assert.equal(userFacingError(new Error(raw), FALLBACK), FALLBACK, raw);
    }
  });

  it('falls back for anything that is not an Error, or says nothing', () => {
    assert.equal(userFacingError('oops', FALLBACK), FALLBACK);
    assert.equal(userFacingError(undefined, FALLBACK), FALLBACK);
    assert.equal(userFacingError(new Error('   '), FALLBACK), FALLBACK);
  });
});
