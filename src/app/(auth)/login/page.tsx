import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './LoginForm';
import { DEMO_LOGIN } from '@/lib/seed/data';
import { supabaseConfigured } from '@/lib/db';
import { authConfigured } from '@/lib/supabase/config';
import { AuthNotConfigured } from '../AuthNotConfigured';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // Sample credentials only mean something once the seeded accounts exist in
  // Supabase Auth, which is what `npm run seed` creates.
  const showDemo = supabaseConfigured() && process.env.FAYTARRA_SHOW_DEMO_LOGIN === '1';

  if (!authConfigured()) {
    return (
      <div className="pt-6">
        <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
          Welcome back.
        </h1>
        <AuthNotConfigured />
      </div>
    );
  }

  return (
    <div className="pt-6">
      <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
        Welcome back.
      </h1>
      <p className="mt-2 text-white/50">Pick up where you left off.</p>

      <LoginForm next={next ?? '/home'} error={error} />

      <p className="mt-6 text-center text-sm text-white/50">
        New here?{' '}
        <Link href="/signup" className="font-semibold text-fay hover:underline">
          Create an account
        </Link>
      </p>

      {showDemo && (
        <div className="card mt-8 p-5 text-sm">
          <p className="label">Demo account</p>
          <p className="mt-2 text-white/60">
            The sample community is loaded. Sign in with{' '}
            <code className="rounded bg-white/10 px-1.5 py-0.5">{DEMO_LOGIN.email}</code> /{' '}
            <code className="rounded bg-white/10 px-1.5 py-0.5">{DEMO_LOGIN.password}</code> to
            explore as an existing creator.
          </p>
        </div>
      )}
    </div>
  );
}
