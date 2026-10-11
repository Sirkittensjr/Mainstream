'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { Logo } from '@/components/Nav';
import { CloseIcon, MenuIcon, SearchIcon } from '@/components/Icons';

/**
 * Where the landing page's links go. Every one is a page that exists or a
 * section of this one — there is no About page, so About is the section that
 * explains how FayTarra works, and Community is the public feed the hero's
 * "Explore the community" button opens.
 */
export const LANDING_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Discover', href: '/discover' },
  { label: 'About', href: '#about' },
  { label: 'Features', href: '#features' },
  { label: 'Community', href: '/home?tab=recommended' },
] as const;

/** The landing page's own bar: the app's navigation is for people inside it. */
export function LandingNav({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  return (
    <header
      data-landing-nav
      className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/75 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-1.5 px-4 sm:gap-2 sm:px-6">
        <Link href="/" aria-label="FayTarra home" className="shrink-0 rounded-full">
          <Logo />
        </Link>

        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 lg:flex">
          {LANDING_LINKS.map((link) => (
            <NavLink key={link.label} {...link} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Link
            href="/search"
            aria-label="Search FayTarra"
            data-landing-search
            className="hidden h-10 w-10 min-[360px]:grid place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/75 transition hover:bg-white/[0.09] hover:text-white"
          >
            <SearchIcon width={19} height={19} />
          </Link>
          {signedIn ? (
            <Link href="/home" className="btn-primary px-4 py-2 text-sm sm:px-5">
              Open FayTarra
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                data-landing-signin
                className="btn-ghost hidden px-4 py-2 text-sm sm:inline-flex"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                data-landing-join
                className="btn-primary px-4 py-2 text-sm sm:px-5"
              >
                <span className="sm:hidden">Join</span>
                <span className="hidden sm:inline">Join FayTarra</span>
              </Link>
            </>
          )}
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls={menuId}
            data-landing-menu-button
            onClick={() => setOpen((value) => !value)}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/80 transition hover:bg-white/[0.09] lg:hidden"
          >
            {open ? <CloseIcon width={19} height={19} /> : <MenuIcon width={19} height={19} />}
          </button>
        </div>
      </div>

      <div
        id={menuId}
        hidden={!open}
        data-landing-menu
        className="border-t border-white/[0.06] bg-ink-950/95 lg:hidden"
      >
        <nav aria-label="Main" className="mx-auto flex max-w-7xl flex-col px-4 py-3 sm:px-6">
          {LANDING_LINKS.map((link) => (
            <NavLink key={link.label} {...link} large onClick={() => setOpen(false)} />
          ))}
          <Link
            href="/search"
            onClick={() => setOpen(false)}
            className="rounded-full px-4 py-3 text-[15px] font-medium text-white/60 hover:bg-white/[0.06] hover:text-white min-[360px]:hidden"
          >
            Search
          </Link>
          {!signedIn && (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="mt-2 rounded-2xl border border-white/10 px-4 py-3 text-center text-[15px] font-semibold text-white sm:hidden"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

function NavLink({
  label,
  href,
  large = false,
  onClick,
}: {
  label: string;
  href: string;
  large?: boolean;
  onClick?: () => void;
}) {
  // This page is Home; the others are elsewhere or further down it.
  const current = href === '/';
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      data-landing-link={label}
      className={`rounded-full font-medium transition ${
        large ? 'px-4 py-3 text-[15px]' : 'px-3.5 py-2 text-sm'
      } ${
        current
          ? 'bg-white/[0.08] text-white'
          : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      {label}
    </Link>
  );
}
