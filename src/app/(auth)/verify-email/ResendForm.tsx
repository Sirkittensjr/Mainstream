'use client';

import { useActionState } from 'react';
import { resendConfirmationAction, type AuthState } from '../actions';

export function ResendForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    resendConfirmationAction,
    {},
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <label className="sr-only" htmlFor="resend-email">
        Email
      </label>
      <input
        id="resend-email"
        name="email"
        type="email"
        required
        defaultValue={email}
        placeholder="you@example.com"
        className="w-full"
      />
      {state.error && <p className="text-sm text-fay-soft">{state.error}</p>}
      {state.notice && <p className="text-sm text-white/70">{state.notice}</p>}
      <button type="submit" disabled={pending} className="btn-quiet w-full py-3">
        {pending ? 'Sending…' : 'Send it again'}
      </button>
    </form>
  );
}
