'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Marks a section's unread items read because it was opened.
 *
 * Deliberately a client component rather than a call in the page's own render.
 * A Server Component renders whenever Next decides to — including when the
 * navigation link to it is merely PREFETCHED on hover — so marking read from
 * render would quietly clear the badge for somebody who only pointed at the
 * tab. Mounting happens once, in the browser, and only when the page is
 * actually on screen.
 *
 * Three cheap rules, all of them things the badge gets wrong otherwise:
 *
 *   - nothing unread, nothing sent. Opening an inbox that is already clear
 *     costs no request at all.
 *   - `fired` survives re-renders, so a route refresh cannot send it twice;
 *     and because React 18 mounts effects twice in development, without it
 *     every open would fire a pair.
 *   - the refresh afterwards is what makes the badge vanish without a manual
 *     reload: the count is server-rendered in the app layout, so the layout
 *     has to be asked again.
 *
 * Renders nothing.
 */
export function MarkReadOnOpen({
  unread,
  action,
}: {
  /** How many unread items the server just rendered. Zero means do nothing. */
  unread: number;
  /** The server action that marks this section read. */
  action: () => Promise<void>;
}) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (unread <= 0 || fired.current) return;
    fired.current = true;

    let cancelled = false;
    void (async () => {
      try {
        await action();
        if (!cancelled) router.refresh();
      } catch {
        // Offline, or the tab went away mid-request. The items stay unread,
        // which is the safe way to be wrong — the next open tries again.
        fired.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unread, action, router]);

  return null;
}
