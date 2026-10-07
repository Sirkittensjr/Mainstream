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
 * Both halves of `playInto` are counted in it: a clip's frame budget is its kept
 * length times this, and the deadband that steers the recorder is measured in
 * frames of it. The file's own length comes from how long the recorder ran, so
 * this decides how finely that is tracked rather than setting it outright.
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

  /**
   * The recorder runs ONLY while a clip is actually playing.
   *
   * MediaRecorder records wall-clock time, and the file's duration is the time
   * it spent recording — so everything that happens between frames of source
   * lands in the finished video as extra length. Two things do: loading and
   * seeking the next clip, which is dead time between clips, and the source
   * falling behind mid-clip when the machine is busy. Measured on a 6.90s
   * project, together they added 1.3s and posted it as 8.22s.
   *
   * Paused time is excluded from the recording, so holding across both leaves
   * the file as long as the source actually played, whatever the machine was
   * doing. `playInto` steers it; this is the switch.
   */
  const recording = {
    hold: () => {
      if (recorder.state === 'recording') recorder.pause();
    },
    run: () => {
      if (recorder.state === 'paused') recorder.resume();
    },
  };

  try {
    // EVERY CLIP IS OPENED BEFORE RECORDING STARTS. A recording with no
    // duration in its header — every MediaRecorder file, so every camera clip
    // on Chrome and Android — has to be read to its end before it will seek and
    // play reliably. Done here, on an idle page, that is quick; done between
    // clips, with the encoder running, it was measured taking past the time
    // allowed, and the post failed. A clip that cannot be opened at all is said
    // plainly, by number, rather than dropped from the video.
    const prepared: HTMLVideoElement[] = [];
    for (const [index, clip] of clips.entries()) {
      options.signal?.throwIfAborted();
      try {
        const video = await loadVideo(clip.src, { settleMs: 15000 });
        prepared.push(video);
        opened.push(video);
      } catch {
        throw new Error(
          clips.length > 1
            ? `Clip ${index + 1} could not be read. Remove it and add it again, then try once more.`
            : 'The video could not be read. Try choosing or recording it again.',
        );
      }
    }

    recorder.start(1000);
    // Nothing is playing yet: the first clip still has to be seeked.
    recording.hold();
    let produced = 0;

    for (const [index, clip] of clips.entries()) {
      options.signal?.throwIfAborted();

      const video = prepared[index];
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
      /** Frames this clip actually put into the output. */
      let delivered = 0;

      await playInto(
        video,
        clip,
        (frames) => {
          delivered += frames;
          // Drawn once however many frames it is worth: the picture has not
          // changed between them, and `drawImage` into a 1080x1920 canvas is the
          // expensive part of this loop.
          drawFrame(context, video, clip, output);
          for (let frame = 0; frame < frames; frame += 1) requestFrame?.();
          produced = startedAt + Math.min(length, video.currentTime - clip.trimStart);
          options.onProgress?.({
            seconds: produced,
            total,
            clip: index + 1,
            clips: clips.length,
          });
        },
        recording,
        options.signal,
      );
      recording.hold();

      // A clip that played back next to nothing has not made it into the
      // video. Posting it anyway is a video with a clip missing and nobody told
      // — so it stops here instead. Half is far outside the pacing's own
      // spread (measured 85-113% of length across runs).
      if (delivered < Math.round(length * OUTPUT_FPS) * 0.5) {
        throw new Error(
          clips.length > 1
            ? `Clip ${index + 1} did not play back, so the video was not finished. Try again — if it keeps happening, remove that clip and add it again.`
            : 'The video did not play back, so it was not finished. Try again.',
        );
      }

      produced = startedAt + length;
      video.pause();
    }

    // Stopped from wherever the last clip left it. Resuming only to stop again
    // costs another pause/resume cycle, and each of those is time the recorder
    // spends not recording.
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
 * Plays one clip from its in-point to its out-point, delivering exactly the
 * frames that clip's kept length is worth, and recording for exactly as long.
 *
 * TWO THINGS DECIDE THE FINISHED VIDEO, and they used to be the same thing:
 * how many pictures it contains, and how long it runs. Both were taken from a
 * wall-clock `setInterval` — one `onFrame` per tick, recorder running
 * throughout — so a machine that could not keep up changed both. Measured on
 * one fixed 6.90s project, the posted file ranged from 49% to 134% of its real
 * length, and the pictures came out of step with it either way.
 *
 * FRAMES ARE PACED ON THE SOURCE: deliver `round(progress * OUTPUT_FPS)` frames
 * by the time the source has played `progress` seconds. If the sampler is
 * throttled to 14Hz each wake delivers the two or three frames the source
 * advanced by instead of one, so the pictures stay in step with the clip's own
 * time; if it runs faster than the source decodes it delivers nothing, so a
 * stalled decoder no longer pads the file with duplicates. That is what keeps a
 * video from playing fast or slow, whatever the machine was doing.
 *
 * TIME IS A WINDOW, because MediaRecorder writes wall-clock: the file is as long
 * as the recorder ran, not as long as the frames imply. So each clip gets a
 * recording window of exactly its kept length — opened when the element really
 * starts playing, shut by one timer that length later — and the recorder is held
 * across everything in between clips, which is dead time spent fetching and
 * seeking the next one. A 2.55s clip contributes 2.55s, and three clips are
 * their three lengths added up.
 *
 * ONE PAUSE AND ONE RESUME PER CLIP, which is the point. Two cleverer versions
 * came first and both failed on the same thing: every pause/resume costs the
 * recording something, and no accounting here can see how much. Pausing whenever
 * the element looked stalled thrashed it thirty times a second and dragged a
 * 0.3s clip out to 1.8s. Steering a control loop on accumulated recorded time
 * against source progress was better — 98%, 103%, 104% — but it could only ever
 * SHED time, so a clip that ended while it happened to be holding stayed short,
 * and the same project came out at 76% on one run in three. Topping the shortfall
 * back up overcorrected the other way, to 117%, because the latency it was
 * compensating for is exactly what it could not measure. A window needs no
 * accounting: it is one timer and two state changes.
 *
 * What a window costs, when the source falls behind, is frame rate: that clip
 * delivers fewer pictures across its own correct length. See `finish` for why it
 * must not try to make them up.
 *
 * The fallback path — a browser with no `requestFrame`, where the canvas is
 * sampled on the browser's own timer — cannot be paced this way, because
 * nothing here decides when a frame is taken. There the old behaviour stands.
 */
function playInto(
  video: HTMLVideoElement,
  clip: Clip,
  /** Deliver this many copies of the picture currently on the element. */
  onFrames: (frames: number) => void,
  /** Starts and stops the clock the finished file is measured by. */
  recording: { hold: () => void; run: () => void },
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      window.clearTimeout(window_);
      resolve();
    };

    const abort = () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearTimeout(window_);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });

    /** What this clip is worth, in frames. */
    const length = clipDuration(clip);
    const budget = Math.max(1, Math.round(length * OUTPUT_FPS));
    let delivered = 0;
    /** Only a sampler: the frame count does not depend on its rate. */
    const period = 1000 / (OUTPUT_FPS * 2);
    let timer = 0;
    let window_ = 0;

    /** Brings the delivered count up to `target`, never past the budget. */
    const deliverTo = (target: number) => {
      const want = Math.min(budget, target);
      if (want > delivered) {
        const frames = want - delivered;
        delivered = want;
        onFrames(frames);
      }
    };

    /**
     * Shuts the window.
     *
     * NOTHING IS FLUSHED HERE, and that is deliberate. An earlier version topped
     * the clip up to its full frame budget first, so that a source which had
     * fallen behind still contributed every picture. But those were up to a
     * hundred `requestFrame` calls in one go, on the same thread that has to run
     * the timer that shuts this window — the flush blocked for long enough that
     * the recorder kept going well past the clip, and one run in three came out
     * at 131%. The flush was left over from when the frame count WAS the
     * duration; under a window it buys nothing and costs the thing it is paid in.
     *
     * A clip whose source fell behind therefore delivers fewer frames across its
     * window, which is a lower frame rate for that stretch and the correct
     * length. The video element is paused because its frames are done with and
     * letting it run on would record audio from past the out-point.
     */
    const finish = () => {
      window.clearInterval(timer);
      window.clearTimeout(window_);
      video.pause();
      recording.hold();
      stop();
    };

    const tick = () => {
      if (stopped) return;
      if (signal?.aborted) {
        window.clearInterval(timer);
        window.clearTimeout(window_);
        return;
      }
      const progress = Math.min(Math.max(video.currentTime - clip.trimStart, 0), length);
      deliverTo(Math.round(progress * OUTPUT_FPS));
      // Deliberately NOT finishing on `trimEnd` or `ended`: the window below is
      // what ends the clip, because the window is what the file's length is made
      // of. Reaching the out-point early just means the rest of the window holds
      // the last frame.
    };

    video.play().then(
      () => {
        // The clip's window opens HERE — when it is really playing, not when it
        // was asked for — and shuts exactly its kept length later. That window
        // is the clip's contribution to the finished file, so a 2.55s clip is
        // 2.55s of video whatever the machine was doing in the meantime.
        recording.run();
        // One frame straight away, so the encoder has a picture from the start
        // and a clip shorter than a sample interval is still represented.
        deliverTo(1);
        timer = window.setInterval(tick, period);
        window_ = window.setTimeout(finish, length * 1000);
      },
      () => reject(new Error('The browser would not play this clip back.')),
    );
  });
}
