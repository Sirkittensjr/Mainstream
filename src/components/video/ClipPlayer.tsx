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
import { placeInFrame } from '@/lib/video/preview';

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
 * EACH CLIP AT ITS OWN LEVEL, through Web Audio. `HTMLMediaElement.volume` is
 * read-only on iOS Safari — setting it to 0.5 does nothing on an iPhone — so a
 * preview that relied on it played every clip at full volume on exactly the
 * phone this editor is for. Each slot is routed through its own gain node
 * instead, set to the volume of whichever clip that slot holds, which is the
 * same thing `renderClips` does to the finished file. The levels are re-applied
 * the moment a clip's volume changes, not when the clip is next loaded. Where
 * Web Audio is unavailable it falls back to `volume`, and a level of 0 always
 * mutes the element too, which works everywhere.
 *
 * EACH CLIP IN ITS OWN CROP AND TURN, laid out by `placeInFrame` with the same
 * arithmetic the render uses, so the preview is the finished frame rather than
 * the raw source.
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
  /**
   * The same, as state, for the one thing that has to re-render when it moves:
   * each slot's crop and turn are those of the clip it holds.
   */
  const [held, setHeld] = useState<[number, number]>([-1, -1]);
  const frame = useRef(0);
  const playing = useRef(false);
  /** Set once a real gesture has played both elements — see `warm`. */
  const warmed = useRef(false);

  const segments = useMemo(() => timeline(clips), [clips]);
  const total = timelineDuration(segments);

  /* ---------------------------------------------------------- the sound */

  /** Read from inside callbacks that must not be rebuilt when they change. */
  const live = useRef({ segments, muted });
  live.current = { segments, muted };
  /** One gain per slot, once a gesture has let us make them. */
  const audio = useRef<{ context: AudioContext; gains: GainNode[] } | null>(null);

  /** Sets one slot to the level of the clip it holds. */
  const level = useCallback(
    (slot: number) => {
      const element = elementFor(slot);
      if (!element) return;
      const segment = live.current.segments[holding.current[slot]];
      const volume = segment ? segment.clip.volume : 1;
      const route = audio.current;
      if (route) {
        route.gains[slot].gain.value = volume;
        try {
          // The gain does the work; the element passes the source through whole.
          element.volume = 1;
        } catch {
          // Read-only, and already 1.
        }
      } else {
        try {
          element.volume = volume;
        } catch {
          // Read-only here (iOS). Mute below still covers a level of 0.
        }
      }
      element.muted = live.current.muted || volume === 0;
      // What was actually applied, for anyone checking the preview is honest.
      element.dataset.clipVolume = String(volume);
      element.dataset.clipAudio = route ? 'gain' : 'element';
    },
    [elementFor],
  );

  /**
   * Routes both slots through gain nodes. Only ever from a gesture — an audio
   * context made outside one starts suspended and plays nothing — and only once,
   * because an element can be given to `createMediaElementSource` only once.
   */
  const route = useCallback(() => {
    if (audio.current) {
      if (audio.current.context.state === 'suspended') void audio.current.context.resume();
      return;
    }
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const a = elementFor(0);
    const b = elementFor(1);
    if (!AudioContextClass || !a || !b) return;
    try {
      const context = new AudioContextClass();
      const gains = [a, b].map((element) => {
        const gain = context.createGain();
        context.createMediaElementSource(element).connect(gain).connect(context.destination);
        return gain;
      });
      audio.current = { context, gains };
      void context.resume();
    } catch {
      audio.current = null;
    }
    level(0);
    level(1);
  }, [elementFor, level]);

  useEffect(
    () => () => {
      void audio.current?.context.close().catch(() => undefined);
      audio.current = null;
    },
    [],
  );

  /* ---------------------------------------------------- crop and turn */

  const box = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => setFrameSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  /** Each slot's own pixel size, once its metadata has said. */
  const [natural, setNatural] = useState<{ width: number; height: number }[]>([
    { width: 0, height: 0 },
    { width: 0, height: 0 },
  ]);

  /** Puts a segment into a slot, seeked to its first kept frame and paused. */
  const load = useCallback(
    (slot: number, segment: Segment | null) => {
      const element = elementFor(slot);
      if (!element) return;
      if (!segment) {
        holding.current[slot] = -1;
        setHeld([holding.current[0], holding.current[1]]);
        return;
      }
      holding.current[slot] = segment.index;
      setHeld([holding.current[0], holding.current[1]]);
      if (element.src !== segment.clip.src) element.src = segment.clip.src;
      level(slot);
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
    [elementFor, level],
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
        route();
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
          route();
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
    [elementFor, onPlayingChange, route, seek, stop, warm],
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

  /**
   * A volume change applies NOW, to whichever slot holds that clip — including
   * the one playing. It used to be set only when a clip was loaded, so moving
   * the slider for the clip on screen did nothing until the preview next came
   * round to it.
   */
  const levels = clips.map((clip) => clip.volume).join('|');
  useEffect(() => {
    level(0);
    level(1);
  }, [levels, muted, level]);
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
      {/* The frame. Clips everything outside it, which is how a crop that
          zooms in reads as a crop rather than as a bigger picture. */}
      <div ref={box} className="absolute inset-0 overflow-hidden">
        {[slotA, slotB].map((slotRef, slot) => {
          const clip = segments[held[slot]]?.clip;
          const place = clip
            ? placeInFrame(
                clip,
                natural[slot].width > 0
                  ? natural[slot]
                  : { width: clip.sourceWidth, height: clip.sourceHeight },
                frameSize,
                fit,
              )
            : null;
          return (
            <video
              key={`clip-slot-${slot}`}
              ref={slotRef}
              playsInline
              // Muted is set imperatively with the level — see `level` — so the
              // two can never disagree. Starting muted is harmless: nothing
              // plays before a gesture, and the gesture applies the real level.
              muted
              preload="auto"
              data-clip-slot={slot}
              data-clip-crop={clip ? `${clip.crop.x},${clip.crop.y},${clip.crop.width},${clip.crop.height}` : ''}
              data-clip-rotation={clip?.rotation ?? 0}
              onLoadedMetadata={(event) => {
                const { videoWidth, videoHeight } = event.currentTarget;
                setNatural((current) =>
                  current.map((size, index) =>
                    index === slot ? { width: videoWidth, height: videoHeight } : size,
                  ),
                );
                level(slot);
              }}
              // Both fill the frame; only the active one is visible. Kept mounted
              // and laid out so the waiting one can decode its first frame in
              // advance. Until the frame has a size, `object-cover` stands in —
              // the same picture for an uncropped clip.
              className={`absolute ${
                place ? 'max-w-none object-fill' : `inset-0 h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`
              } ${visible === slot ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
              style={
                place
                  ? {
                      left: place.left,
                      top: place.top,
                      width: place.width,
                      height: place.height,
                      transform: place.rotate ? `rotate(${place.rotate}deg)` : undefined,
                      transformOrigin: `${place.originX}px ${place.originY}px`,
                    }
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
});
