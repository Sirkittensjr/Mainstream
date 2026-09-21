import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADVANCE_RATING, SHOT_STAGES, isResting, shotProgress, shouldAdvance } from './shot';

const post = (over: Partial<{ shot: boolean; shot_stage: number; impressions: number }> = {}) => ({
  shot: true,
  shot_stage: 0,
  impressions: 0,
  ...over,
});

describe('staged exposure', () => {
  it('does not apply to posts that never asked for a shot', () => {
    assert.equal(shotProgress(post({ shot: false }), 9, 0.2), null);
  });

  it('holds a post inside its slice until the slice is used up', () => {
    assert.equal(shouldAdvance(post({ impressions: SHOT_STAGES[0] - 1 }), 10, 1), false);
  });

  it('graduates a well-received post to the next slice', () => {
    assert.equal(shouldAdvance(post({ impressions: SHOT_STAGES[0] }), ADVANCE_RATING, 0), true);
  });

  it('rests a post the community did not respond to', () => {
    const used = post({ impressions: SHOT_STAGES[0] });
    assert.equal(shouldAdvance(used, 5.5, 0.001), false);
    assert.equal(isResting(used, 5.5, 0.001), true);
  });

  it('lets an unrated post advance on engagement alone', () => {
    // A post nobody rated should not be trapped at stage one forever.
    assert.equal(shouldAdvance(post({ impressions: SHOT_STAGES[0] }), null, 0.2), true);
  });

  it('stops at the top of the ladder instead of advancing forever', () => {
    const top = post({ shot_stage: SHOT_STAGES.length - 1, impressions: 1_000_000 });
    assert.equal(shouldAdvance(top, 10, 1), false);
    assert.equal(shotProgress(top, 10, 1)?.status, 'complete');
  });

  it('reports progress through the current slice', () => {
    const half = shotProgress(post({ impressions: 50 }), 8, 0.1);
    assert.equal(half?.cap, SHOT_STAGES[0]);
    assert.equal(half?.progress, 50);
  });
});
