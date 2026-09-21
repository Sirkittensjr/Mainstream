'use client';

import { useActionState } from 'react';
import { loginAction, type AuthState } from '../actions';

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="identifier">
          Email or username
        </label>
        <input
          id="identifier"
          name="identifier"
          autoComplete="username"
          required
          placeholder="you@example.com"
          className="mt-2 w-full"
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="mt-2 w-full"
        />
      </div>
      {state.error && (
        <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary w-full py-4">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
