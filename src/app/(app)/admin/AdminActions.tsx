'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminCaptureRanksAction,
  adminFeatureAction,
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

const BUTTON = 'rounded-full border border-white/12 px-3 py-1.5 text-xs font-semibold transition';

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

export function CaptureRanksButton() {
  const { pending, run } = useAction();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      className="btn-ghost px-5 py-2.5 text-sm"
      onClick={() =>
        run(async () => {
          await adminCaptureRanksAction();
          setDone(true);
        })
      }
    >
      {pending ? 'Capturing…' : done ? 'Captured' : "Capture this month's ranks"}
    </button>
  );
}

export function FeatureButton({ postId, featured }: { postId: string; featured: boolean }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      disabled={pending}
      className={`${BUTTON} ${featured ? 'border-solar/40 text-solar' : 'hover:bg-white/10'}`}
      onClick={() => run(() => adminFeatureAction(postId, !featured))}
    >
      {featured ? 'Unfeature' : 'Feature'}
    </button>
  );
}
