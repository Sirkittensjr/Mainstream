'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveTopCreatorsAction } from '@/app/actions';
import { Avatar } from './Avatar';
import { ChevronIcon, CloseIcon } from './Icons';
import { Portal } from './Portal';

export interface CreatorOption {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Choosing and ordering your Top 3.
 *
 * Three slots, a menu per slot of the people you follow, and a pair of arrows
 * to move somebody up or down. Deliberately not drag and drop: this has to
 * work with a thumb on a phone and with a keyboard, and two buttons do that
 * without a library.
 *
 * The list offered is only ever people you currently follow. The server checks
 * that again before it stores anything — this menu is a convenience, not the
 * rule.
 */
export function TopCreatorsEditor({
  slots,
  options,
}: {
  slots: { position: number; id: string | null }[];
  options: CreatorOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="chip hover:bg-white/10"
        aria-label="Edit your Top 3 creators"
      >
        Edit
      </button>
      {open && <Sheet slots={slots} options={options} onClose={() => setOpen(false)} />}
    </>
  );
}

function Sheet({
  slots,
  options,
  onClose,
}: {
  slots: { position: number; id: string | null }[];
  options: CreatorOption[];
  onClose: () => void;
}) {
  const [picks, setPicks] = useState<(string | null)[]>(() => {
    const initial = [0, 1, 2].map((index) => slots[index]?.id ?? null);
    return initial;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const byId = new Map(options.map((option) => [option.id, option]));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function choose(index: number, id: string) {
    setPicks((current) => {
      const next = [...current];
      // Picking somebody who is already in another slot swaps the two, which
      // is what dragging them would have done.
      const existing = next.indexOf(id || '');
      if (id && existing >= 0 && existing !== index) next[existing] = next[index];
      next[index] = id || null;
      return next;
    });
  }

  function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target > 2) return;
    setPicks((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveTopCreatorsAction(picks.filter((id): id is string => Boolean(id)));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Your Top 3 creators"
      >
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="absolute inset-0 cursor-default"
          onClick={onClose}
        />
        <div className="card relative max-h-[88dvh] w-full max-w-md animate-fade-up overflow-y-auto rounded-b-none p-6 sm:rounded-3xl">
          <div className="mb-1 flex items-start justify-between gap-4">
            <h2 className="font-display text-xl font-bold">Your Top 3</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-white/50 hover:text-white"
            >
              <CloseIcon />
            </button>
          </div>
          <p className="mb-5 text-sm text-white/45">
            Anyone you follow. They do not have to follow you back.
          </p>

          {options.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/50">
              You are not following anyone yet. Follow someone and they can go in your Top 3.
            </p>
          ) : (
            <ol className="space-y-3">
              {[0, 1, 2].map((index) => {
                const id = picks[index];
                const person = id ? byId.get(id) : undefined;
                return (
                  <li key={index} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] font-display text-xs font-bold tabular-nums"
                    >
                      {index + 1}
                    </span>
                    {person ? (
                      <Avatar
                        username={person.username}
                        displayName={person.displayName}
                        src={person.avatarUrl}
                        size="xs"
                        href={false}
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="h-7 w-7 shrink-0 rounded-full border border-dashed border-white/20"
                      />
                    )}
                    <select
                      aria-label={`Top 3 slot ${index + 1}`}
                      value={id ?? ''}
                      onChange={(event) => choose(index, event.target.value)}
                      className="min-w-0 flex-1 px-3 py-2 text-sm"
                    >
                      <option value="">Empty</option>
                      {options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.displayName} (@{option.username})
                        </option>
                      ))}
                    </select>
                    <span className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move slot ${index + 1} up`}
                        className="rotate-[-90deg] p-1 text-white/45 disabled:opacity-25 hover:text-white"
                      >
                        <ChevronIcon width={16} height={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={index === 2}
                        aria-label={`Move slot ${index + 1} down`}
                        className="rotate-90 p-1 text-white/45 disabled:opacity-25 hover:text-white"
                      >
                        <ChevronIcon width={16} height={16} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {error && (
            <p className="mt-4 rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
              {error}
            </p>
          )}

          <div className="mt-6 flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 py-3">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending || options.length === 0}
              className="btn-primary flex-1 py-3"
            >
              {pending ? 'Saving…' : 'Save Top 3'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
