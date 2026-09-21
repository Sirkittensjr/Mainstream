'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const classes =
    size === 'lg'
      ? 'px-6 py-3 text-[15px]'
      : 'px-4 py-1.5 text-[13px]';

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!signedIn) {
          router.push(`/login?next=/u`);
          return;
        }
        const next = !following;
        setFollowing(next); // optimistic — following should feel instant
        startTransition(async () => {
          const result = await followAction(userId, next);
          if (!result.ok) setFollowing(!next);
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
  );
}
