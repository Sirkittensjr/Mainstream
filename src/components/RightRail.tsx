import Link from 'next/link';
import { levelFor } from '@/lib/progression';
import { timeLeft } from '@/lib/time';
import { activeChallenges } from '@/lib/services/challenges';
import { risingCreatorCards } from '@/lib/services/discover';
import { userRating } from '@/lib/services/ratings';
import { userRanks } from '@/lib/services/rankings';
import { RatingPill } from './RatingPill';
import type { User } from '@/lib/types';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { LevelMeter } from './LevelBadge';
import { ArrowIcon } from './Icons';

/** Desktop-only sidebar: progress, the live challenge and people to discover. */
export async function RightRail({ viewer }: { viewer: User | null }) {
  const [challenges, creators, rating, ranks] = await Promise.all([
    activeChallenges(),
    risingCreatorCards(viewer?.id ?? null, null, 3),
    viewer ? userRating(viewer.id) : Promise.resolve(null),
    viewer ? userRanks(viewer.id) : Promise.resolve(null),
  ]);
  const challenge = challenges[0];
  const level = viewer ? levelFor(viewer.points) : null;

  return (
    <aside className="sticky top-0 hidden h-dvh w-80 shrink-0 space-y-4 overflow-y-auto px-4 py-6 xl:block">
      {viewer && level && rating && ranks ? (
        <div className="card p-5">
          <p className="label">Your FayTarra</p>
          <div className="mt-3 flex items-center gap-2">
            <RatingPill value={rating.overall} label="overall" />
            <RatingPill value={rating.current} label="now" trend={rating.trend} />
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Overall', value: ranks.overall },
              { label: 'Current', value: ranks.current },
              { label: 'Rising', value: ranks.rising },
            ].map((entry) => (
              <div key={entry.label} className="rounded-xl bg-black/25 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-white/35">{entry.label}</dt>
                <dd className="font-display text-sm font-bold tabular-nums">
                  {entry.value ? `#${entry.value}` : '—'}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mb-2 mt-4 text-[13px] text-white/45">
            Level {level.level} — {level.name} · {viewer.points.toLocaleString()} pts
          </p>
          <LevelMeter points={viewer.points} compact />
          <Link href="/rankings" className="btn-ghost mt-4 w-full text-sm">
            See rankings
          </Link>
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
            Join FayTarra
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
                  <p className="flex items-center gap-1.5 truncate text-xs text-white/40">
                    <RatingPill value={creator.rating} size="sm" />
                    {creator.followers} followers
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
        <Link href="/rankings" className="hover:text-white/60">
          Rankings
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
