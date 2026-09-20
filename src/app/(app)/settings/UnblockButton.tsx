'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { blockAction } from '@/app/actions';

export function UnblockButton({ userId }: { userId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await blockAction(userId, false);
          router.refresh();
        })
      }
      className="btn-ghost px-4 py-1.5 text-xs"
    >
      {pending ? 'Unblocking…' : 'Unblock'}
    </button>
  );
}
