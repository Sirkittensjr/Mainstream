'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { createViewTracker, type ViewTracker } from '@/lib/video/views';
import { latestViews, noteViews, reportView, watchViews } from '@/lib/video/view-reports';

/**
 * Counting a watch, from the player's side.
 *
 * Deliberately not "this component rendered". Every rule about when a viewing
 * starts and when it is reported lives in `createViewTracker`
 * (lib/video/views.ts), which is fed the player's own media events and answers
 * "report now" once per viewing:
 *
 *   playback begins           reported — on `playing`, or the first timeupdate
 *                             that moves — autoplay included
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
 * this returns is always the server's: what the page was rendered with, or a
 * total the server has answered since (see lib/video/view-reports.ts).
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
  // Whichever is newer: what the page was rendered with — a navigation or a
  // refresh brings a fresh one — or the newest total any player on this page
  // has been told for this video. A stale render can never pull it back down.
  const known = useSyncExternalStore(
    useCallback((listener: () => void) => watchViews(postId, listener), [postId]),
    () => latestViews(postId),
    () => 0,
  );
  useEffect(() => {
    if (enabled) noteViews(postId, initialCount);
  }, [enabled, postId, initialCount]);
  const count = Math.max(initialCount, known);

  const tracker = useRef<ViewTracker | null>(null);
  tracker.current ??= createViewTracker({ duration });

  const report = useCallback(
    (sessionKey: string) => {
      if (!enabled || !postId) return;
      // Sent at once, retried under the same key until it gets through, and
      // the answer goes to every player of this video, mounted or not.
      reportView(postId, sessionKey);
    },
    [enabled, postId],
  );

  const onPlay = useCallback((event: { currentTarget: { currentTime: number } }) => {
    tracker.current?.play(event.currentTarget.currentTime);
  }, []);

  /** Playback has actually begun: the moment a view is. */
  const onPlaying = useCallback(
    (event: { currentTarget: { currentTime: number } }) => {
      if (!enabled) return;
      const watch = tracker.current;
      if (watch?.playing(event.currentTarget.currentTime)) report(watch.sessionKey);
    },
    [enabled, report],
  );

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

  return { count, onPlay, onPlaying, onTimeUpdate, onEnded, onSeeked, restart };
}
