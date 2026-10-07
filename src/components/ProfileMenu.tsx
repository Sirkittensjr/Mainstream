'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { blockAction } from '@/app/actions';
import { ReportDialog } from './ReportDialog';

/** Block / report menu shown on someone else's profile. */
export function ProfileMenu({
  userId,
  username,
  blocked,
}: {
  userId: string;
  username: string;
  blocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** Blocking asks first: it hides both of you from each other everywhere. */
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [pending, startTransition] = useTransition();
  const close = () => {
    setOpen(false);
    setConfirmingBlock(false);
  };
  const router = useRouter();

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="More options"
        onClick={() => setOpen((value) => !value)}
        className="btn-ghost px-4 py-2.5 text-sm"
      >
        •••
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-30 cursor-default"
            onClick={close}
          />
          <div className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-2xl border border-white/10 bg-ink-850 py-1 shadow-xl">
            <ReportDialog targetType="user" targetId={userId} label={`Report @${username}`} />
            {confirmingBlock ? (
              <div className="border-t border-white/[0.06] px-4 py-3" data-confirm-block>
                <p className="text-sm font-semibold text-white">Block @{username}?</p>
                <p className="mt-1 text-xs leading-relaxed text-white/50">
                  You will stop seeing each other&apos;s posts, comments and messages, and neither
                  of you can follow the other. You can unblock any time.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingBlock(false)}
                    className="btn-quiet min-h-[40px] flex-1 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    data-confirm-block-yes
                    onClick={() =>
                      startTransition(async () => {
                        await blockAction(userId, true);
                        close();
                        router.refresh();
                      })
                    }
                    className="btn-primary min-h-[40px] flex-1 py-2 text-sm"
                  >
                    {pending ? 'Blocking…' : 'Block'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  blocked
                    ? // Unblocking loses nothing, so it does not ask.
                      startTransition(async () => {
                        await blockAction(userId, false);
                        close();
                        router.refresh();
                      })
                    : setConfirmingBlock(true)
                }
                className="block min-h-[44px] w-full px-4 py-2.5 text-left text-sm text-white/70 hover:bg-white/5"
              >
                {blocked ? `Unblock @${username}` : `Block @${username}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
