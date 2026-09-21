import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { raterWeight } from './rating-weight';
import { DAY } from './time';

const NOW = Date.parse('2026-09-21T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

const rater = (over: Partial<Parameters<typeof raterWeight>[0]> = {}) => ({
  status: 'active' as const,
  trusted: true,
  created_at: daysAgo(90),
  points: 500,
  ...over,
});

const given = (count: number, owner: string, score = 8) =>
  Array.from({ length: count }, () => ({ score, owner_id: owner }));

describe('raterWeight', () => {
  it('gives an established, active participant full weight', () => {
    assert.equal(raterWeight(rater(), [], 'creator', NOW).weight, 1);
  });

  it('silences nobody but discounts a brand new account', () => {
    const fresh = raterWeight(rater({ created_at: daysAgo(0.5), points: 0 }), [], 'creator', NOW);
    assert.ok(fresh.weight > 0, 'a new account still counts for something');
    assert.ok(fresh.weight <= 0.25, `expected a heavy discount, got ${fresh.weight}`);
  });

  it('revokes weight entirely for a moderator-flagged account', () => {
    assert.equal(raterWeight(rater({ trusted: false }), [], 'creator', NOW).weight, 0);
  });

  it('revokes weight for a suspended account', () => {
    assert.equal(raterWeight(rater({ status: 'suspended' }), [], 'creator', NOW).weight, 0);
  });

  it('collapses weight when someone keeps rating the same creator', () => {
    const occasional = raterWeight(rater(), given(2, 'creator'), 'creator', NOW).weight;
    const repeated = raterWeight(rater(), given(4, 'creator'), 'creator', NOW).weight;
    const obsessive = raterWeight(rater(), given(7, 'creator'), 'creator', NOW).weight;
    assert.equal(occasional, 1);
    assert.ok(repeated < occasional, 'several ratings should cost weight');
    assert.ok(obsessive < repeated, 'many ratings should cost much more');
  });

  it('discounts an account that rates almost everything a 9 or 10', () => {
    const stamper = raterWeight(
      rater(),
      Array.from({ length: 12 }, (_, i) => ({ score: 10, owner_id: `creator-${i}` })),
      'someone-new',
      NOW,
    );
    assert.ok(stamper.weight <= 0.4, `expected discount, got ${stamper.weight}`);
    assert.ok(stamper.reasons.some((r) => r.includes('9 or 10')));
  });

  it('discounts brigading just as hard as rubber-stamping', () => {
    const brigade = raterWeight(
      rater(),
      Array.from({ length: 12 }, (_, i) => ({ score: 1, owner_id: `creator-${i}` })),
      'someone-new',
      NOW,
    );
    assert.ok(brigade.weight <= 0.4, `expected discount, got ${brigade.weight}`);
  });

  it('catches a ring: most ratings aimed at one creator', () => {
    const ring = raterWeight(
      rater(),
      [...given(6, 'target'), ...given(2, 'decoy-a'), ...given(2, 'decoy-b')],
      'target',
      NOW,
    );
    assert.ok(ring.weight <= 0.1, `expected near-zero weight, got ${ring.weight}`);
    assert.ok(ring.reasons.length >= 2, 'a moderator should see why');
  });

  it('never returns a weight outside 0-1', () => {
    const cases = [
      raterWeight(rater({ created_at: daysAgo(0), points: 0 }), given(20, 'x', 10), 'x', NOW),
      raterWeight(rater(), [], 'x', NOW),
    ];
    for (const result of cases) {
      assert.ok(result.weight >= 0 && result.weight <= 1, `out of band: ${result.weight}`);
    }
  });
});
