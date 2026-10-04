import { type Clip, clipDuration, outputFrame, totalDuration } from './clips';
import { loadVideo, seekTo } from './capture';

/**
 * Turning a list of clips into one video, in the browser.
 *
 * Each clip is played into a canvas with its crop and rotation applied, its
 * audio is routed through a gain node at the volume the person chose, and the
 * canvas and the audio are recorded together as a single file. That file is
 * what gets uploaded — the server receives one ordinary video and needs to
 * know nothing about clips.
 *
 * It runs in real time, because it is a recording rather than a transcode: a
 * two-minute video takes two minutes to put together. That is the price of
 * having no encoder dependency, no special cross-origin headers and no server
 * render farm, and it is why a single unedited clip skips this entirely (see
 * `needsRender`). The caller is expected to show progress and allow a cancel.
 */

export interface RenderProgress {
  /** Seconds of finished video produced so far. */
  seconds: number;
  /** Seconds it will be in total. */
  total: number;
  /** Which clip is being played in, 1-based. */
  clip: number;
  clips: number;
}

export interface RenderResult {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  duration: number;
}

export interface RenderOptions {
  onProgress?: (progress: RenderProgress) => void;
  signal?: AbortSignal;
}

/**
 * The container to record into, best first.
 *
 * MP4 is preferred because it plays everywhere; Safari records it natively and
 * recent Chrome does too. WebM is the fallback, and every browser that can
 * record at all supports one of these.
 */
const CANDIDATE_TYPES = [
  'video/mp4;codecs=avc1.4d002a,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** Whether this browser can combine clips at all. */
export function canRender(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickMimeType() !== null
  );
}

/**
 * Frames per second of the finished video.
 *
 * The number the muxer is told and the number the render actually delivers have
 * to be the same one, or the file comes out the wrong length — see `playInto`.
 */
export const OUTPUT_FPS = 30;

export class RenderUnsupportedError extends Error {
  constructor() {
    super('This browser cannot combine video clips. Post a single clip, or try another browser.');
    this.name = 'RenderUnsupportedError';
  }
}

/** Draws one frame of a clip into the output frame, cropped and rotated. */
function drawFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  clip: Clip,
  output: { width: number; height: number; fit: 'cover' | 'contain' },
): void {
  context.fillStyle = '#000';
  context.fillRect(0, 0, output.width, output.height);

  const naturalWidth = video.videoWidth || clip.sourceWidth;
  const naturalHeight = video.videoHeight || clip.sourceHeight;
  const sourceWidth = Math.max(1, naturalWidth * clip.crop.width);
  const sourceHeight = Math.max(1, naturalHeight * clip.crop.height);

  context.save();
  context.translate(output.width / 2, output.height / 2);
  context.rotate((clip.rotation * Math.PI) / 180);

  // After a quarter turn the box the picture has to fit inside is the output
  // frame on its side.
  const upright = clip.rotation % 180 === 0;
  const boxWidth = upright ? output.width : output.height;
  const boxHeight = upright ? output.height : output.width;

  // One scale for both axes either way, which is what "never stretched" means.
  // `cover` fills the frame and lets the overflow fall outside it — a centre
  // crop; `contain` fits the whole picture inside and leaves bars. Which one is
  // the frame's own decision: see `outputFrame`.
  const scale =
    output.fit === 'cover'
      ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight)
      : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;

  context.drawImage(
    video,
    clip.crop.x * naturalWidth,
    clip.crop.y * naturalHeight,
    sourceWidth,
    sourceHeight,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
  );
  context.restore();
}

export async function renderClips(clips: Clip[], options: RenderOptions = {}): Promise<RenderResult> {
  if (clips.length === 0) throw new Error('There is nothing to render.');
  const mimeType = pickMimeType();
  if (!canRender() || !mimeType) throw new RenderUnsupportedError();

  const output = outputFrame(clips);
  const total = totalDuration(clips);

  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new RenderUnsupportedError();
  context.fillStyle = '#000';
  context.fillRect(0, 0, output.width, output.height);

  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const audio = AudioContextClass ? new AudioContextClass() : null;
  const audioDestination = audio?.createMediaStreamDestination() ?? null;
  // Resuming needs the click that started the render, which is what we are in.
  if (audio?.state === 'suspended') await audio.resume();

  /**
   * A frame reaches the encoder when one has been DRAWN, not on a timer.
   *
   * `captureStream(OUTPUT_FPS)` samples the canvas on a timer whether or not
   * a new frame is ready, and the output's length is however many frames arrived
   * divided by that declared rate. So a canvas the machine cannot repaint thirty
   * times a second produces a SHORT video — the same content, played fast.
   * Measured when the vertical frame went from 608x1080 to 1080x1920: three clips
   * totalling 7.6s posted as 5.89s, 77% of the frames and 77% of the length.
   *
   * `captureStream(0)` produces a frame only when asked, each stamped with the
   * real time it was asked for, so a slow repaint costs frame rate and never
   * duration. Where `requestFrame` is missing the old behaviour is the fallback,
   * because a video that is slightly fast beats no video at all.
   */
  type OnDemandTrack = MediaStreamTrack & { requestFrame?: () => void };
  let videoTrack = canvas.captureStream(0).getVideoTracks()[0] as OnDemandTrack | undefined;
  const requestFrame: (() => void) | null =
    typeof videoTrack?.requestFrame === 'function' ? () => videoTrack?.requestFrame?.() : null;
  if (!requestFrame) {
    videoTrack?.stop();
    videoTrack = canvas.captureStream(OUTPUT_FPS).getVideoTracks()[0] as OnDemandTrack | undefined;
  }

  const stream = new MediaStream([
    ...(videoTrack ? [videoTrack] : []),
    ...(audioDestination ? audioDestination.stream.getAudioTracks() : []),
  ]);

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  const finished = new Promise<void>((resolve, reject) => {
    recorder.addEventListener('stop', () => resolve(), { once: true });
    recorder.addEventListener('error', () => reject(new Error('Recording the video failed.')), {
      once: true,
    });
  });

  const opened: HTMLVideoElement[] = [];
  const cleanUp = () => {
    for (const video of opened) {
      video.pause();
      video.src = '';
      video.load();
    }
    for (const track of stream.getTracks()) track.stop();
    void audio?.close();
  };

  try {
    recorder.start(1000);
    let produced = 0;

    for (const [index, clip] of clips.entries()) {
      options.signal?.throwIfAborted();

      const video = await loadVideo(clip.src);
      opened.push(video);
      video.muted = false;
      video.volume = 1;

      // Routing the element into the graph takes its audio off the speakers,
      // so the person is not listening to their own clips play back at them.
      if (audio && audioDestination) {
        try {
          const source = audio.createMediaElementSource(video);
          const gain = audio.createGain();
          gain.gain.value = clip.volume;
          source.connect(gain).connect(audioDestination);
        } catch {
          // No audio track on this clip, or the browser refused. Silence is
          // the right outcome either way; it must not stop the render.
          video.muted = true;
        }
      } else {
        video.muted = true;
      }

      await seekTo(video, clip.trimStart);
      const length = clipDuration(clip);
      const startedAt = produced;

      await playInto(video, clip, () => {
        drawFrame(context, video, clip, output);
        // The drawn frame is the frame: see the captureStream note above.
        requestFrame?.();
        produced = startedAt + Math.min(length, video.currentTime - clip.trimStart);
        options.onProgress?.({
          seconds: produced,
          total,
          clip: index + 1,
          clips: clips.length,
        });
      }, options.signal);

      produced = startedAt + length;
      video.pause();
    }

    recorder.stop();
    await finished;
    return {
      blob: new Blob(chunks, { type: mimeType }),
      mimeType,
      width: output.width,
      height: output.height,
      duration: total,
    };
  } catch (error) {
    if (recorder.state !== 'inactive') recorder.stop();
    throw error;
  } finally {
    cleanUp();
  }
}

/**
 * Plays one clip from its in-point to its out-point, drawing every frame.
 *
 * `requestVideoFrameCallback` fires once per decoded frame, which is exactly
 * the cadence the canvas wants. Where it does not exist, animation frames are
 * close enough and no browser that can record is far behind on both.
 */
function playInto(
  video: HTMLVideoElement,
  clip: Clip,
  onFrame: () => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      video.removeEventListener('ended', stop);
      resolve();
    };

    const abort = () => {
      stopped = true;
      window.clearInterval(timer);
      video.removeEventListener('ended', stop);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });

    /**
     * A steady OUTPUT_FPS, not one draw per source frame.
     *
     * This used to draw on `requestVideoFrameCallback`, which fires once per
     * frame the SOURCE presents — so the output got as many frames per second as
     * the source had, and no more. Chromium's MP4 muxer assumes a fixed rate, so
     * a 22fps source produced a file 22/30ths of its real length: the whole video
     * slightly sped up. Measured on three clips totalling 7.65s, posted as 5.74s.
     *
     * Sampling the element on a timer instead means a second of wall clock is
     * always OUTPUT_FPS frames, whatever the source's rate, and the file comes
     * out the length it was played for. Drawing the same source frame twice
     * costs a drawImage and nothing else.
     */
    const period = 1000 / OUTPUT_FPS;
    let timer = 0;

    const finish = () => {
      window.clearInterval(timer);
      stop();
    };

    const tick = () => {
      if (stopped) return;
      if (signal?.aborted) {
        window.clearInterval(timer);
        return;
      }
      onFrame();
      if (video.currentTime >= clip.trimEnd - 0.02 || video.ended) finish();
    };

    video.addEventListener('ended', stop);
    video.play().then(
      () => {
        // One frame straight away, so a clip shorter than a frame interval is
        // still represented, then the steady rate.
        tick();
        timer = window.setInterval(tick, period);
      },
      () => reject(new Error('The browser would not play this clip back.')),
    );
  });
}
