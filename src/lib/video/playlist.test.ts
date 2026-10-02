import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FULL_FRAME, type Clip } from './clips';
import {
  locate,
  nextSegment,
  projectTime,
  stripWidths,
  timeline,
  timelineDuration,
  trimBounds,
} from './playlist';

/** A clip of `source` seconds, kept from `start` to `end`. */
function clip(id: string, source: number, start = 0, end = source): Clip {
  return {
    id,
    src: `blob:${id}`,
    label: id,
    sourceDuration: source,
    sourceWidth: 720,
    sourceHeight: 1280,
    trimStart: start,
    trimEnd: end,
    crop: FULL_FRAME,
    rotation: 0,
    volume: 1,
  };
}

describe('laying three clips on one timeline', () => {
  const clips = [clip('a', 4), clip('b', 3), clip('c', 5)];

  it('lays them end to end in order', () => {
    const segments = timeline(clips);
    assert.deepEqual(
      segments.map((s) => [s.startsAt, s.endsAt]),
      [
        [0, 4],
        [4, 7],
        [7, 12],
      ],
    );
  });

  it('keeps the array order, because the finished file is rendered in it', () => {
    assert.deepEqual(
      timeline(clips).map((s) => s.clip.id),
      ['a', 'b', 'c'],
    );
  });

  it('adds up to the whole video', () => {
    assert.equal(timelineDuration(timeline(clips)), 12);
  });

  it('is empty for no clips, and says the video is 0 long', () => {
    assert.deepEqual(timeline([]), []);
    assert.equal(timelineDuration([]), 0);
    assert.equal(locate([], 3), null);
  });
});

describe('trimming shortens the timeline rather than leaving a hole', () => {
  // Middle clip keeps only its middle second.
  const clips = [clip('a', 4), clip('b', 3, 1, 2), clip('c', 5)];

  it('closes the gap the trim left', () => {
    assert.deepEqual(
      timeline(clips).map((s) => [s.startsAt, s.endsAt]),
      [
        [0, 4],
        [4, 5],
        [5, 10],
      ],
    );
  });

  /**
   * The point of the whole module: project time 4.5s is half a second into
   * clip B's KEPT part, which is 1.5s into B's own file — not 4.5s.
   */
  it('maps project time onto the right place in the right source file', () => {
    const segments = timeline(clips);
    const found = locate(segments, 4.5);
    assert.equal(found?.segment.clip.id, 'b');
    assert.equal(found?.sourceTime, 1.5);
  });

  it('and back again', () => {
    const segments = timeline(clips);
    assert.equal(projectTime(segments[1], 1.5), 4.5);
  });

  it('round-trips every clip at its own start', () => {
    const segments = timeline(clips);
    for (const segment of segments) {
      const found = locate(segments, segment.startsAt);
      assert.equal(found?.segment.clip.id, segment.clip.id, `at ${segment.startsAt}s`);
      assert.equal(found?.sourceTime, segment.clip.trimStart);
    }
  });
});

describe('the join between two clips', () => {
  const segments = timeline([clip('a', 3), clip('b', 2)]);

  /**
   * This is what makes playback advance instead of stalling. At exactly the
   * boundary we must already be on the next clip; if the boundary belonged to
   * the earlier segment, the player would sit on its last frame forever.
   */
  it('belongs to the clip that is starting, not the one that ended', () => {
    assert.equal(locate(segments, 3)?.segment.clip.id, 'b');
    assert.equal(locate(segments, 3)?.sourceTime, 0);
  });

  it('a hair before the join is still the first clip', () => {
    const found = locate(segments, 2.99);
    assert.equal(found?.segment.clip.id, 'a');
    assert.ok(found && Math.abs(found.sourceTime - 2.99) < 1e-9);
  });

  it('names the clip to preload', () => {
    assert.equal(nextSegment(segments, 0)?.clip.id, 'b');
    assert.equal(nextSegment(segments, 1), null);
  });
});

describe('out-of-range times do not break the player', () => {
  const segments = timeline([clip('a', 3), clip('b', 2)]);

  it('past the end holds the last frame of the last clip', () => {
    const found = locate(segments, 99);
    assert.equal(found?.segment.clip.id, 'b');
    assert.equal(found?.sourceTime, 2);
  });

  it('before the start is the first frame', () => {
    assert.equal(locate(segments, -5)?.segment.clip.id, 'a');
    assert.equal(locate(segments, -5)?.sourceTime, 0);
  });

  it('NaN is treated as the beginning rather than throwing', () => {
    assert.equal(locate(segments, Number.NaN)?.sourceTime, 0);
  });
});

describe('a trimmed clip is bounded by its own file, not by its neighbours', () => {
  it('offers the whole source', () => {
    assert.deepEqual(trimBounds(clip('a', 6, 1, 4)), { min: 0, max: 6 });
  });

  it('a clip whose duration never settled offers nothing rather than NaN', () => {
    assert.deepEqual(trimBounds(clip('a', 0)), { min: 0, max: 0 });
  });
});

describe('the clip strip', () => {
  it('is proportional to what each clip keeps', () => {
    const widths = stripWidths(timeline([clip('a', 3), clip('b', 1)]), 0);
    assert.deepEqual(widths, [0.75, 0.25]);
  });

  it('always fills the strip', () => {
    const widths = stripWidths(timeline([clip('a', 10), clip('b', 0.2), clip('c', 5)]));
    assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  });

  /** A clip trimmed down to nothing still has to be tappable. */
  it('gives a very short clip enough width to tap', () => {
    const widths = stripWidths(timeline([clip('a', 60), clip('b', 0.2)]));
    assert.ok(widths[1] >= 0.07, `${widths[1]}`);
  });

  it('splits evenly when nothing has a length yet', () => {
    assert.deepEqual(stripWidths(timeline([clip('a', 0), clip('b', 0)])), [0.5, 0.5]);
  });

  it('is empty for no clips', () => {
    assert.deepEqual(stripWidths([]), []);
  });
});
