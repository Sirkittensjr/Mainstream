import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { FollowButton } from '@/components/FollowButton';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { LoadMore } from '@/components/LoadMore';
import { ProfileMenu } from '@/components/ProfileMenu';
import { RatingPill, ReactionBar } from '@/components/RatingPill';
import { RateButton } from '@/components/RateSheet';
import { formatCount } from '@/lib/format';
import { formatVotes, MIN_VOTES_FOR_RANKING, topReactions } from '@/lib/ratings';
import { hydratePosts, postsByAuthor } from '@/lib/services/posts';
import { myRating, userRating } from '@/lib/services/ratings';
import { userRanks } from '@/lib/services/rankings';
import {
  getUserByUsername,
  getUserStats,
  isBlockedEitherWay,
  isFollowing,
} from '@/lib/services/users';
import { getViewer } from '@/lib/session';
import { formatMonthYear } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const user = await getUserByUsername(username);
  return { title: user ? `${user.display_name} (@${user.username})` : 'Profile' };
}

const TABS = ['posts', 'about'] as const;

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string; show?: string }>;
}) {
  const { username } = await params;
  const { tab: tabParam, show } = await searchParams;
  const tab = TABS.includes((tabParam ?? '') as (typeof TABS)[number])
    ? (tabParam as (typeof TABS)[number])
    : 'posts';

  const user = await getUserByUsername(username);
  if (!user) notFound();

  const viewer = await getViewer();
  const isSelf = viewer?.id === user.id;
  const blocked = viewer && !isSelf ? await isBlockedEitherWay(viewer.id, user.id) : false;
  if (user.status === 'banned' && !isSelf && viewer?.role !== 'admin') notFound();

  const [stats, following, allPosts, rating, ranks, mine] = await Promise.all([
    getUserStats(user.id),
    viewer && !isSelf ? isFollowing(viewer.id, user.id) : Promise.resolve(false),
    postsByAuthor(user.id),
    userRating(user.id),
    userRanks(user.id),
    myRating(viewer?.id ?? null, 'user', user.id),
  ]);

  const requested = Number.parseInt(show ?? '', 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 20), 200) : 20;
  const posts = blocked ? [] : await hydratePosts(allPosts.slice(0, limit), viewer?.id ?? null);
  const moreHref = `/u/${user.username}?${new URLSearchParams({
    ...(tab === 'about' ? { tab } : {}),
    show: String(Math.min(limit + 20, 200)),
  })}`;
  const rated = rating.overallVotes > 0;

  return (
    <>
      <PageTopBar title={`@${user.username}`} />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <header className="card p-6">
          <div className="flex items-start gap-4">
            <Avatar
              username={user.username}
              displayName={user.display_name}
              src={user.avatar_url}
              size="xl"
              href={false}
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-2xl font-extrabold tracking-tight">
                {user.display_name}
              </h1>
              <p className="text-white/45">@{user.username}</p>
              {user.status === 'suspended' && (
                <span className="chip mt-2 border-fay/40 bg-fay/10 text-fay">Suspended</span>
              )}
            </div>
          </div>

          {user.bio && (
            <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-white/80">
              {user.bio}
            </p>
          )}

          {user.interests.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {user.interests.map((interest) => (
                <Link
                  key={interest}
                  href={`/discover?category=${encodeURIComponent(interest)}`}
                  className="chip hover:bg-white/10"
                >
                  {interest}
                </Link>
              ))}
            </div>
          )}
          {user.location && <p className="mt-3 text-sm text-white/35">📍 {user.location}</p>}

          <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Stat label="Followers" value={formatCount(stats.followers)} />
            <Stat label="Following" value={formatCount(stats.following)} />
            <Stat label="Posts" value={formatCount(stats.posts)} />
          </dl>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
              <p className="label">Overall</p>
              <div className="mt-2">
                <RatingPill
                  value={rated ? rating.overall : null}
                  size="lg"
                  votes={rating.overallVotes}
                />
              </div>
              <p className="mt-2 text-xs text-white/35">
                {rated ? formatVotes(rating.overallVotes) : 'Not rated yet'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
              <p className="label">Last 30 days</p>
              <div className="mt-2">
                <RatingPill
                  value={rating.recentVotes > 0 ? rating.recent : null}
                  trend={rating.trend}
                  size="lg"
                  votes={rating.recentVotes}
                />
              </div>
              <p className="mt-2 text-xs text-white/35">
                {rating.recentVotes > 0 ? formatVotes(rating.recentVotes) : 'No ratings this month'}
              </p>
            </div>
          </div>

          {ranks.overall ? (
            <p className="mt-3 text-sm text-white/50">
              <Link href="/discover" className="font-semibold text-white hover:underline">
                #{ranks.overall}
              </Link>{' '}
              of {ranks.total.toLocaleString()} rated people
              {ranks.category && ranks.categoryRank
                ? ` · #${ranks.categoryRank} in ${ranks.category}`
                : ''}
            </p>
          ) : (
            <p className="mt-3 text-sm text-white/35">
              Needs {MIN_VOTES_FOR_RANKING} ratings to be ranked
              {rating.overallVotes > 0 ? ` — ${ranks.votesNeeded} to go` : ''}.
            </p>
          )}

          {topReactions(rating.reactions, 4).length > 0 && (
            <div className="mt-4">
              <ReactionBar reactions={topReactions(rating.reactions, 4)} />
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {isSelf ? (
              <>
                <Link href="/settings" className="btn-ghost px-6 py-2.5 text-sm">
                  Edit profile
                </Link>
                <Link href="/create" className="btn-primary px-6 py-2.5 text-sm">
                  Create a post
                </Link>
              </>
            ) : (
              <>
                <FollowButton
                  userId={user.id}
                  initialFollowing={following}
                  size="lg"
                  signedIn={Boolean(viewer)}
                />
                <RateButton
                  targetType="user"
                  targetId={user.id}
                  rating={rated ? rating.overall : null}
                  votes={rating.overallVotes}
                  myScore={mine?.score ?? null}
                  myReactions={mine?.reactions ?? []}
                  signedIn={Boolean(viewer)}
                  subject={`@${user.username}`}
                />
                {viewer && (
                  <ProfileMenu userId={user.id} username={user.username} blocked={blocked} />
                )}
              </>
            )}
          </div>
        </header>

        <nav className="mt-6 flex gap-2">
          {TABS.map((entry) => (
            <Link
              key={entry}
              href={entry === 'posts' ? `/u/${user.username}` : `/u/${user.username}?tab=${entry}`}
              className={`chip capitalize ${tab === entry ? 'chip-active' : 'hover:bg-white/10'}`}
            >
              {entry}
            </Link>
          ))}
        </nav>

        <div className="mt-4 space-y-4 pb-10">
          {blocked ? (
            <EmptyState
              title="This profile is hidden"
              body="You and this person have blocked each other, so posts are not shown."
            />
          ) : tab === 'about' ? (
            <section className="card p-6">
              <h2 className="font-display text-lg font-bold">About</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <Row label="Joined" value={formatMonthYear(user.created_at)} />
                <Row label="Into" value={user.interests.join(', ') || '—'} />
                <Row label="Location" value={user.location ?? 'Not shared'} />
                <Row label="Posts" value={String(stats.posts)} />
                <Row label="Likes received" value={formatCount(stats.likesReceived)} />
                <Row
                  label="Ratings received"
                  value={rated ? formatVotes(rating.overallVotes) : 'None yet'}
                />
              </dl>
            </section>
          ) : (
            <>
              <PostList
                posts={posts}
                viewerId={viewer?.id ?? null}
                empty={
                  <EmptyState
                    title="Nothing posted yet"
                    body={
                      isSelf
                        ? 'Post a photo, a video or just a thought. It shows up here.'
                        : `${user.display_name} has not posted yet. Follow to be there when they do.`
                    }
                    cta={isSelf ? { href: '/create', label: 'Create a post' } : undefined}
                  />
                }
              />
              <LoadMore href={moreHref} hasMore={allPosts.length > posts.length} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="order-2 text-white/40">{label}</dt>
      <dd className="order-1 font-display text-base font-bold">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] pb-2">
      <dt className="text-white/40">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
