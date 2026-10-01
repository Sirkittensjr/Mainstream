import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MissingRelationError } from './db/errors';
import {
  AUTO_REVIEW_THRESHOLD,
  REVIEW_WINDOW_HOURS,
  REVIEW_WINDOW_MS,
  clampWindow,
  countUniqueReporters,
  describeWindow,
  isMissingReviewColumn,
  reachedThreshold,
  reviewExpiry,
  reviewHasExpired,
  underReview,
} from './auto-review-rules';

const NOW = Date.parse('2026-09-27T12:00:00.000Z');
const HOUR = 3_600_000;

const reporters = (...ids: string[]) => ids.map((reporter_id) => ({ reporter_id }));

describe('the threshold counts people, not reports', () => {
  it('is ten distinct accounts', () => {
    assert.equal(AUTO_REVIEW_THRESHOLD, 10);
  });

  it('counts one account once, however many times it reported', () => {
    const spammer = reporters(...Array.from({ length: 30 }, () => 'u1'));
    assert.equal(countUniqueReporters(spammer), 1);
    assert.equal(reachedThreshold(countUniqueReporters(spammer)), false);
  });

  /**
   * The case the whole feature exists for, and the case a brigade would try to
   * fake: nine real people is not ten.
   */
  it('nine different accounts is not enough', () => {
    const nine = reporters(...Array.from({ length: 9 }, (_, i) => `u${i}`));
    assert.equal(countUniqueReporters(nine), 9);
    assert.equal(reachedThreshold(9), false);
  });

  it('ten different accounts is', () => {
    const ten = reporters(...Array.from({ length: 10 }, (_, i) => `u${i}`));
    assert.equal(countUniqueReporters(ten), 10);
    assert.equal(reachedThreshold(10), true);
  });

  it('twenty reports from two people is two', () => {
    const mixed = reporters(...Array.from({ length: 20 }, (_, i) => `u${i % 2}`));
    assert.equal(countUniqueReporters(mixed), 2);
    assert.equal(reachedThreshold(countUniqueReporters(mixed)), false);
  });
});

describe('the window', () => {
  it('is 24 hours', () => {
    assert.equal(REVIEW_WINDOW_HOURS, 24);
    assert.equal(REVIEW_WINDOW_MS, 24 * HOUR);
    assert.equal(reviewExpiry(new Date(NOW)).getTime(), NOW + 24 * HOUR);
  });

  /**
   * The one that stops "temporary" quietly becoming something else. A
   * deployment may shorten the window; nothing may lengthen it.
   */
  it('can be shortened but never lengthened', () => {
    assert.equal(clampWindow(2 * 60_000), 2 * 60_000);
    assert.equal(clampWindow(48 * HOUR), 24 * HOUR);
    assert.equal(reviewExpiry(new Date(NOW), 999 * HOUR).getTime(), NOW + 24 * HOUR);
  });

  it('falls back to 24 hours for nonsense, rather than to zero', () => {
    // Zero or a negative number would expire a hide the instant it started;
    // NaN would produce an Invalid Date. Both read as "no window configured".
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 30_000]) {
      assert.equal(clampWindow(bad), 24 * HOUR, `clampWindow(${bad})`);
    }
  });

  it('describes itself so no message hard-codes the wrong duration', () => {
    assert.equal(describeWindow(), '24 hours');
    assert.equal(describeWindow(24 * HOUR), '24 hours');
    assert.equal(describeWindow(HOUR), '1 hour');
    assert.equal(describeWindow(2 * 60_000), '2 minutes');
    assert.equal(describeWindow(60_000), '1 minute');
    // Out of range still describes the window actually used.
    assert.equal(describeWindow(100 * HOUR), '24 hours');
  });
});

describe('underReview', () => {
  it('a normal post is not under review', () => {
    assert.equal(underReview({}, NOW), false);
    assert.equal(underReview({ review_state: null }, NOW), false);
  });

  it('a temporary review inside its window hides the post', () => {
    const post = { review_state: 'temporary_review', review_expires_at: iso(NOW + HOUR) };
    assert.equal(underReview(post, NOW), true);
  });

  /**
   * No sweep has to have run for this. The post is visible again because the
   * time passed, not because a job noticed the time passed.
   */
  it('an expired temporary review does not, with no sweep involved', () => {
    const post = { review_state: 'temporary_review', review_expires_at: iso(NOW - 1) };
    assert.equal(underReview(post, NOW), false);
  });

  it('exactly at the expiry the post is back', () => {
    const post = { review_state: 'temporary_review', review_expires_at: iso(NOW) };
    assert.equal(underReview(post, NOW), false);
  });

  it('an admin hold ignores the clock entirely', () => {
    const post = { review_state: 'admin_hold', review_expires_at: iso(NOW - 100 * HOUR) };
    assert.equal(underReview(post, NOW), true);
    assert.equal(underReview({ review_state: 'admin_hold' }, NOW), true);
  });

  it('a temporary review with no expiry recorded stays hidden rather than leaking', () => {
    assert.equal(underReview({ review_state: 'temporary_review' }, NOW), true);
  });

  it('an unrecognised state is treated as not hidden, not as a hold', () => {
    // Defensive: a value this code does not know about must not become a
    // permanent invisible state nobody can find in the queue.
    assert.equal(underReview({ review_state: 'something_else' }, NOW), false);
  });
});

describe('reviewHasExpired', () => {
  it('is true only for a temporary review whose time is up', () => {
    assert.equal(
      reviewHasExpired({ review_state: 'temporary_review', review_expires_at: iso(NOW - 1) }, NOW),
      true,
    );
    assert.equal(
      reviewHasExpired({ review_state: 'temporary_review', review_expires_at: iso(NOW + 1) }, NOW),
      false,
    );
  });

  it('never sweeps away an admin hold', () => {
    assert.equal(
      reviewHasExpired({ review_state: 'admin_hold', review_expires_at: iso(NOW - HOUR) }, NOW),
      false,
    );
  });

  it('never sweeps a post that is not under review at all', () => {
    assert.equal(reviewHasExpired({}, NOW), false);
  });
});

/**
 * The guard that decides whether an error is swallowed and the feature switched
 * off. Anything it says yes to wrongly becomes a bug that hides itself, so the
 * negative cases below matter more than the positive ones.
 */
describe('isMissingReviewColumn', () => {
  const missing = (table: string, column: string | null) =>
    new MissingRelationError(table, column, `[supabase:${table}] nope`);

  it('recognises every column 0009 adds, not just the first one', () => {
    // An update sends all four; which one PostgREST names is not ours to pick.
    for (const column of [
      'review_state',
      'review_started_at',
      'review_expires_at',
      'review_reports',
    ]) {
      assert.equal(isMissingReviewColumn(missing('posts', column)), true, column);
    }
  });

  it('recognises the posts table being absent entirely', () => {
    assert.equal(isMissingReviewColumn(missing('posts', null)), true);
  });

  it('does NOT swallow a missing column this feature did not add', () => {
    // Swallowing this would turn a real schema problem elsewhere on `posts`
    // into a silent no-op attributed to migration 0009.
    assert.equal(isMissingReviewColumn(missing('posts', 'content_warning')), false);
    assert.equal(isMissingReviewColumn(missing('posts', 'caption')), false);
  });

  it('does NOT swallow a problem with another table', () => {
    assert.equal(isMissingReviewColumn(missing('reports', 'cleared_at')), false);
    assert.equal(isMissingReviewColumn(missing('messages', null)), false);
    assert.equal(isMissingReviewColumn(missing('moderation_events', null)), false);
  });

  it('does NOT swallow an ordinary error', () => {
    assert.equal(isMissingReviewColumn(new Error('connection reset')), false);
    assert.equal(isMissingReviewColumn(null), false);
    assert.equal(isMissingReviewColumn(undefined), false);
    assert.equal(isMissingReviewColumn('review_state'), false);
  });
});

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
