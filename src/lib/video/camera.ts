import { MAX_VIDEO_SECONDS } from './limits';

/**
 * What the camera does between takes.
 *
 * The camera used to be a one-shot: release the shutter and the take was over,
 * the stream was torn down, and the next screen was the one on the way to
 * posting. Filming a second clip meant going back for it. That is backwards —
 * a clip is a sentence, not a video, and somebody filming three of them should
 * never leave the viewfinder in between.
 *
 * So the rule here is: a finished segment keeps the camera. The only thing
 * that ends the recording stage is the person pressing Next, or the overall
 * budget running out — at which point there is nothing left to film, and
 * holding them on a dead viewfinder would be the rudeness.
 *
 * The decisions live here rather than in the component because they are the
 * behaviour — "stopping does not leave the camera", "Next goes to the editor",
 * "the limit is the total, not the clip" — and behaviour should be testable
 * without a camera, a browser or a MediaRecorder.
 *
 * Everything takes plain segment lengths in seconds. The clips themselves live
 * in VideoStudio; nothing here needs to know what a Clip is.
 */

/** Where the three mobile stages are. The camera is the first of them. */
export type CameraStage = 'camera' | 'edit' | 'post';

/** The least a segment has to run to be worth keeping. */
export const MIN_SEGMENT_SECONDS = 0.3;

/**
 * How little budget may be left before the camera stops offering another take.
 *
 * Half a second: enough that a camera showing 0:00 cannot be pressed, and not
 * so much that somebody with a second of room is told they have none.
 */
export const BUDGET_SPENT_SECONDS = 0.5;

/** The total of every segment filmed so far. The limit is measured against this. */
export const recordedSeconds = (segments: readonly number[]): number =>
  segments.reduce((sum, seconds) => sum + Math.max(0, seconds), 0);

/**
 * What is left of the overall budget.
 *
 * The budget is the finished video's length, which is why this subtracts the
 * total rather than the last segment: three clips of 10, 8 and 12 seconds have
 * spent 30 seconds of the two minutes between them, not 12.
 */
export const budgetLeft = (segments: readonly number[], max = MAX_VIDEO_SECONDS): number =>
  Math.max(0, max - recordedSeconds(segments));

/** Whether there is room to film at all. */
export const canRecordAnother = (segments: readonly number[], max = MAX_VIDEO_SECONDS): boolean =>
  budgetLeft(segments, max) >= BUDGET_SPENT_SECONDS;

/**
 * How long the next take may run.
 *
 * The chosen cap or what is left of the budget, whichever is smaller — so
 * picking 2m with twenty seconds left promises twenty seconds, not two minutes.
 */
export const segmentBudget = (
  segments: readonly number[],
  cap: number,
  max = MAX_VIDEO_SECONDS,
): number => Math.max(0, Math.min(budgetLeft(segments, max), cap));

/** Whether Next has anything to go on. Nothing filmed, nothing to edit. */
export const canContinue = (segments: readonly number[]): boolean =>
  segments.some((seconds) => seconds >= MIN_SEGMENT_SECONDS);

/**
 * Where the camera goes when a segment finishes.
 *
 * `camera` is the answer almost every time, and that is the whole point of
 * this change. `edit` only when the budget is spent: there is no third clip to
 * film, so sitting on the viewfinder would be a dead end rather than a choice.
 */
export function stageAfterSegment(
  segments: readonly number[],
  max = MAX_VIDEO_SECONDS,
): CameraStage {
  return canRecordAnother(segments, max) ? 'camera' : 'edit';
}

/**
 * Where Next goes.
 *
 * The editor, once anything has been filmed. With nothing filmed it is not a
 * button anybody should be able to press, and if they somehow do, the camera
 * is where they stay.
 */
export function stageAfterNext(segments: readonly number[]): CameraStage {
  return canContinue(segments) ? 'edit' : 'camera';
}

/**
 * Whether a segment is worth keeping at all.
 *
 * A tap that starts and stops the recorder in the same moment is not a clip,
 * and adding it would put a frame of nothing in the middle of somebody's video.
 */
export const keepsSegment = (seconds: number): boolean =>
  Number.isFinite(seconds) && seconds >= MIN_SEGMENT_SECONDS;

/** "3 clips · 0:30" — what the camera says it is holding. */
export function segmentSummary(segments: readonly number[]): string {
  const kept = segments.filter(keepsSegment);
  const total = recordedSeconds(kept);
  const whole = Math.max(0, Math.round(total));
  const clock = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  return `${kept.length} clip${kept.length === 1 ? '' : 's'} · ${clock}`;
}

/**
 * Where a finished segment goes.
 *
 * A recording session is a list that only ever grows: a new segment is appended
 * to the clips already filmed, and nothing about pressing Record again replaces,
 * resets or reorders what came before. Stated as a function — and tested — because
 * "the second clip started a new video" is the exact bug this is here to make
 * impossible.
 *
 * The length is the recorder's OWN measurement, which is why this needs nothing
 * from the file. Waiting on a probe to read the duration back out of a WebM is
 * what used to make a segment appear seconds late, or not at all when the probe
 * gave up — and a clip that has not appeared yet is a clip the next press of the
 * shutter cannot see.
 */
export function appendSegment(
  segments: readonly number[],
  seconds: number,
  max = MAX_VIDEO_SECONDS,
): { segments: number[]; added: boolean; reason?: 'too-short' | 'no-room' } {
  const kept = [...segments];
  if (!keepsSegment(seconds)) return { segments: kept, added: false, reason: 'too-short' };
  // Measured against the total, so the limit is the finished video's length.
  if (recordedSeconds(kept) + seconds - max > 0.05) {
    return { segments: kept, added: false, reason: 'no-room' };
  }
  return { segments: [...kept, seconds], added: true };
}

/**
 * The segments as spans of the whole budget, for the bar across the top of the
 * camera.
 *
 * One span per clip, in order, each a fraction of the two minutes — so somebody
 * filming can see at a glance how many clips they have and how much of the
 * video is already shot, the way every camera that records in takes does.
 */
export function segmentSpans(
  segments: readonly number[],
  max = MAX_VIDEO_SECONDS,
): { seconds: number; fraction: number }[] {
  const ceiling = max > 0 ? max : 1;
  return segments
    .filter(keepsSegment)
    .map((seconds) => ({ seconds, fraction: Math.min(1, seconds / ceiling) }));
}
