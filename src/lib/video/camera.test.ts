import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUDGET_SPENT_SECONDS,
  MIN_SEGMENT_SECONDS,
  appendSegment,
  budgetLeft,
  canContinue,
  canRecordAnother,
  keepsSegment,
  recordedSeconds,
  segmentBudget,
  segmentSpans,
  segmentSummary,
  stageAfterNext,
  stageAfterSegment,
} from './camera';
import { MAX_VIDEO_SECONDS } from './limits';

describe('recording more than one segment', () => {
  it('counts the total of every segment, not the last one', () => {
    // The example from the brief: three clips, thirty seconds.
    assert.equal(recordedSeconds([10, 8, 12]), 30);
  });

  it('measures the limit against the total', () => {
    assert.equal(budgetLeft([10, 8, 12]), MAX_VIDEO_SECONDS - 30);
    // Not "two minutes per clip": three forty-second clips are the whole budget.
    assert.equal(budgetLeft([40, 40, 40]), 0);
    assert.equal(canRecordAnother([40, 40, 40]), false);
  });

  it('never reports a negative budget, however much was imported', () => {
    assert.equal(budgetLeft([500]), 0);
    assert.equal(canRecordAnother([500]), false);
  });

  it('offers the chosen cap or what is left, whichever is smaller', () => {
    // Nothing filmed: the cap is the whole promise.
    assert.equal(segmentBudget([], 15), 15);
    // 100 seconds gone, and 2m chosen: the next take runs to 20, not to 120.
    assert.equal(segmentBudget([100], MAX_VIDEO_SECONDS), 20);
    // A short cap with plenty of room left is still the short cap.
    assert.equal(segmentBudget([10], 15), 15);
  });
});

describe('stopping a segment does not leave the camera', () => {
  it('stays on the camera after a segment', () => {
    assert.equal(stageAfterSegment([5]), 'camera');
    assert.equal(stageAfterSegment([10, 8]), 'camera');
    assert.equal(stageAfterSegment([10, 8, 12]), 'camera');
  });

  it('stays on the camera with a second of the budget left', () => {
    assert.equal(stageAfterSegment([MAX_VIDEO_SECONDS - 1]), 'camera');
  });

  it('leaves only when the budget is spent, because there is nothing left to film', () => {
    assert.equal(stageAfterSegment([MAX_VIDEO_SECONDS]), 'edit');
    assert.equal(
      stageAfterSegment([MAX_VIDEO_SECONDS - BUDGET_SPENT_SECONDS / 2]),
      'edit',
    );
  });
});

describe('Next', () => {
  it('moves to the editor once something has been filmed', () => {
    assert.equal(stageAfterNext([4]), 'edit');
    assert.equal(stageAfterNext([10, 8, 12]), 'edit');
  });

  it('does nothing with an empty camera', () => {
    assert.equal(stageAfterNext([]), 'camera');
    assert.equal(canContinue([]), false);
    // A shutter tapped twice in the same instant is not a clip to continue with.
    assert.equal(stageAfterNext([0.05]), 'camera');
  });
});

describe('what counts as a segment', () => {
  it('keeps a real take and drops an empty one', () => {
    assert.equal(keepsSegment(MIN_SEGMENT_SECONDS), true);
    assert.equal(keepsSegment(4), true);
    assert.equal(keepsSegment(0), false);
    assert.equal(keepsSegment(0.05), false);
    assert.equal(keepsSegment(Number.NaN), false);
  });
});

describe('what the camera says it is holding', () => {
  it('counts clips and their total', () => {
    assert.equal(segmentSummary([10, 8, 12]), '3 clips · 0:30');
    assert.equal(segmentSummary([7]), '1 clip · 0:07');
    assert.equal(segmentSummary([65, 10]), '2 clips · 1:15');
  });

  it('ignores takes too short to have been kept', () => {
    assert.equal(segmentSummary([10, 0.05]), '1 clip · 0:10');
  });
});

describe('appending a clip to the recording session', () => {
  it('appends rather than replacing, however many times Record is pressed', () => {
    // The sequence from the brief: 5s, then 8s, then 4s, one session.
    let session: number[] = [];
    for (const seconds of [5, 8, 4]) {
      const result = appendSegment(session, seconds);
      assert.equal(result.added, true);
      session = result.segments;
    }
    assert.deepEqual(session, [5, 8, 4]);
    assert.equal(recordedSeconds(session), 17);
  });

  it('keeps the clips in the order they were filmed', () => {
    const first = appendSegment([], 5).segments;
    const second = appendSegment(first, 8).segments;
    const third = appendSegment(second, 4).segments;
    assert.deepEqual(third, [5, 8, 4]);
    // The earlier lists are untouched: nothing is mutated out from under them.
    assert.deepEqual(first, [5]);
    assert.deepEqual(second, [5, 8]);
  });

  it('leaves the session alone when a take was too short to keep', () => {
    const result = appendSegment([5, 8], 0.05);
    assert.equal(result.added, false);
    assert.equal(result.reason, 'too-short');
    assert.deepEqual(result.segments, [5, 8]);
  });

  it('refuses a clip that would take the video past the total limit, and keeps the rest', () => {
    const result = appendSegment([MAX_VIDEO_SECONDS - 2], 10);
    assert.equal(result.added, false);
    assert.equal(result.reason, 'no-room');
    assert.deepEqual(result.segments, [MAX_VIDEO_SECONDS - 2]);
  });

  it('allows a clip that exactly fills the budget', () => {
    assert.equal(appendSegment([60], 60).added, true);
  });

  it('stays on the camera after each of three clips, and Next then has all three', () => {
    let session: number[] = [];
    for (const seconds of [5, 8, 4]) {
      session = appendSegment(session, seconds).segments;
      assert.equal(stageAfterSegment(session), 'camera');
    }
    assert.equal(session.length, 3);
    assert.equal(stageAfterNext(session), 'edit');
  });
});

describe('the clip bar across the top of the camera', () => {
  it('gives one span per clip, in order, as a fraction of the budget', () => {
    const spans = segmentSpans([30, 60], MAX_VIDEO_SECONDS);
    assert.equal(spans.length, 2);
    assert.equal(spans[0].seconds, 30);
    assert.equal(spans[0].fraction, 0.25);
    assert.equal(spans[1].fraction, 0.5);
  });

  it('leaves out a take too short to have been kept', () => {
    assert.equal(segmentSpans([10, 0.05]).length, 1);
  });

  it('never gives a span wider than the whole bar', () => {
    assert.equal(segmentSpans([500])[0].fraction, 1);
  });
});
