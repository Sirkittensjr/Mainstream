import type { Metadata } from 'next';
import Link from 'next/link';
import { SignupForm } from './SignupForm';

export const metadata: Metadata = { title: 'Join FayTarra' };

export default function SignupPage() {
  return (
    <div className="pt-6">
      <p className="chip border-fay/30 bg-fay/10 text-fay-soft">Takes about 90 seconds</p>
      <h1 className="mt-5 font-display text-4xl font-extrabold leading-[0.95] tracking-tight">
        Join FayTarra.
        <br />
        <span className="gradient-text">Everyone gets a say.</span>
      </h1>
      <p className="mt-3 text-white/50">
        You need an email, a username and a password. Everything else can change later.
      </p>

      <SignupForm />

      <p className="mt-6 text-center text-sm text-white/50">
        Already on FayTarra?{' '}
        <Link href="/login" className="font-semibold text-fay hover:underline">
          Sign in
        </Link>
      </p>
      <p className="mt-4 text-center text-xs leading-relaxed text-white/30">
        By joining you agree to the{' '}
        <Link href="/rules" className="underline">
          community rules
        </Link>
        . FayTarra is not intended for people under 13.
      </p>
    </div>
  );
}
