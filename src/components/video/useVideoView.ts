'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { recordVideoViewAction } from '@/app/actions';
import { isLoopRestart, newSessionKey } from '@/lib/video/views';

/** Pauses before each retry of a report that did not reach the server. */
const RETRY_AFTER_MS = [1_500, 4_000];

/** The player's own length when it knows it; a recording can say Infinity. */
const lengthOf = (element: { duration: number }, fallback?: number | null) =>
  Number.isFinite(element.duration) && element.duration > 0 ? element.duration : (fallback ?? null);

/**
 * Counting a view, from the player's side.
 *
 * A view is a playback session, reported the moment playback actually starts
 * (`playing`) — not when a player renders, mounts or loads a thumbnail, and not
 * when autoplay was attempted and refused. One report per session, whatever the
 * player does in between:
 *
 *   a re-render                nothing here runs on render
 *   duplicate events           `reported` is set before anything is sent
 *   pause and play, a stall    the same session, already reported
 *   a report that fails        retried with the SAME session key, which the
 *                              server counts once however often it arrives
 *
 * A new session — and so a new view — starts when the video is watched again:
 * it ended and plays again, it loops round to its start, or the feed scrolled
 * away from it and back (the feed calls `restart`). A fresh mount, which is
 * what opening or refreshing a page is, starts with a fresh session too.
 *
 * The count this returns is always the server's.
 */
export function useVideoView({
  postId,
  enabled,
  duration,
  initialCount,
}: {
  postId: string;
  /** False for anything that is not a video post. Photos have no watch count. */
  enabled: boolean;
  duration?: number | null;
  /** What the server rendered. The starting point, and never overwritten by a guess. */
  initialCount: number;
}) {
  const [count, setCount] = useState(initialCount);

  /** Whether this playback session has been reported. One per session, ever. */
  const reported = useRef(false);
  /** This session's key, made when it is reported. */
  const session = useRef('');
  /** Where the playhead was at the last event, to tell a loop from playback. */
  const lastAt = useRef<number | null>(null);
  /** Unmounted: a retry has nobody to tell. */
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);

  // A fresh server count — a navigation, a revalidation — wins over what this
  // component has been told by its own reports, but never takes it backwards.
  useEffect(() => {
    setCount((current) => (initialCount > current ? initialCount : current));
  }, [initialCount]);

  /** The next playback is a new session, and so a new view. */
  const restart = useCallback(() => {
    reported.current = false;
    session.current = '';
    lastAt.current = null;
  }, []);

  const send = useCallback(
    (key: string, attempt: number) => {
      void recordVideoViewAction(postId, key)
        .then((result) => {
          if (result.ok) {
            if (!gone.current) setCount((current) => Math.max(current, result.count));
            return;
          }
          throw new Error('not counted');
        })
        .catch(() => {
          // The server did not answer, or could not store it. Try again with
          // the same key a couple of times — it counts that key at most once —
          // and then let it go: a view that could not be reported is a number
          // that does not move, and nothing about playback depends on it.
          const wait = RETRY_AFTER_MS[attempt];
          if (wait === undefined || gone.current) return;
          setTimeout(() => {
            if (!gone.current) send(key, attempt + 1);
          }, wait);
        });
    },
    [postId],
  );

  /** Reports this session, once. */
  const report = useCallback(() => {
    if (!enabled || !postId || reported.current) return;
    // Set before anything is sent: a burst of events must not each report.
    reported.current = true;
    session.current = newSessionKey();
    send(session.current, 0);
  }, [enabled, postId, send]);

  /** Playback has actually begun — the moment a view is. */
  const onPlaying = useCallback(() => report(), [report]);

  /** Kept for callers: pressing play is not yet playback, so nothing happens here. */
  const onPlay = useCallback(() => undefined, []);

  const onTimeUpdate = useCallback(
    (event: { currentTarget: { currentTime: number; paused: boolean; duration: number } }) => {
      if (!enabled) return;
      const element = event.currentTarget;
      const at = element.currentTime;
      if (!element.paused) {
        // Looped round to the start: watching it again.
        if (lastAt.current !== null && isLoopRestart(lastAt.current, at, lengthOf(element, duration))) restart();
        // The fallback for a browser that is playing without having said so.
        if (at > 0) report();
      }
      lastAt.current = at;
    },
    [enabled, duration, report, restart],
  );

  const onSeeked = useCallback(
    (event: { currentTarget: { currentTime: number; paused: boolean; duration: number } }) => {
      if (!enabled) return;
      const element = event.currentTarget;
      // A loop is a seek to the start made by the browser; so is replaying
      // from the end. Either is a new viewing.
      if (
        !element.paused &&
        lastAt.current !== null &&
        isLoopRestart(lastAt.current, element.currentTime, lengthOf(element, duration))
      ) {
        restart();
        report();
      }
      lastAt.current = element.currentTime;
    },
    [enabled, duration, report, restart],
  );

  /** Watched to the end: playing it again is watching it again. */
  const onEnded = useCallback(() => restart(), [restart]);

  return { count, onPlay, onPlaying, onTimeUpdate, onEnded, onSeeked, restart };
}
