'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { ADMIN_CODE_DIGITS } from '@/lib/services/admin-code';
import {
  sendAdminCodeAction,
  verifyAdminCodeAction,
  type AdminVerifyState,
} from './actions';

/**
 * Ask for a code, then type it in.
 *
 * The code exists only in the admin's inbox and in Supabase. Nothing on this
 * screen has ever held it: the field is write-only from the browser's point of
 * view, and what is typed goes to the server to be checked by Supabase.
 */
export function AdminVerifyForm() {
  const [state, formAction, pending] = useActionState<AdminVerifyState, FormData>(
    verifyAdminCodeAction,
    {},
  );

  const [sendState, setSendState] = useState<AdminVerifyState>({});
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const lastHandled = useRef<number | undefined>(undefined);

  async function send() {
    if (sending || remaining > 0) return;
    setSending(true);
    try {
      setSendState(await sendAdminCodeAction());
    } catch {
      setSendState({ error: 'Could not send the code. Try again in a moment.' });
    } finally {
      setSending(false);
    }
  }

  // Starts the countdown on a send that really happened, and restarts it on a
  // later one even when the answer is word for word the same.
  useEffect(() => {
    if (!sendState.cooldown || sendState.at === lastHandled.current) return;
    lastHandled.current = sendState.at;
    setRemaining(sendState.cooldown);
  }, [sendState]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setRemaining((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  const holding = remaining > 0;
  const message = state.error ?? sendState.error;
  const notice = !message ? sendState.notice : undefined;

  return (
    <div className="mt-6 space-y-4">
      <button
        type="button"
        onClick={send}
        disabled={sending || holding}
        className="btn-primary w-full py-3 disabled:opacity-60"
      >
        {sending
          ? 'Sending…'
          : holding
            ? `Send another in ${remaining} second${remaining === 1 ? '' : 's'}`
            : sendState.notice
              ? 'Send another code'
              : 'Email me a code'}
      </button>

      <form action={formAction} className="space-y-3">
        <label className="label" htmlFor="admin-code">
          {ADMIN_CODE_DIGITS}-digit code
        </label>
        <input
          id="admin-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          // Deliberately a little longer than the code itself. Only a code of
          // exactly the right length ever verifies, but a longer one pasted in
          // reaches the server and is answered with how many digits it should
          // have, instead of being silently cut down and spent as a wrong guess.
          maxLength={ADMIN_CODE_DIGITS + 4}
          required
          placeholder={'0'.repeat(ADMIN_CODE_DIGITS)}
          aria-invalid={Boolean(state.error)}
          aria-describedby={message ? 'admin-code-message' : undefined}
          className="w-full text-center text-2xl tracking-[0.5em]"
        />

        {message && (
          <p id="admin-code-message" role="alert" className="text-sm text-fay-soft">
            {message}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-mint">
            {notice}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn-quiet w-full py-3 disabled:opacity-60">
          {pending ? 'Checking…' : 'Verify and open admin'}
        </button>
      </form>
    </div>
  );
}
