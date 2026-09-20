import Link from 'next/link';
import { levelFor } from '@/lib/rise';
import { timeLeft } from '@/lib/time';
import { activeChallenges } from '@/lib/services/challenges';
import { risingCreatorCards } from '@/lib/services/discover';
import type { User } from '@/lib/types';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { RiseMeter } from './LevelBadge';
import { ArrowIcon } from './Icons';

/** Desktop-only sidebar: progress, the live challenge and people to discover. */
export async function RightRail({ viewer }: { viewer: User | null }) {
  const [challenges, creators] = await Promise.all([
    activeChallenges(),
    risingCreatorCards(viewer?.id ?? null, null, 3),
  ]);
  const challenge = challenges[0];
  const level = viewer ? levelFor(viewer.rise_points) : null;

  return (
    <aside className="sticky top-0 hidden h-dvh w-80 shrink-0 space-y-4 overflow-y-auto px-4 py-6 xl:block">
      {viewer && level ? (
        <div className="card p-5">
          <p className="label">Your RISE</p>
          <p className="mt-2 font-display text-2xl font-bold">
            Level {level.level} — {level.name}
          </p>
          <p className="mb-3 text-sm text-white/45">
            {viewer.rise_points.toLocaleString()} RISE points
          </p>
          <RiseMeter points={viewer.rise_points} />
          <p className="mt-3 text-[13px] text-white/50">Goal: {viewer.goal}</p>
        </div>
      ) : (
        <div className="card p-5">
          <p className="font-display text-xl font-bold leading-tight">
            Everyone starts <span className="gradient-text">at zero.</span>
          </p>
          <p className="mt-2 text-sm text-white/50">
            Make an account and your first post can be discovered today.
          </p>
          <Link href="/signup" className="btn-primary mt-4 w-full">
            Join RISE
          </Link>
        </div>
      )}

      {challenge && (
        <div className="card p-5">
          <p className="label">Live challenge</p>
          <h3 className="mt-2 font-display text-lg font-bold">{challenge.title}</h3>
          <p className="mt-1 line-clamp-3 text-sm text-white/50">{challenge.description}</p>
          <p className="mt-3 text-xs font-semibold text-solar">{timeLeft(challenge.ends_at)}</p>
          <Link
            href={`/challenges/${challenge.slug}`}
            className="btn-ghost mt-4 w-full text-sm"
          >
            See entries
          </Link>
        </div>
      )}

      {creators.length > 0 && (
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="label">Rising creators</p>
            <Link href="/discover" className="text-xs text-white/40 hover:text-white">
              See all
            </Link>
          </div>
          <ul className="space-y-3">
            {creators.map((creator) => (
              <li key={creator.user.id} className="flex items-center gap-3">
                <Avatar
                  username={creator.user.username}
                  displayName={creator.user.display_name}
                  src={creator.user.avatar_url}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/u/${creator.user.username}`}
                    className="block truncate text-sm font-semibold hover:underline"
                  >
                    {creator.user.display_name}
                  </Link>
                  <p className="truncate text-xs text-white/40">
                    {creator.followers} followers · +{creator.weeklyPoints} this week
                  </p>
                </div>
                {viewer && viewer.id !== creator.user.id && (
                  <FollowButton
                    userId={creator.user.id}
                    initialFollowing={false}
                    signedIn={Boolean(viewer)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-2 pb-8 text-xs leading-relaxed text-white/25">
        <Link href="/rules" className="hover:text-white/60">
          Community rules
        </Link>
        {' · '}
        <Link href="/leaderboards" className="hover:text-white/60">
          Leaderboards
        </Link>
        {' · '}
        <Link href="/settings" className="hover:text-white/60">
          Settings
        </Link>
        <p className="mt-2 flex items-center gap-1">
          Everyone starts at zero <ArrowIcon width={13} height={13} />
        </p>
      </div>
    </aside>
  );
}
