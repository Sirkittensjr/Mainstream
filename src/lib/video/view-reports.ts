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
 * starts.
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
 * The newest total this page has been told for each video.
 *
 * A number only ever moves up here, and it is shared by every player on the
 * page, so a count learned in the feed is not undone by a stale copy of the
 * same post — a page the router kept from before the view, a card rendered
 * from a cache — and two players of one video agree.
 */
const latest = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

export function latestViews(postId: string): number {
  return latest.get(postId) ?? 0;
}

/** Records a total for a video, if it is newer, and tells whoever is showing it. */
export function noteViews(postId: string, count: number): void {
  if (!postId || !Number.isFinite(count) || count < 0) return;
  if (count <= (latest.get(postId) ?? -1)) return;
  latest.set(postId, count);
  for (const listener of listeners.get(postId) ?? []) listener();
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

/**
 * Reports one playback session of one video, retrying on failure, and passes
 * on the total the server answers with.
 */
export function reportView(postId: string, sessionKey: string): void {
  const attempt = (retry: number) => {
    sendView(postId, sessionKey)
      .then((reply) => {
        if (typeof reply.count === 'number') noteViews(postId, reply.count);
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
        warnOnce(
          `A video view could not be reported (${error instanceof Error ? error.message : 'unknown error'}).`,
        );
      });
  };
  attempt(0);
}
