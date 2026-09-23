'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccountMenu } from './AccountMenu';
import {
  BellIcon,
  MailIcon,
  CompassIcon,
  HomeIcon,
  PlusIcon,
  ReelIcon,
  SearchIcon,
  ShieldIcon,
  UserIcon,
} from './Icons';

export interface NavUser {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  unread: number;
  /** Unread direct messages. */
  unreadMessages: number;
}

const PRIMARY = [
  { href: '/home', label: 'Home', icon: HomeIcon },
  { href: '/videos', label: 'Videos', icon: ReelIcon },
  { href: '/create', label: 'Create', icon: PlusIcon },
  { href: '/discover', label: 'Discover', icon: CompassIcon },
  { href: '/notifications', label: 'Alerts', icon: BellIcon },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/home') return pathname === '/home';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Bottom navigation — the primary way around FayTarra on a phone. */
export function BottomNav({ user }: { user: NavUser | null }) {
  const pathname = usePathname();
  const profileHref = user ? `/u/${user.username}` : '/login';
  const profileActive = user ? pathname === profileHref : pathname === '/login';

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.07] bg-ink-950/85 pt-1 backdrop-blur-xl lg:hidden">
      <ul className="mx-auto flex max-w-lg items-end justify-around px-2">
        {PRIMARY.map((item) => {
          const active = isActive(pathname, item.href);
          if (item.href === '/create') {
            return (
              <li key={item.href} className="-mt-5">
                <Link
                  href={user ? '/create' : '/login?next=/create'}
                  aria-label="Create"
                  className="flex h-14 w-14 items-center justify-center rounded-2xl shadow-glow transition active:scale-95"
                  style={{
                    backgroundImage: 'linear-gradient(135deg,#7C5CFF,#FF3D9A 55%,#FFB443)',
                  }}
                >
                  <PlusIcon width={26} height={26} className="text-ink-950" strokeWidth={2.4} />
                </Link>
              </li>
            );
          }
          const href =
            item.href === '/notifications' && !user ? '/login?next=/notifications' : item.href;
          return (
            <li key={item.href}>
              <NavTab href={href} label={item.label} active={active}>
                <span className="relative block">
                  <item.icon />
                  {item.href === '/notifications' && user && user.unread > 0 && (
                    <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-fay ring-2 ring-ink-950" />
                  )}
                </span>
              </NavTab>
            </li>
          );
        })}
        <li>
          <NavTab href={profileHref} label="Profile" active={profileActive}>
            <UserIcon />
          </NavTab>
        </li>
      </ul>
    </nav>
  );
}

function NavTab({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex w-[3.25rem] flex-col items-center gap-1 py-2 text-[10px] font-semibold tracking-wide transition ${
        active ? 'text-white' : 'text-white/40'
      }`}
    >
      <span className={active ? 'text-fay' : ''}>{children}</span>
      {label}
    </Link>
  );
}

/** Desktop sidebar. */
export function Sidebar({ user }: { user: NavUser | null }) {
  const pathname = usePathname();
  const items = [
    { href: '/home', label: 'Home', icon: HomeIcon as typeof HomeIcon },
    { href: '/videos', label: 'Videos', icon: ReelIcon },
    { href: '/discover', label: 'Discover', icon: CompassIcon },
    { href: '/create', label: 'Create', icon: PlusIcon },
    { href: '/search', label: 'Search', icon: SearchIcon },
    { href: '/messages', label: 'Messages', icon: MailIcon },
    { href: '/notifications', label: 'Notifications', icon: BellIcon },
  ];
  if (user?.isAdmin) items.push({ href: '/admin', label: 'Admin', icon: ShieldIcon });

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-white/[0.06] px-4 py-6 lg:flex xl:w-72">
      <Link href="/home" className="mb-8 flex items-center gap-2 px-3">
        <Logo />
      </Link>
      <ul className="space-y-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-medium transition ${
                  active ? 'bg-white/[0.08] text-white' : 'text-white/55 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <span className={active ? 'text-fay' : ''}>
                  <item.icon />
                </span>
                {item.label}
                {item.href === '/notifications' && user && user.unread > 0 && (
                  <span className="ml-auto rounded-full bg-fay px-2 py-0.5 text-[11px] font-bold text-ink-950">
                    {user.unread > 9 ? '9+' : user.unread}
                  </span>
                )}
                {item.href === '/messages' && user && user.unreadMessages > 0 && (
                  <span
                    aria-label={`${user.unreadMessages} unread`}
                    className="ml-auto rounded-full bg-fay px-2 py-0.5 text-[11px] font-bold text-ink-950"
                  >
                    {user.unreadMessages > 9 ? '9+' : user.unreadMessages}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-6">
        <Link href={user ? '/create' : '/login?next=/create'} className="btn-primary w-full">
          <PlusIcon width={18} height={18} strokeWidth={2.4} /> Create
        </Link>
      </div>

      <div className="mt-auto">
        {user ? (
          <AccountMenu user={user} placement="sidebar" />
        ) : (
          <div className="space-y-2 px-1">
            <Link href="/signup" className="btn-primary w-full">
              Join FayTarra
            </Link>
            <Link href="/login" className="btn-ghost w-full">
              Sign in
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Mobile top bar. */
export function TopBar({ user, title }: { user: NavUser | null; title?: string }) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/[0.06] bg-ink-950/80 px-4 py-3 backdrop-blur-xl lg:hidden">
      {title ? (
        <h1 className="font-display text-lg font-bold tracking-tight">{title}</h1>
      ) : (
        <Link href="/home">
          <Logo small />
        </Link>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Link href="/search" aria-label="Search" className="p-2 text-white/60 hover:text-white">
          <SearchIcon />
        </Link>
        {/* Messages is a sidebar item on desktop; on a phone the bottom bar is
            full, so it lives here rather than only inside the account menu. */}
        <Link
          href={user ? '/messages' : '/login?next=/messages'}
          aria-label={
            user && user.unreadMessages > 0
              ? `Messages, ${user.unreadMessages} unread`
              : 'Messages'
          }
          className="relative p-2 text-white/60 hover:text-white"
        >
          <MailIcon />
          {user && user.unreadMessages > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-fay ring-2 ring-ink-950" />
          )}
        </Link>
        <Link
          href={user ? '/notifications' : '/login?next=/notifications'}
          aria-label={user && user.unread > 0 ? `Notifications, ${user.unread} unread` : 'Notifications'}
          className="relative p-2 text-white/60 hover:text-white"
        >
          <BellIcon />
          {user && user.unread > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-fay ring-2 ring-ink-950" />
          )}
        </Link>
        {user ? (
          <span className="ml-1">
            <AccountMenu user={user} placement="topbar" />
          </span>
        ) : (
          <Link href="/signup" className="btn-primary ml-1 px-4 py-2 text-sm">
            Join
          </Link>
        )}
      </div>
    </header>
  );
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark size={small ? 22 : 26} />
      <span
        className={`font-display font-extrabold tracking-tight ${small ? 'text-xl' : 'text-2xl'}`}
      >
        <span className="gradient-text">FayTarra</span>
      </span>
    </span>
  );
}

/** The FayTarra mark: three climbing bars and a spark. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="fay-mark" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#7C5CFF" />
          <stop offset="52%" stopColor="#FF3D9A" />
          <stop offset="100%" stopColor="#FFB443" />
        </linearGradient>
      </defs>
      <g fill="url(#fay-mark)">
        <rect x="6" y="38" width="11" height="18" rx="5.5" />
        <rect x="24" y="26" width="11" height="30" rx="5.5" />
        <rect x="42" y="12" width="11" height="44" rx="5.5" />
      </g>
      <path
        d="M47.5 2 l2.1 4.4 4.4 2.1 -4.4 2.1 -2.1 4.4 -2.1 -4.4 -4.4 -2.1 4.4 -2.1z"
        fill="#FFB443"
      />
    </svg>
  );
}
