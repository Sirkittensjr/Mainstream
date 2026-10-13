/**
 * Sound in the video players: what the viewer chose, and what the browser allows.
 *
 * In the browser. Two different things decide whether a video is heard, and
 * keeping them apart is most of what this file is for:
 *
 *   the viewer's choice   sound on (the default) or off. Theirs to make, and
 *                         kept: muting is never undone by the feed, and
 *                         turning sound on is remembered across pages.
 *   the browser           which may refuse to START a video with sound until
 *                         the viewer has interacted with the page. Chrome and
 *                         Firefox ask for one interaction with the page; Safari
 *                         — every browser on an iPhone — asks for one per video
 *                         ELEMENT, which is why the feed readies its players for
 *                         sound inside the tap that turns sound on.
 *
 * Nothing here gets around a policy. A refused start is answered with the one
 * thing every policy allows — the same video, muted — and a clear way to turn
 * the sound on, which is the interaction the policy was waiting for.
 */

export type SoundChoice = 'on' | 'off';

/** Where the viewer's choice is kept. */
export const SOUND_KEY = 'fay:video-sound';

type Readable = Pick<Storage, 'getItem'>;
type Writable = Pick<Storage, 'setItem'>;

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The viewer's choice: sound on unless they have turned it off. */
export function readSoundChoice(store: Readable | null = defaultStorage()): SoundChoice {
  try {
    return store?.getItem(SOUND_KEY) === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

/** Remembers the viewer's choice, where the browser allows. */
export function saveSoundChoice(choice: SoundChoice, store: Writable | null = defaultStorage()): void {
  try {
    store?.setItem(SOUND_KEY, choice);
  } catch {
    // Storage blocked or full: the choice still holds for this page.
  }
}

/**
 * What a refused play() means.
 *
 *   needs-gesture  NotAllowedError: the browser will not start it this way
 *                  without an interaction — with sound, or (Low Power Mode) at
 *                  all
 *   interrupted    AbortError: a newer play(), a pause() or a new source got
 *                  there first. Nothing was refused; nothing needs doing.
 *   failed         anything else: the file, the network, the decoder
 *
 * Only the first is a reason to fall back to muted. Treating an interruption
 * as a refusal — which a quick swipe produces — would mute the whole feed for
 * nothing.
 */
export type PlayRefusal = 'needs-gesture' | 'interrupted' | 'failed';

export function classifyPlayError(error: unknown): PlayRefusal {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : null;
  if (name === 'NotAllowedError') return 'needs-gesture';
  if (name === 'AbortError') return 'interrupted';
  return 'failed';
}

/**
 * Readies players to play with sound later. Call it inside a tap.
 *
 * Safari lets a video element play with sound once a user gesture has played
 * or unmuted THAT element; a new element needs a gesture of its own. So inside
 * the tap that turns sound on, each paused player is started and stopped in
 * the same instant — never long enough to be heard or counted — and from then
 * on the feed can start it with sound when it is swiped to. Elsewhere it is
 * harmless. Each element only once.
 */
export function readyForSound(
  elements: Iterable<HTMLMediaElement>,
  readied: WeakSet<HTMLMediaElement>,
): void {
  for (const element of elements) {
    if (readied.has(element)) continue;
    readied.add(element);
    if (!element.paused) continue;
    try {
      const attempt = element.play();
      element.pause();
      attempt?.catch?.(() => undefined);
    } catch {
      // A browser whose play() throws rather than rejects: nothing to ready.
    }
  }
}

/**
 * One video heard at a time, page-wide.
 *
 * Called when a player starts playing with sound, or is unmuted while playing:
 * every other player that is playing AND audible is paused. Muted autoplay
 * elsewhere carries on; it is not making any noise.
 */
export function claimAudio(element: HTMLMediaElement): void {
  if (element.muted || element.paused || typeof document === 'undefined') return;
  for (const other of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
    if (other !== element && !other.paused && !other.muted) other.pause();
  }
}
