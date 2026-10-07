import { MAX_CLIPS, MAX_VIDEO_SECONDS } from './limits';

/**
 * A FayTarra video is a list of clips.
 *
 * Every edit is a value on the clip rather than a change to its bytes: a trim
 * is two numbers, a crop is a rectangle in fractions of the frame, a rotation
 * is a quarter turn. Nothing is rendered until the person is finished, so
 * every edit stays undoable and re-editable, and one pass at the end produces
 * the single video that gets posted.
 */

/** A rectangle in fractions of the source frame, so it survives any resolution. */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export const FULL_FRAME: Crop = { x: 0, y: 0, width: 1, height: 1 };

export interface Clip {
  id: string;
  /** Object URL for the source, for preview and for the render pass. */
  src: string;
  /** Shown in the strip. The file name, or "Recording 2". */
  label: string;
  /** Length of the source file in seconds, before trimming. */
  sourceDuration: number;
  /** Natural pixel size of the source. */
  sourceWidth: number;
  sourceHeight: number;
  /** Seconds into the source where this clip starts and ends. */
  trimStart: number;
  trimEnd: number;
  crop: Crop;
  rotation: Rotation;
  /** 0 is silent, 1 is as recorded. */
  volume: number;
  /** Set when the clip came from a file, so an unedited single clip can be posted as-is. */
  file?: File;
  /**
   * Filmed here, rather than chosen from the camera roll.
   *
   * A recording is a vertical video by intent: the viewfinder is a full-screen
   * 9:16 crop and that crop is what the person framed. What the sensor hands
   * back is another matter — it is landscape on an iPhone (1920x1080) and
   * oversized here (1216x2160) — so this says "make this 1080x1920" rather than
   * trusting the dimensions that arrived. A file somebody uploaded says nothing
   * of the sort and keeps its own shape.
   */
  fromCamera?: boolean;
}

export const clipDuration = (clip: Clip): number => Math.max(0, clip.trimEnd - clip.trimStart);

export const totalDuration = (clips: Clip[]): number =>
  clips.reduce((sum, clip) => sum + clipDuration(clip), 0);

export const remainingSeconds = (clips: Clip[]): number =>
  Math.max(0, MAX_VIDEO_SECONDS - totalDuration(clips));

export const isOverLength = (clips: Clip[]): boolean => totalDuration(clips) > MAX_VIDEO_SECONDS;

/**
 * Whether another clip of this length fits.
 *
 * The answer is never "yes, and we will cut it for you". Somebody who films
 * five minutes of something should be told it does not fit and left in
 * control of which part goes — silently truncating their video is the one
 * outcome nobody wants.
 */
export function canAdd(clips: Clip[], seconds: number): { ok: true } | { ok: false; error: string } {
  if (clips.length >= MAX_CLIPS) {
    return { ok: false, error: `A post can hold up to ${MAX_CLIPS} clips.` };
  }
  const over = totalDuration(clips) + seconds - MAX_VIDEO_SECONDS;
  if (over > 0.05) {
    const room = remainingSeconds(clips);
    return {
      ok: false,
      error:
        room < 1
          ? `Your video is already ${MAX_VIDEO_SECONDS / 60} minutes. Trim or remove a clip to make room.`
          : `That clip is ${seconds.toFixed(1)}s and only ${room.toFixed(1)}s of room is left. Trim it first, or shorten another clip.`,
    };
  }
  return { ok: true };
}

/** Moves a clip, for drag-to-reorder and the arrow buttons beside it. */
export function moveClip(clips: Clip[], from: number, to: number): Clip[] {
  if (from === to || from < 0 || from >= clips.length) return clips;
  const target = Math.min(Math.max(to, 0), clips.length - 1);
  const next = [...clips];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

export function updateClip(clips: Clip[], id: string, patch: Partial<Clip>): Clip[] {
  return clips.map((clip) => (clip.id === id ? normaliseClip({ ...clip, ...patch }) : clip));
}

/**
 * What Mute does to a clip's level.
 *
 * Mute is a volume of 0 — the one number the render and the preview both read —
 * rather than a second flag that could disagree with it. Unmuting brings back
 * the level the clip had before, not full volume: somebody who set a clip to
 * 50% and muted it for a moment did not ask for it to come back at 100%.
 */
export function toggledVolume(volume: number, before: number | undefined): number {
  if (volume > 0) return 0;
  return before !== undefined && before > 0 ? before : 1;
}

/** Keeps a clip's numbers inside the range they are allowed to be in. */
export function normaliseClip(clip: Clip): Clip {
  const duration = clip.sourceDuration > 0 ? clip.sourceDuration : 0;
  const trimStart = clamp(clip.trimStart, 0, duration);
  const trimEnd = clamp(clip.trimEnd, trimStart, duration);
  const width = clamp(clip.crop.width, 0.05, 1);
  const height = clamp(clip.crop.height, 0.05, 1);
  return {
    ...clip,
    trimStart,
    // A zero-length clip is not an edit anybody meant to make.
    trimEnd: trimEnd - trimStart < 0.1 ? Math.min(duration, trimStart + 0.1) : trimEnd,
    crop: {
      width,
      height,
      x: clamp(clip.crop.x, 0, 1 - width),
      y: clamp(clip.crop.y, 0, 1 - height),
    },
    volume: clamp(clip.volume, 0, 1),
  };
}

const clamp = (value: number, low: number, high: number) =>
  Number.isFinite(value) ? Math.min(Math.max(value, low), high) : low;

/** The size a clip's picture ends up, after its crop and its rotation. */
export function displaySize(clip: Clip): { width: number; height: number } {
  const width = Math.max(1, Math.round(clip.sourceWidth * clip.crop.width));
  const height = Math.max(1, Math.round(clip.sourceHeight * clip.crop.height));
  return clip.rotation === 90 || clip.rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

/** The longest side any FayTarra video is rendered at. */
export const OUTPUT_LONG_EDGE = 1080;

/** The vertical short-form frame: 1080x1920, 9:16. */
export const VERTICAL_OUTPUT = { width: 1080, height: 1920 } as const;

/**
 * Whether a clip's picture is taller than it is wide, after crop and rotation.
 *
 * Strictly taller. A square clip is not a vertical video, and pulling it into
 * the 9:16 frame would centre-crop almost half its width away for the sake of a
 * format it never claimed. Square stays square.
 */
export function isUpright(clip: Clip): boolean {
  const { width, height } = displaySize(clip);
  return height > width;
}

/**
 * The frame the finished video is rendered into, and how clips are fitted to it.
 *
 * A project that starts upright is a vertical video, and it renders to 1080x1920
 * whatever shape its clips happen to be — which is the format a phone records in
 * and the format every short-video feed expects. This used to scale the LONG edge
 * to 1080, so a 1080x1920 recording came out 608x1080: a vertical post rendered
 * at barely more than half the width it arrived with. A fixed target can upscale
 * a 720-wide source, which costs bitrate for no extra detail, and that is the
 * lesser of the two. Those clips FILL that frame:
 * a 9:16 recording fills it exactly, and anything wider is centre-cropped rather
 * than letterboxed, because bars baked down the top and bottom of a vertical post
 * look like a mistake. Nothing is ever stretched either way; the scale is one
 * number applied to both axes.
 *
 * A project that starts LANDSCAPE is left alone: its own shape, and clips
 * letterboxed into it rather than cropped. FayTarra is still a general social
 * network, and somebody uploading a 16:9 video from a desktop did not ask for
 * two thirds of its width to be thrown away. Cropping is for the vertical frame,
 * where the alternative is worse.
 */
export function outputFrame(clips: Clip[]): {
  width: number;
  height: number;
  fit: 'cover' | 'contain';
} {
  const first = clips[0];
  if (!first) return { ...VERTICAL_OUTPUT, fit: 'cover' };
  // Filmed here: 9:16 is what the viewfinder framed, whatever the sensor said.
  if (first.fromCamera) return { ...VERTICAL_OUTPUT, fit: 'cover' };
  if (isUpright(first)) return { ...VERTICAL_OUTPUT, fit: 'cover' };

  const { width, height } = displaySize(first);
  const scale = Math.min(1, OUTPUT_LONG_EDGE / Math.max(width, height));
  // Even numbers: an odd dimension is rejected by some H.264 encoders.
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height), fit: 'contain' };
}

/** Whether a clip is already exactly the vertical frame, pixel for pixel. */
export function isOutputFrame(clip: Clip): boolean {
  const { width, height } = displaySize(clip);
  return width === VERTICAL_OUTPUT.width && height === VERTICAL_OUTPUT.height;
}

/** The frame's dimensions alone, for callers that do not care how clips fit it. */
export function outputSize(clips: Clip[]): { width: number; height: number } {
  const { width, height } = outputFrame(clips);
  return { width, height };
}

/**
 * Whether these clips need the render pass at all.
 *
 * One clip, untouched, is already the video the person wants to post — there
 * is nothing to combine and nothing to change, so re-encoding it would cost
 * them minutes of waiting and some quality to arrive back where they started.
 */
export function needsRender(clips: Clip[]): boolean {
  if (clips.length !== 1) return true;
  const [clip] = clips;
  if (!clip.file) return true;
  // A recording that is not already the output frame has to be built, however
  // untouched it is. Skipping the pass is what posted the camera's own
  // dimensions — 1920x1080 from an iPhone, 1216x2160 from Chromium's fake
  // device — as the finished video, and no CSS downstream can turn a landscape
  // file into a portrait one. This is the one case where the saving is not
  // worth taking: see `fromCamera`.
  if (clip.fromCamera && !isOutputFrame(clip)) return true;
  return (
    clip.rotation !== 0 ||
    clip.volume !== 1 ||
    clip.trimStart > 0.05 ||
    clip.trimEnd < clip.sourceDuration - 0.05 ||
    clip.crop.x > 0.001 ||
    clip.crop.y > 0.001 ||
    clip.crop.width < 0.999 ||
    clip.crop.height < 0.999
  );
}
