'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { forgotPasswordAction, type AuthState } from '../actions';

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    forgotPasswordAction,
    {},
  );

  // The same answer whether or not that address has an account — the form is
  // replaced outright so nothing on screen differs between the two cases.
  if (state.notice) {
    return (
      <div className="mt-8">
        <p role="status" className="card p-5 text-sm text-white/70">
          {state.notice}
        </p>
        <Link href="/login" className="btn-quiet mt-4 block w-full py-3 text-center">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? 'forgot-error' : undefined}
          className="mt-2 w-full"
        />
      </div>
      {state.error && (
        <p
          id="forgot-error"
          role="alert"
          className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft"
        >
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn-primary w-full py-4 disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send password reset email'}
      </button>
    </form>
  );
}
