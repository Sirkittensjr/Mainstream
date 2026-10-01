import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUDGET_SPENT_SECONDS,
  MIN_SEGMENT_SECONDS,
  budgetLeft,
  canContinue,
  canRecordAnother,
  keepsSegment,
  recordedSeconds,
  segmentBudget,
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
