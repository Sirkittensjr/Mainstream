import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './LoginForm';
import { DEMO_LOGIN } from '@/lib/seed/data';
import { supabaseConfigured } from '@/lib/db';
import { authConfigured, missingAuthVars } from '@/lib/supabase/config';
import { AuthNotConfigured } from '../AuthNotConfigured';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; reset?: string }>;
}) {
  const { next, error, reset } = await searchParams;
  // Sample credentials only mean something once the seeded accounts exist in
  // Supabase Auth, which is what `npm run seed` creates.
  const showDemo = supabaseConfigured() && process.env.FAYTARRA_SHOW_DEMO_LOGIN === '1';

  if (!authConfigured()) {
    return (
      <div className="pt-6">
        <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
          Welcome back.
        </h1>
        <AuthNotConfigured missing={missingAuthVars()} />
      </div>
    );
  }

  return (
    <div className="pt-6">
      <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
        Welcome back.
      </h1>
      <p className="mt-2 text-white/50">Pick up where you left off.</p>

      {/* Where a finished password reset lands. The reset ends every session,
          so this page — not the reset form — is what survives to say so. */}
      {reset === 'done' && (
        <div
          role="status"
          className="mt-6 rounded-2xl border border-mint/40 bg-mint/10 px-4 py-3 text-sm text-mint"
        >
          <p className="font-semibold">Your password has been updated.</p>
          <p className="mt-1 text-mint/80">
            You have been signed out everywhere. Log in with your new password.
          </p>
        </div>
      )}

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
