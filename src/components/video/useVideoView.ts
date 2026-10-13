'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { recordVideoViewAction } from '@/app/actions';
import { createViewTracker, type ViewTracker } from '@/lib/video/views';

/**
 * How long to wait before each retry of a report that did not get through.
 *
 * Safe to retry because a report is keyed on its playback session: the server
 * stores one view per session key, so a retry of a report that did land the
 * first time is recognised and counts nothing.
 */
const RETRY_DELAYS_MS = [1_000, 4_000];

/**
 * Counting a watch, from the player's side.
 *
 * Deliberately not "this component rendered". Every rule about when a viewing
 * starts and when it is reported lives in `createViewTracker`
 * (lib/video/views.ts), which is fed the player's own media events and answers
 * "report now" once per viewing:
 *
 *   playback begins           reported — autoplay included
 *   a re-render               nothing here runs on render
 *   pause and play            the same viewing, already reported
 *   seeking mid-video         the same viewing
 *   played to the end         `ended`: the next play is a new view
 *   the loop comes round      a new view
 *   rewound to the start      a new view
 *   scrolled away and back    the feed calls `restart`; a new view
 *   autoplay being refused    no playback, no view
 *
 * The server still has the final say on whether a report counts, and the count
 * this returns is always the server's.
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
  /** The newest total the server has answered a report with. */
  const [reportedCount, setReportedCount] = useState(0);
  // Whichever is newer: what the page was rendered with — a navigation or a
  // refresh brings a fresh one — or what this player's own reports returned.
  const count = Math.max(initialCount, reportedCount);

  const tracker = useRef<ViewTracker | null>(null);
  tracker.current ??= createViewTracker({ duration });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const report = useCallback(
    (sessionKey: string) => {
      if (!enabled || !postId) return;
      const attempt = (retry: number) => {
        void recordVideoViewAction(postId, sessionKey)
          .then((result) => {
            if (result.ok) {
              if (live.current) setReportedCount((current) => Math.max(current, result.count));
              return;
            }
            throw new Error('not recorded');
          })
          .catch(() => {
            // A view that could not be reported is a number that does not move,
            // not a video that fails to play. Try again a couple of times under
            // the same session key, which the server will not count twice.
            const delay = RETRY_DELAYS_MS[retry];
            if (delay !== undefined) setTimeout(() => attempt(retry + 1), delay);
          });
      };
      attempt(0);
    },
    [enabled, postId],
  );

  const onPlay = useCallback((event: { currentTarget: { currentTime: number } }) => {
    tracker.current?.play(event.currentTarget.currentTime);
  }, []);

  const onTimeUpdate = useCallback(
    (event: { currentTarget: { currentTime: number; paused: boolean } }) => {
      if (!enabled) return;
      const watch = tracker.current;
      const element = event.currentTarget;
      if (watch?.timeUpdate(element.currentTime, element.paused)) report(watch.sessionKey);
    },
    [enabled, report],
  );

  /** Watched to the end: playing it again is watching it again. */
  const onEnded = useCallback(() => tracker.current?.ended(), []);

  const onSeeked = useCallback((event: { currentTarget: { currentTime: number } }) => {
    tracker.current?.seeked(event.currentTarget.currentTime);
  }, []);

  /** Starts a new viewing. Called when a feed moves off this video. */
  const restart = useCallback(() => tracker.current?.restart(), []);

  return { count, onPlay, onTimeUpdate, onEnded, onSeeked, restart };
}
