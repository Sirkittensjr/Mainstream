'use client';

import { showingAt, spotOf } from '@/lib/video/overlays';
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
 * PLACED FREELY, as a fraction of the frame. Each line is absolutely positioned
 * on its own centre, so the same numbers mean the same place at any size — a
 * 200px editor preview and a full-screen feed slide put a line in the same spot
 * relative to the picture. This used to be three stops down the frame; see
 * `TextOverlay`.
 *
 * TIMED, where the surface knows the time. `now` is the playhead in seconds of
 * the finished video; a line outside its own window is not drawn. Undefined
 * means there is no playhead to ask — a poster image, say — and everything
 * shows, because hiding a line there would lose it rather than time it.
 */

const SIZE: Record<TextOverlay['size'], string> = {
  m: 'text-[15px] leading-snug sm:text-base',
  l: 'text-[22px] leading-tight sm:text-2xl',
};

const TONE: Record<TextOverlay['tone'], string> = {
  light: 'bg-black/45 text-white',
  dark: 'bg-white/85 text-ink-950',
  fay: 'bg-fay/85 text-white',
};

export function VideoText({
  media,
  className = '',
  /** Playhead, in seconds of the finished video. Undefined where there is none. */
  now,
  /**
   * Editing a line by tapping or dragging the line itself.
   *
   * Passed only by the editor. Everywhere else these stay untappable, so a tap
   * on a post's text still reaches the player underneath.
   */
  onPick,
  onMove,
  selected = null,
}: {
  media: Pick<Media, 'text' | 'duration'>;
  className?: string;
  now?: number;
  /** Takes the overlay's index in `media.text`. */
  onPick?: (index: number) => void;
  /** Dragged to a new centre, in frame fractions. */
  onMove?: (index: number, x: number, y: number) => void;
  selected?: number | null;
}) {
  const overlays = media.text;
  if (!overlays || overlays.length === 0) return null;
  const total = media.duration ?? 0;
  const editing = Boolean(onPick || onMove);

  /** Where in the layer a pointer is, as fractions of it. */
  function fractionsOf(layer: HTMLElement, clientX: number, clientY: number) {
    const box = layer.getBoundingClientRect();
    return {
      x: (clientX - box.left) / Math.max(1, box.width),
      y: (clientY - box.top) / Math.max(1, box.height),
    };
  }

  function dragFrom(index: number, event: React.PointerEvent<HTMLElement>) {
    if (!onMove) return;
    const layer = event.currentTarget.parentElement;
    if (!layer) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    let moved = false;

    const move = (moveEvent: PointerEvent) => {
      moved = true;
      const { x, y } = fractionsOf(layer, moveEvent.clientX, moveEvent.clientY);
      onMove(index, x, y);
    };
    const release = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      // A tap that never moved is a tap: it opens the line for editing.
      if (!moved) onPick?.(index);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  return (
    // Over the video and out of the way of it: nothing here takes a tap unless
    // the editor asked for it, so the player's own controls underneath work.
    <div
      aria-hidden={false}
      data-video-text
      data-video-text-variant={editing ? 'editor' : 'post'}
      className={`pointer-events-none absolute inset-0 z-[5] ${className}`}
    >
      {overlays.map((overlay, index) => {
        // A line with nothing in it yet is not drawn, but it keeps its place in
        // the array: the editor addresses overlays by index, so filtering them
        // out here would move every line after it under somebody's finger.
        if (!overlay.text.trim()) return null;
        if (!showingAt(overlay, now, total)) return null;
        const { x, y } = spotOf(overlay);
        const words = (
          <span
            className={`block max-w-full break-words rounded-2xl px-3 py-1.5 text-center font-display font-bold backdrop-blur-sm ${SIZE[overlay.size]} ${TONE[overlay.tone]}`}
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
            <span key={index} data-video-text-line={index} className="absolute" style={place}>
              {words}
            </span>
          );
        }
        return (
          <button
            key={index}
            type="button"
            onPointerDown={(event) => dragFrom(index, event)}
            onClick={() => onPick?.(index)}
            aria-label={`Move the text “${overlay.text}”`}
            data-video-text-pick={index}
            data-video-text-line={index}
            style={place}
            className={`pointer-events-auto absolute touch-none rounded-2xl transition-[box-shadow] ${
              selected === index ? 'ring-2 ring-white/90' : 'ring-1 ring-white/0'
            }`}
          >
            {words}
          </button>
        );
      })}
    </div>
  );
}
