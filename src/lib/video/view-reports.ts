/**
 * Getting a view to the server, and its total back to every player showing it.
 *
 * In the browser. The rules for WHEN a view happens are in views.ts; this is
 * only the delivery, and the one place a page keeps the totals it has been told.
 *
 * Delivery is a plain `fetch` to /api/v1/posts/<id>/views, not a server action.
 * Next runs server actions one at a time through the router — the same queue
 * as navigations and refreshes — so a view waited behind whatever else the page
 * was doing, and a navigation that started while one was in flight cut it off.
 * A server action is also addressed by an id that a new deployment changes, so
 * a page opened before a deploy could not report anything until it was
 * reloaded. A `keepalive` request to a fixed address has none of those
 * problems: it goes at once, alongside anything else, and it is finished even
 * if the page is navigated away from or closed the moment after playback
 * starts. Nothing waits for it: the video is already playing.
 *
 * Every report is safe to send more than once. It carries its playback
 * session's key, and the server counts a key once — so a report is retried
 * until it gets an answer, kept in localStorage if it still has none, and sent
 * again on the next page, without ever counting twice.
 */

/** What the server answers about one report. */
export interface ViewReply {
  ok: boolean;
  /** The total the database holds, counted or not. */
  count?: number;
  counted?: boolean;
  /** Why it was not counted: the name of the rule, or "unavailable". */
  reason?: string;
}

/**
 * How long to wait before each retry of a report that did not get through.
 *
 * Safe to retry because a report is keyed on its playback session, and the
 * server stores a view and adds it to the total in one step: either the first
 * attempt counted — and a retry is recognised and counts nothing — or it left
 * nothing behind, and the retry counts it.
 */
export const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

/**
 * The newest total the server has told this page for each video.
 *
 * A number only ever moves up here, and it is shared by every player on the
 * page, so a count learned in the feed is not undone by a stale copy of the
 * same post — a page the router kept from before the view, a card rendered
 * from a cache, a card that was unmounted and mounted again — and two players
 * of one video agree.
 *
 * Only totals the database has stored ever go in: what a page was rendered
 * with, and what the server answers a report with, which it reads back after
 * the play is committed. The eye used to show a play the moment it started,
 * ahead of that answer, and take it off again if the answer said it had not
 * been stored. On a server that could not store views — every report answered
 * "unavailable" — that was a 1 that went back to 0 a moment later, on every
 * play. A number that was never stored is never shown now: the eye goes up
 * when the server says the play is in the total, and does not come down.
 */
const confirmed = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

function changed(postId: string): void {
  for (const listener of listeners.get(postId) ?? []) listener();
}

/** The newest total the server has confirmed for this video on this page, or 0. */
export function latestViews(postId: string): number {
  return confirmed.get(postId) ?? 0;
}

/**
 * What the eye should show: the stored total — the newer of what the page was
 * rendered with and what the server has said since.
 */
export function viewsShown(postId: string, rendered: number): number {
  return Math.max(Number.isFinite(rendered) && rendered > 0 ? rendered : 0, confirmed.get(postId) ?? 0);
}

/** Records a total for a video, if it is newer, and tells whoever is showing it. */
export function noteViews(postId: string, count: number): void {
  if (!postId || !Number.isFinite(count) || count < 0) return;
  if (count <= (confirmed.get(postId) ?? -1)) return;
  confirmed.set(postId, count);
  changed(postId);
}

/** Calls `listener` whenever this video's total moves. Returns the unsubscribe. */
export function watchViews(postId: string, listener: () => void): () => void {
  let set = listeners.get(postId);
  if (!set) {
    set = new Set();
    listeners.set(postId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(postId);
  };
}

/** A report that should be tried again: the network, or the server, failed. */
class RetryableReport extends Error {}

/** One attempt. Resolves with the server's answer; throws when worth retrying. */
export async function sendView(postId: string, sessionKey: string): Promise<ViewReply> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/views`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionKey }),
      credentials: 'same-origin',
      cache: 'no-store',
      // Finish even if the page goes away: a glance followed by a tap on a
      // link is still a view.
      keepalive: true,
    });
  } catch (error) {
    throw new RetryableReport(error instanceof Error ? error.message : 'network error');
  }
  if (response.status >= 500 || response.status === 429) {
    throw new RetryableReport(`HTTP ${response.status}`);
  }
  const reply = (await response.json().catch(() => null)) as ViewReply | null;
  if (!reply || typeof reply.ok !== 'boolean') throw new RetryableReport('unreadable answer');
  return reply;
}

let warned = false;
/** Once per page, in the browser console, when views are not being counted. */
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[FayTarra] ${message}`);
}

/* ------------------------------------------------------------------------- */
/* Reports still owed an answer, kept across pages                           */
/* ------------------------------------------------------------------------- */

/** Where reports that never got an answer wait for the next chance to send. */
export const QUEUE_KEY = 'fay:view-reports';
/** A play older than this is not sent any more: a day late is not "promptly". */
export const QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
/** And no more than this many are kept. */
export const QUEUE_LIMIT = 100;

interface Owed {
  /** Post id. */
  p: string;
  /** Playback-session key. */
  k: string;
  /** When it was first sent (ms). */
  t: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Blocked storage (a private window, a sandboxed frame) throws on access.
    return null;
  }
}

function readOwed(): Owed[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(QUEUE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (item): item is Owed =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Owed).p === 'string' &&
        typeof (item as Owed).k === 'string' &&
        typeof (item as Owed).t === 'number' &&
        now - (item as Owed).t < QUEUE_TTL_MS,
    );
  } catch {
    return [];
  }
}

function writeOwed(list: Owed[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (list.length === 0) store.removeItem(QUEUE_KEY);
    else store.setItem(QUEUE_KEY, JSON.stringify(list.slice(-QUEUE_LIMIT)));
  } catch {
    // Full or blocked: the in-page retries still run.
  }
}

function owe(postId: string, sessionKey: string): void {
  const list = readOwed().filter((item) => !(item.p === postId && item.k === sessionKey));
  list.push({ p: postId, k: sessionKey, t: Date.now() });
  writeOwed(list);
}

function settle(postId: string, sessionKey: string): void {
  const list = readOwed();
  const rest = list.filter((item) => !(item.p === postId && item.k === sessionKey));
  if (rest.length !== list.length) writeOwed(rest);
}

/** Reports being sent from this page right now, so a flush does not send them twice at once. */
const sending = new Set<string>();

/**
 * Sends one report, retrying on failure, and passes on the total the server
 * answers with.
 */
function deliver(postId: string, sessionKey: string): void {
  const id = `${postId} ${sessionKey}`;
  if (sending.has(id)) return;
  sending.add(id);
  const finish = () => {
    sending.delete(id);
  };
  const attempt = (retry: number) => {
    sendView(postId, sessionKey)
      .then((reply) => {
        // Answered: counted, recognised as already counted, or refused — any
        // of which is final. It is owed nothing more.
        settle(postId, sessionKey);
        if (typeof reply.count === 'number') noteViews(postId, reply.count);
        finish();
        if (reply.reason === 'unavailable') {
          warnOnce('Video views are not being counted right now: the server has no view storage. See /api/health.');
        }
      })
      .catch((error: unknown) => {
        const delay = RETRY_DELAYS_MS[retry];
        if (delay !== undefined) {
          setTimeout(() => attempt(retry + 1), delay);
          return;
        }
        // Still owed (it stays in localStorage); the next page sends it.
        finish();
        warnOnce(
          `A video view could not be reported yet (${error instanceof Error ? error.message : 'unknown error'}); it will be sent again.`,
        );
      });
  };
  attempt(0);
}

/**
 * Reports one playback session of one video.
 *
 * Sent at once, without waiting for anything, and retried under the same key
 * until it is answered. The eye moves when the answer comes: the total in it
 * is read after the play is stored, so it already includes this play.
 */
export function reportView(postId: string, sessionKey: string): void {
  // One report per playback session: the tracker never sends a key twice, and
  // if anything ever did, it would be sent once.
  if (!postId || !sessionKey || sending.has(`${postId} ${sessionKey}`)) return;
  owe(postId, sessionKey);
  deliver(postId, sessionKey);
}

let lastFlush = 0;
/**
 * Sends whatever an earlier page never got an answer for. Each is counted at
 * most once whatever happened to it before — answered on a page that closed
 * before it could hear, or never sent at all.
 */
export function flushOwedViews(now: number = Date.now()): void {
  if (now - lastFlush < 10_000) return;
  lastFlush = now;
  const list = readOwed();
  writeOwed(list);
  for (const item of list) deliver(item.p, item.k);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Not straight away: the page and its first video come first.
  window.setTimeout(() => flushOwedViews(), 4_000);
  window.addEventListener('online', () => flushOwedViews());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushOwedViews();
  });
}

/** For tests: forget everything this page knows. */
export function resetViewReportsForTests(): void {
  confirmed.clear();
  listeners.clear();
  sending.clear();
  lastFlush = 0;
  warned = false;
}
