'use client';

import { useActionState } from 'react';
import { forgotPasswordAction, type AuthState } from '../actions';

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    forgotPasswordAction,
    {},
  );

  if (state.notice) {
    return (
      <p className="card mt-8 p-5 text-sm text-white/70">{state.notice}</p>
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
          className="mt-2 w-full"
        />
      </div>
      {state.error && (
        <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary w-full py-4">
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}
