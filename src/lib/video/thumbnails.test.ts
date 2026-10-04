import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sampleTimes } from './thumbnails';

describe('spreading frames across a clip', () => {
  it('samples the middle of each slice, not the ends', () => {
    // Four frames of a 4-second clip: 0.5, 1.5, 2.5, 3.5 — never 0, which on a
    // recording is usually black.
    assert.deepEqual(sampleTimes(0, 4, 4), [0.5, 1.5, 2.5, 3.5]);
  });

  it('starts from where it is told, so a trimmed clip strips its own part', () => {
    assert.deepEqual(sampleTimes(2, 4, 2), [2.5, 3.5]);
  });

  it('gives one frame when asked for one, from the middle', () => {
    assert.deepEqual(sampleTimes(0, 10, 1), [5]);
  });

  it('stays inside the span', () => {
    for (const time of sampleTimes(1, 3, 7)) {
      assert.ok(time > 1 && time < 3, `${time}`);
    }
  });

  /** A recording whose duration has not settled yet still has to draw a strip. */
  it('repeats the start when there is no length to spread over', () => {
    assert.deepEqual(sampleTimes(0, 0, 3), [0, 0, 0]);
    assert.deepEqual(sampleTimes(2, 2, 2), [2, 2]);
  });

  it('treats a backwards span as no span rather than counting down', () => {
    assert.deepEqual(sampleTimes(5, 1, 2), [5, 5]);
  });

  it('survives NaN and Infinity instead of producing NaN times', () => {
    assert.deepEqual(sampleTimes(Number.NaN, 4, 2), [1, 3]);
    for (const time of sampleTimes(0, Number.POSITIVE_INFINITY, 3)) {
      assert.ok(Number.isFinite(time) === false || time >= 0);
    }
  });

  it('never returns an empty strip', () => {
    assert.equal(sampleTimes(0, 4, 0).length, 1);
    assert.equal(sampleTimes(0, 4, -3).length, 1);
  });
});
