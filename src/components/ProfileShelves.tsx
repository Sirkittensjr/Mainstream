'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { profileTabFrom, type ProfileTab } from '@/lib/profile-shelves';

/**
 * The profile's tab bar and whichever shelf it has open.
 *
 * Every shelf arrives already rendered on the server — the first page of each,
 * with its own "Show more" — so switching is only a matter of which one is shown.
 * Nothing is fetched, the header is never re-rendered, and the page does not
 * move.
 *
 * The tabs are still real anchors to `?tab=…`, so a new tab, a copied link and a
 * page without JavaScript all work as they always did. A plain click is taken
 * over and the address changed with `history.pushState`, which the App Router
 * picks up: `useSearchParams` follows it, and Back and Forward restore it
 * without asking the server for anything. This replaces the full page load the
 * tabs used to do — which was there because a `<Link>` navigation that only
 * changed a search param on this `force-dynamic` page was sometimes swallowed.
 * No navigation happens here at all, so there is nothing to swallow.
 */
export function ProfileShelves({
  tabs,
  panels,
}: {
  tabs: { tab: ProfileTab; href: string; count: number | null }[];
  panels: Record<ProfileTab, React.ReactNode>;
}) {
  const tab = profileTabFrom(useSearchParams().get('tab'));
  const nav = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Where the tab bar sat on the screen when the shelf was changed — never
  // above the top of it: from further down a list, the new shelf opens at its
  // start, with the bar along the top of the screen.
  const pinned = useRef<number | null>(null);
  // Once the shelf has been changed in the page, the cards of the next one are
  // simply there: their fade-up is an arrival for a page that is loading, and
  // on a tab that is already loaded it would only read as a flash.
  const [switched, setSwitched] = useState(false);
  const current = useRef(tab);
  useEffect(() => {
    current.current = tab;
  }, [tab]);

  // Back and Forward change the shelf too, and are held to the same rule.
  useEffect(() => {
    const onPop = () => {
      const next = profileTabFrom(new URLSearchParams(window.location.search).get('tab'));
      if (next === current.current) return;
      pinned.current = barTop(nav.current);
      setSwitched(true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Keep the tab bar exactly where it was. A shorter shelf would otherwise make
  // the page shorter than the place it was scrolled to, and the browser would
  // pull everything down to fit. Holding the content open just far enough for
  // the bar to stay put is the smallest thing that stops it; it is only ever
  // set after the shelf changes, so a page loaded fresh is laid out as it was.
  useLayoutEffect(() => {
    const top = pinned.current;
    pinned.current = null;
    if (top === null || !nav.current || !content.current) return;
    const box = content.current;
    box.style.minHeight = '';
    const gap = box.getBoundingClientRect().top - nav.current.getBoundingClientRect().top;
    const below = window.innerHeight - top - gap;
    if (box.getBoundingClientRect().height < below) box.style.minHeight = `${Math.ceil(below)}px`;
    const drift = nav.current.getBoundingClientRect().top - top;
    if (Math.abs(drift) >= 1) window.scrollBy(0, drift);
  }, [tab]);

  function open(event: React.MouseEvent<HTMLAnchorElement>, next: string, href: string) {
    // Let the browser have anything that is not a plain click: a new tab, a new
    // window, a download.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (next === tab) return;
    pinned.current = barTop(nav.current);
    setSwitched(true);
    window.history.pushState(null, '', href);
  }

  return (
    <>
      {/* Scrollable, because four chips and a count each do not fit across a
          small phone — and cutting one off the end would hide a whole shelf. */}
      <nav
        ref={nav}
        className="profile-tabs -mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:gap-1.5 lg:rounded-2xl lg:border lg:border-white/[0.08] lg:bg-ink-950/60 lg:p-1.5 lg:backdrop-blur-xl [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((entry) => (
          <a
            key={entry.tab}
            href={entry.href}
            onClick={(event) => open(event, entry.tab, entry.href)}
            data-profile-tab={entry.tab}
            aria-current={tab === entry.tab ? 'page' : undefined}
            // A `chip`'s own padding makes a 34px-tall pill, which is fine
            // for a filter and too small for the navigation these four are:
            // the shelves are how somebody gets at their own videos, photos
            // and writing, so they are given a thumb-sized target.
            className={`chip min-h-[44px] shrink-0 px-4 text-sm capitalize lg:min-h-[48px] lg:flex-1 lg:justify-center lg:rounded-xl lg:text-[15px] lg:font-semibold ${tab === entry.tab ? 'chip-active' : 'hover:bg-white/10'}`}
          >
            {entry.tab}
            {entry.count !== null && entry.count > 0 && (
              <span className="tabular-nums opacity-60">{entry.count}</span>
            )}
          </a>
        ))}
      </nav>

      {/* Only the open shelf is in the page — the others are not hidden copies.
          Keyed by tab, so a post on two shelves is drawn fresh on each rather
          than carrying one shelf's state onto the other. */}
      <div
        ref={content}
        className={`mt-4 space-y-4 pb-10 ${switched ? '[&_.animate-fade-up]:animate-none' : ''}`}
        data-profile-shelf={tab}
      >
        <Fragment key={tab}>{panels[tab]}</Fragment>
      </div>
    </>
  );
}

function barTop(bar: HTMLElement | null): number | null {
  return bar ? Math.max(bar.getBoundingClientRect().top, 0) : null;
}
