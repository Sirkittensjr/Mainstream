import type { Metadata } from 'next';
import Link from 'next/link';
import { ResendForm } from './ResendForm';

export const metadata: Metadata = { title: 'Confirm your email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

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

      <div className="card mt-8 p-5 text-sm text-white/60">
        <p className="label">Not arrived?</p>
        <p className="mt-2">
          Give it a minute, then check your spam folder. You can also send it again.
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
