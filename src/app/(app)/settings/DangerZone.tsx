'use client';

import { useState, useTransition } from 'react';
import { deleteAccountAction } from '@/app/actions';

/** Permanent account deletion — posts, comments, likes and follows all go. */
export function DangerZone({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-white/40 underline hover:text-fay"
      >
        Delete my account
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-fay/30 bg-fay/[0.06] p-4">
      <p className="text-sm text-white/70">
        This deletes your profile, posts, comments, likes and follows. It cannot be undone. Type{' '}
        <strong className="text-white">{username}</strong> to confirm.
      </p>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={username}
        className="mt-3 w-full py-2 text-sm"
        aria-label="Confirm your username"
      />
      {error && <p className="mt-2 text-sm text-fay">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteAccountAction(value);
              if (result && !result.ok) setError(result.error);
            })
          }
          className="btn bg-fay px-5 py-2 text-sm text-ink-950"
        >
          {pending ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setValue('');
            setError(null);
          }}
          className="btn-quiet px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
