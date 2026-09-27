'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { resendConfirmationAction, type AuthState } from '../actions';

/**
 * "Send verification email again".
 *
 * Supabase sends the mail and owns the token; this only asks it to, reports
 * what it actually said, and then refuses to ask again for a moment.
 *
 * The cooldown is here for the person as much as for the server: GoTrue
 * rate-limits repeat sends per address, so a second click a few seconds later
 * does not produce a second email — it produces a refusal. Counting down is
 * the honest version of that.
 */
export function ResendForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    resendConfirmationAction,
    {},
  );

  const [remaining, setRemaining] = useState(0);
  const lastHandled = useRef<number | undefined>(undefined);

  // Starts on a send that actually happened, and restarts if they send again
  // later — `at` changes even when the answer is word for word the same.
  useEffect(() => {
    if (!state.cooldown || state.at === lastHandled.current) return;
    lastHandled.current = state.at;
    setRemaining(state.cooldown);
  }, [state]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setRemaining((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  const holding = remaining > 0;
  const blocked = pending || holding;

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
        aria-invalid={Boolean(state.error)}
        aria-describedby={state.error ? 'resend-error' : state.notice ? 'resend-notice' : undefined}
        className="w-full"
      />

      {state.error && (
        <p id="resend-error" role="alert" className="text-sm text-fay-soft">
          {state.error}
        </p>
      )}
      {state.notice && !state.error && (
        <p id="resend-notice" role="status" className="text-sm text-mint">
          {state.notice}
        </p>
      )}

      <button type="submit" disabled={blocked} className="btn-quiet w-full py-3 disabled:opacity-60">
        {pending
          ? 'Sending…'
          : holding
            ? `Resend available in ${remaining} second${remaining === 1 ? '' : 's'}`
            : 'Send verification email again'}
      </button>

      {/* Announced separately from the button so a screen reader hears the
          countdown without the button's label changing under the focus. */}
      <span aria-live="polite" className="sr-only">
        {holding ? `Resend available in ${remaining} seconds` : ''}
      </span>
    </form>
  );
}
