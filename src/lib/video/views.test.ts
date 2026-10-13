import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VIEW_COOLDOWN_MS,
  VIEW_HOURLY_LIMIT,
  type ViewDecision,
  createViewTracker,
  decideView,
  dedupeKey,
  isFreshView,
  newSessionKey,
  playedSince,
  sanitiseSessionKey,
  shouldReportView,
} from './views';

describe('when a view is counted', () => {
  it('needs playback to have begun, not a render or a play() call', () => {
    assert.equal(shouldReportView({ playedSeconds: 0, reported: false }), false);
    // The first sliver of real playback is the view: opening a video, or a
    // feed autoplaying it, counts as soon as it is actually playing.
    assert.equal(shouldReportView({ playedSeconds: 0.25, reported: false }), true);
  });

  it('never reports a playback session twice', () => {
    // The whole defence against re-renders, remounts and scrolling: once the
    // session has been reported, no amount of further playback reports again.
    assert.equal(shouldReportView({ playedSeconds: 90, reported: true }), false);
  });
});

/**
 * A fake <video>: the events a real player fires, in the order it fires them,
 * fed to the tracker the hook wraps. `reports` is every session key the player
 * would have sent to the server.
 */
function player(duration = 10) {
  let n = 0;
  const tracker = createViewTracker({ duration, mint: () => `session-${++n}` });
  const reports: string[] = [];
  let at = 0;
  const tick = (to: number, paused = false) => {
    at = to;
    if (tracker.timeUpdate(at, paused)) reports.push(tracker.sessionKey);
  };
  return {
    reports,
    tracker,
    /** play() from wherever the playhead is, then `seconds` of timeupdates. */
    play(seconds = 1, from = at) {
      at = from;
      tracker.play(at);
      const end = at + seconds;
      while (at < end - 1e-9) tick(Math.min(end, at + 0.25));
    },
    pause() {
      tick(at, true);
    },
    /** Only a timeupdate, as a player that is already playing fires. */
    tick,
    seek(to: number) {
      at = to;
      tracker.seeked(to);
    },
    /** A non-looping video reaching its end. */
    end() {
      tracker.ended();
      at = duration;
    },
    /** A `loop` video coming round: back to 0, and playing on. */
    loop() {
      at = 0;
      tracker.seeked(0);
    },
    rerender() {
      // A React re-render calls nothing on the tracker. Stated so the test
      // reads as the scenario it is.
    },
  };
}

describe('a player counting its own viewings', () => {
  it('reports once when an autoplaying video starts', () => {
    const video = player();
    video.play(3);
    assert.deepEqual(video.reports, ['session-1']);
  });

  it('reports nothing when autoplay is refused and nothing plays', () => {
    const video = player();
    // The feed asked; the browser said no. No play event, no timeupdates.
    assert.deepEqual(video.reports, []);
  });

  it('ignores re-renders, a burst of timeupdates, and pause and play', () => {
    const video = player();
    video.play(1);
    video.rerender();
    video.rerender();
    video.pause();
    video.play(2);
    video.seek(6);
    video.play(1);
    assert.deepEqual(video.reports, ['session-1']);
  });

  it('counts a replay after the video ended', () => {
    const video = player(4);
    video.play(4);
    video.end();
    video.play(2, 0);
    assert.deepEqual(video.reports, ['session-1', 'session-2']);
  });

  it('counts each time a looping video comes round', () => {
    const video = player(4);
    video.play(4);
    video.loop();
    video.play(4);
    video.loop();
    video.play(1);
    assert.deepEqual(video.reports, ['session-1', 'session-2', 'session-3']);
  });

  it('counts a loop that wraps without a seek event', () => {
    const video = player(4);
    video.play(4);
    // Some browsers only show the wrap as the next timeupdate being back at the
    // start — no play event, no seek event, the video simply carries on.
    video.tick(0.1);
    video.tick(0.35);
    assert.deepEqual(video.reports, ['session-1', 'session-2']);
  });

  it('counts scrolling away and back as watching again', () => {
    const video = player();
    video.play(0.5);
    // The feed moves off the clip: it ends that viewing and rewinds the player.
    video.tracker.restart();
    video.seek(0);
    video.play(2, 0);
    assert.deepEqual(video.reports, ['session-1', 'session-2']);
  });

  it('counts somebody taking it back to the start to watch again', () => {
    const video = player(30);
    video.play(8);
    video.seek(0);
    video.play(1);
    assert.deepEqual(video.reports, ['session-1', 'session-2']);
  });

  it('does not count a nudge of the scrubber in the first second', () => {
    const video = player(30);
    video.play(0.5);
    video.seek(0);
    video.play(1);
    assert.deepEqual(video.reports, ['session-1']);
  });

  it('lets a very short clip be watched again too', () => {
    const video = player(0.8);
    video.play(0.75);
    video.loop();
    video.play(0.5);
    assert.deepEqual(video.reports, ['session-1', 'session-2']);
  });

  it('reports on `playing`, before any timeupdate, and only once', () => {
    const video = player();
    video.tracker.play(0);
    assert.equal(video.tracker.playing(0), true, 'the moment playback starts');
    const key = video.tracker.sessionKey;
    // A stall and resume, or a pause and play, fires `playing` again.
    assert.equal(video.tracker.playing(1.2), false);
    video.play(2, 1.2);
    assert.deepEqual(video.reports, [], 'the timeupdates after it add nothing');
    assert.equal(video.tracker.sessionKey, key);
  });

  it('reports on `playing` again for a new viewing', () => {
    const video = player(4);
    video.tracker.play(0);
    assert.equal(video.tracker.playing(0), true);
    video.end();
    video.tracker.play(0);
    assert.equal(video.tracker.playing(0), true, 'played again after it ended');
  });

  it('keeps one session key for one viewing', () => {
    const video = player();
    const before = video.tracker.sessionKey;
    video.play(3);
    assert.equal(video.tracker.sessionKey, before);
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

  it('refuses a second view of the same video at the same instant', () => {
    assert.equal(isFreshView(new Date(now - VIEW_COOLDOWN_MS / 2).toISOString(), now), false);
  });

  it('is shorter than a swipe away and back, so watching again straight after still counts', () => {
    // Leaving a clip and coming back to it is two swipes and a fresh start of
    // playback: comfortably over half a second, and a view each time.
    assert.ok(VIEW_COOLDOWN_MS <= 500);
    assert.equal(isFreshView(new Date(now - 600).toISOString(), now), true);
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
    post: { removed: false, hasVideo: true },
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
      decideView(base({ identity: 'anon:browser-1' })),
      'count',
    );
  });

  it('counts nothing for a post with no video on it', () => {
    assert.equal(
      decideView(base({ post: { removed: false, hasVideo: false } })),
      'not-a-video',
    );
  });

  it('counts nothing for a missing or removed post', () => {
    assert.equal(decideView(base({ post: null })), 'no-post');
    assert.equal(
      decideView(base({ post: { removed: true, hasVideo: true } })),
      'no-post',
    );
  });

  it("counts the author's own plays, like anybody else's", () => {
    assert.equal(decideView(base({ identity: 'author' })), 'count');
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
              created_at: new Date(now - VIEW_COOLDOWN_MS / 2).toISOString(),
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

  it('counts a glance, a swipe on and a swipe straight back: two views under a second apart', () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    assert.equal(
      decideView(
        base({
          now,
          dedupeKey: dedupeKey('post', 'watcher', 'session-back'),
          recent: [
            {
              dedupe_key: dedupeKey('post', 'watcher', 'session-glance'),
              created_at: new Date(now - 700).toISOString(),
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
    assert.equal(decideView(base({ now, identity: 'someone-else' })), 'count');
  });

  it('counts nothing on a post hidden while it is reviewed', () => {
    assert.equal(
      decideView(base({ post: { removed: false, hasVideo: true, hidden: true } })),
      'no-post',
    );
  });

  it('refuses a session already stored, however long ago', () => {
    // `recent` only reaches back so far; the exact lookup does not.
    assert.equal(decideView(base({ sessionCounted: true })), 'duplicate-session');
  });

  it('caps how many views one person can add to one video in an hour', () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    const recent = Array.from({ length: VIEW_HOURLY_LIMIT }, (_, i) => ({
      dedupe_key: dedupeKey('post', 'watcher', `old-${i}`),
      created_at: new Date(now - VIEW_COOLDOWN_MS - i * 30_000).toISOString(),
    }));
    assert.equal(
      decideView(base({ now, dedupeKey: dedupeKey('post', 'watcher', 'new'), recent })),
      'hourly-limit',
    );
    // An hour on, the oldest have aged out and watching counts again.
    assert.equal(
      decideView(
        base({ now: now + 60 * 60 * 1000, dedupeKey: dedupeKey('post', 'watcher', 'new'), recent }),
      ),
      'count',
    );
  });

  it('counts nothing when there is no way to tell who watched', () => {
    assert.equal(decideView(base({ identity: null })), 'unknown-viewer');
  });
});
