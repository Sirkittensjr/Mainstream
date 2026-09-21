import Link from 'next/link';
import { formatVotes } from '@/lib/ratings';
import { userRating } from '@/lib/services/ratings';
import { userRanks } from '@/lib/services/rankings';
import { suggestedPeople } from '@/lib/services/users';
import type { User } from '@/lib/types';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { RatingPill } from './RatingPill';

/** Desktop-only sidebar: your ratings and people worth following. */
export async function RightRail({ viewer }: { viewer: User | null }) {
  const [people, rating, ranks] = await Promise.all([
    suggestedPeople(viewer, 4),
    viewer ? userRating(viewer.id) : Promise.resolve(null),
    viewer ? userRanks(viewer.id) : Promise.resolve(null),
  ]);

  return (
    <aside className="sticky top-0 hidden h-dvh w-80 shrink-0 space-y-4 overflow-y-auto px-4 py-6 xl:block">
      {viewer && rating && ranks ? (
        <div className="card p-5">
          <p className="label">Your ratings</p>
          <div className="mt-3 flex items-center gap-2">
            <RatingPill
              value={rating.overallVotes > 0 ? rating.overall : null}
              label="overall"
              votes={rating.overallVotes}
            />
            <RatingPill
              value={rating.recentVotes > 0 ? rating.recent : null}
              label="30d"
              trend={rating.trend}
              votes={rating.recentVotes}
            />
          </div>
          <p className="mt-3 text-[13px] text-white/45">
            {ranks.overall
              ? `#${ranks.overall} of ${ranks.total.toLocaleString()} rated people`
              : `${ranks.votesNeeded} more rating${ranks.votesNeeded === 1 ? '' : 's'} and you appear in Discover`}
          </p>
          <Link href={`/u/${viewer.username}`} className="btn-ghost mt-4 w-full text-sm">
            View profile
          </Link>
        </div>
      ) : (
        <div className="card p-5">
          <p className="font-display text-xl font-bold leading-tight">
            Everyone starts <span className="gradient-text">at zero.</span>
          </p>
          <p className="mt-2 text-sm text-white/50">
            Post what you are into, follow people, rate what you like.
          </p>
          <Link href="/signup" className="btn-primary mt-4 w-full">
            Join FayTarra
          </Link>
        </div>
      )}

      {people.length > 0 && (
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="label">People to follow</p>
            <Link href="/discover" className="text-xs text-white/40 hover:text-white">
              See all
            </Link>
          </div>
          <ul className="space-y-3">
            {people.map((person) => (
              <li key={person.user.id} className="flex items-center gap-3">
                <Avatar
                  username={person.user.username}
                  displayName={person.user.display_name}
                  src={person.user.avatar_url}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/u/${person.user.username}`}
                    className="block truncate text-sm font-semibold hover:underline"
                  >
                    {person.user.display_name}
                  </Link>
                  <p className="flex items-center gap-1.5 truncate text-xs text-white/40">
                    <RatingPill value={person.rating} size="sm" votes={person.votes} />
                    {person.category ?? formatVotes(person.votes)}
                  </p>
                </div>
                {viewer && (
                  <FollowButton userId={person.user.id} initialFollowing={false} signedIn />
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
        <Link href="/discover" className="hover:text-white/60">
          Discover
        </Link>
        {' · '}
        <Link href="/settings" className="hover:text-white/60">
          Settings
        </Link>
      </div>
    </aside>
  );
}
