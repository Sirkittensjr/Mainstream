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
  const [pending, startTransition] = useTransition();
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
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-12 z-40 w-52 overflow-hidden rounded-2xl border border-white/10 bg-ink-850 py-1 shadow-xl">
            <ReportDialog targetType="user" targetId={userId} label={`Report @${username}`} />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await blockAction(userId, !blocked);
                  setOpen(false);
                  router.refresh();
                })
              }
              className="block w-full px-4 py-2.5 text-left text-sm text-white/70 hover:bg-white/5"
            >
              {blocked ? `Unblock @${username}` : `Block @${username}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
