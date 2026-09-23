'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { logoutAction } from '@/app/actions';
import { formatUnread } from '@/lib/format';
import type { NavUser } from './Nav';

/**
 * The signed-in account menu: profile, settings, log out.
 *
 * Log out is a real form posting to a server action, not an onClick handler.
 * That means the sign-out is performed by Supabase on the server — the session
 * cookies are cleared and the refresh token is revoked there — and it still
 * works if JavaScript has not loaded. A client-only "log out" that just forgot
 * the user locally would leave a live session behind.
 */
export function AccountMenu({
  user,
  placement,
}: {
  user: NavUser;
  /** 'sidebar' opens upward from the bottom of the desktop rail; 'topbar' downward on a phone. */
  placement: 'sidebar' | 'topbar';
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const initials = user.displayName.slice(0, 2).toUpperCase();

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className={
          placement === 'sidebar'
            ? 'flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-white/[0.04]'
            : 'flex items-center rounded-full p-0.5 transition hover:bg-white/[0.06]'
        }
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            className={`shrink-0 rounded-full object-cover ${
              placement === 'sidebar' ? 'h-10 w-10' : 'h-8 w-8'
            }`}
          />
        ) : (
          <span
            aria-hidden
            className={`flex shrink-0 items-center justify-center rounded-full font-display font-bold text-ink-950 ${
              placement === 'sidebar' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs'
            }`}
            style={{ backgroundImage: 'linear-gradient(135deg,#FF3D9A,#FFB443)' }}
          >
            {initials}
          </span>
        )}
        {placement === 'sidebar' && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{user.displayName}</span>
            <span className="block truncate text-xs text-white/40">@{user.username}</span>
          </span>
        )}
        {placement === 'sidebar' && (
          <span aria-hidden className="shrink-0 text-white/30">
            ⋯
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-50 w-56 overflow-hidden rounded-2xl border border-white/10 bg-ink-850 py-1 shadow-xl ${
            placement === 'sidebar' ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2'
          }`}
        >
          <div className="border-b border-white/[0.06] px-4 py-3">
            <p className="truncate text-sm font-semibold">{user.displayName}</p>
            <p className="truncate text-xs text-white/40">@{user.username}</p>
          </div>

          <Link
            href={`/u/${user.username}`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            View profile
          </Link>
          <Link
            href="/messages"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            Messages
            {user.unreadMessages > 0 && (
              <span className="rounded-full bg-fay px-2 py-0.5 text-[11px] font-bold text-ink-950">
                {formatUnread(user.unreadMessages)}
              </span>
            )}
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            Settings
          </Link>
          {user.isAdmin && (
            <Link
              href="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              Admin
            </Link>
          )}

          <form action={logoutAction} className="border-t border-white/[0.06]">
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-4 py-2.5 text-left text-sm font-semibold text-fay transition hover:bg-fay/10"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
