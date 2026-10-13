/**
 * What counts as watching a video.
 *
 * A view is a claim about a person, and almost everything a video player does
 * is not one. A React component rendering is not a view. Scrolling a feed is
 * not a view. Autoplay state changing, a slide mounting and unmounting, a seek,
 * a pause, a tap on the sound button — none of those are somebody watching, and
 * counting any of them is how a number stops meaning anything.
 *
 * So the rule here is deliberately narrow: a view is PLAYBACK BEGINNING —
 * the playhead actually advancing, autoplay included — once per playback
 * session. A new session is a new viewing: played to the end, the loop coming
 * round, rewound to the start, or scrolled away from and back to. Everything
 * in this file is the arithmetic for that, kept pure and shared by both sides —
 * the player decides when to send an event, the server decides whether to
 * count it, and neither trusts a number the other one made up.
 *
 * The count itself is never a client's to report. The browser says "this was
 * watched"; the database says how many times it has been.
 */

/**
 * How far into a video still counts as its start.
 *
 * A jump back to here from further on is somebody watching it again: the loop
 * came round, the feed rewound it, or they dragged it back to the beginning.
 * Half a second rather than zero because a loop lands a frame or two in.
 */
export const START_SECONDS = 0.5;

/**
 * How far a viewing has to have got before a return to the start is a new
 * viewing, rather than a nudge of the scrubber in the first second.
 */
export const REWATCH_AFTER_SECONDS = 1;

/**
 * The least time between two counted views of one video by one person.
 *
 * The playback-session key stops the accidents — the re-renders, the remounts,
 * a timeupdate handler firing twice, a request retried. This only stops two
 * different session keys arriving for the same video at the same instant,
 * which no person can do: starting a video, leaving it and coming back to
 * start it again takes a swipe each way, and the shortest clip loops no
 * faster than its own length. It was two seconds, which was long enough to
 * swallow exactly the views that matter here — a glance, a swipe on, and a
 * swipe straight back. The real ceiling on a client inventing keys is
 * VIEW_HOURLY_LIMIT.
 */
export const VIEW_COOLDOWN_MS = 250;

/**
 * The most views one person can add to one video in an hour.
 *
 * A clip left looping counts every time it comes round, which is what a view
 * count on a looping feed means. This is only the ceiling on that, so a
 * signed-in script cannot loop one video into the thousands.
 */
export const VIEW_HOURLY_LIMIT = 60;
export const VIEW_HOUR_MS = 60 * 60 * 1000;

/** What the player knows about the playback session it is watching. */
export interface PlaybackWatch {
  /** Seconds that have actually elapsed while playing. Not currentTime: a seek
   *  to the end is not watching. */
  playedSeconds: number;
  /** Whether this playback session has already been reported. */
  reported: boolean;
}

/**
 * Whether the player should report a view now.
 *
 * A view is the video BEGINNING to play — autoplay in a feed included — which
 * is measured as the playhead actually advancing while it plays. Not the play()
 * call, which autoplay policy can refuse, and not the element mounting, which
 * a feed does for the clips either side of the one on screen.
 *
 * `reported` is the whole defence against duplicates on the client: one true
 * per playback session, no matter how many times the component renders or how
 * many timeupdate events fire.
 */
export function shouldReportView(watch: PlaybackWatch): boolean {
  if (watch.reported) return false;
  return watch.playedSeconds > 0;
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

/**
 * One player's viewings, as a sequence of media events.
 *
 * The rules for when a viewing starts and when it has been watched, kept out
 * of React so they can be tested as the events a real player fires:
 *
 *   playback begins           the viewing is reported, once — on `playing`,
 *                             or the first timeupdate that moves, whichever
 *                             comes first
 *   pause and play            the same viewing, nothing new
 *   a re-render               nothing here runs on render
 *   a burst of timeupdates    reported once; every one after is ignored
 *   seeking mid-video         the same viewing; the jump is not watched time
 *   played to the end         `ended`: the next play is a new viewing
 *   the loop comes round      back at the start: a new viewing
 *   rewound to the start      the same, whoever rewound it
 *   scrolled away             the feed calls `restart`; coming back is new
 *
 * `timeUpdate` answers true exactly once per viewing — at the moment it should
 * be reported — and `sessionKey` is the key to report it under.
 */
export interface ViewTracker {
  /** The key of the viewing in progress. One per viewing, made on demand. */
  readonly sessionKey: string;
  /** Playback was asked for, or resumed, at this playhead. */
  play(at: number): void;
  /**
   * The browser says playback has actually begun (`playing`). True when this
   * viewing should be reported now — the earliest honest moment a view is.
   * After a stall, or a pause and play, it is the same viewing: false.
   */
  playing(at: number): boolean;
  /** A timeupdate. True when this viewing should be reported now. */
  timeUpdate(at: number, paused: boolean): boolean;
  /** A seek finished at this playhead. */
  seeked(at: number): void;
  /** Played to the end. */
  ended(): void;
  /** Starts a new viewing: the next playback is a new view. */
  restart(): void;
}

export function createViewTracker({
  duration,
  mint = newSessionKey,
}: {
  /** Seconds, if known. A very short clip still loops into new viewings. */
  duration?: number | null;
  mint?: () => string;
} = {}): ViewTracker {
  const length = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0;
  // A clip shorter than these two can still be watched again.
  const start = length ? Math.min(START_SECONDS, length / 4) : START_SECONDS;
  const rewatchAfter = length ? Math.min(REWATCH_AFTER_SECONDS, length / 2) : REWATCH_AFTER_SECONDS;

  let session = '';
  let played = 0;
  let lastAt: number | null = null;
  let furthest = 0;
  let reported = false;

  const restart = () => {
    session = '';
    played = 0;
    lastAt = null;
    furthest = 0;
    reported = false;
  };
  const key = () => (session ||= mint());
  // Back at the start of a viewing that has already been counted and has got
  // somewhere: the loop came round, or it was taken back to be watched again.
  const backToStart = (at: number) => reported && at <= start && furthest >= rewatchAfter;

  return {
    get sessionKey() {
      return key();
    },
    play(at) {
      key();
      lastAt = at;
    },
    playing(at) {
      key();
      lastAt = at;
      if (reported) return false;
      reported = true;
      return true;
    },
    timeUpdate(at, paused) {
      // A loop that wraps without a seek event still lands back at the start.
      if (lastAt != null && at < lastAt && backToStart(at)) restart();
      if (paused) {
        lastAt = at;
        return false;
      }
      key();
      if (lastAt != null) played += playedSince(lastAt, at);
      lastAt = at;
      if (at > furthest) furthest = at;
      if (!shouldReportView({ playedSeconds: played, reported })) return false;
      reported = true;
      return true;
    },
    seeked(at) {
      if (backToStart(at)) restart();
      // Scrubbing is not watching: re-anchor rather than measure the jump.
      lastAt = at;
    },
    ended: restart,
    restart,
  };
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
  /** No such post, it has been removed, or it is hidden while it is reviewed. */
  | 'no-post'
  /** A photo or a text post. There is nothing to play, so there is nothing to count. */
  | 'not-a-video'
  /** Nothing to deduplicate on: no account, and nowhere to keep a browser id. */
  | 'unknown-viewer'
  /** This playback session has already been counted. */
  | 'duplicate-session'
  /** This person counted a view of this video a moment ago. */
  | 'cooldown'
  /** This person has already added the most views to this video an hour allows. */
  | 'hourly-limit';

export interface ViewDecision {
  post: { removed: boolean; hasVideo: boolean; hidden?: boolean } | null;
  /** Account id, or `anon:<browser id>`. Null when neither is known. */
  identity: string | null;
  /** The key this request would be stored under. */
  dedupeKey: string;
  /**
   * Whether a view is already stored under `dedupeKey`, from an exact lookup.
   * `recent` only reaches back so far; this does not.
   */
  sessionCounted?: boolean;
  /** This identity's recent counted views of this post, newest first. */
  recent: readonly { dedupe_key: string; created_at: string }[];
  now?: number;
  cooldownMs?: number;
  hourlyLimit?: number;
}

/**
 * Whether a reported watch counts.
 *
 * Every rule that decides a view lives here, in one pure function, so the ones
 * that matter most can be stated as tests rather than as comments: a photo
 * never gets a video view, one playback session counts once however many
 * times it is reported, and no identity can count twice inside the cooldown
 * however many session keys it invents. Every playback counts, the author's
 * own included.
 */
export function decideView(input: ViewDecision): ViewVerdict {
  const { post, identity, dedupeKey: key, recent } = input;
  const now = input.now ?? Date.now();
  if (!post || post.removed || post.hidden) return 'no-post';
  if (!post.hasVideo) return 'not-a-video';
  if (!identity) return 'unknown-viewer';
  if (input.sessionCounted || recent.some((row) => row.dedupe_key === key)) {
    return 'duplicate-session';
  }
  if (!isFreshView(recent[0]?.created_at ?? null, now, input.cooldownMs)) return 'cooldown';
  const limit = input.hourlyLimit ?? VIEW_HOURLY_LIMIT;
  const lastHour = recent.filter((row) => {
    const at = Date.parse(row.created_at);
    return Number.isFinite(at) && now - at < VIEW_HOUR_MS;
  }).length;
  if (lastHour >= limit) return 'hourly-limit';
  return 'count';
}
