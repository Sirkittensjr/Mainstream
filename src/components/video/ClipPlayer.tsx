'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Clip } from '@/lib/video/clips';
import { locate, timeline, timelineDuration, type Segment } from '@/lib/video/playlist';

/**
 * Plays a multi-clip project as one video, with no gap at the joins.
 *
 * The editor needs to show the video that is about to be posted, and that video
 * is the clips in order with each one's trim applied. Rendering first to get it
 * is not an option — the pass is real time, so a 90-second project would cost 90
 * seconds of waiting before the first frame and again after every trim. So the
 * clips are played from their own object URLs instead, and the arithmetic lives
 * in `lib/video/playlist.ts`.
 *
 * TWO ELEMENTS, taking turns. One plays while the other has the next clip
 * already loaded and seeked to its first kept frame. At the join we swap which
 * is visible and call `play()` on the one that was waiting, so the next clip
 * starts from a decoded frame rather than from a fresh network and decode. One
 * element that re-pointed its `src` at each join would show a black flash for
 * as long as the decode took, which is the gap this exists to avoid.
 *
 * WHY requestAnimationFrame AND NOT `timeupdate`. `timeupdate` fires about four
 * times a second, so a clip would overrun its trim by up to 250ms before anyone
 * noticed — long enough to show frames that were trimmed away and to put a
 * stutter on every join. A frame-rate loop catches the boundary within ~16ms.
 *
 * It draws no controls. The editor overlays its own, so this is only the
 * picture and the clock.
 */

export interface ClipPlayerHandle {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Seek, in PROJECT time — how far into the finished video. */
  seek: (projectTime: number) => void;
  isPaused: () => boolean;
}

/** Past this much of a clip's kept length, move to the next one. */
const BOUNDARY_SLACK = 0.04;

export const ClipPlayer = forwardRef<
  ClipPlayerHandle,
  {
    clips: Clip[];
    muted: boolean;
    /**
     * How the picture meets its box, and it must be the SAME rule the render
     * uses — see `outputFrame`. The editor previewed with `contain` while the
     * output was `cover`, so a 9:16 recording in a taller-than-9:16 phone screen
     * was fitted by width and shown with a band of black above and below it that
     * the finished video does not have. A preview with a different fit from the
     * export is not a preview.
     */
    fit?: 'cover' | 'contain';
    /** Must position the element — `absolute inset-0`, or `relative` plus a size. */
    /** Project time, every frame while playing. */
    onTime?: (projectTime: number) => void;
    onPlayingChange?: (playing: boolean) => void;
    className?: string;
  }
>(function ClipPlayer(
  { clips, muted, fit = 'cover', onTime, onPlayingChange, className = '' },
  ref,
) {
  const slotA = useRef<HTMLVideoElement>(null);
  const slotB = useRef<HTMLVideoElement>(null);
  /** Stable, so every hook below can list it as the dependency it really is. */
  const elementFor = useCallback(
    (slot: number) => (slot === 0 ? slotA.current : slotB.current),
    [],
  );
  /**
   * Which slot is on screen. The other one is holding the next clip.
   *
   * Both a ref and state, deliberately: the frame loop reads it synchronously
   * many times a second and must never see a stale value, while the rendering
   * needs a re-render to move the opacity across. A ref alone left the swap
   * invisible — the next clip played with the finished one still on top of it.
   */
  const active = useRef(0);
  const [visible, setVisible] = useState(0);
  /** Keeps the two in step, so there is one place that changes which is shown. */
  const show = useCallback((slot: number) => {
    active.current = slot;
    setVisible(slot);
  }, []);
  /**
   * Which segment each slot currently holds, by index into `segments`.
   *
   * -1 means "nothing loaded yet", and starting there matters: claiming slot 0
   * already held clip 0 made the effect below think it was mid-playback on the
   * very first render, so it took the "keep the playhead where it is" path and
   * never gave slot 0 a `src` at all. Nothing played.
   */
  const holding = useRef<[number, number]>([-1, -1]);
  const frame = useRef(0);
  const playing = useRef(false);
  /** Set once a real gesture has played both elements — see `warm`. */
  const warmed = useRef(false);

  const segments = useMemo(() => timeline(clips), [clips]);
  const total = timelineDuration(segments);

  /** Puts a segment into a slot, seeked to its first kept frame and paused. */
  const load = useCallback(
    (slot: number, segment: Segment | null) => {
      const element = elementFor(slot);
      if (!element) return;
      if (!segment) {
        holding.current[slot] = -1;
        return;
      }
      holding.current[slot] = segment.index;
      if (element.src !== segment.clip.src) element.src = segment.clip.src;
      element.volume = segment.clip.volume;
      const settle = () => {
        // `fastSeek` where it exists: this runs at every join and an exact seek
        // costs a decode we do not need for a frame nobody will scrub to.
        try {
          element.currentTime = segment.clip.trimStart;
        } catch {
          // Metadata has not arrived; the loadedmetadata handler will retry.
        }
      };
      if (element.readyState >= 1) settle();
      else element.addEventListener('loadedmetadata', settle, { once: true });
    },
    [elementFor],
  );

  /**
   * Lets both elements play later without another gesture.
   *
   * Autoplay rules are per element, and the swap at a join happens inside an
   * animation frame rather than inside a click. Playing and immediately pausing
   * the waiting element while we still have the gesture is what buys it the
   * right to start on its own later. Without this, a project with sound would
   * play its first clip and stop dead at the first join.
   */
  const warm = useCallback(() => {
    if (warmed.current) return;
    warmed.current = true;
    const idle = elementFor(active.current === 0 ? 1 : 0);
    if (!idle) return;
    const at = idle.currentTime;
    void idle
      .play()
      .then(() => {
        idle.pause();
        idle.currentTime = at;
      })
      .catch(() => undefined);
  }, [elementFor]);

  /** Swaps to the slot holding `segment` and starts it. */
  const advance = useCallback(
    (segment: Segment) => {
      const waiting = active.current === 0 ? 1 : 0;
      const element = elementFor(waiting);
      if (!element) return;

      // If the waiting slot somehow holds the wrong clip — a seek landed oddly,
      // or a trim moved the boundary — load it now. A frame of black beats
      // playing the wrong clip.
      if (holding.current[waiting] !== segment.index) load(waiting, segment);

      const previous = elementFor(active.current);
      show(waiting);
      if (previous) previous.pause();
      void element.play().catch(() => undefined);

      // The slot just freed takes the clip after this one.
      load(waiting === 0 ? 1 : 0, segments[segment.index + 1] ?? null);
    },
    [elementFor, load, segments, show],
  );

  const report = useCallback(
    (projectTime: number) => {
      onTime?.(Math.min(Math.max(projectTime, 0), total));
    },
    [onTime, total],
  );

  const stop = useCallback(() => {
    playing.current = false;
    onPlayingChange?.(false);
    for (const slot of [0, 1]) elementFor(slot)?.pause();
  }, [elementFor, onPlayingChange]);

  /** Back to the first frame of the first clip, both slots primed. */
  const reset = useCallback(() => {
    show(0);
    load(0, segments[0] ?? null);
    load(1, segments[1] ?? null);
  }, [load, segments, show]);

  /**
   * The clock. Reads where the playing element is, turns it into project time,
   * and hands over at the end of each clip.
   */
  const tick = useCallback(() => {
    frame.current = requestAnimationFrame(tick);
    if (!playing.current) return;

    const element = elementFor(active.current);
    const index = holding.current[active.current];
    const segment = segments[index];
    if (!element || !segment) return;

    const into = Math.min(Math.max(element.currentTime - segment.clip.trimStart, 0), segment.length);
    report(segment.startsAt + into);

    const done = element.currentTime >= segment.clip.trimEnd - BOUNDARY_SLACK || element.ended;
    if (!done) return;

    const next = segments[index + 1];
    if (next) {
      advance(next);
      return;
    }
    // The end of the last clip. Back to the top, paused, like a short video.
    stop();
    reset();
    report(0);
  }, [advance, elementFor, report, reset, segments, stop]);

  const seek = useCallback(
    (projectTime: number) => {
      const found = locate(segments, projectTime);
      if (!found) return;
      const { segment, sourceTime } = found;
      const wasPlaying = playing.current;

      // Already on screen: just move the playhead.
      if (holding.current[active.current] === segment.index) {
        const element = elementFor(active.current);
        if (element) element.currentTime = sourceTime;
      } else {
        // Land the target in the active slot so nothing else has to change, and
        // prime the other with whatever follows.
        for (const slot of [0, 1]) elementFor(slot)?.pause();
        load(active.current, segment);
        const element = elementFor(active.current);
        if (element) {
          const go = () => {
            element.currentTime = sourceTime;
            if (wasPlaying) void element.play().catch(() => undefined);
          };
          if (element.readyState >= 1) go();
          else element.addEventListener('loadedmetadata', go, { once: true });
        }
        load(active.current === 0 ? 1 : 0, segments[segment.index + 1] ?? null);
      }
      report(projectTime);
    },
    [elementFor, load, report, segments],
  );

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        const element = elementFor(active.current);
        if (!element) return;
        warm();
        playing.current = true;
        onPlayingChange?.(true);
        void element.play().catch(() => {
          playing.current = false;
          onPlayingChange?.(false);
        });
      },
      pause: stop,
      toggle: () => {
        if (playing.current) stop();
        else {
          const element = elementFor(active.current);
          if (!element) return;
          warm();
          playing.current = true;
          onPlayingChange?.(true);
          void element.play().catch(() => {
            playing.current = false;
            onPlayingChange?.(false);
          });
        }
      },
      seek,
      isPaused: () => !playing.current,
    }),
    [elementFor, onPlayingChange, seek, stop, warm],
  );

  // One loop for the component's life. It costs nothing while paused and saves
  // starting and stopping a timer on every play, pause and join.
  useEffect(() => {
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [tick]);

  /**
   * Re-prime when the clips change — a trim moved a boundary, or a clip was
   * added or dropped. Keyed on the shape of the project rather than on the array
   * identity, so re-rendering for an unrelated reason does not interrupt
   * playback mid-clip.
   */
  const shape = clips.map((clip) => `${clip.id}:${clip.trimStart}:${clip.trimEnd}`).join('|');
  useEffect(() => {
    const element = elementFor(active.current);
    const index = holding.current[active.current];
    const segment = segments[index];
    // Mid-playback, keep the playhead where it is if it is still inside the clip
    // on screen; a trim to a LATER clip should not jump the preview back to the
    // start. Otherwise — including the first render, when nothing is loaded and
    // the index is -1 — prime from the top.
    if (segment && element && element.src && element.currentTime >= segment.clip.trimStart - 0.5) {
      load(active.current === 0 ? 1 : 0, segments[segment.index + 1] ?? null);
      return;
    }
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  return (
    // No position of its own: the caller supplies one, because this has to be
    // able to BE the full-screen layer rather than sit inside one. Hardcoding
    // `relative` here and passing `absolute inset-0` from the editor put two
    // position classes on one element, `relative` won, and the box collapsed to
    // zero height — measured at 390x0. The two videos inside are
    // `absolute inset-0`, so whatever className arrives must be positioned.
    <div className={className} data-clip-player={clips.length}>
      {[slotA, slotB].map((slotRef, slot) => (
        <video
          key={`clip-slot-${slot}`}
          ref={slotRef}
          playsInline
          muted={muted}
          preload="auto"
          data-clip-slot={slot}
          // Both fill the frame; only the active one is visible. Kept mounted and
          // laid out so the waiting one can decode its first frame in advance.
          className={`absolute inset-0 h-full w-full ${
            fit === 'cover' ? 'object-cover' : 'object-contain'
          } ${
            visible === slot ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />
      ))}
    </div>
  );
});
