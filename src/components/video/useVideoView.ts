'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { recordVideoViewAction } from '@/app/actions';
import { newSessionKey, playedSince, shouldReportView } from '@/lib/video/views';

/**
 * Counting a watch, from the player's side.
 *
 * Deliberately not "this component rendered". The hook watches one thing — how
 * many seconds have actually elapsed while the video was playing — and reports
 * once, when that passes the threshold. Everything else a player does is
 * ignored by construction:
 *
 *   a re-render               nothing here runs on render
 *   mounting and unmounting   `reported` is per playback session, and a
 *                             remounted player plays from zero again
 *   scrolling a feed          a paused video accrues no played time
 *   autoplay being refused    no playback, no view
 *   seeking                   a jump in currentTime is not watched time; see
 *                             playedSince
 *   pause and play            the same session, already reported
 *
 * A video watched to the end and played again IS a second view, so the session
 * key is renewed on `ended`. The server still has the final say on whether that
 * counts, and the count this returns is always the server's.
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

  /** Seconds actually played in this viewing. */
  const played = useRef(0);
  /** Where the playhead was at the last timeupdate, to measure the step. */
  const lastAt = useRef<number | null>(null);
  /** Whether this viewing has already been reported. One per session, ever. */
  const reported = useRef(false);
  const session = useRef<string>('');
  const sending = useRef(false);

  // A fresh server count — a navigation, a revalidation — wins over what this
  // component has been told by its own reports.
  useEffect(() => {
    setCount((current) => (initialCount > current ? initialCount : current));
  }, [initialCount]);

  /** Starts a new viewing. The next threshold crossing is a new view. */
  const restart = useCallback(() => {
    played.current = 0;
    lastAt.current = null;
    reported.current = false;
    session.current = newSessionKey();
  }, []);

  const report = useCallback(() => {
    if (reported.current || sending.current) return;
    // Set before the await: a burst of timeupdates must not each start a
    // request, and this is the client half of "once per playback session".
    reported.current = true;
    sending.current = true;
    if (!session.current) session.current = newSessionKey();
    void recordVideoViewAction(postId, session.current)
      .then((result) => {
        if (result.ok) setCount(result.count);
      })
      .catch(() => {
        // A view that could not be reported is a number that does not move.
        // Nothing about playback depends on it.
      })
      .finally(() => {
        sending.current = false;
      });
  }, [postId]);

  const onPlay = useCallback(() => {
    if (!session.current) session.current = newSessionKey();
    // The playhead is wherever play resumed from; the step is measured from
    // here rather than from wherever it was before the pause or the seek.
    lastAt.current = null;
  }, []);

  const onTimeUpdate = useCallback(
    (event: { currentTarget: { currentTime: number; paused: boolean } }) => {
      if (!enabled) return;
      const element = event.currentTarget;
      const at = element.currentTime;
      if (element.paused) {
        lastAt.current = at;
        return;
      }
      if (lastAt.current != null) played.current += playedSince(lastAt.current, at);
      lastAt.current = at;
      if (shouldReportView({ playedSeconds: played.current, reported: reported.current }, duration)) {
        report();
      }
    },
    [enabled, duration, report],
  );

  /** Watched to the end: playing it again is watching it again. */
  const onEnded = useCallback(() => restart(), [restart]);

  const onSeeked = useCallback((event: { currentTarget: { currentTime: number } }) => {
    // Scrubbing is not watching. The step across the scrub is dropped by
    // re-anchoring rather than by trying to measure it.
    lastAt.current = event.currentTarget.currentTime;
  }, []);

  return { count, onPlay, onTimeUpdate, onEnded, onSeeked, restart };
}
