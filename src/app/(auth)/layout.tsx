import Link from 'next/link';
import { Logo } from '@/components/Nav';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/discover" className="btn-quiet px-4 text-sm">
          Explore first
        </Link>
      </header>
      <main className="mx-auto w-full max-w-lg px-5 pb-20">{children}</main>
    </div>
  );
}
