import { loadVideo, seekTo } from './capture';

/**
 * Frames of a clip, small, for the editor's timeline.
 *
 * A timeline of numbered grey boxes is a form; a timeline of the actual frames
 * is a video editor. It is the difference somebody sees first, and it is the one
 * thing a clip strip cannot fake: you choose which clip to cut by recognising
 * what is in it.
 *
 * Cheap on purpose. These are drawn 2-3cm wide on a phone, so they are grabbed
 * at a small edge and encoded as low-quality JPEG data URLs — a strip of six is
 * a few tens of kilobytes, held in React state and thrown away with the editor.
 * They are NOT the cover: `grabFrame` makes that, at a real size, as a Blob that
 * gets uploaded.
 *
 * One element for the whole strip. Each `loadVideo` costs a fresh fetch, decode
 * and duration settle — a recording from MediaRecorder carries no duration, so
 * settling it means reading the file to the end — and paying that six times to
 * draw six frames of the same clip made selecting a clip visibly slow.
 */

/**
 * `count` times spread across a span, each in the MIDDLE of its own slice.
 *
 * Not `from` to `to` inclusive: a filmstrip whose first frame is the clip's
 * first frame usually opens on black, because that is what the first frame of a
 * recording is while the sensor is still coming up. Sampling the middle of each
 * slice also means the strip reads as "these are the parts", which is what it
 * is for, rather than "these are the ends".
 */
export function sampleTimes(from: number, to: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const start = Math.max(0, Number.isFinite(from) ? from : 0);
  const end = Math.max(start, Number.isFinite(to) ? to : start);
  const span = end - start;
  if (span <= 0) return Array.from({ length: n }, () => start);
  return Array.from({ length: n }, (_, index) => start + (span * (index + 0.5)) / n);
}

/**
 * Those times, as data URLs, in order.
 *
 * Never rejects: a frame that cannot be grabbed comes back as an empty string
 * and the caller draws a placeholder. A thumbnail is decoration, and a clip
 * strip that threw because one seek failed would take the whole editor with it.
 *
 * Abortable, and the editor uses it. Without a signal the loop runs on after the
 * caller has gone — and the moment the editor is left is the moment `renderClips`
 * starts, which is a real-time pass that writes output frames on a clock. A
 * forgotten strip still seeking in the background slows that pass down and the
 * posted file comes out the wrong length. An aborted run returns the frames it
 * had got to, which is fewer than asked for.
 */
export async function framesFrom(
  src: string,
  times: number[],
  {
    maxEdge = 96,
    quality = 0.5,
    signal,
  }: { maxEdge?: number; quality?: number; signal?: AbortSignal } = {},
): Promise<string[]> {
  if (times.length === 0) return [];
  let video: HTMLVideoElement;
  try {
    video = await loadVideo(src);
  } catch {
    return times.map(() => '');
  }

  /** Lets the element go and stops decoding. */
  const release = () => {
    video.src = '';
    video.load();
  };

  if (signal?.aborted) {
    release();
    return times.map(() => '');
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const width = video.videoWidth || 720;
  const height = video.videoHeight || 1280;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  canvas.width = Math.max(2, Math.round(width * scale));
  canvas.height = Math.max(2, Math.round(height * scale));

  const frames: string[] = [];
  for (const time of times) {
    // Checked between every frame, not only at the start. Each seek is a decode,
    // and the caller that gave up is usually the editor closing — which on a
    // phone means the render pass is about to want the whole decoder to itself.
    if (signal?.aborted) break;
    if (!context) {
      frames.push('');
      continue;
    }
    try {
      await seekTo(video, time);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', quality));
    } catch {
      frames.push('');
    }
  }

  // Let the decoder go. The editor keeps several clips' strips at once and each
  // one of these holds a decoded video until it is released.
  release();
  return frames;
}

/**
 * One filmstrip for the WHOLE project, assembled from frames already in hand.
 *
 * Timing a line of text is a question about the finished video — "show this from
 * two seconds to five" — so the strip it is trimmed against has to be the whole
 * video, not the one clip the editor happens to have open. Grabbing a fresh set
 * for that would mean another pass over every clip; instead each cell picks the
 * frame its own moment already fell on, out of the per-clip strips the timeline
 * is drawn from.
 *
 * Cells are sampled at their own midpoints, so a strip of six over three equal
 * clips gives two cells to each rather than one landing exactly on a join.
 * A clip whose frames have not arrived yet contributes an empty string, and the
 * caller draws a placeholder for it.
 */
export function projectFrames(
  segments: {
    clip: { id: string; trimStart: number; sourceDuration: number };
    startsAt: number;
    endsAt: number;
    length: number;
  }[],
  strips: Record<string, string[]>,
  cells: number,
): string[] {
  const count = Math.max(1, Math.floor(cells));
  const total = segments.length === 0 ? 0 : segments[segments.length - 1].endsAt;
  if (total <= 0) return Array.from({ length: count }, () => '');

  return Array.from({ length: count }, (_, cell) => {
    const when = (total * (cell + 0.5)) / count;
    const segment =
      segments.find((each) => when < each.endsAt) ?? segments[segments.length - 1];
    const frames = strips[segment.clip.id];
    if (!frames || frames.length === 0) return '';

    // Where that moment falls inside the clip's own FILE, which is what its
    // strip spans — the strip covers the whole source, trimmed-off parts and all.
    const into = Math.min(Math.max(when - segment.startsAt, 0), segment.length);
    const source = segment.clip.trimStart + into;
    const across =
      segment.clip.sourceDuration > 0 ? source / segment.clip.sourceDuration : 0;
    const slot = Math.min(frames.length - 1, Math.max(0, Math.floor(across * frames.length)));
    return frames[slot] ?? '';
  });
}
