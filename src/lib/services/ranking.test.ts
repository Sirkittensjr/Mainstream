import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Post } from '@/lib/types';
import { interleave, ratingMultiplier, recommendScore } from './ranking';

const NOW = Date.parse('2026-09-21T00:00:00.000Z');
const HOUR = 3_600_000;

const post = (over: Partial<Post> = {}): Post =>
  ({
    id: 'p1',
    author_id: 'a1',
    caption: '',
    media: [],
    category: 'Music',
    tags: [],
    views: 0,
    removed: false,
    removed_reason: null,
    created_at: new Date(NOW - 2 * HOUR).toISOString(),
    ...over,
  }) as Post;

describe('recommendScore', () => {
  it('ranks a small account above a huge one with far more raw engagement', () => {
    // Follower count is a denominator here, never a bonus.
    const newcomer = recommendScore(post(), { likes: 40, comments: 6, views: 300 }, 20, NOW);
    const famous = recommendScore(
      post(),
      { likes: 400, comments: 60, views: 40_000 },
      200_000,
      NOW,
    );
    assert.ok(newcomer > famous, `${newcomer} should beat ${famous}`);
  });

  it('decays with age so fresh posts always have a chance', () => {
    const engagement = { likes: 20, comments: 2, views: 100 };
    const fresh = recommendScore(post(), engagement, 50, NOW);
    const old = recommendScore(
      post({ created_at: new Date(NOW - 120 * HOUR).toISOString() }),
      engagement,
      50,
      NOW,
    );
    assert.ok(fresh > old);
  });

  it('rewards a well-rated post over an identical badly-rated one', () => {
    const engagement = { likes: 10, comments: 1, views: 50 };
    const loved = recommendScore(post(), engagement, 30, NOW, 10);
    const unrated = recommendScore(post(), engagement, 30, NOW, null);
    const disliked = recommendScore(post(), engagement, 30, NOW, 3);
    assert.ok(loved > unrated && unrated > disliked);
  });

  it('lifts posts in a category you are into', () => {
    const engagement = { likes: 10, comments: 1, views: 50 };
    const matched = recommendScore(post(), engagement, 30, NOW, null, true);
    const not = recommendScore(post(), engagement, 30, NOW, null, false);
    assert.ok(matched > not);
  });
});

describe('ratingMultiplier', () => {
  it('is neutral for an unrated post, so new work is not penalised', () => {
    assert.equal(ratingMultiplier(null), 1);
  });

  it('moves reach meaningfully but never overwhelmingly', () => {
    assert.ok(ratingMultiplier(10) <= 1.35);
    assert.ok(ratingMultiplier(1) >= 0.7);
  });
});

describe('interleave', () => {
  it('mixes streams so one source cannot fill the screen', () => {
    const mixed = interleave(
      [
        ['a1', 'a2', 'a3'],
        ['b1', 'b2'],
      ],
      (value) => value,
    );
    assert.deepEqual(mixed, ['a1', 'b1', 'a2', 'b2', 'a3']);
  });

  it('never shows the same post twice, even when streams overlap', () => {
    const mixed = interleave(
      [
        ['x', 'y'],
        ['x', 'z'],
      ],
      (value) => value,
    );
    assert.equal(new Set(mixed).size, mixed.length, 'no duplicates');
    assert.deepEqual([...mixed].sort(), ['x', 'y', 'z'], 'nothing is dropped');
  });
});
