import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MIN_VIEW_SECONDS,
  VIEW_COOLDOWN_MS,
  VIEW_THRESHOLD_SECONDS,
  type ViewDecision,
  decideView,
  dedupeKey,
  isFreshView,
  newSessionKey,
  playedSince,
  sanitiseSessionKey,
  shouldReportView,
  viewThreshold,
} from './views';

describe('when a view is counted', () => {
  it('needs real playback, not a render', () => {
    assert.equal(shouldReportView({ playedSeconds: 0, reported: false }, 60), false);
    assert.equal(shouldReportView({ playedSeconds: 1, reported: false }, 60), false);
    assert.equal(
      shouldReportView({ playedSeconds: VIEW_THRESHOLD_SECONDS, reported: false }, 60),
      true,
    );
  });

  it('never reports a playback session twice', () => {
    // The whole defence against re-renders, remounts and scrolling: once the
    // session has been reported, no amount of further playback reports again.
    assert.equal(shouldReportView({ playedSeconds: 90, reported: true }, 120), false);
  });

  it('lets a video shorter than the threshold be viewed at all', () => {
    assert.equal(viewThreshold(2), 1);
    assert.equal(viewThreshold(60), VIEW_THRESHOLD_SECONDS);
    // Nothing is below the floor, even for a video of almost no length.
    assert.equal(viewThreshold(0.2), MIN_VIEW_SECONDS);
    // An unknown duration is held to the full threshold.
    assert.equal(viewThreshold(undefined), VIEW_THRESHOLD_SECONDS);
    assert.equal(viewThreshold(null), VIEW_THRESHOLD_SECONDS);
  });
});

describe('measuring played time', () => {
  it('adds the step between two timeupdates', () => {
    assert.equal(playedSince(1, 1.25), 0.25);
  });

  it('counts a seek as nothing watched', () => {
    // Dragging the scrubber a minute forward is not a minute of watching.
    assert.equal(playedSince(2, 62), 0);
    // Backwards is not watching either.
    assert.equal(playedSince(30, 2), 0);
    assert.equal(playedSince(5, 5), 0);
  });
});

describe('playback session keys', () => {
  it('accepts a key of the right shape and refuses anything else', () => {
    const key = newSessionKey();
    assert.equal(sanitiseSessionKey(key), key);
    assert.equal(sanitiseSessionKey('  ' + key + '  '), key);
    assert.equal(sanitiseSessionKey('short'), null);
    assert.equal(sanitiseSessionKey('has spaces in it'), null);
    assert.equal(sanitiseSessionKey('x'.repeat(65)), null);
    assert.equal(sanitiseSessionKey(42), null);
    assert.equal(sanitiseSessionKey(null), null);
  });

  it('keys a view on who watched as well as which session', () => {
    assert.notEqual(dedupeKey('p1', 'u1', 's1'), dedupeKey('p1', 'u2', 's1'));
    assert.notEqual(dedupeKey('p1', 'u1', 's1'), dedupeKey('p2', 'u1', 's1'));
    assert.notEqual(dedupeKey('p1', 'u1', 's1'), dedupeKey('p1', 'u1', 's2'));
    assert.equal(dedupeKey('p1', 'u1', 's1'), dedupeKey('p1', 'u1', 's1'));
  });
});

describe('the cooldown', () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);

  it('treats a first view as fresh', () => {
    assert.equal(isFreshView(null, now), true);
    assert.equal(isFreshView(undefined, now), true);
  });

  it('refuses a second view of the same video moments later', () => {
    assert.equal(isFreshView(new Date(now - 1_000).toISOString(), now), false);
  });

  it('allows one once the cooldown has passed', () => {
    assert.equal(isFreshView(new Date(now - VIEW_COOLDOWN_MS).toISOString(), now), true);
  });

  it('treats an unreadable timestamp as fresh rather than as a block', () => {
    assert.equal(isFreshView('not a date', now), true);
  });
});

describe('the server-side decision', () => {
  const base = (over: Partial<ViewDecision> = {}): ViewDecision => ({
    post: { authorId: 'author', removed: false, hasVideo: true },
    viewerId: 'watcher',
    identity: 'watcher',
    dedupeKey: dedupeKey('post', 'watcher', 'session-one'),
    recent: [],
    now: Date.UTC(2026, 9, 1, 12, 0, 0),
    ...over,
  });

  it('counts a genuine watch', () => {
    assert.equal(decideView(base()), 'count');
  });

  it('counts a visitor nobody has signed in, by their browser', () => {
    assert.equal(
      decideView(base({ viewerId: null, identity: 'anon:browser-1' })),
      'count',
    );
  });

  it('counts nothing for a post with no video on it', () => {
    assert.equal(
      decideView(base({ post: { authorId: 'author', removed: false, hasVideo: false } })),
      'not-a-video',
    );
  });

  it('counts nothing for a missing or removed post', () => {
    assert.equal(decideView(base({ post: null })), 'no-post');
    assert.equal(
      decideView(base({ post: { authorId: 'author', removed: true, hasVideo: true } })),
      'no-post',
    );
  });

  it('does not count the author watching their own video back', () => {
    assert.equal(decideView(base({ viewerId: 'author', identity: 'author' })), 'own-video');
  });

  it('counts one playback session once, however many times it is reported', () => {
    const key = dedupeKey('post', 'watcher', 'session-one');
    const decision = base({
      dedupeKey: key,
      recent: [{ dedupe_key: key, created_at: new Date(Date.UTC(2026, 9, 1, 11, 0, 0)).toISOString() }],
    });
    // Long past the cooldown, and still not a second view: it is the same
    // playback session, which is what a remount or a scroll back produces.
    assert.equal(decideView(decision), 'duplicate-session');
  });

  it('refuses a fresh session key invented inside the cooldown', () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    assert.equal(
      decideView(
        base({
          now,
          dedupeKey: dedupeKey('post', 'watcher', 'session-two'),
          recent: [
            {
              dedupe_key: dedupeKey('post', 'watcher', 'session-one'),
              created_at: new Date(now - 5_000).toISOString(),
            },
          ],
        }),
      ),
      'cooldown',
    );
  });

  it('counts watching the same video again later', () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    assert.equal(
      decideView(
        base({
          now,
          dedupeKey: dedupeKey('post', 'watcher', 'session-two'),
          recent: [
            {
              dedupe_key: dedupeKey('post', 'watcher', 'session-one'),
              created_at: new Date(now - VIEW_COOLDOWN_MS - 1).toISOString(),
            },
          ],
        }),
      ),
      'count',
    );
  });

  it('counts two different people watching the same video', () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    // Somebody else's view a second ago is not this person's cooldown: the
    // recent rows handed in are this identity's own.
    assert.equal(decideView(base({ now, identity: 'someone-else', viewerId: 'someone-else' })), 'count');
  });

  it('counts nothing when there is no way to tell who watched', () => {
    assert.equal(decideView(base({ viewerId: null, identity: null })), 'unknown-viewer');
  });
});
