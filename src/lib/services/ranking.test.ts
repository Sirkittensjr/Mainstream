import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Post } from '@/lib/types';
import { interleave, ratingMultiplier, risingScore, shotRotation, trendingScore } from './ranking';

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
    challenge_id: null,
    shot: false,
    shot_stage: 0,
    impressions: 0,
    boosted: false,
    views: 0,
    featured: false,
    featured_at: null,
    removed: false,
    removed_reason: null,
    created_at: new Date(NOW - 2 * HOUR).toISOString(),
    ...over,
  }) as Post;

describe('risingScore', () => {
  it('ranks a small creator above a huge one with far more raw engagement', () => {
    // The product promise, as an assertion: 40 likes on a 20-follower account
    // must beat 400 likes on a 200,000-follower account.
    const newcomer = risingScore(post(), { likes: 40, comments: 6, views: 300 }, 20, NOW);
    const famous = risingScore(post(), { likes: 400, comments: 60, views: 40_000 }, 200_000, NOW);
    assert.ok(newcomer > famous, `${newcomer} should beat ${famous}`);
  });

  it('decays with age so fresh work always has a chance', () => {
    const fresh = risingScore(post(), { likes: 20, comments: 2, views: 100 }, 50, NOW);
    const old = risingScore(
      post({ created_at: new Date(NOW - 120 * HOUR).toISOString() }),
      { likes: 20, comments: 2, views: 100 },
      50,
      NOW,
    );
    assert.ok(fresh > old);
  });

  it('lifts a post that asked for a shot above an identical one that did not', () => {
    const engagement = { likes: 10, comments: 1, views: 50 };
    const asked = risingScore(post({ shot: true }), engagement, 30, NOW);
    const silent = risingScore(post(), engagement, 30, NOW);
    assert.ok(asked > silent);
  });

  it('rewards a well-rated post over an identical badly-rated one', () => {
    const engagement = { likes: 10, comments: 1, views: 50 };
    const loved = risingScore(post(), engagement, 30, NOW, 10);
    const unrated = risingScore(post(), engagement, 30, NOW, null);
    const disliked = risingScore(post(), engagement, 30, NOW, 3);
    assert.ok(loved > unrated && unrated > disliked);
  });
});

describe('ratingMultiplier', () => {
  it('is neutral for an unrated post, so new work is not penalised', () => {
    assert.equal(ratingMultiplier(null), 1);
  });

  it('moves exposure meaningfully but never overwhelmingly', () => {
    assert.ok(ratingMultiplier(10) <= 1.35);
    assert.ok(ratingMultiplier(1) >= 0.7);
  });
});

describe('trendingScore', () => {
  it('rewards raw popularity regardless of audience size', () => {
    const big = trendingScore(post(), { likes: 400, comments: 60, views: 40_000 }, NOW);
    const small = trendingScore(post(), { likes: 40, comments: 6, views: 300 }, NOW);
    assert.ok(big > small, 'trending is the one place scale wins');
  });
});

describe('shotRotation', () => {
  it('puts brand new posts at the front of the queue', () => {
    const fresh = { id: 'fresh', created_at: new Date(NOW - HOUR).toISOString() };
    const older = { id: 'older', created_at: new Date(NOW - 80 * HOUR).toISOString() };
    const order = shotRotation([older, fresh], NOW, 2);
    assert.equal(order[0].id, 'fresh');
  });

  it('is stable within a rotation window and returns everyone eventually', () => {
    const posts = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      created_at: new Date(NOW - 100 * HOUR).toISOString(),
    }));
    const a = shotRotation(posts, NOW, 5).map((p) => p.id);
    const b = shotRotation(posts, NOW, 5).map((p) => p.id);
    assert.deepEqual(a, b, 'same window must produce the same order');
    assert.equal(new Set(a).size, posts.length, 'nobody is dropped from the queue');
  });

  it('advances the queue as time passes, so a waiting post gets its turn', () => {
    const posts = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      created_at: new Date(NOW - 100 * HOUR).toISOString(),
    }));
    const now = shotRotation(posts, NOW, 2).map((p) => p.id);
    const later = shotRotation(posts, NOW + 7 * HOUR, 2).map((p) => p.id);
    assert.notDeepEqual(now, later);
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

  it('never shows the same item twice, even when streams overlap', () => {
    // A post can legitimately appear in several streams (followed *and*
    // rising). It must reach the feed exactly once.
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
