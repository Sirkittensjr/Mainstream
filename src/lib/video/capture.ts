/**
 * Reading a video the browser is holding: how long it is, how big it is, and
 * what a given frame looks like.
 *
 * Browser-only. The server reads the same facts out of the file's bytes (see
 * probe.ts) and does not trust anything measured here.
 */

export interface LocalVideoFacts {
  duration: number;
  width: number;
  height: number;
}

/**
 * Makes a video element report a real duration.
 *
 * A file written by MediaRecorder carries no duration in its header, so the
 * browser reports `Infinity` until it is asked to seek past the end — doing that
 * makes it read to the end and correct itself. Until it does, the element is not
 * only missing a number: it will not reliably play or seek either, which is why
 * anything that shows a recording back has to do this first and not just
 * anything that measures one.
 *
 * Resolves true once the duration is real, false if this browser never corrects
 * it. Never rejects and never throws — a player that cannot report its length is
 * still a player.
 */
export function settleDuration(video: HTMLVideoElement, timeoutMs = 4000): Promise<boolean> {
  if (Number.isFinite(video.duration) && video.duration > 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      video.removeEventListener('durationchange', onChange);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const onChange = () => {
      if (!Number.isFinite(video.duration)) return;
      // Back to the start: the seek below leaves it parked at the end. And
      // only finished once that seek has LANDED — `currentTime` reads 0 the
      // moment it is asked for, while the element is still at the end, so
      // anything that played it next started at the end and played nothing.
      video.removeEventListener('durationchange', onChange);
      video.addEventListener('seeked', () => finish(true), { once: true });
      video.currentTime = 0;
    };
    video.addEventListener('durationchange', onChange);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    try {
      video.currentTime = 1e101;
    } catch {
      finish(false);
    }
  });
}

/**
 * A hidden <video> holding this source, once its metadata has arrived.
 *
 * By default it also insists on a real duration, which is right when a file is
 * being measured — a clip of unknown length cannot be budgeted. The render
 * passes `needDuration: false`: it already knows every clip's length from when
 * the clip was added, and failing a whole post because the browser was slow to
 * re-read a recording's length mid-render (measured: past 4s, right after the
 * previous clip, on a busy machine) lost somebody their video for nothing.
 */
export function loadVideo(
  src: string,
  {
    settleMs = 4000,
    needDuration = true,
    element,
  }: { settleMs?: number; needDuration?: boolean; element?: HTMLVideoElement } = {},
): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    // An element can be handed in already pointed at `src` — the render makes
    // its elements inside the tap that started it (see `unlockedVideo`) — in
    // which case its metadata may have arrived before anything was listening.
    const video = element ?? document.createElement('video');
    if (!element) {
      video.preload = 'metadata';
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
    }
    const fail = () => {
      // Let the element go: a page can only hold so many media players, fewer
      // on a phone, and one that failed to open was still holding a slot.
      video.removeAttribute('src');
      video.load();
      reject(new Error('That video could not be opened. Try a different file.'));
    };
    const opened = () => {
      video.removeEventListener('error', fail);
      void settleDuration(video, settleMs).then((ok) =>
        ok || !needDuration ? resolve(video) : fail(),
      );
    };
    if (video.src === src && video.error) {
      fail();
      return;
    }
    if (video.src === src && video.readyState >= 1) {
      opened();
      return;
    }
    video.addEventListener('error', fail, { once: true });
    video.addEventListener('loadedmetadata', opened, { once: true });
    if (video.src !== src) video.src = src;
  });
}

/**
 * A <video> for `src` that is allowed to play with sound later, outside a tap.
 *
 * iOS Safari lets an element start playing with sound only from inside a tap —
 * unless that element has already been started once inside one, after which it
 * may play whenever it likes. The render plays each clip long after the tap on
 * Next (it reads every clip first, then plays them one after another), so an
 * element made at that point was refused, and Next failed with "The browser
 * would not play this clip back." — on Clip 1, or on a later clip once the
 * first had taken longer than Safari's grace period.
 *
 * So this must be called SYNCHRONOUSLY from the tap, before anything is
 * awaited: it starts the element and stops it again at once, which is what
 * releases it. Muted for that instant, so nothing is heard; the render unmutes
 * it when its turn comes. The preview player does the same thing for its two
 * elements — see `warm` in ClipPlayer.
 */
export function unlockedVideo(src: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.src = src;
  try {
    void video.play().catch(() => undefined);
    video.pause();
  } catch {
    // An old browser with no promise from play(). Nothing to release there.
  }
  return video;
}

export async function probeLocalVideo(src: string): Promise<LocalVideoFacts> {
  const video = await loadVideo(src);
  const facts = {
    duration: video.duration,
    width: video.videoWidth || 720,
    height: video.videoHeight || 1280,
  };
  video.src = '';
  video.load();
  return facts;
}

/** Puts a video element on an exact frame, and waits until it is really there. */
export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    // An element still unsure of its length reports Infinity or NaN; neither is
    // a limit, and NaN would make the seek itself throw.
    const limit = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : time;
    const target = Math.max(0, Math.min(time, limit));
    // Not while a seek is still under way: `currentTime` already reports where
    // it is going, not where the element is.
    if (!video.seeking && Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = target;
    // A seek that never lands must not wedge the editor.
    window.setTimeout(done, 3000);
  });
}

export interface FrameOptions {
  /** Longest edge of the produced image. Thumbnails do not need to be huge. */
  maxEdge?: number;
  quality?: number;
}

/** One frame of a video, as a JPEG. Used for the post's thumbnail. */
export async function grabFrame(
  src: string,
  time: number,
  { maxEdge = 720, quality = 0.82 }: FrameOptions = {},
): Promise<Blob> {
  const video = await loadVideo(src);
  await seekTo(video, time);

  const width = video.videoWidth || 720;
  const height = video.videoHeight || 1280;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width * scale));
  canvas.height = Math.max(2, Math.round(height * scale));

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot make a thumbnail.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  video.src = '';
  video.load();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('This browser cannot make a thumbnail.'))),
      'image/jpeg',
      quality,
    );
  });
}
