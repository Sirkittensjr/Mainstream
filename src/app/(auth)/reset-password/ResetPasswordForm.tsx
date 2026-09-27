'use client';

import { useActionState, useState } from 'react';
import { resetPasswordAction, type AuthState } from '../actions';

/**
 * Choosing the new password.
 *
 * The recovery session this runs inside was created by Supabase from the
 * emailed one-time code — see /auth/callback. Nothing here mints or checks a
 * token, and the password only ever travels in the Server Action body to
 * `supabase.auth.updateUser`.
 */
export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(resetPasswordAction, {});

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);

  // Checked here only to say so early; the server checks it again, and the
  // server's answer is the one that decides.
  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= 8 && password === confirm;

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">
            New password
          </label>
          <button
            type="button"
            onClick={() => setVisible((shown) => !shown)}
            aria-pressed={visible}
            className="text-xs text-white/45 hover:text-fay"
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        </div>
        <input
          id="password"
          name="password"
          type={visible ? 'text' : 'password'}
          minLength={8}
          required
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={tooShort || Boolean(state.error)}
          aria-describedby={tooShort ? 'password-hint' : undefined}
          className="mt-2 w-full"
        />
        {tooShort && (
          <p id="password-hint" className="mt-1.5 text-sm text-fay-soft">
            Use at least 8 characters.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="confirm">
          Confirm new password
        </label>
        <input
          id="confirm"
          name="confirm"
          type={visible ? 'text' : 'password'}
          minLength={8}
          required
          autoComplete="new-password"
          placeholder="Type it again"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? 'confirm-hint' : undefined}
          className="mt-2 w-full"
        />
        {mismatch && (
          <p id="confirm-hint" role="alert" className="mt-1.5 text-sm text-fay-soft">
            Those passwords do not match.
          </p>
        )}
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft"
        >
          {state.error}
        </p>
      )}

      {/* Held shut until both fields agree, and while a save is in flight, so
          a double tap cannot send the change twice. */}
      <button
        type="submit"
        disabled={pending || !ready}
        className="btn-primary w-full py-4 disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Reset password'}
      </button>
    </form>
  );
}
