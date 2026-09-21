'use client';

import { useState, useTransition } from 'react';
import { deletePostAction } from '@/app/actions';

export function DeletePostButton({ postId }: { postId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn-ghost px-4 py-2 text-sm text-white/50"
      >
        Delete post
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => deletePostAction(postId))}
        className="btn px-4 py-2 text-sm bg-fay text-ink-950"
      >
        {pending ? 'Deleting…' : 'Yes, delete'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="btn-quiet px-3 py-2 text-sm"
      >
        Cancel
      </button>
    </div>
  );
}
