"use client";

import { useState, useTransition } from "react";
import { reportAction } from "@/app/actions";
import { REPORT_REASONS } from "@/lib/moderation-reasons";
import { FlagIcon } from "./Icons";
import { Sheet } from "./Sheet";

export function ReportDialog({
  targetType,
  targetId,
  label = "Report",
}: {
  targetType: "post" | "user" | "comment";
  targetId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] w-full items-center gap-2 px-4 text-left text-sm text-white/70 hover:bg-white/5"
      >
        <FlagIcon width={16} height={16} />
        {label}
      </button>

      {open && (
        <Sheet
          title={`Report this ${targetType}`}
          subtitle="Reports go to the FayTarra moderation team. We never tell the other person who reported them."
          onClose={() => {
            setOpen(false);
            setDone(false);
          }}
        >
          {done ? (
            <div className="py-6 text-center">
              <p className="font-display text-lg font-semibold">
                Thanks — we have it.
              </p>
              <p className="mt-1 text-sm text-white/50">
                A moderator will review this. You can also block this person
                from their profile.
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
                setError(null);
                startTransition(async () => {
                  const result = await reportAction(formData);
                  // A refused report must say so — silently showing
                  // "thanks, we have it" would be a lie.
                  if (result?.ok) setDone(true);
                  else setError(result?.error ?? 'Could not send that report.');
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
              <label className="sr-only" htmlFor="report-details">
                More detail (optional)
              </label>
              <textarea
                id="report-details"
                name="details"
                rows={3}
                placeholder="Anything else we should know? (optional)"
                className="w-full"
              />
              {error && (
                <p role="alert" className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-2.5 text-sm text-fay-soft">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={pending}
                className="btn-primary w-full"
              >
                {pending ? "Sending…" : "Submit report"}
              </button>
            </form>
          )}
        </Sheet>
      )}
    </>
  );
}
