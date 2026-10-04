import { LEGACY_TEXT_SPOTS, type TextOverlay } from '@/lib/types';

/**
 * Where a line of text sits, and when it shows.
 *
 * Pure arithmetic, kept out of the components because three of them draw
 * overlays — the editor, the post page and the Videos feed — and a line that
 * appears at a different moment in the feed from the one it was placed at in
 * the editor is a bug nobody would find by reading either file.
 */

/**
 * How close to the edge a line may be dragged.
 *
 * Its own box is centred on the point, so a centre at the very edge would put
 * half the words outside the frame. This keeps the centre far enough in that
 * there is always something to grab and always something to read.
 */
export const EDGE = 0.08;

export const clamp01 = (value: number, edge = EDGE): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, edge), 1 - edge) : 0.5;

/** A new line starts in the middle of the frame, showing for the whole video. */
export function newOverlay(): TextOverlay {
  return { text: '', x: 0.5, y: 0.5, size: 'l', tone: 'light' };
}

/** Keeps a dragged line inside the frame. */
export function clampOverlay(overlay: TextOverlay, x: number, y: number): TextOverlay {
  return { ...overlay, x: clamp01(x), y: clamp01(y) };
}

/**
 * The centre of an overlay, in frame fractions.
 *
 * Falls back to the old three-stop position for anything stored before free
 * placement, so an old post is drawn where its author put it rather than
 * collapsing to the middle of the screen.
 */
export function spotOf(overlay: TextOverlay): { x: number; y: number } {
  const y =
    typeof overlay.y === 'number' && Number.isFinite(overlay.y)
      ? overlay.y
      : (overlay.at && LEGACY_TEXT_SPOTS[overlay.at]) ?? 0.5;
  const x =
    typeof overlay.x === 'number' && Number.isFinite(overlay.x) ? overlay.x : 0.5;
  return { x: clamp01(x, 0), y: clamp01(y, 0) };
}

/**
 * The window an overlay shows for, in seconds of the finished video.
 *
 * An overlay with neither end set runs the whole length, which is what every
 * overlay made before timing existed means.
 */
export function windowOf(overlay: TextOverlay, total: number): { from: number; to: number } {
  const length = Number.isFinite(total) && total > 0 ? total : 0;
  const from = typeof overlay.from === 'number' && Number.isFinite(overlay.from) ? overlay.from : 0;
  const to = typeof overlay.to === 'number' && Number.isFinite(overlay.to) ? overlay.to : length;
  const start = Math.min(Math.max(from, 0), length);
  const end = Math.min(Math.max(to, start), length);
  return { from: start, to: end };
}

/**
 * Whether an overlay is on screen at this moment.
 *
 * `now` undefined means "no playhead to ask" — a poster image, or a surface that
 * does not track time — and everything shows, because hiding a line there would
 * lose it rather than time it. The end is exclusive at the very end of the video
 * only when it was set: a line left running to the end stays up on the last
 * frame rather than blinking off.
 */
export function showingAt(overlay: TextOverlay, now: number | undefined, total: number): boolean {
  if (now === undefined || !Number.isFinite(now)) return true;
  const { from, to } = windowOf(overlay, total);
  if (to <= from) return true;
  return now >= from - 0.001 && now <= to + 0.001;
}

/** The shortest window a line may be trimmed to, so a grip cannot swallow it. */
export const MIN_TEXT_SECONDS = 0.3;

/** Moves one end of an overlay's window, keeping it inside the video. */
export function trimOverlay(
  overlay: TextOverlay,
  edge: 'from' | 'to',
  seconds: number,
  total: number,
): TextOverlay {
  const { from, to } = windowOf(overlay, total);
  if (edge === 'from') {
    return { ...overlay, from: Math.max(0, Math.min(seconds, to - MIN_TEXT_SECONDS)), to };
  }
  return { ...overlay, from, to: Math.min(total, Math.max(seconds, from + MIN_TEXT_SECONDS)) };
}
