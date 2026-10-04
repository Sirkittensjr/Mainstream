import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectFrames, sampleTimes } from './thumbnails';

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

describe('one filmstrip for the whole project', () => {
  const clip = (id: string, sourceDuration: number, trimStart = 0) => ({
    id,
    trimStart,
    sourceDuration,
  });
  /** Two clips of 4s each, kept whole. */
  const segments = [
    { clip: clip('a', 4), startsAt: 0, endsAt: 4, length: 4 },
    { clip: clip('b', 4), startsAt: 4, endsAt: 8, length: 4 },
  ];
  const strips = {
    a: ['a0', 'a1', 'a2', 'a3'],
    b: ['b0', 'b1', 'b2', 'b3'],
  };

  it('draws from each clip in proportion to how long it runs', () => {
    const cells = projectFrames(segments, strips, 4);
    assert.deepEqual(
      cells.map((frame) => frame[0]),
      ['a', 'a', 'b', 'b'],
    );
  });

  it('walks forward through each clip rather than repeating one frame', () => {
    // Cells are sampled at their own midpoints — 1s, 3s, 5s, 7s of an 8s
    // project — so neither end of the strip lands exactly on a join.
    assert.deepEqual(projectFrames(segments, strips, 4), ['a1', 'a3', 'b1', 'b3']);
  });

  it('gives a longer clip more of the strip', () => {
    const uneven = [
      { clip: clip('a', 9), startsAt: 0, endsAt: 9, length: 9 },
      { clip: clip('b', 3), startsAt: 9, endsAt: 12, length: 3 },
    ];
    const cells = projectFrames(uneven, { a: ['a0', 'a1'], b: ['b0', 'b1'] }, 4);
    assert.equal(cells.filter((frame) => frame.startsWith('a')).length, 3);
    assert.equal(cells.filter((frame) => frame.startsWith('b')).length, 1);
  });

  /** The strip spans a clip's whole FILE, so a trim moves which frame a moment
   *  of the project lands on. */
  it('reads a trimmed clip from the right part of its own file', () => {
    const trimmed = [{ clip: clip('a', 8, 4), startsAt: 0, endsAt: 4, length: 4 }];
    // Project 0-4s is file 4-8s, which is the back half of a four-frame strip.
    assert.deepEqual(projectFrames(trimmed, { a: ['a0', 'a1', 'a2', 'a3'] }, 2), ['a2', 'a3']);
  });

  it('gives an empty cell for a clip whose frames have not arrived', () => {
    assert.deepEqual(projectFrames(segments, { a: ['a0'] }, 2), ['a0', '']);
  });

  it('answers with blanks rather than throwing on an empty project', () => {
    assert.deepEqual(projectFrames([], {}, 3), ['', '', '']);
  });

  it('never returns an empty strip', () => {
    assert.equal(projectFrames(segments, strips, 0).length, 1);
  });
});
