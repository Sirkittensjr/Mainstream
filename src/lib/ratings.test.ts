import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PLATFORM_MEAN,
  PRIOR,
  clampRating,
  formatRating,
  ratingTone,
  roundRating,
  scoreSignal,
  shrunkAverage,
  trendFor,
} from './ratings';

describe('shrunkAverage', () => {
  it('returns the prior when there is no evidence at all', () => {
    assert.equal(shrunkAverage([], PRIOR.post, PLATFORM_MEAN), PLATFORM_MEAN);
  });

  it('keeps a single perfect rating well short of a perfect score', () => {
    // The whole point: one 10/10 must not present as a 10/10.
    const single = shrunkAverage([{ score: 10, weight: 1 }], PRIOR.post, 7.2);
    assert.ok(single < 8.3, `expected shrinkage, got ${single}`);
    assert.ok(single > 7.2, 'should still move up from the prior');
  });

  it('lets forty consistent ratings outrank one perfect one', () => {
    const one = shrunkAverage([{ score: 10, weight: 1 }], PRIOR.post, 7.2);
    const many = shrunkAverage(
      Array.from({ length: 40 }, () => ({ score: 9.3, weight: 1 })),
      PRIOR.post,
      7.2,
    );
    assert.ok(many > one, `${many} should beat ${one}`);
  });

  it('ignores zero-weight ratings entirely', () => {
    const withRevoked = shrunkAverage(
      [
        { score: 8, weight: 1 },
        { score: 1, weight: 0 },
      ],
      PRIOR.post,
      7.2,
    );
    const without = shrunkAverage([{ score: 8, weight: 1 }], PRIOR.post, 7.2);
    assert.equal(withRevoked, without);
  });

  it('weights a trusted rater above a discounted one', () => {
    const trusted = shrunkAverage([{ score: 10, weight: 1 }], PRIOR.post, 7.2);
    const discounted = shrunkAverage([{ score: 10, weight: 0.25 }], PRIOR.post, 7.2);
    assert.ok(trusted > discounted);
  });
});

describe('trendFor', () => {
  it('treats small movement as steady, so the arrow means something', () => {
    assert.equal(trendFor(8.5, 8.5), 'steady');
    assert.equal(trendFor(8.6, 8.5), 'steady');
    assert.equal(trendFor(8.4, 8.5), 'steady');
  });

  it('reports real movement in both directions', () => {
    assert.equal(trendFor(9.0, 8.5), 'up');
    assert.equal(trendFor(8.0, 8.5), 'down');
  });
});

describe('rating display', () => {
  it('clamps and rounds into the 1-10 band', () => {
    assert.equal(clampRating(12), 10);
    assert.equal(clampRating(0), 1);
    assert.equal(roundRating(8.449), 8.4);
  });

  it('shows an em dash rather than a zero for an unrated thing', () => {
    assert.equal(formatRating(null), '—');
    assert.equal(formatRating(9), '9.0');
  });

  it('bands tones without ever calling a rating "none" when it exists', () => {
    assert.equal(ratingTone(null), 'none');
    assert.equal(ratingTone(9.1), 'high');
    assert.equal(ratingTone(7.6), 'good');
    assert.equal(ratingTone(6.2), 'mid');
    assert.equal(ratingTone(3), 'low');
  });
});

describe('scoreSignal', () => {
  it('is zero at zero and rises with diminishing returns', () => {
    assert.equal(scoreSignal(0, 4), 0);
    const one = scoreSignal(1, 4);
    const two = scoreSignal(2, 4);
    const three = scoreSignal(3, 4);
    assert.ok(two > one && three > two);
    assert.ok(two - one > three - two, 'later gains should be smaller');
  });

  it('never exceeds the 0-10 band', () => {
    assert.ok(scoreSignal(10_000, 4) <= 10);
  });
});
