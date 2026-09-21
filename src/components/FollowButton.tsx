'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { followAction } from '@/app/actions';

export function FollowButton({
  userId,
  initialFollowing,
  size = 'sm',
  signedIn,
}: {
  userId: string;
  initialFollowing: boolean;
  size?: 'sm' | 'lg';
  signedIn: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  const classes =
    size === 'lg'
      ? 'px-6 py-3 text-[15px]'
      : 'px-4 py-1.5 text-[13px]';

  return (
    <span className="relative inline-block">
    <button
      type="button"
      disabled={pending}
      title={error ?? undefined}
      onClick={() => {
        if (!signedIn) {
          // Back to wherever they were, not to a route that does not exist.
          router.push(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        const next = !following;
        setFollowing(next); // optimistic — following should feel instant
        setError(null);
        startTransition(async () => {
          const result = await followAction(userId, next);
          if (!result.ok) {
            // Reverting on its own looks like the button is broken; say why.
            setFollowing(!next);
            setError(result.error);
            setTimeout(() => setError(null), 4000);
          }
        });
      }}
      className={`rounded-full font-semibold transition active:scale-95 ${classes} ${
        following
          ? 'border border-white/15 bg-white/[0.06] text-white/70 hover:bg-white/10'
          : 'bg-white text-ink-950 hover:bg-white/90'
      }`}
    >
      {following ? 'Following' : 'Follow'}
    </button>
      {error && (
        <span className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-fay/40 bg-ink-850 px-3 py-2 text-xs text-fay-soft shadow-xl">
          {error}
        </span>
      )}
    </span>
  );
}
