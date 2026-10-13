/**
 * Sound in the video players: the viewer's choice, and what a refused play()
 * means. The browser behaviour these answer — Safari's per-element rule, the
 * muted fallback, "Tap for sound" — is driven end to end in
 * scripts/e2e/views-sound-flow.mjs.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  SOUND_KEY,
  claimAudio,
  classifyPlayError,
  readSoundChoice,
  readyForSound,
  saveSoundChoice,
} from './sound';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const broken = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe("the viewer's choice", () => {
  it('is sound on unless they turned it off', () => {
    assert.equal(readSoundChoice(memory()), 'on');
    assert.equal(readSoundChoice(memory({ [SOUND_KEY]: 'on' })), 'on');
    assert.equal(readSoundChoice(memory({ [SOUND_KEY]: 'off' })), 'off');
    assert.equal(readSoundChoice(memory({ [SOUND_KEY]: 'garbage' })), 'on');
    assert.equal(readSoundChoice(null), 'on');
  });

  it('is remembered, and turning it off stays off', () => {
    const store = memory();
    saveSoundChoice('off', store);
    assert.equal(readSoundChoice(store), 'off');
    saveSoundChoice('on', store);
    assert.equal(readSoundChoice(store), 'on');
  });

  it('survives a browser that refuses storage', () => {
    assert.equal(readSoundChoice(broken), 'on');
    assert.doesNotThrow(() => saveSoundChoice('off', broken));
  });
});

describe('a refused play()', () => {
  const named = (name: string) => Object.assign(new Error(name), { name });

  it('is a policy refusal only when the browser says NotAllowedError', () => {
    assert.equal(classifyPlayError(named('NotAllowedError')), 'needs-gesture');
  });

  it('is an interruption, not a refusal, when a newer play() or pause() got there first', () => {
    // A quick swipe produces these. Muting the feed for one would take sound
    // away from somebody who was allowed it.
    assert.equal(classifyPlayError(named('AbortError')), 'interrupted');
  });

  it('is a failure for anything else', () => {
    assert.equal(classifyPlayError(named('NotSupportedError')), 'failed');
    assert.equal(classifyPlayError(new Error('boom')), 'failed');
    assert.equal(classifyPlayError(undefined), 'failed');
    assert.equal(classifyPlayError('NotAllowedError'), 'failed');
  });
});

/** Just enough of an HTMLMediaElement. */
function player({ paused = true, muted = false, playThrows = false } = {}) {
  const calls: string[] = [];
  const element = {
    paused,
    muted,
    play() {
      calls.push('play');
      if (playThrows) throw new Error('old browser');
      element.paused = false;
      return Promise.reject(Object.assign(new Error('interrupted'), { name: 'AbortError' }));
    },
    pause() {
      calls.push('pause');
      element.paused = true;
    },
  };
  return { element: element as unknown as HTMLMediaElement, calls };
}

describe('readying players for sound, inside a tap', () => {
  it('starts and stops each paused player in the same instant, once', async () => {
    const a = player();
    const b = player();
    const readied = new WeakSet<HTMLMediaElement>();
    readyForSound([a.element, b.element], readied);
    assert.deepEqual(a.calls, ['play', 'pause']);
    assert.deepEqual(b.calls, ['play', 'pause']);
    assert.equal(a.element.paused, true, 'left paused: never heard, never counted');
    readyForSound([a.element, b.element], readied);
    assert.deepEqual(a.calls, ['play', 'pause'], 'not twice');
    await new Promise((resolve) => setImmediate(resolve)); // the rejected play() is handled
  });

  it('leaves a playing player alone, and survives a play() that throws', () => {
    const playing = player({ paused: false });
    const old = player({ playThrows: true });
    readyForSound([playing.element, old.element], new WeakSet());
    assert.deepEqual(playing.calls, []);
    assert.deepEqual(old.calls, ['play']);
  });
});

describe('one video heard at a time', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  function page(...elements: HTMLMediaElement[]) {
    (globalThis as { document?: unknown }).document = { querySelectorAll: () => elements };
  }

  it('pauses every other player that is playing with sound', () => {
    const mine = player({ paused: false });
    const loud = player({ paused: false });
    const quiet = player({ paused: false, muted: true });
    const stopped = player();
    page(mine.element, loud.element, quiet.element, stopped.element);
    claimAudio(mine.element);
    assert.equal(loud.element.paused, true, 'the other one making noise stops');
    assert.equal(quiet.element.paused, false, 'muted autoplay carries on');
    assert.deepEqual(stopped.calls, []);
    assert.equal(mine.element.paused, false);
  });

  it('does nothing for a player that is muted or not playing', () => {
    const loud = player({ paused: false });
    page(loud.element);
    claimAudio(player({ paused: false, muted: true }).element);
    claimAudio(player().element);
    assert.equal(loud.element.paused, false);
  });
});
