'use client';

import { useActionState } from 'react';
import { resetPasswordAction, type AuthState } from '../actions';

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(resetPasswordAction, {});

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <label className="label" htmlFor="password">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={8}
          required
          autoComplete="new-password"
          placeholder="At least 8 characters"
          className="mt-2 w-full"
        />
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Confirm it
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          minLength={8}
          required
          autoComplete="new-password"
          placeholder="Type it again"
          className="mt-2 w-full"
        />
      </div>
      {state.error && (
        <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary w-full py-4">
        {pending ? 'Saving…' : 'Save password'}
      </button>
    </form>
  );
}
