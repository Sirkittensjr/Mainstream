/**
 * The limits on FayTarra video, in one place.
 *
 * Both sides need these: the editor to stop somebody before they waste time,
 * and the upload route to stop somebody who skipped the editor. The editor's
 * copy is a courtesy; the server's copy is the rule.
 */

/** One uploaded file. Big enough for a phone's 4K clip, small enough to refuse a disc image. */
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

/** Images are not video and have no business being this large. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** The longest finished post. Clips can be combined up to this, never past it. */
export const MAX_VIDEO_SECONDS = 120;

/**
 * Slack on the server's duration check.
 *
 * A WebM written by MediaRecorder carries no duration, so the server reads the
 * last cluster's timestamp instead. That is accurate to about one cluster, and
 * the error runs both ways: a file usually measures slightly SHORT, and an MP4
 * rounding through a timescale can measure slightly long. Refusing a 120.4s
 * file the editor believes is 120s would be a bug rather than a rule, so a
 * couple of seconds of container imprecision is allowed.
 *
 * The effective ceiling is therefore a few seconds past two minutes. That is
 * a deliberate trade: it is nowhere near enough to fit anything a person would
 * notice, and it is the difference between a limit and a trap.
 */
export const DURATION_TOLERANCE_SECONDS = 2.5;

/** The hard server-side ceiling, tolerance included. */
export const MAX_VIDEO_SECONDS_ENFORCED = MAX_VIDEO_SECONDS + DURATION_TOLERANCE_SECONDS;

/** How many clips one post may be built from. */
export const MAX_CLIPS = 12;

/** What the file picker offers, and what the sniffer will accept. */
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/*';

export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** "2:59.4" — for the places where tenths matter, like a trim handle. */
export function formatPreciseSeconds(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${(safe - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}
