import { clipDuration, type Clip } from './clips';

/**
 * A multi-clip video, laid out on one timeline.
 *
 * The editor has to show somebody the video they are about to post, and that
 * video is the clips played one after another with each one's trim applied. The
 * finished file is produced exactly that way — `renderClips` walks the array in
 * order, seeks to `trimStart` and plays to `trimEnd` — so a preview that plays
 * anything else is a preview of a different video.
 *
 * Rendering first to get a preview is not an option: the pass is real time, so
 * watching a 90-second project back would cost 90 seconds of waiting before the
 * first frame, and again after every trim. Instead the clips are played in
 * sequence from their own object URLs and this module does the arithmetic:
 * project time in, which clip and where inside its source, out.
 *
 * Two kinds of time, and mixing them up is the whole difficulty:
 *
 *   SOURCE time    where the playhead is inside one clip's own file. What a
 *                  `<video>` element's `currentTime` means.
 *   PROJECT time   how far into the finished video we are, with earlier clips'
 *                  kept lengths added up and their trimmed-off parts gone.
 *                  What the scrubber shows.
 */

export interface Segment {
  clip: Clip;
  /** Position in `clips`, so a trim can be applied to the right one. */
  index: number;
  /** Project time this segment starts at. */
  startsAt: number;
  /** Project time it ends at. `startsAt + length`. */
  endsAt: number;
  /** Kept length, after trimming. */
  length: number;
}

/**
 * The clips as one timeline.
 *
 * Zero-length segments are kept rather than dropped: a clip trimmed to nothing
 * is still a clip somebody can select and re-trim, and silently losing it from
 * the strip would be worse than showing it as a sliver. `normaliseClip` already
 * refuses to make one shorter than 0.1s, so this is defensive rather than load
 * bearing.
 */
export function timeline(clips: Clip[]): Segment[] {
  let at = 0;
  return clips.map((clip, index) => {
    const length = clipDuration(clip);
    const segment: Segment = { clip, index, startsAt: at, endsAt: at + length, length };
    at += length;
    return segment;
  });
}

/** How long the finished video is. The last segment's end. */
export function timelineDuration(segments: Segment[]): number {
  return segments.length === 0 ? 0 : segments[segments.length - 1].endsAt;
}

/**
 * Which clip is on screen at a given project time, and where inside its source.
 *
 * The boundary belongs to the LATER segment — at exactly 3.0s of a 3-second
 * first clip we are at the first frame of the second clip, not the last frame of
 * the first. That is what makes playback advance rather than stall on the join.
 * Past the end, the last segment's final frame; before the start, the first.
 */
export function locate(
  segments: Segment[],
  projectTime: number,
): { segment: Segment; sourceTime: number } | null {
  if (segments.length === 0) return null;
  const t = Number.isFinite(projectTime) ? Math.max(0, projectTime) : 0;

  for (const segment of segments) {
    if (t < segment.endsAt || segment === segments[segments.length - 1]) {
      const into = Math.min(Math.max(t - segment.startsAt, 0), segment.length);
      return { segment, sourceTime: segment.clip.trimStart + into };
    }
  }
  return null;
}

/** The inverse: a position inside one clip's source, as project time. */
export function projectTime(segment: Segment, sourceTime: number): number {
  const into = Math.min(
    Math.max(sourceTime - segment.clip.trimStart, 0),
    segment.length,
  );
  return segment.startsAt + into;
}

/** The segment after this one, or null at the end. What to preload. */
export function nextSegment(segments: Segment[], index: number): Segment | null {
  return segments[index + 1] ?? null;
}

/**
 * Where a clip's trim handles may go, in that clip's own source time.
 *
 * Only the clip's own file bounds it. Its neighbours are separate files and the
 * total length is checked when a clip is ADDED, not while one is being
 * shortened — trimming can only ever free up budget.
 */
export function trimBounds(clip: Clip): { min: number; max: number } {
  return { min: 0, max: clip.sourceDuration > 0 ? clip.sourceDuration : 0 };
}

/**
 * How wide each clip should be drawn in the strip, as a fraction of the whole.
 *
 * Proportional to kept length, so the strip reads as the video's shape. With a
 * floor, because a clip trimmed to half a second still has to be tappable — and
 * then the fractions are renormalised so they still add to 1 and the strip has
 * no gap at the end.
 */
export function stripWidths(segments: Segment[], minimum = 0.08): number[] {
  const total = timelineDuration(segments);
  if (segments.length === 0) return [];
  if (total <= 0) return segments.map(() => 1 / segments.length);

  const floored = segments.map((segment) => Math.max(segment.length / total, minimum));
  const sum = floored.reduce((a, b) => a + b, 0);
  return floored.map((value) => value / sum);
}
