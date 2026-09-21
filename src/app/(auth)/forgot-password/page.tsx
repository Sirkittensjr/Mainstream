import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <div className="pt-6">
      <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
        Forgot your password?
      </h1>
      <p className="mt-2 text-white/50">
        Tell us your email and we will send a link to set a new one.
      </p>

      <ForgotPasswordForm />

      <p className="mt-6 text-center text-sm text-white/50">
        Remembered it?{' '}
        <Link href="/login" className="font-semibold text-fay hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
