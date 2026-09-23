'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** How often a tab in the foreground asks whether the badges are still right. */
const POLL_MS = 20_000;

/**
 * Keeps the unread badges honest between navigations.
 *
 * The counts are rendered on the server with everything else, which is right —
 * one source of truth, no client-side copy of the inbox to drift. But a
 * message that arrives while somebody is reading a post would otherwise go
 * unannounced until their next click. This asks for the two numbers, and when
 * they disagree with what is on screen it refreshes the route so the server
 * re-renders the navigation. Nothing is stored here and nothing is drawn: the
 * badge still comes from the same place it always did.
 *
 * It stops while the tab is in the background, which is where a tab spends
 * most of its life.
 */
export function UnreadWatch({ messages, notifications }: { messages: number; notifications: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer = 0;
    let stopped = false;

    const tick = async () => {
      if (!stopped && document.visibilityState === 'visible') {
        try {
          const response = await fetch('/api/unread', { cache: 'no-store' });
          if (response.ok) {
            const counts = (await response.json()) as { messages: number; notifications: number };
            if (counts.messages !== messages || counts.notifications !== notifications) {
              router.refresh();
            }
          }
        } catch {
          // Offline, or the tab is being torn down. Try again next time.
        }
      }
      if (!stopped) timer = window.setTimeout(tick, POLL_MS);
    };

    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [messages, notifications, router]);

  return null;
}
