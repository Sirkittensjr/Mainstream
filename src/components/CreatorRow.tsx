import Link from 'next/link';
import type { CreatorCard } from '@/lib/services/discover';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { LevelBadge } from './LevelBadge';

/** Horizontal, swipeable row of creators — used on Discover. */
export function CreatorRow({
  creators,
  viewerId,
}: {
  creators: CreatorCard[];
  viewerId: string | null;
}) {
  if (creators.length === 0) return null;
  return (
    <div className="hide-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
      {creators.map((creator) => (
        <div
          key={creator.user.id}
          className="card w-[200px] shrink-0 snap-start p-5 text-center"
        >
          <div className="flex justify-center">
            <Avatar
              username={creator.user.username}
              displayName={creator.user.display_name}
              src={creator.user.avatar_url}
              size="lg"
            />
          </div>
          <Link
            href={`/u/${creator.user.username}`}
            className="mt-3 block truncate font-semibold hover:underline"
          >
            {creator.user.display_name}
          </Link>
          <p className="truncate text-xs text-white/40">@{creator.user.username}</p>
          <p className="mt-2 line-clamp-2 h-8 text-xs leading-4 text-white/45">
            {creator.user.bio || 'Starting at zero.'}
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <LevelBadge level={creator.level} name={creator.levelName} size="xs" />
          </div>
          <p className="mt-2 text-[11px] text-white/35">
            {creator.followers} followers · +{creator.weeklyPoints} pts this week
          </p>
          {viewerId !== creator.user.id && (
            <div className="mt-3 flex justify-center">
              <FollowButton
                userId={creator.user.id}
                initialFollowing={false}
                signedIn={Boolean(viewerId)}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
