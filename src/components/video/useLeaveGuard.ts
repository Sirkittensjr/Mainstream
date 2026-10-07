'use client';

import { useEffect } from 'react';

/**
 * Asks before leaving a page that holds work nothing else has saved.
 *
 * A video project lives in memory — the clips are recordings in this tab and
 * nowhere else — so leaving the page loses all of it. Two ways out are covered:
 *
 *   - closing or reloading the tab: the browser's own "Leave site?" prompt.
 *     Desktop and Android show it. iOS Safari does not, whatever a page asks,
 *     which is why the second one matters more on an iPhone;
 *   - tapping a link inside FayTarra — the navigation bar on the posting
 *     screen, a profile link — which never unloads the page, so the browser
 *     would not ask. A plain confirm, because it has to be answered before the
 *     navigation either happens or does not.
 *
 * Off whenever `active` is false, so finishing a post, or never starting one,
 * leaves navigation alone.
 */
export function useLeaveGuard(active: boolean, message: string) {
  useEffect(() => {
    if (!active) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a value to show the prompt at all.
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== '_self') return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      // A link to where we already are, or to a fragment of it, loses nothing.
      if (to.pathname === window.location.pathname && to.search === window.location.search) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    // Capture, so this runs before Next's own link handler navigates.
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active, message]);
}
