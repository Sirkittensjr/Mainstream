import Link from 'next/link';
import { Logo } from '@/components/Nav';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo />
      <h1 className="mt-8 font-display text-5xl font-extrabold tracking-tight">Nothing here.</h1>
      <p className="mt-3 max-w-sm text-white/50">
        This page does not exist — or the post was removed. Plenty of people still to find though.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/home" className="btn-primary">
          Go to feed
        </Link>
        <Link href="/discover" className="btn-ghost">
          Discover
        </Link>
      </div>
    </div>
  );
}
