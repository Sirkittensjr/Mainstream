import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MIN_VOTES_FOR_RANKING,
  PRIOR_VOTES,
  bayesianRating,
  clampRating,
  effectiveVotes,
  formatRating,
  formatVotes,
  isRankable,
  rankingScore,
  ratingTone,
  roundRating,
  trendFor,
  type WeightedSample,
} from './ratings';

const votes = (count: number, score: number, weight = 1): WeightedSample[] =>
  Array.from({ length: count }, () => ({ score, weight }));

describe('bayesianRating', () => {
  it('returns the prior when nobody has rated yet', () => {
    assert.equal(bayesianRating([], PRIOR_VOTES.post, 7), 7);
  });

  it('keeps a single perfect rating well short of a perfect score', () => {
    const single = bayesianRating(votes(1, 10), PRIOR_VOTES.post, 7);
    assert.ok(single < 8.5, `expected shrinkage, got ${single}`);
    assert.ok(single > 7, 'should still move up from the prior');
  });

  it('ignores ratings whose weight has been revoked', () => {
    const withRevoked = bayesianRating(
      [{ score: 8, weight: 1 }, { score: 1, weight: 0 }],
      PRIOR_VOTES.post,
      7,
    );
    assert.equal(withRevoked, bayesianRating(votes(1, 8), PRIOR_VOTES.post, 7));
  });
});

describe('vote count beats a higher raw average', () => {
  // The rule from the product brief, asserted directly.
  it('ranks 1,000 votes at 9.4 above 6 votes at 10.0', () => {
    const many = rankingScore(votes(1000, 9.4), PRIOR_VOTES.userOverall, 7);
    const few = rankingScore(votes(6, 10), PRIOR_VOTES.userOverall, 7);
    assert.ok(many > few, `${many} should beat ${few}`);
  });

  it('keeps a handful of votes off the rankings entirely', () => {
    assert.equal(isRankable(votes(6, 10)), false);
    assert.equal(isRankable(votes(MIN_VOTES_FOR_RANKING, 5)), true);
  });

  it('so a six-vote 10.0 cannot outrank a thousand-vote 4.7, because it is not ranked', () => {
    const established = votes(1000, 4.7);
    const newcomer = votes(6, 10);
    assert.ok(isRankable(established), 'the established account is ranked');
    assert.ok(!isRankable(newcomer), 'the six-vote account is not');
  });

  it('prefers more evidence when two things average the same', () => {
    const confident = rankingScore(votes(500, 8.5), PRIOR_VOTES.post, 7);
    const shaky = rankingScore(votes(12, 8.5), PRIOR_VOTES.post, 7);
    assert.ok(confident > shaky, `${confident} should beat ${shaky}`);
  });

  it('still rewards being genuinely better at the same vote count', () => {
    const better = rankingScore(votes(200, 9.2), PRIOR_VOTES.post, 7);
    const worse = rankingScore(votes(200, 7.1), PRIOR_VOTES.post, 7);
    assert.ok(better > worse);
  });

  it('counts integrity weight, not raw rows, as evidence', () => {
    // Twenty ratings from revoked accounts are not twenty votes.
    assert.equal(effectiveVotes(votes(20, 10, 0)), 0);
    assert.equal(isRankable(votes(20, 10, 0)), false);
  });
});

describe('trendFor', () => {
  it('treats small movement as steady, so the arrow means something', () => {
    assert.equal(trendFor(8.5, 8.5), 'steady');
    assert.equal(trendFor(8.6, 8.5), 'steady');
  });

  it('reports real movement in both directions', () => {
    assert.equal(trendFor(9.0, 8.5), 'up');
    assert.equal(trendFor(8.0, 8.5), 'down');
  });
});

describe('display helpers', () => {
  it('clamps and rounds into the 1-10 band', () => {
    assert.equal(clampRating(12), 10);
    assert.equal(clampRating(0), 1);
    assert.equal(roundRating(8.449), 8.4);
  });

  it('shows an em dash rather than a zero for something unrated', () => {
    assert.equal(formatRating(null), '—');
    assert.equal(formatRating(9), '9.0');
  });

  it('always states how many people rated', () => {
    assert.equal(formatVotes(1), '1 rating');
    assert.equal(formatVotes(42), '42 ratings');
    assert.equal(formatVotes(1500), '1.5k ratings');
  });

  it('never calls an existing rating "none"', () => {
    assert.equal(ratingTone(null), 'none');
    assert.equal(ratingTone(9.1), 'high');
    assert.equal(ratingTone(3), 'low');
  });
});
