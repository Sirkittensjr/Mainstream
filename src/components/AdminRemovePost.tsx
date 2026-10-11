'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adminHidePostAction } from '@/app/actions';
import { ShieldIcon } from './Icons';
import { Portal } from './Portal';

/**
 * "Remove from public viewing" in a post's ••• menu — administrators only.
 *
 * Asks first, and will not go ahead without a reason (the author is shown it).
 * The post is held for review, not deleted: it disappears from every public
 * surface at once, and the moderation queue can restore it. Drawn only for an
 * admin, but the server action is the lock: it re-checks the role and the
 * admin's second step whoever calls it.
 */
export function AdminRemovePost({
  postId,
  onRemoved,
  onCancel,
}: {
  postId: string;
  onRemoved?: () => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  const cancel = useCallback(() => {
    setOpen(false);
    onCancelRef.current?.();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pending, cancel]);

  function confirm() {
    setError(null);
    if (!reason.trim()) {
      setError('Give a reason. The author is shown it.');
      return;
    }
    startTransition(async () => {
      const result = await adminHidePostAction(postId, reason);
      if (!result?.ok) {
        setError(result?.error ?? 'Could not remove that post. Try again.');
        return;
      }
      setOpen(false);
      onRemoved?.();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        data-admin-remove-post
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-solar hover:bg-white/5"
      >
        <ShieldIcon width={16} height={16} />
        Remove from public viewing
      </button>

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
            onClick={() => {
              if (!pending) cancel();
            }}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`admin-remove-${postId}`}
              data-admin-remove-confirm
              onClick={(event) => event.stopPropagation()}
              className="card w-full max-w-sm animate-fade-up rounded-b-none p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-3xl sm:pb-6"
            >
              <h2 id={`admin-remove-${postId}`} className="font-display text-xl font-bold">
                Remove from public viewing?
              </h2>
              <p className="mt-1 text-sm text-white/55">
                It is hidden everywhere at once and kept for review — nothing is deleted. The author
                is told, with your reason. You can restore it from the moderation queue.
              </p>
              <label className="mt-4 block">
                <span className="label">Reason (shown to the author)</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  maxLength={300}
                  autoFocus
                  data-admin-remove-reason
                  className="mt-2 w-full text-sm"
                />
              </label>
              {error && (
                <p className="mt-3 rounded-2xl border border-fay/40 bg-fay/10 px-4 py-2.5 text-sm text-fay-soft">
                  {error}
                </p>
              )}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={pending}
                  onClick={cancel}
                  className="btn-ghost min-h-[48px] w-full sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={confirm}
                  data-admin-remove-confirm-button
                  className="btn min-h-[48px] w-full bg-solar text-ink-950 sm:w-auto"
                >
                  {pending ? 'Removing…' : 'Remove from public viewing'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
