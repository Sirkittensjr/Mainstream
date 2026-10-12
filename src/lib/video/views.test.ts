import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_VIEWS_PER_HOUR,
  MIN_VIEW_GAP_MS,
  decideView,
  dedupeKey,
  isLoopRestart,
  newSessionKey,
  sanitiseSessionKey,
  type ViewDecision,
} from './views';

describe('a loop or a replay from the start is a new viewing', () => {
  it('near the end, then back at the start: it looped', () => {
    assert.equal(isLoopRestart(9.8, 0.05, 10), true);
    assert.equal(isLoopRestart(9.1, 0, 10), true);
  });

  it('a short clip loops too', () => {
    assert.equal(isLoopRestart(0.75, 0.02, 1), true);
  });

  it('playing forwards is not a restart, however the events arrive', () => {
    assert.equal(isLoopRestart(1, 1.25, 10), false);
    assert.equal(isLoopRestart(5, 5, 10), false);
    assert.equal(isLoopRestart(0.1, 0.3, 10), false);
  });

  it('scrubbing back a little, or to the middle, is not', () => {
    assert.equal(isLoopRestart(5, 0.2, 10), false, 'from the middle of a known length');
    assert.equal(isLoopRestart(9.8, 4, 10), false, 'not back to the start');
  });

  it('with no length known, any jump back to the start from over a second in', () => {
    assert.equal(isLoopRestart(6, 0.1, Number.POSITIVE_INFINITY), true);
    assert.equal(isLoopRestart(6, 0.1, null), true);
    assert.equal(isLoopRestart(0.8, 0.1, null), false);
  });

  it('nonsense is not a restart', () => {
    assert.equal(isLoopRestart(Number.NaN, 0, 10), false);
    assert.equal(isLoopRestart(9.9, Number.NaN, 10), false);
  });
});

describe('playback session keys', () => {
  it('accepts a key of the right shape and refuses anything else', () => {
    assert.equal(sanitiseSessionKey('abc12345'), 'abc12345');
    assert.equal(sanitiseSessionKey('  abc12345  '), 'abc12345');
    assert.equal(sanitiseSessionKey('short'), null);
    assert.equal(sanitiseSessionKey('has spaces in it'), null);
    assert.equal(sanitiseSessionKey('x'.repeat(65)), null);
    assert.equal(sanitiseSessionKey(42), null);
    assert.equal(sanitiseSessionKey(null), null);
  });

  it('makes a new, valid key every time', () => {
    const a = newSessionKey();
    const b = newSessionKey();
    assert.notEqual(a, b);
    assert.equal(sanitiseSessionKey(a), a);
  });

  it('keys a view on who watched as well as which session', () => {
    assert.notEqual(dedupeKey('p', 'u1', 'session1'), dedupeKey('p', 'u2', 'session1'));
    assert.notEqual(dedupeKey('p', 'u1', 'session1'), dedupeKey('p', 'u1', 'session2'));
    assert.equal(dedupeKey('p', 'u1', null), 'p:u1:no-session');
  });
});

describe('the server-side decision', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const ago = (ms: number) => ({ created_at: new Date(now - ms).toISOString() });
  const base: ViewDecision = {
    post: { removed: false, hasVideo: true },
    identity: 'viewer',
    sessionCounted: false,
    recent: [],
    now,
  };

  it('counts a playback, however brief', () => {
    assert.equal(decideView(base), 'count');
  });

  it('counts a visitor nobody has signed in, by their browser', () => {
    assert.equal(decideView({ ...base, identity: 'anon:browser' }), 'count');
  });

  it('counts nothing for a post with no video on it', () => {
    assert.equal(decideView({ ...base, post: { removed: false, hasVideo: false } }), 'not-a-video');
  });

  it('counts nothing for a missing or removed post', () => {
    assert.equal(decideView({ ...base, post: null }), 'no-post');
    assert.equal(decideView({ ...base, post: { removed: true, hasVideo: true } }), 'no-post');
  });

  it('counts one playback session once, however many times it is reported', () => {
    assert.equal(decideView({ ...base, sessionCounted: true }), 'duplicate-session');
  });

  it('counts the same person watching again — scrolled back, replayed, refreshed', () => {
    assert.equal(decideView({ ...base, recent: [ago(MIN_VIEW_GAP_MS)] }), 'count');
    assert.equal(decideView({ ...base, recent: [ago(5_000), ago(60_000)] }), 'count');
  });

  it('a second session inside the gap is a burst, not a re-watch', () => {
    assert.equal(decideView({ ...base, recent: [ago(200)] }), 'too-soon');
  });

  it('no one person adds more than the hourly cap, whatever keys they invent', () => {
    const full = Array.from({ length: MAX_VIEWS_PER_HOUR }, (_, i) => ago(2_000 + i * 10_000));
    assert.equal(decideView({ ...base, recent: full }), 'hourly-limit');
    const older = full.map((_, i) => ago(3_600_000 + i * 1_000));
    assert.equal(decideView({ ...base, recent: older }), 'count', 'views over an hour old do not count against it');
  });

  it('counts nothing when there is no way to tell who watched', () => {
    assert.equal(decideView({ ...base, identity: null }), 'unknown-viewer');
  });

  it('an unreadable timestamp is not a reason to refuse', () => {
    assert.equal(decideView({ ...base, recent: [{ created_at: 'not a date' }] }), 'count');
  });
});
