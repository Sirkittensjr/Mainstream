'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminApprovePostAction,
  adminDenyPostAction,
  adminDismissReportAction,
  adminKeepUnderReviewAction,
  adminRemoveCommentAction,
  adminRemovePostAction,
  adminResolveReportAction,
  adminSetStatusAction,
  adminSetTrustAction,
  adminWarnUserAction,
} from '@/app/actions';
import { SUSPENSION_DAYS } from '@/lib/moderation-rules';

type Result = { ok: true } | { ok: false; error: string } | void;

/**
 * Runs an admin action and refreshes the page, keeping what went wrong.
 *
 * Every action re-checks on the server that the caller is an administrator;
 * nothing here is the lock. What this adds is saying so when a decision was
 * refused — a reason missing, somebody else got there first — instead of the
 * button appearing to do nothing.
 */
function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result && !result.ok) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  return { pending, run, error };
}

const BUTTON =
  'rounded-full border border-white/[0.12] px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50';
const APPROVE = `${BUTTON} border-mint/40 text-mint hover:bg-mint/10`;
const HOLD = `${BUTTON} border-solar/40 text-solar hover:bg-solar/10`;
const DANGER = `${BUTTON} border-fay/40 text-fay hover:bg-fay/10`;
const QUIET = `${BUTTON} text-white/60 hover:bg-white/10`;

function Problem({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-xs text-fay-soft">
      {error}
    </p>
  );
}

/**
 * The decisions about a post in the queue.
 *
 * The note goes into the moderation log with whichever decision is made; for
 * Remove permanently it is required, and the button asks once more, because
 * that one deletes the files.
 */
export function PostDecisions({
  postId,
  state,
}: {
  postId: string;
  state: 'report_hold' | 'admin_hold' | 'visible';
}) {
  const { pending, run, error } = useAction();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-4 space-y-2 border-t border-white/[0.08] pt-4" data-post-decisions={postId}>
      <label className="block">
        <span className="sr-only">Reason or note for the moderation log</span>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Reason — required to deny or delete, and then shown to the author"
          maxLength={300}
          className="w-full py-2 text-sm"
          data-decision-note
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={APPROVE}
          data-decision="approve"
          onClick={() => run(() => adminApprovePostAction(postId, note))}
        >
          {state === 'visible' ? 'Approve — close reports' : 'Approve and restore'}
        </button>
        {state !== 'admin_hold' && (
          <button
            type="button"
            disabled={pending}
            className={HOLD}
            data-decision="hold"
            onClick={() => run(() => adminKeepUnderReviewAction(postId, note))}
          >
            {state === 'visible' ? 'Hide and keep under review' : 'Keep under review'}
          </button>
        )}
        {state !== 'visible' && (
          <button
            type="button"
            disabled={pending}
            className={DANGER}
            data-decision="deny"
            onClick={() => run(() => adminDenyPostAction(postId, note))}
          >
            Deny — keep removed
          </button>
        )}
        {confirming ? (
          <>
            <button
              type="button"
              disabled={pending}
              className={`${DANGER} bg-fay/10`}
              data-decision="remove-confirm"
              onClick={() => run(() => adminRemovePostAction(postId, note), () => setConfirming(false))}
            >
              Yes, delete permanently
            </button>
            <button type="button" disabled={pending} className={QUIET} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            className={DANGER}
            data-decision="remove"
            onClick={() => setConfirming(true)}
          >
            Delete permanently
          </button>
        )}
      </div>
      {confirming && (
        <p className="text-[11px] text-fay-soft">
          Removes it for good and deletes its files unless something else uses them. The record of
          the post, its reports and this decision are kept. Its author is not suspended.
        </p>
      )}
      <Problem error={error} />
    </div>
  );
}

/** Dismiss one report as unfounded, with an optional note. */
export function DismissReport({ reportId }: { reportId: string }) {
  const { pending, run, error } = useAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!open) {
    return (
      <button
        type="button"
        className={QUIET}
        data-dismiss-report={reportId}
        onClick={() => setOpen(true)}
      >
        Dismiss report
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why it is unfounded (optional)"
          maxLength={300}
          className="min-w-0 flex-1 py-1.5 text-sm"
          data-dismiss-note
        />
        <button
          type="button"
          disabled={pending}
          className={QUIET}
          data-dismiss-confirm={reportId}
          onClick={() => run(() => adminDismissReportAction(reportId, note))}
        >
          Dismiss
        </button>
        <button type="button" className={QUIET} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <Problem error={error} />
    </div>
  );
}

/** Actions on a report about a profile or a comment. */
export function OtherReportActions({
  reportId,
  target,
}: {
  reportId: string;
  target: { type: 'user'; id: string } | { type: 'comment'; id: string } | { type: 'post'; id: string } | null;
}) {
  const { pending, run, error } = useAction();
  const [note, setNote] = useState('');
  return (
    <div className="mt-3 space-y-2">
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note for the log"
        maxLength={300}
        className="w-full py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {target?.type === 'comment' && (
          <button
            type="button"
            disabled={pending}
            className={DANGER}
            onClick={() => run(() => adminRemoveCommentAction(target.id, note))}
          >
            Remove comment
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          className={QUIET}
          onClick={() => run(() => adminResolveReportAction(reportId, 'resolved', note))}
        >
          Mark resolved
        </button>
        <button
          type="button"
          disabled={pending}
          className={QUIET}
          onClick={() => run(() => adminResolveReportAction(reportId, 'dismissed', note))}
        >
          Dismiss
        </button>
      </div>
      <Problem error={error} />
    </div>
  );
}

/**
 * What a moderator can do to an account: warn, suspend for a while or until
 * reinstated, ban, or reverse a suspension or ban.
 *
 * Suspending and banning are not offered for an administrator, and the server
 * refuses them anyway — for that and for the admin's own account.
 */
export function AccountActions({
  userId,
  status,
  isAdmin,
}: {
  userId: string;
  status: 'active' | 'suspended' | 'banned';
  isAdmin: boolean;
}) {
  const { pending, run, error } = useAction();
  const [mode, setMode] = useState<'none' | 'warn' | 'suspend' | 'ban'>('none');
  const [text, setText] = useState('');
  const [days, setDays] = useState<string>('7');
  const close = () => {
    setMode('none');
    setText('');
  };

  return (
    <div className="space-y-2" data-account-actions={userId}>
      <div className="flex flex-wrap gap-2">
        {status !== 'active' && (
          <button
            type="button"
            disabled={pending}
            className={APPROVE}
            data-account="reinstate"
            onClick={() => run(() => adminSetStatusAction(userId, 'active', 'Reinstated by a moderator'))}
          >
            {status === 'banned' ? 'Reverse ban' : 'Reverse suspension'}
          </button>
        )}
        <button type="button" className={QUIET} data-account="warn" onClick={() => setMode('warn')}>
          Warn
        </button>
        {!isAdmin && status !== 'banned' && (
          <button type="button" className={HOLD} data-account="suspend" onClick={() => setMode('suspend')}>
            {status === 'suspended' ? 'Change suspension' : 'Suspend'}
          </button>
        )}
        {!isAdmin && status !== 'banned' && (
          <button type="button" className={DANGER} data-account="ban" onClick={() => setMode('ban')}>
            Ban
          </button>
        )}
      </div>

      {mode !== 'none' && (
        <div className="space-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            maxLength={mode === 'warn' ? 500 : 300}
            placeholder={
              mode === 'warn'
                ? 'The warning they will read'
                : 'The reason — they are shown it'
            }
            className="w-full text-sm"
            data-account-text
          />
          {mode === 'suspend' && (
            <label className="flex items-center gap-2 text-xs text-white/60">
              For
              <select
                value={days}
                onChange={(event) => setDays(event.target.value)}
                className="py-1.5 text-sm"
                data-account-days
              >
                {SUSPENSION_DAYS.map((count) => (
                  <option key={count} value={String(count)}>
                    {count} day{count === 1 ? '' : 's'}
                  </option>
                ))}
                <option value="until">Until reinstated</option>
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className={mode === 'ban' ? DANGER : mode === 'suspend' ? HOLD : QUIET}
              data-account-confirm={mode}
              onClick={() =>
                run(() => {
                  if (mode === 'warn') return adminWarnUserAction(userId, text);
                  if (mode === 'suspend') {
                    return adminSetStatusAction(userId, 'suspended', text, days === 'until' ? null : Number(days));
                  }
                  return adminSetStatusAction(userId, 'banned', text);
                }, close)
              }
            >
              {mode === 'warn' ? 'Send warning' : mode === 'suspend' ? 'Suspend' : 'Ban permanently'}
            </button>
            <button type="button" className={QUIET} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <Problem error={error} />
    </div>
  );
}

export function TrustActions({ userId, trusted }: { userId: string; trusted: boolean }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      disabled={pending}
      className={`${BUTTON} ${
        trusted ? 'border-fay/40 text-fay hover:bg-fay/10' : 'border-mint/40 text-mint hover:bg-mint/10'
      }`}
      onClick={() => run(() => adminSetTrustAction(userId, !trusted))}
    >
      {trusted ? 'Flag for abuse (revoke weight)' : 'Clear abuse flag'}
    </button>
  );
}
