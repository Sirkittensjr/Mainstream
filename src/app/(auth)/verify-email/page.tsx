import type { Metadata } from 'next';
import Link from 'next/link';
import { ResendForm } from './ResendForm';

export const metadata: Metadata = { title: 'Confirm your email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const { email, error } = await searchParams;

  return (
    <div className="pt-6">
      <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
        Check your email.
      </h1>
      <p className="mt-3 text-white/60">
        We sent a confirmation link{email ? ' to ' : ''}
        {email && <span className="font-semibold text-white">{email}</span>}. Open it and your
        account is ready — you will land straight back here signed in.
      </p>

      {/* Set by /auth/callback when a link came back without actually
          confirming the address — better said here, next to the button that
          sends a new one, than swallowed. */}
      {error && (
        <p
          role="alert"
          className="mt-6 rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft"
        >
          {error}
        </p>
      )}

      <div className="card mt-8 p-5 text-sm text-white/60">
        <p className="label">Didn&rsquo;t receive the email?</p>
        <p className="mt-2">
          Give it a minute, then check your spam folder. If it still has not arrived, we can send
          another one.
        </p>
        <ResendForm email={email ?? ''} />
      </div>

      <p className="mt-6 text-center text-sm text-white/50">
        Already confirmed?{' '}
        <Link href="/login" className="font-semibold text-fay hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
