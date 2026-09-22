'use client';

import { useActionState, useState } from 'react';
import { changeUsernameAction } from '@/app/actions';

interface State {
  ok?: boolean;
  error?: string;
  message?: string;
  username?: string;
}

/**
 * Changing the @username.
 *
 * This edits the existing account — the row's id is the Supabase Auth user id
 * and never moves — so posts, followers, ratings and messages stay attached.
 */
export function UsernameForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState<State | null, FormData>(
    changeUsernameAction,
    null,
  );
  const [value, setValue] = useState(current);
  const settled = state?.username ?? current;

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <div className="relative">
        <label className="sr-only" htmlFor="username">
          Username
        </label>
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
          @
        </span>
        <input
          id="username"
          name="username"
          required
          pattern="[A-Za-z0-9_]{3,20}"
          title="3–20 letters, numbers or underscores"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={Boolean(state?.error)}
          aria-describedby={state?.error ? 'username-change-error' : undefined}
          className={`w-full pl-9 ${state?.error ? 'border-fay/60 focus:border-fay' : ''}`}
        />
      </div>

      {state?.error && (
        <p id="username-change-error" role="alert" className="text-sm text-fay-soft">
          {state.error}
        </p>
      )}
      {state?.message && (
        <p role="status" className="text-sm text-mint">
          {state.message}
        </p>
      )}

      <p className="text-xs text-white/35">
        Your profile lives at faytarra.com/u/{settled}. Changing this does not affect your posts,
        followers or ratings.
      </p>

      <button
        type="submit"
        disabled={pending || value.trim().toLowerCase() === settled}
        className="btn-ghost w-full py-3 text-sm"
      >
        {pending ? 'Saving…' : 'Change username'}
      </button>
    </form>
  );
}
