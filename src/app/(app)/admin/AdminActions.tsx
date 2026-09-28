'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminClearReportsAction,
  adminHoldReviewedAction,
  adminRemoveReviewedAction,
  adminRestoreReviewedAction,
  adminSetTrustAction,
  adminRemoveCommentAction,
  adminRemovePostAction,
  adminResolveReportAction,
  adminRestorePostAction,
  adminSetStatusAction,
} from '@/app/actions';

function useAction() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  return { pending, run };
}

const BUTTON = 'rounded-full border border-white/[0.12] px-3 py-1.5 text-xs font-semibold transition';

export function ReportActions({
  reportId,
  target,
}: {
  reportId: string;
  target:
    | { type: 'post'; id: string; removed: boolean }
    | { type: 'user'; id: string; status: string }
    | { type: 'comment'; id: string }
    | null;
}) {
  const { pending, run } = useAction();
  const [reason, setReason] = useState('Breaks the community rules');

  return (
    <div className="mt-3 space-y-2">
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason / note"
        className="w-full py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {target?.type === 'post' &&
          (target.removed ? (
            <button
              type="button"
              disabled={pending}
              className={`${BUTTON} hover:bg-white/10`}
              onClick={() => run(() => adminRestorePostAction(target.id))}
            >
              Restore post
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              className={`${BUTTON} border-fay/40 text-fay hover:bg-fay/10`}
              onClick={() => run(() => adminRemovePostAction(target.id, reason))}
            >
              Remove post
            </button>
          ))}
        {target?.type === 'comment' && (
          <button
            type="button"
            disabled={pending}
            className={`${BUTTON} border-fay/40 text-fay hover:bg-fay/10`}
            onClick={() => run(() => adminRemoveCommentAction(target.id))}
          >
            Remove comment
          </button>
        )}
        {target?.type === 'user' && (
          <>
            <button
              type="button"
              disabled={pending}
              className={`${BUTTON} border-solar/40 text-solar hover:bg-solar/10`}
              onClick={() => run(() => adminSetStatusAction(target.id, 'suspended', reason))}
            >
              Suspend
            </button>
            <button
              type="button"
              disabled={pending}
              className={`${BUTTON} border-fay/40 text-fay hover:bg-fay/10`}
              onClick={() => run(() => adminSetStatusAction(target.id, 'banned', reason))}
            >
              Ban
            </button>
          </>
        )}
        <button
          type="button"
          disabled={pending}
          className={`${BUTTON} hover:bg-white/10`}
          onClick={() => run(() => adminResolveReportAction(reportId, 'resolved', reason))}
        >
          Mark resolved
        </button>
        <button
          type="button"
          disabled={pending}
          className={`${BUTTON} text-white/50 hover:bg-white/10`}
          onClick={() => run(() => adminResolveReportAction(reportId, 'dismissed', reason))}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function UserActions({
  userId,
  status,
}: {
  userId: string;
  status: 'active' | 'suspended' | 'banned';
}) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      {status !== 'active' && (
        <button
          type="button"
          disabled={pending}
          className={`${BUTTON} border-mint/40 text-mint hover:bg-mint/10`}
          onClick={() => run(() => adminSetStatusAction(userId, 'active', ''))}
        >
          Reinstate
        </button>
      )}
      {status === 'active' && (
        <>
          <button
            type="button"
            disabled={pending}
            className={`${BUTTON} border-solar/40 text-solar hover:bg-solar/10`}
            onClick={() =>
              run(() => adminSetStatusAction(userId, 'suspended', 'Suspended by a moderator'))
            }
          >
            Suspend
          </button>
          <button
            type="button"
            disabled={pending}
            className={`${BUTTON} border-fay/40 text-fay hover:bg-fay/10`}
            onClick={() => run(() => adminSetStatusAction(userId, 'banned', 'Banned by a moderator'))}
          >
            Ban
          </button>
        </>
      )}
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
      {trusted ? 'Revoke rating weight' : 'Restore rating weight'}
    </button>
  );
}

/**
 * The four decisions available on something under automatic review.
 *
 * None of them is available to anybody who is not an administrator, and not
 * because these buttons are hidden: every handler calls a server action that
 * re-checks the role against the database before it touches a row. A user
 * calling the action directly gets the same refusal as a user who never saw
 * the page.
 */
export function ReviewActions({
  postId,
  state,
  window: reviewWindow,
}: {
  postId: string;
  /** Where the review came from, so the copy can say so. */
  state: 'temporary_review' | 'admin_hold';
  /** The window in words, resolved on the server so this cannot disagree with it. */
  window: string;
}) {
  const held = state === 'admin_hold';
  const { pending, run } = useAction();
  const [reason, setReason] = useState('Breaks the community guidelines');
  const [clearFirst, setClearFirst] = useState(true);

  return (
    <div className="mt-4 space-y-2 border-t border-white/[0.08] pt-4">
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason, if you remove it"
        className="w-full py-2 text-sm"
      />
      <label className="flex items-center gap-2 text-xs text-white/50">
        <input
          type="checkbox"
          checked={clearFirst}
          onChange={(event) => setClearFirst(event.target.checked)}
          className="h-4 w-4 accent-fay"
        />
        Clear the reports that triggered this, so restoring does not re-hide it
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={`${BUTTON} border-mint/40 text-mint hover:bg-mint/10`}
          onClick={() =>
            run(async () => {
              if (clearFirst) await adminClearReportsAction('post', postId);
              await adminRestoreReviewedAction(postId);
            })
          }
        >
          Restore now
        </button>
        <button
          type="button"
          disabled={pending}
          className={`${BUTTON} border-fay/40 text-fay hover:bg-fay/10`}
          onClick={() => run(() => adminRemoveReviewedAction(postId, reason))}
        >
          Remove permanently
        </button>
        {!held && (
          <button
            type="button"
            disabled={pending}
            className={`${BUTTON} border-solar/40 text-solar hover:bg-solar/10`}
            onClick={() => run(() => adminHoldReviewedAction(postId))}
          >
            Hold past {reviewWindow}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          className={`${BUTTON} text-white/50 hover:bg-white/10`}
          onClick={() => run(() => adminClearReportsAction('post', postId))}
        >
          Clear reports only
        </button>
      </div>
      <p className="text-[11px] text-white/30">
        {state === 'admin_hold'
          ? 'Held by an administrator. It will not come back on its own.'
          : `Doing nothing is also an option: it comes back by itself when the ${reviewWindow} run out.`}{' '}
        Removing a post does not suspend its author.
      </p>
    </div>
  );
}
