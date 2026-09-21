import Link from 'next/link';
import { BellIcon, SearchIcon } from './Icons';
import { Logo } from './Nav';

/**
 * Loading placeholders.
 *
 * Every page here is server-rendered and dynamic, so a navigation used to sit
 * on the old screen with nothing happening until the new one was ready. These
 * are what Next.js shows in the meantime.
 */
/**
 * The mobile top bar, while the page behind it loads.
 *
 * Without this the chrome disappears for as long as the page takes, so search
 * and notifications stop being reachable at exactly the moment somebody is
 * waiting. These links need no knowledge of who is signed in, so they work
 * straight away; only the unread badge waits for the real bar.
 */
export function SkeletonTopBar({ title }: { title?: string }) {
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
        <Link href="/search" aria-label="Search" className="p-2 text-white/60">
          <SearchIcon />
        </Link>
        <Link href="/notifications" aria-label="Notifications" className="p-2 text-white/60">
          <BellIcon />
        </Link>
      </div>
    </header>
  );
}

export function SkeletonCard() {
  return (
    <div className="card animate-pulse p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.06]" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-1/3 rounded bg-white/[0.06]" />
          <div className="h-2.5 w-1/4 rounded bg-white/[0.04]" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full rounded bg-white/[0.05]" />
        <div className="h-3 w-4/5 rounded bg-white/[0.05]" />
      </div>
      <div className="mt-4 h-44 rounded-2xl bg-white/[0.04]" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="card flex animate-pulse items-center gap-3 p-4">
      <div className="h-9 w-9 shrink-0 rounded-full bg-white/[0.06]" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-1/3 rounded bg-white/[0.06]" />
        <div className="h-2.5 w-1/5 rounded bg-white/[0.04]" />
      </div>
      <div className="h-6 w-12 rounded-full bg-white/[0.05]" />
    </div>
  );
}

export function SkeletonFeed({ count = 3, title }: { count?: number; title?: string }) {
  return (
    <>
      <SkeletonTopBar title={title} />
      <div className="mx-auto max-w-2xl space-y-4 px-4 pt-4 lg:pt-8">
        {Array.from({ length: count }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </>
  );
}

export function SkeletonList({ count = 8, title }: { count?: number; title?: string }) {
  return (
    <>
      <SkeletonTopBar title={title} />
      <div className="mx-auto max-w-2xl space-y-2 px-4 pt-4 lg:pt-8">
        {Array.from({ length: count }, (_, index) => (
          <SkeletonRow key={index} />
        ))}
      </div>
    </>
  );
}
