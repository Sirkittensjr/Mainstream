'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { deletePostAction } from '@/app/actions';
import { TrashIcon } from './Icons';
import { Portal } from './Portal';

/**
 * "Delete" in a post's ••• menu, and the question it asks first.
 *
 * Only ever rendered for the post's author — but that is a courtesy, not the
 * rule: the server deletes nothing that is not the signed-in person's own,
 * whatever this sends.
 *
 * Nothing is deleted until Delete in the confirmation is pressed. Cancel, the
 * backdrop and Escape all close it and change nothing. Once the server says the
 * post is gone, `onDeleted` takes it off the screen straight away and the page
 * underneath is refreshed in place — no reload. On the post's own page there is
 * nothing left to show, so `then="profile"` moves to the author's profile
 * instead.
 */
export function DeletePost({
  postId,
  then,
  onDeleted,
  onCancel,
}: {
  postId: string;
  then?: 'profile';
  onDeleted?: () => void;
  /** The question was closed without deleting — the menu it came from goes too. */
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
    startTransition(async () => {
      const result = await deletePostAction(postId, then ? { then } : {});
      // With `then`, a successful delete navigates away and never returns here.
      if (!result?.ok) {
        setError(result?.error ?? 'Could not delete that post. Try again.');
        return;
      }
      // The action revalidated every page, and the one on screen comes back
      // refreshed with it; taking the post off now just means it does not sit
      // there until that lands.
      setOpen(false);
      onDeleted?.();
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
        data-delete-post
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-fay-soft hover:bg-white/5"
      >
        <TrashIcon width={16} height={16} />
        Delete
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
              aria-labelledby={`delete-post-${postId}`}
              data-delete-confirm
              onClick={(event) => event.stopPropagation()}
              className="card w-full max-w-sm animate-fade-up rounded-b-none p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-3xl sm:pb-6"
            >
              <h2 id={`delete-post-${postId}`} className="font-display text-xl font-bold">
                Delete this post?
              </h2>
              <p className="mt-1 text-sm text-white/55">This can&apos;t be undone.</p>
              {error && (
                <p className="mt-4 rounded-2xl border border-fay/40 bg-fay/10 px-4 py-2.5 text-sm text-fay-soft">
                  {error}
                </p>
              )}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  autoFocus
                  disabled={pending}
                  onClick={cancel}
                  data-delete-cancel
                  className="btn-ghost min-h-[48px] w-full sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={confirm}
                  data-delete-confirm-button
                  className="btn min-h-[48px] w-full bg-fay text-ink-950 sm:w-auto"
                >
                  {pending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
