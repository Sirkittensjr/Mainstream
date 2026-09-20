'use client';

import { useState, useTransition } from 'react';
import { reportAction } from '@/app/actions';
import { REPORT_REASONS } from '@/lib/moderation-reasons';
import { CloseIcon, FlagIcon } from './Icons';

export function ReportDialog({
  targetType,
  targetId,
  label = 'Report',
}: {
  targetType: 'post' | 'user' | 'comment';
  targetId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-white/70 hover:bg-white/5"
      >
        <FlagIcon width={16} height={16} />
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="card w-full max-w-md animate-fade-up rounded-b-none p-6 sm:rounded-3xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-bold">Report this {targetType}</h2>
                <p className="mt-1 text-sm text-white/50">
                  Reports go to the RISE moderation team. We never tell the other person who
                  reported them.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>

            {done ? (
              <div className="py-6 text-center">
                <p className="font-display text-lg font-semibold">Thanks — we have it.</p>
                <p className="mt-1 text-sm text-white/50">
                  A moderator will review this. You can also block this person from their profile.
                </p>
                <button
                  type="button"
                  className="btn-ghost mt-5 w-full"
                  onClick={() => {
                    setOpen(false);
                    setDone(false);
                  }}
                >
                  Done
                </button>
              </div>
            ) : (
              <form
                action={(formData) => {
                  startTransition(async () => {
                    await reportAction(formData);
                    setDone(true);
                  });
                }}
                className="space-y-3"
              >
                <input type="hidden" name="targetType" value={targetType} />
                <input type="hidden" name="targetId" value={targetId} />
                <label className="label" htmlFor="reason">
                  What is happening?
                </label>
                <select id="reason" name="reason" className="w-full" required>
                  {REPORT_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
                <textarea
                  name="details"
                  rows={3}
                  placeholder="Anything else we should know? (optional)"
                  className="w-full"
                />
                <button type="submit" disabled={pending} className="btn-primary w-full">
                  {pending ? 'Sending…' : 'Submit report'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
