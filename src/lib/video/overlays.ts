import { LEGACY_TEXT_SPOTS, MAX_TEXT_SCALE, MIN_TEXT_SCALE, type TextOverlay } from '@/lib/types';

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

/**
 * When a line is picked, where the playhead has to go for it to be on screen —
 * or null when it already is.
 *
 * A line outside its own window is not drawn, so picking one while the playhead
 * is elsewhere used to select something invisible: it could not be seen, tapped
 * or dragged, and looked as if it had been lost. Its start is where it first
 * appears.
 */
export function seekToShow(overlay: TextOverlay, now: number, total: number): number | null {
  if (showingAt(overlay, now, total)) return null;
  return windowOf(overlay, total).from;
}

/* ------------------------------------------------------------------ size */

/**
 * How big each size is, as a percentage of the frame's width — and the pixel
 * size used where a browser cannot measure against the frame (no container
 * query units, which means iOS Safari before 16).
 *
 * Relative to the frame so that a line is the same size against the PICTURE on
 * every surface: the editor's preview is about 200px wide on a phone, a feed
 * slide is the whole screen, and a fixed pixel size made the same line twice
 * as big over the video in the editor as in the post. The percentages are the
 * old pixel sizes on a phone-width (390px) frame, so a phone feed looks as it
 * always has.
 */
export const TEXT_BASE: Record<TextOverlay['size'], { cqw: number; px: number }> = {
  m: { cqw: 3.85, px: 15 },
  l: { cqw: 5.64, px: 22 },
};

/** A pinch scale held inside what the editor allows. Anything unreadable is 1. */
export function clampScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(Math.max(value, MIN_TEXT_SCALE), MAX_TEXT_SCALE);
}

/** How much a line has been pinched. 1 for every line that never was. */
export const scaleOf = (overlay: TextOverlay): number => clampScale(overlay.scale ?? 1);

/** The size a line is drawn at, frame-relative and in fallback pixels. */
export function textSize(overlay: TextOverlay): { cqw: number; px: number } {
  const base = TEXT_BASE[overlay.size] ?? TEXT_BASE.m;
  const scale = scaleOf(overlay);
  return { cqw: Math.round(base.cqw * scale * 100) / 100, px: Math.round(base.px * scale * 10) / 10 };
}

/* -------------------------------------------------------------- gestures */

/** A point in the video frame, in pixels from its top-left corner. */
export interface Point {
  x: number;
  y: number;
}

/** The frame's size in pixels, so fractions and pixels can be converted. */
export interface Frame {
  width: number;
  height: number;
}

/** Where a line is and how big — the three things a gesture changes. */
export interface Placement {
  x: number;
  y: number;
  scale: number;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Fingers closer than this tell us nothing about size; the ratio would explode. */
const MIN_SPAN_PX = 12;

/**
 * Two fingers: the size follows the distance between them, and the line stays
 * anchored around the point between them.
 *
 * The point of the text that was under the middle of the two fingers when they
 * landed stays under it — so pinching outward over one side of a line grows it
 * from there rather than from its own centre, and moving both fingers carries
 * it along, which is how every short-video editor feels.
 *
 * `start` is the line when the two fingers landed; `a0`/`b0` are where they
 * landed and `a1`/`b1` where they are now, in frame pixels.
 */
export function pinch(
  start: Placement,
  a0: Point,
  b0: Point,
  a1: Point,
  b1: Point,
  frame: Frame,
): Placement {
  const width = Math.max(1, frame.width);
  const height = Math.max(1, frame.height);
  const before = distance(a0, b0);
  const ratio = before >= MIN_SPAN_PX ? distance(a1, b1) / before : 1;
  const scale = clampScale(start.scale * ratio);
  // What the size actually changed by, after clamping — so a pinch that has
  // hit the largest size stops pushing the line away from the fingers.
  const grown = scale / clampScale(start.scale);
  const c0 = middle(a0, b0);
  const c1 = middle(a1, b1);
  const x = c1.x + (start.x * width - c0.x) * grown;
  const y = c1.y + (start.y * height - c0.y) * grown;
  return { x: x / width, y: y / height, scale };
}

/**
 * The resize handle, for a mouse — or one finger: the size follows how far the
 * handle is from the line's centre, so dragging it outward grows the line and
 * inward shrinks it, and the line stays where it is.
 */
export function resizeFromHandle(start: Placement, from: Point, to: Point, frame: Frame): number {
  const centre = { x: start.x * frame.width, y: start.y * frame.height };
  const before = distance(centre, from);
  if (before < MIN_SPAN_PX / 2) return clampScale(start.scale);
  return clampScale(start.scale * (distance(centre, to) / before));
}

/**
 * Keeps a whole line inside the frame, not just its centre.
 *
 * `halfWidth` and `halfHeight` are half the line's box as fractions of the
 * frame. A bigger line has to sit further from the edges; one wider than the
 * frame is centred, because there is no position that would fit it.
 */
export function fitCenter(x: number, y: number, halfWidth: number, halfHeight: number): { x: number; y: number } {
  const keep = (value: number, half: number) => {
    const margin = Math.min(0.5, Math.max(EDGE, Number.isFinite(half) ? half : EDGE));
    return Number.isFinite(value) ? Math.min(Math.max(value, margin), 1 - margin) : 0.5;
  };
  return { x: keep(x, halfWidth), y: keep(y, halfHeight) };
}

/** A gesture's outcome applied to a line — position, size, and nothing else. */
export function placeOverlay(overlay: TextOverlay, placement: Placement): TextOverlay {
  const scale = clampScale(placement.scale);
  const next: TextOverlay = { ...overlay, x: placement.x, y: placement.y };
  if (Math.abs(scale - 1) < 0.005) delete next.scale;
  else next.scale = Math.round(scale * 100) / 100;
  return next;
}
