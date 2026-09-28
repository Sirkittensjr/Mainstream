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
      // Back to the start: the seek below leaves it parked at the end.
      video.currentTime = 0;
      finish(true);
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

/** A hidden <video> holding this source, once its metadata has arrived. */
export function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = src;

    const fail = () => reject(new Error('That video could not be opened. Try a different file.'));
    video.addEventListener('error', fail, { once: true });
    video.addEventListener(
      'loadedmetadata',
      () => {
        void settleDuration(video).then((ok) => (ok ? resolve(video) : fail()));
      },
      { once: true },
    );
  });
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
    const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.05)));
    if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) {
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
