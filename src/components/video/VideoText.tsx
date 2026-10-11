'use client';

import { useEffect, useRef } from 'react';
import {
  fitCenter,
  pinch,
  resizeFromHandle,
  scaleOf,
  showingAt,
  spotOf,
  textSize,
  type Placement,
  type Point,
} from '@/lib/video/overlays';
import type { Media, TextOverlay } from '@/lib/types';

/**
 * The words somebody put over their video, drawn by the player.
 *
 * Not burnt into the file, and that is the whole point: `needsRender` returns
 * false for an untouched recording, which is the only reason a two-minute take
 * does not cost a two-minute re-encode before it can be uploaded. Text that had
 * to be rendered in would flip that for every video carrying any. Drawn here
 * instead — free, and still editable after the fact.
 *
 * Used by every surface that plays a video, so one overlay looks the same on the
 * post page, in the feed and in the full-screen Videos feed. The editor uses it
 * too, which is what makes the preview honest.
 *
 * PLACED AND SIZED AGAINST THE FRAME. Each line is absolutely positioned on its
 * own centre as a fraction of the frame, and its type is a percentage of the
 * frame's width (container query units, with the old pixel sizes where a
 * browser has none) — so the same numbers are the same place and the same size
 * relative to the picture in a 200px editor preview and a full-screen feed
 * slide. See `TEXT_BASE`.
 *
 * TIMED, where the surface knows the time. `now` is the playhead in seconds of
 * the finished video; a line outside its own window is not drawn. Undefined
 * means there is no playhead to ask — a poster image, say — and everything
 * shows, because hiding a line there would lose it rather than time it.
 *
 * EDITABLE, in the editor only: a line is picked by tapping it, moved by
 * dragging it, and resized by pinching it with two fingers or by dragging the
 * handle on its corner (which is also how a mouse resizes). See `useGestures`.
 */

const LEADING: Record<TextOverlay['size'], string> = {
  m: 'leading-snug',
  l: 'leading-tight',
};

const TONE: Record<TextOverlay['tone'], string> = {
  light: 'bg-black/45 text-white',
  dark: 'bg-white/85 text-ink-950',
  fay: 'bg-fay/85 text-white',
};

/** A pointer that moved less than this was a tap, not a drag. */
const TAP_SLOP_PX = 6;
/** How long after a gesture a click is still treated as part of it. */
const CLICK_GUARD_MS = 400;

export function VideoText({
  media,
  className = '',
  /** Playhead, in seconds of the finished video. Undefined where there is none. */
  now,
  /**
   * Editing a line by tapping, dragging or pinching the line itself.
   *
   * Passed only by the editor. Everywhere else these stay untappable, so a tap
   * on a post's text still reaches the player underneath.
   */
  onPick,
  onPlace,
  selected = null,
}: {
  media: Pick<Media, 'text' | 'duration'>;
  className?: string;
  now?: number;
  /** Takes the overlay's index in `media.text`. */
  onPick?: (index: number) => void;
  /** Moved or resized: a new centre, in frame fractions, and a new scale. */
  onPlace?: (index: number, placement: Placement) => void;
  selected?: number | null;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const startGesture = useGestures(layer, onPick, onPlace, media.text, selected);

  const overlays = media.text;
  if (!overlays || overlays.length === 0) return null;
  const total = media.duration ?? 0;
  const editing = Boolean(onPick || onPlace);

  return (
    // Over the video and out of the way of it: nothing here takes a tap unless
    // the editor asked for it, so the player's own controls underneath work.
    // A size container, so the words can be sized against the frame.
    <div
      ref={layer}
      aria-hidden={false}
      data-video-text
      data-video-text-variant={editing ? 'editor' : 'post'}
      className={`pointer-events-none absolute inset-0 z-[5] [container-type:inline-size] ${className}`}
    >
      {overlays.map((overlay, index) => {
        // A line with nothing in it yet is not drawn, but it keeps its place in
        // the array: the editor addresses overlays by index, so filtering them
        // out here would move every line after it under somebody's finger.
        if (!overlay.text.trim()) return null;
        if (!showingAt(overlay, now, total)) return null;
        const { x, y } = spotOf(overlay);
        const size = textSize(overlay);
        const words = (
          <span
            data-video-text-words
            className={`video-text-words block max-w-full break-words rounded-[0.7em] px-[0.55em] py-[0.27em] text-center font-display font-bold backdrop-blur-sm ${LEADING[overlay.size]} ${TONE[overlay.tone]}`}
            style={{ '--vt-px': size.px, '--vt-cqw': size.cqw } as React.CSSProperties}
          >
            {overlay.text}
          </span>
        );
        const place = {
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          transform: 'translate(-50%, -50%)',
          maxWidth: '86%',
        } as const;

        if (!editing) {
          return (
            <span
              key={index}
              data-video-text-line={index}
              data-video-text-scale={scaleOf(overlay)}
              className="absolute"
              style={place}
            >
              {words}
            </span>
          );
        }
        const isSelected = selected === index;
        return (
          <div
            key={index}
            role="button"
            tabIndex={0}
            aria-label={`Text ${index + 1}: “${overlay.text}”. Drag to move, pinch to resize.`}
            aria-pressed={isSelected}
            data-video-text-pick={index}
            data-video-text-line={index}
            data-video-text-selected={isSelected ? 'true' : undefined}
            data-video-text-scale={scaleOf(overlay)}
            onPointerDown={(event) => startGesture(index, overlay, 'move', event)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onPick?.(index);
              }
            }}
            style={place}
            className={`pointer-events-auto absolute cursor-move touch-none select-none rounded-[0.8em] [-webkit-touch-callout:none] [-webkit-user-select:none] ${
              isSelected
                ? 'outline-dashed outline-2 outline-offset-4 outline-white/95'
                : 'outline-none'
            }`}
          >
            {words}
            {isSelected && (
              // The corner handle: drag it out to grow the line, in to shrink
              // it. What a mouse uses, since a mouse cannot pinch; a finger can
              // use it too.
              <span
                role="slider"
                aria-label={`Resize text ${index + 1}`}
                aria-valuemin={0.5}
                aria-valuemax={3}
                aria-valuenow={scaleOf(overlay)}
                data-video-text-resize={index}
                onPointerDown={(event) => startGesture(index, overlay, 'resize', event)}
                // Entirely outside the corner, so on a small line it never
                // covers the words: a finger on the words drags or pinches.
                className="absolute -bottom-7 -right-7 flex h-7 w-7 cursor-nwse-resize touch-none items-center justify-center"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-ink-950 bg-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.35)]">
                  <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
                    <path d="M2 8 8 2M5 8h3V5M2 5V2h3" fill="none" stroke="#06060A" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface Gesture {
  index: number;
  /** The frame, in client pixels, when the gesture began. It does not move. */
  frame: DOMRect;
  /** The line's own element, measured as it changes size. */
  element: HTMLElement;
  /** Fingers or the mouse, by pointer id, in frame pixels. */
  pointers: Map<number, Point>;
  /** Where the line was, and where the pointers were, when the current
   *  combination of pointers began. Re-taken whenever a finger lands or lifts,
   *  so the line never jumps when a pinch becomes a drag or the other way. */
  base: { placement: Placement; points: Map<number, Point> };
  /** The latest placement sent, for re-basing and for measuring growth. */
  last: Placement;
  kind: 'move' | 'resize';
  moved: boolean;
}

/**
 * Touch, pen and mouse on the lines of text, with Pointer Events.
 *
 *   one pointer on a line        drag it (a tap, without moving, picks it)
 *   a second finger, anywhere     pinch: resize around the point between them
 *   the corner handle            resize from the line's centre (mouse or finger)
 *
 * And with a line picked, two fingers placed ANYWHERE on the video pinch it —
 * a line small enough to want growing is usually smaller than the gap between
 * two fingertips, so insisting that both land on it would make pinching inward
 * nearly impossible. One finger on bare video is still a tap on the video
 * (play/pause); it only becomes a pinch when the second finger lands.
 *
 * The rules that keep this from fighting the rest of the editor:
 *
 *   - The lines are `touch-action: none`, and so is the stage around them while
 *     the Text tool is open, so the browser never turns a drag into a scroll or
 *     a pinch into a page zoom. Safari's own `gesturestart` is cancelled too.
 *   - While a gesture is under way, every further pointerdown is caught on the
 *     window, before anything else sees it, and becomes another finger of the
 *     gesture — so a second finger landing beside the line on the video does
 *     not hit the play/pause button there.
 *   - A click right after a gesture is swallowed, for the same reason.
 *   - The timeline is outside the stage, so nothing here can seek it.
 */
function useGestures(
  layer: React.RefObject<HTMLDivElement | null>,
  onPick: ((index: number) => void) | undefined,
  onPlace: ((index: number, placement: Placement) => void) | undefined,
  overlays: TextOverlay[] | undefined,
  selected: number | null,
) {
  const active = useRef<Gesture | null>(null);
  const guardUntil = useRef(0);
  const handlers = useRef({ onPick, onPlace, overlays });
  handlers.current = { onPick, onPlace, overlays };
  const cleanup = useRef<(() => void) | null>(null);
  const editing = Boolean(onPick || onPlace);

  useEffect(() => () => cleanup.current?.(), []);

  // Two fingers anywhere on the video pinch the picked line.
  useEffect(() => {
    const stage = layer.current?.parentElement;
    if (!editing || selected === null || !stage) return;
    const pending = new Map<number, { clientX: number; clientY: number }>();
    const down = (event: PointerEvent) => {
      if (active.current || event.pointerType !== 'touch') return;
      // A finger on a line is that line's own gesture.
      if ((event.target as Element | null)?.closest?.('[data-video-text-pick]')) return;
      pending.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (pending.size < 2) return;
      const overlay = handlers.current.overlays?.[selected];
      const element = layer.current?.querySelector<HTMLElement>(`[data-video-text-pick="${selected}"]`);
      if (!overlay || !element) return;
      event.preventDefault();
      event.stopPropagation();
      begin(selected, overlay, 'move', element, [...pending].map(([pointerId, at]) => ({ pointerId, ...at })));
      pending.clear();
    };
    const move = (event: PointerEvent) => {
      if (pending.has(event.pointerId)) pending.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    };
    const up = (event: PointerEvent) => pending.delete(event.pointerId);
    stage.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      stage.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
    // `begin` only reads refs; it is the same function in effect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selected, layer]);

  const toFrame = (gesture: Gesture, event: { clientX: number; clientY: number }): Point => ({
    x: event.clientX - gesture.frame.left,
    y: event.clientY - gesture.frame.top,
  });

  /** The line where the pointers now say, kept inside the frame. */
  function placementFor(gesture: Gesture): Placement {
    const { base, pointers, frame } = gesture;
    const size = { width: frame.width, height: frame.height };
    const ids = [...base.points.keys()].filter((id) => pointers.has(id));
    let next: Placement;
    if (gesture.kind === 'resize') {
      const id = ids[0];
      const scale = resizeFromHandle(base.placement, base.points.get(id)!, pointers.get(id)!, size);
      next = { ...base.placement, scale };
    } else if (ids.length >= 2) {
      const [a, b] = ids;
      next = pinch(base.placement, base.points.get(a)!, base.points.get(b)!, pointers.get(a)!, pointers.get(b)!, size);
    } else {
      const id = ids[0];
      const from = base.points.get(id)!;
      const to = pointers.get(id)!;
      next = {
        x: base.placement.x + (to.x - from.x) / Math.max(1, frame.width),
        y: base.placement.y + (to.y - from.y) / Math.max(1, frame.height),
        scale: base.placement.scale,
      };
    }
    return fitted(gesture, next);
  }

  /**
   * Keeps the whole box in the frame. The box is measured as it is drawn now
   * and scaled to the size being asked for — re-measured on every move, so the
   * estimate corrects itself as the words wrap differently at a new size.
   */
  function fitted(gesture: Gesture, next: Placement): Placement {
    const box = gesture.element.getBoundingClientRect();
    const width = Math.max(1, gesture.frame.width);
    const height = Math.max(1, gesture.frame.height);
    const grow = next.scale / Math.max(0.01, gesture.last.scale);
    let scale = next.scale;
    // Never taller than the frame: a pinch past that stops growing.
    const tall = (box.height / height) * grow;
    if (grow > 1 && tall > 0.92) scale = gesture.last.scale * Math.max(1, 0.92 / (box.height / height));
    const ratio = scale / Math.max(0.01, gesture.last.scale);
    // Text wraps at 86% of the frame, so it is never wider than that.
    const halfWidth = Math.min((box.width / width) * ratio, 0.86) / 2;
    const halfHeight = ((box.height / height) * ratio) / 2;
    const centre = fitCenter(next.x, next.y, halfWidth, halfHeight);
    return { x: centre.x, y: centre.y, scale };
  }

  function rebase(gesture: Gesture) {
    gesture.base = { placement: { ...gesture.last }, points: new Map(gesture.pointers) };
  }

  /** Starts a gesture on one line with the pointers already down. */
  function begin(
    overlayIndex: number,
    overlay: TextOverlay,
    kind: 'move' | 'resize',
    element: HTMLElement,
    initial: { pointerId: number; clientX: number; clientY: number }[],
  ) {
    const frameElement = layer.current;
    if (!frameElement || active.current) return;
    const start: Placement = { ...spotOf(overlay), scale: scaleOf(overlay) };
    const gesture: Gesture = {
      index: overlayIndex,
      frame: frameElement.getBoundingClientRect(),
      element,
      pointers: new Map(),
      base: { placement: start, points: new Map() },
      last: start,
      kind,
      moved: false,
    };
    for (const pointer of initial) gesture.pointers.set(pointer.pointerId, toFrame(gesture, pointer));
    rebase(gesture);
    // Two fingers from the start is already a pinch, never a tap.
    if (initial.length > 1) gesture.moved = true;
    active.current = gesture;
    guardUntil.current = Date.now() + CLICK_GUARD_MS;

    const down = (downEvent: PointerEvent) => {
      // Another finger: part of this gesture, wherever it landed.
      downEvent.preventDefault();
      downEvent.stopPropagation();
      if (gesture.kind === 'resize') return;
      gesture.pointers.set(downEvent.pointerId, toFrame(gesture, downEvent));
      rebase(gesture);
      gesture.moved = true;
    };
    const move = (moveEvent: PointerEvent) => {
      if (!gesture.pointers.has(moveEvent.pointerId)) return;
      moveEvent.preventDefault();
      const point = toFrame(gesture, moveEvent);
      const from = gesture.base.points.get(moveEvent.pointerId);
      gesture.pointers.set(moveEvent.pointerId, point);
      if (!gesture.moved && from && Math.hypot(point.x - from.x, point.y - from.y) < TAP_SLOP_PX) return;
      gesture.moved = true;
      const next = placementFor(gesture);
      gesture.last = next;
      handlers.current.onPlace?.(gesture.index, next);
    };
    const up = (upEvent: PointerEvent) => {
      if (!gesture.pointers.has(upEvent.pointerId)) return;
      gesture.pointers.delete(upEvent.pointerId);
      guardUntil.current = Date.now() + CLICK_GUARD_MS;
      if (gesture.pointers.size > 0) {
        // One finger lifted from a pinch: carry on as a drag from here.
        rebase(gesture);
        return;
      }
      finish();
    };
    const swallowClick = (clickEvent: MouseEvent) => {
      if (Date.now() <= guardUntil.current || active.current) {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
      }
    };
    // Safari's own pinch, which would zoom the page under the editor.
    const noZoom = (zoomEvent: Event) => zoomEvent.preventDefault();

    function finish() {
      cleanup.current?.();
      active.current = null;
      // Once it has settled at its new size, make sure the whole box is in.
      requestAnimationFrame(() => {
        if (!gesture.moved || !gesture.element.isConnected) return;
        const settled = fitted(gesture, gesture.last);
        if (Math.abs(settled.x - gesture.last.x) > 0.001 || Math.abs(settled.y - gesture.last.y) > 0.001) {
          handlers.current.onPlace?.(gesture.index, settled);
        }
      });
    }

    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('click', swallowClick, true);
    window.addEventListener('gesturestart', noZoom);
    window.addEventListener('gesturechange', noZoom);
    cleanup.current = () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('gesturestart', noZoom);
      window.removeEventListener('gesturechange', noZoom);
      // The click guard outlives the gesture by a moment, then goes.
      window.setTimeout(() => window.removeEventListener('click', swallowClick, true), CLICK_GUARD_MS);
      cleanup.current = null;
    };
  }

  return function startGesture(
    index: number,
    overlay: TextOverlay,
    kind: 'move' | 'resize',
    event: React.PointerEvent<HTMLElement>,
  ) {
    const { onPlace: place, onPick: pick } = handlers.current;
    if (!place && !pick) return;
    // A second finger on a line while a gesture is running is handled by the
    // gesture's window listener, which has already seen it.
    if (active.current) return;
    const element = (event.currentTarget.closest('[data-video-text-pick]') ?? event.currentTarget) as HTMLElement;
    event.preventDefault();
    event.stopPropagation();
    begin(index, overlay, kind, element, [event]);
    // Picked the moment it is touched, so the outline and the controls follow
    // the line being moved rather than the one that was picked before.
    pick?.(index);
  };
}
