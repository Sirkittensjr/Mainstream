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
 * three minutes of something should be told it does not fit and left in
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

/**
 * The frame the finished video is rendered into.
 *
 * The first clip decides the shape, and everything after it is fitted inside
 * without being stretched or cropped further. FayTarra is not a vertical-video
 * app: somebody who starts with a landscape clip gets a landscape post, and
 * somebody who starts with a phone clip gets a tall one.
 */
export function outputSize(clips: Clip[]): { width: number; height: number } {
  const first = clips[0];
  if (!first) return { width: 720, height: 1280 };
  const { width, height } = displaySize(first);
  const scale = Math.min(1, OUTPUT_LONG_EDGE / Math.max(width, height));
  // Even numbers: an odd dimension is rejected by some H.264 encoders.
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
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
