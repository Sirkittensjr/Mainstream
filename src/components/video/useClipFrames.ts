'use client';

import { useEffect, useRef, useState } from 'react';
import type { Clip } from '@/lib/video/clips';
import { framesFrom, sampleTimes } from '@/lib/video/thumbnails';

/**
 * Frames of every clip, for the editor's timeline.
 *
 * ONE SET PER CLIP, used for both jobs. The open clip is drawn as a filmstrip of
 * its whole source and the others as a single thumbnail, and the thumbnail is
 * just the middle frame of that same strip — so a clip is read once, not once
 * for its poster and again when somebody selects it. Each read costs a fetch, a
 * decode and a duration settle, and settling a MediaRecorder file means reading
 * it to the end, so halving the reads is most of the cost.
 *
 * KEYED ON THE SOURCE, NOT ON THE TRIM. The frames cover a clip's WHOLE source
 * file, so moving a trim handle never invalidates them — which matters because
 * trimming is a drag, and regrabbing six frames on every pointermove would make
 * the handle crawl. The lit window in the timeline moves over frames that are
 * already there.
 *
 * CACHED FOR AS LONG AS THE CLIP EXISTS, so going back to a clip is instant
 * rather than another six seeks. A clip dropped from the project is forgotten
 * with it, so a long session of filming and deleting does not keep every take's
 * strip alive.
 *
 * THE OPEN CLIP IS READ FIRST. With three clips still being grabbed, selecting
 * the third and waiting for the first two to finish is the difference between a
 * strip that appears and one that arrives.
 */

/**
 * Frames across a clip's source.
 *
 * Ten, because the strip now runs the full width of the screen under the top
 * bar rather than sitting in a tile: at ~56px tall each frame is about 31px
 * wide, so ten of them fill 390px and the strip reads as film rather than as a
 * row of swatches. Each one costs a seek, so this is the width that is useful
 * and no more.
 */
const STRIP = 10;
/** Which of them stands in for the whole clip in the timeline. */
const POSTER = Math.floor(STRIP / 2);

export interface ClipFrames {
  /** Frames across each clip's whole source, by clip id, in order. */
  strips: Record<string, string[]>;
  /** The one frame that stands for a clip. Undefined until it has been read. */
  poster: (id: string) => string | undefined;
}

export function useClipFrames(clips: Clip[], selectedId: string | null): ClipFrames {
  const [strips, setStrips] = useState<Record<string, string[]>>({});
  /** Ids already read, so a re-render does not start the same work again. */
  const asked = useRef(new Set<string>());

  // Identity of the project, by source. A trim does not change it.
  const sources = clips.map((clip) => `${clip.id}:${clip.src}:${clip.sourceDuration}`).join('|');

  useEffect(() => {
    let cancelled = false;
    /** The clip being read right now, so an interrupted read can be retried. */
    let reading: string | null = null;
    // Stops the seeking too, not just the bookkeeping. Leaving the editor starts
    // the render, and a strip still decoding in the background makes that
    // real-time pass produce a file of the wrong length — see `framesFrom`.
    const stop = new AbortController();
    // Held in a local for the cleanup below: the Set itself never changes
    // identity, but reading `asked.current` from a cleanup is the pattern that
    // goes wrong when a ref points at something React replaced.
    const seen = asked.current;

    const present = new Set(clips.map((clip) => clip.id));
    setStrips((current) => {
      const kept = Object.fromEntries(Object.entries(current).filter(([id]) => present.has(id)));
      return Object.keys(kept).length === Object.keys(current).length ? current : kept;
    });
    for (const id of seen) if (!present.has(id)) seen.delete(id);

    // The open clip first; the rest in the order they will be played.
    const order = [...clips].sort((a, b) =>
      a.id === selectedId ? -1 : b.id === selectedId ? 1 : 0,
    );

    void (async () => {
      for (const clip of order) {
        if (cancelled) return;
        if (seen.has(clip.id)) continue;
        seen.add(clip.id);
        reading = clip.id;
        const frames = await framesFrom(
          clip.src,
          sampleTimes(0, clip.sourceDuration, STRIP),
          { maxEdge: 120, signal: stop.signal },
        );
        reading = null;
        if (cancelled) return;
        setStrips((current) => ({ ...current, [clip.id]: frames }));
      }
    })();

    return () => {
      cancelled = true;
      stop.abort();
      // Selecting a clip re-runs this effect, which abandons whatever read was
      // in flight. Letting it stay in `asked` would mean that clip never got its
      // frames; putting it back means the run that just started picks it up.
      if (reading) seen.delete(reading);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, selectedId]);

  return {
    strips,
    poster: (id: string) => {
      const frames = strips[id];
      if (!frames || frames.length === 0) return undefined;
      // A frame can come back empty when a seek fails; fall back to any that did.
      return frames[POSTER] || frames.find((frame) => frame !== '') || undefined;
    },
  };
}
