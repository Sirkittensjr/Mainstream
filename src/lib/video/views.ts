/**
 * What counts as watching a video.
 *
 * A view is a claim about a person, and almost everything a video player does
 * is not one. A React component rendering is not a view. Scrolling a feed is
 * not a view. Autoplay state changing, a slide mounting and unmounting, a seek,
 * a pause, a tap on the sound button — none of those are somebody watching, and
 * counting any of them is how a number stops meaning anything.
 *
 * So the rule here is deliberately narrow: a view is PLAYBACK, measured in
 * seconds that actually elapsed while the video was playing, past a threshold,
 * once per playback session. Everything in this file is the arithmetic for
 * that, kept pure and shared by both sides — the player decides when to send
 * an event, the server decides whether to count it, and neither trusts a
 * number the other one made up.
 *
 * The count itself is never a client's to report. The browser says "this was
 * watched"; the database says how many times it has been.
 */

/** Seconds of real playback before a view is counted. */
export const VIEW_THRESHOLD_SECONDS = 3;

/**
 * The least a view can cost, for a video shorter than the threshold.
 *
 * A two-second clip can never be watched for three, and a video that can never
 * be viewed is worse than a generous threshold.
 */
export const MIN_VIEW_SECONDS = 1;

/**
 * How long after a counted view the same person may count another on the same
 * video.
 *
 * The playback-session key stops the accidents — the re-renders, the remounts,
 * the pause and play. This stops the deliberate: a client is free to mint a
 * fresh session key for every request, so the server needs a limit that does
 * not depend on the client being honest. Half a minute is long enough that no
 * accident survives it and short enough that genuinely watching something
 * twice still counts twice.
 */
export const VIEW_COOLDOWN_MS = 30_000;

/**
 * How much of this video has to play before it has been viewed.
 *
 * Three seconds, or half of a video too short for that. Not a fraction of the
 * length in general: "viewed" should mean the same thing on a ten-second clip
 * as on a two-minute one.
 */
export function viewThreshold(durationSeconds?: number | null): number {
  const duration = typeof durationSeconds === 'number' && durationSeconds > 0 ? durationSeconds : 0;
  if (duration === 0) return VIEW_THRESHOLD_SECONDS;
  return Math.max(MIN_VIEW_SECONDS, Math.min(VIEW_THRESHOLD_SECONDS, duration / 2));
}

/** What the player knows about the playback session it is watching. */
export interface PlaybackWatch {
  /** Seconds that have actually elapsed while playing. Not currentTime: a seek
   *  to the end is not three seconds of watching. */
  playedSeconds: number;
  /** Whether this playback session has already been reported. */
  reported: boolean;
}

/**
 * Whether the player should report a view now.
 *
 * `reported` is the whole defence against duplicates on the client: one true
 * per playback session, no matter how many times the component renders or how
 * many timeupdate events fire.
 */
export function shouldReportView(watch: PlaybackWatch, durationSeconds?: number | null): boolean {
  if (watch.reported) return false;
  return watch.playedSeconds >= viewThreshold(durationSeconds);
}

/**
 * How much playing time to add for a timeupdate.
 *
 * The gap between two timeupdates, ignored when it is implausible: a seek
 * jumps currentTime by minutes without anybody watching them, and a tab that
 * was in the background reports one enormous step. Anything over a second and
 * a half of wall clock between events is treated as not-watching rather than
 * as watched time.
 */
export function playedSince(previous: number, current: number): number {
  const step = current - previous;
  if (!Number.isFinite(step) || step <= 0) return 0;
  return step > 1.5 ? 0 : step;
}

/** Characters a playback-session key may be made of. */
const SESSION_KEY = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Checks a session key sent by a browser.
 *
 * It is an opaque string used for nothing but equality, so the only questions
 * are whether it is the right shape and short enough to store. A key that
 * fails this is dropped rather than rejected: the view then falls back to the
 * cooldown alone, which is the safe way to be wrong.
 */
export function sanitiseSessionKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return SESSION_KEY.test(trimmed) ? trimmed : null;
}

/**
 * The key a view is deduplicated on, server-side.
 *
 * Identity first, so one person reloading a player twenty times in one
 * playback session counts once, and two people watching the same video count
 * twice. The session key is the client's contribution and the only part of
 * this it supplies — which is exactly why the cooldown exists alongside it.
 */
export function dedupeKey(postId: string, identity: string, sessionKey: string | null): string {
  return `${postId}:${identity}:${sessionKey ?? 'no-session'}`;
}

/**
 * Whether enough time has passed since this person's last counted view of this
 * video.
 *
 * No previous view is always fresh. This is what makes the count resistant to
 * a client that invents a new session key per request.
 */
export function isFreshView(
  lastCountedAt: string | number | null | undefined,
  now: number = Date.now(),
  cooldownMs: number = VIEW_COOLDOWN_MS,
): boolean {
  if (lastCountedAt == null) return true;
  const last = typeof lastCountedAt === 'number' ? lastCountedAt : Date.parse(lastCountedAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= cooldownMs;
}

/** A new playback-session key. One per viewing, generated by the player. */
export function newSessionKey(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return `s${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The reasons a reported watch is or is not a view.
 *
 * Named rather than boolean because every one of them is a different decision
 * somebody could disagree with, and a test that asserts "false" tells nobody
 * which rule fired.
 */
export type ViewVerdict =
  | 'count'
  /** No such post, or it has been removed. */
  | 'no-post'
  /** A photo or a text post. There is nothing to play, so there is nothing to count. */
  | 'not-a-video'
  /** The author watching their own video back. */
  | 'own-video'
  /** Nothing to deduplicate on: no account, and nowhere to keep a browser id. */
  | 'unknown-viewer'
  /** This playback session has already been counted. */
  | 'duplicate-session'
  /** This person counted a view of this video a moment ago. */
  | 'cooldown';

export interface ViewDecision {
  post: { authorId: string; removed: boolean; hasVideo: boolean } | null;
  viewerId: string | null;
  /** Account id, or `anon:<browser id>`. Null when neither is known. */
  identity: string | null;
  /** The key this request would be stored under. */
  dedupeKey: string;
  /** This identity's recent counted views of this post, newest first. */
  recent: readonly { dedupe_key: string; created_at: string }[];
  now?: number;
  cooldownMs?: number;
}

/**
 * Whether a reported watch counts.
 *
 * Every rule that decides a view lives here, in one pure function, so the ones
 * that matter most can be stated as tests rather than as comments: a photo
 * never gets a video view, an author is not their own audience, one playback
 * session counts once however many times it is reported, and no identity can
 * count twice inside the cooldown however many session keys it invents.
 */
export function decideView(input: ViewDecision): ViewVerdict {
  const { post, viewerId, identity, dedupeKey: key, recent } = input;
  if (!post || post.removed) return 'no-post';
  if (!post.hasVideo) return 'not-a-video';
  if (viewerId && post.authorId === viewerId) return 'own-video';
  if (!identity) return 'unknown-viewer';
  if (recent.some((row) => row.dedupe_key === key)) return 'duplicate-session';
  if (!isFreshView(recent[0]?.created_at ?? null, input.now ?? Date.now(), input.cooldownMs)) {
    return 'cooldown';
  }
  return 'count';
}
