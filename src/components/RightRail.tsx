import Link from 'next/link';
import { formatCount } from '@/lib/format';
import { formatVotes } from '@/lib/ratings';
import { newPeople, rankings } from '@/lib/services/rankings';
import { topCreators } from '@/lib/services/top-creators';
import { hiddenUserIds, profileCounts, suggestedPeople } from '@/lib/services/users';
import type { PublicUser, User } from '@/lib/types';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { CompassIcon, ReelIcon, UserIcon } from './Icons';
import { RatingPill } from './RatingPill';
import { TopCreators } from './TopCreators';
import { UnlessOwnProfile } from './UnlessOwnProfile';

/**
 * The desktop right-hand column: who you are, your Top 3, and where to look next.
 *
 * Everything in it is read from what already exists — the profile's own counts,
 * the Top 3 the profile shows, the Discover page's boards and the "People to
 * follow" suggestions — so there is nothing here to keep in step with anything
 * else. Shown from 1280px up; below that the centre column gets the room.
 */
export async function RightRail({ viewer }: { viewer: User | null }) {
  const [people, counts, top, leaders, newcomers, hidden] = await Promise.all([
    suggestedPeople(viewer, 4),
    viewer ? profileCounts(viewer.id) : Promise.resolve(null),
    viewer ? topCreators(viewer.id, viewer.id) : Promise.resolve(null),
    rankings({ board: 'overall', limit: 8 }),
    newPeople({ viewerId: viewer?.id ?? null, limit: 8 }),
    hiddenUserIds(viewer?.id ?? null),
  ]);
  // Faces on the Discover tiles: nobody blocked either way, and not you.
  const visible = (user: PublicUser) => !hidden.has(user.id) && user.id !== viewer?.id;
  const topFaces = leaders.map((entry) => entry.user).filter(visible).slice(0, 3);
  const newFaces = newcomers.map((entry) => entry.user).filter(visible).slice(0, 3);

  return (
    <aside
      data-right-rail
      className="sticky top-0 hidden h-dvh w-[320px] shrink-0 space-y-4 overflow-y-auto px-4 py-6 xl:block 2xl:w-[360px]"
    >
      {viewer && counts ? (
        <UnlessOwnProfile username={viewer.username}>
          <ProfileCard viewer={viewer} counts={counts} />
        </UnlessOwnProfile>
      ) : (
        <div className="card p-5">
          <p className="font-display text-xl font-bold leading-tight">
            Everyone gets <span className="gradient-text">a say.</span>
          </p>
          <p className="mt-2 text-sm text-white/50">
            Post what you are into. Likes, comments and a rating out of 10 on everything.
          </p>
          <Link href="/signup" className="btn-primary mt-4 w-full">
            Join FayTarra
          </Link>
        </div>
      )}

      {viewer && top && (
        <UnlessOwnProfile username={viewer.username}>
          <TopCreators
            variant="rail"
            slots={top.slots}
            owner={`@${viewer.username}`}
            canEdit={false}
            options={[]}
            editHref={`/u/${viewer.username}`}
          />
        </UnlessOwnProfile>
      )}

      <section className="card p-5" data-rail-discover>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label">Discover</h2>
          <Link href="/discover" className="text-xs text-white/40 hover:text-white">
            See all
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DiscoverTile
            href="/discover?board=trending"
            title="Trending"
            blurb="Reacted to now"
            icon={<ReelIcon width={18} height={18} />}
          />
          <DiscoverTile
            href="/discover"
            title="Top rated"
            blurb="Best of FayTarra"
            icon={<CompassIcon width={18} height={18} />}
          />
          <DiscoverTile
            href="/discover?show=people"
            title="Top creators"
            blurb="Highest rated people"
            faces={topFaces}
            icon={<UserIcon width={18} height={18} />}
          />
          <DiscoverTile
            href="/discover?show=people#new"
            title="New people"
            blurb="Just joined"
            faces={newFaces}
            icon={<UserIcon width={18} height={18} />}
          />
        </div>
      </section>

      {people.length > 0 && (
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label">People to follow</h2>
            <Link href="/discover?show=people" className="text-xs text-white/40 hover:text-white">
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
        </section>
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

/**
 * You, at the top of the column: picture, name, handle, and your three numbers.
 *
 * The numbers are the profile page's own — posts that are still up, people
 * following you, people you follow — read from `profileCounts`, and each one
 * opens the list it counts.
 */
function ProfileCard({
  viewer,
  counts,
}: {
  viewer: User;
  counts: { posts: number; followers: number; following: number };
}) {
  const profile = `/u/${viewer.username}`;
  const stats = [
    { label: 'Posts', value: counts.posts, href: profile },
    { label: 'Followers', value: counts.followers, href: `${profile}/followers` },
    { label: 'Following', value: counts.following, href: `${profile}/following` },
  ];
  return (
    <section className="card overflow-hidden" data-rail-profile>
      {/* A band of the FayTarra gradient for the picture to sit on. */}
      <div
        aria-hidden
        className="h-16"
        style={{
          backgroundImage:
            'linear-gradient(120deg, rgba(124,92,255,0.55) 0%, rgba(255,61,154,0.45) 52%, rgba(255,180,67,0.4) 100%)',
        }}
      />
      <div className="-mt-9 flex flex-col items-center px-5 pb-5 text-center">
        <span className="rounded-full ring-4 ring-ink-900">
          <Avatar
            username={viewer.username}
            displayName={viewer.display_name}
            src={viewer.avatar_url}
            size="lg"
          />
        </span>
        <Link
          href={profile}
          className="mt-2 max-w-full truncate font-display text-lg font-bold leading-tight hover:underline"
          data-rail-name
        >
          {viewer.display_name}
        </Link>
        <p className="max-w-full truncate text-[13px] text-white/45">@{viewer.username}</p>

        <div className="mt-4 grid w-full grid-cols-3 gap-1">
          {stats.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              aria-label={`${stat.value.toLocaleString()} ${stat.label.toLowerCase()}`}
              className="rounded-xl px-1 py-1.5 transition hover:bg-white/[0.05]"
              data-rail-stat={stat.label.toLowerCase()}
            >
              <span className="block font-display text-lg font-bold tabular-nums leading-tight">
                {formatCount(stat.value)}
              </span>
              <span className="block text-[11px] text-white/45">{stat.label}</span>
            </Link>
          ))}
        </div>

        <Link href="/settings" className="btn-ghost mt-4 w-full py-2.5 text-sm">
          Edit profile
        </Link>
      </div>
    </section>
  );
}

function DiscoverTile({
  href,
  title,
  blurb,
  icon,
  faces = [],
}: {
  href: string;
  title: string;
  blurb: string;
  icon: React.ReactNode;
  faces?: PublicUser[];
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[92px] flex-col justify-between rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 transition hover:border-white/15 hover:bg-white/[0.06]"
    >
      {/* The people tiles show who is in them; the others show what they are. */}
      {faces.length > 0 ? (
        <span className="flex h-8 items-center -space-x-2" aria-hidden>
          {faces.map((face) => (
            <span key={face.id} className="rounded-full ring-2 ring-ink-900">
              <Avatar
                username={face.username}
                displayName={face.display_name}
                src={face.avatar_url}
                size="xs"
                href={false}
              />
            </span>
          ))}
        </span>
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-fay/15 text-fay-soft">
          {icon}
        </span>
      )}
      <span className="mt-2 block">
        <span className="block text-sm font-semibold leading-tight group-hover:text-white">
          {title}
        </span>
        <span className="block truncate text-[11px] text-white/40">{blurb}</span>
      </span>
    </Link>
  );
}
