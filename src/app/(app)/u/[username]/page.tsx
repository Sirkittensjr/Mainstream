import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { FollowButton } from '@/components/FollowButton';
import { Journey } from '@/components/Journey';
import { LevelBadge, LevelMeter } from '@/components/LevelBadge';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { ProfileMenu } from '@/components/ProfileMenu';
import { RatingPill, ReactionBar } from '@/components/RatingPill';
import { RateButton } from '@/components/RateSheet';
import { formatCount, levelFor } from '@/lib/progression';
import { hydratePosts, postsByAuthor } from '@/lib/services/posts';
import {
  getJourney,
  getUserByUsername,
  getUserStats,
  isBlockedEitherWay,
  isFollowing,
} from '@/lib/services/users';
import { db } from '@/lib/db';
import { myRating, userRating } from '@/lib/services/ratings';
import { rankHistory, userRanks } from '@/lib/services/rankings';
import { topReactions } from '@/lib/ratings';
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

const TABS = ['posts', 'challenges', 'about'] as const;

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { username } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = TABS.includes((tabParam ?? '') as (typeof TABS)[number])
    ? (tabParam as (typeof TABS)[number])
    : 'posts';

  const user = await getUserByUsername(username);
  if (!user) notFound();

  const viewer = await getViewer();
  const isSelf = viewer?.id === user.id;
  const blocked = viewer && !isSelf ? await isBlockedEitherWay(viewer.id, user.id) : false;

  if (user.status === 'banned' && !isSelf && viewer?.role !== 'admin') notFound();

  const [stats, following, allPosts, journey, challenges, rating, ranks, history, mine] =
    await Promise.all([
      getUserStats(user.id),
      viewer && !isSelf ? isFollowing(viewer.id, user.id) : Promise.resolve(false),
      postsByAuthor(user.id),
      getJourney(user),
      db().query('challenges'),
      userRating(user.id),
      userRanks(user.id),
      rankHistory(user.id),
      myRating(viewer?.id ?? null, 'user', user.id),
    ]);

  const challengeById = new Map(challenges.map((entry) => [entry.id, entry]));
  const shown = tab === 'challenges' ? allPosts.filter((post) => post.challenge_id) : allPosts;
  const posts = blocked ? [] : await hydratePosts(shown.slice(0, 40), viewer?.id ?? null);
  const level = levelFor(user.points);

  return (
    <>
      <PageTopBar title={`@${user.username}`} />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        {/* Header ------------------------------------------------------- */}
        <header className="card p-6">
          <div className="flex items-start gap-4">
            <Avatar
              username={user.username}
              displayName={user.display_name}
              src={user.avatar_url}
              size="xl"
              href={false}
              ring
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-2xl font-extrabold tracking-tight">
                {user.display_name}
              </h1>
              <p className="text-white/45">@{user.username}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <LevelBadge level={level.level} name={level.name} />
                {user.status === 'suspended' && (
                  <span className="chip border-fay/40 bg-fay/10 text-fay">Suspended</span>
                )}
              </div>
            </div>
          </div>

          {user.interests.length > 0 && (
            <p className="mt-4 text-sm font-semibold text-white/70">
              {user.interests.join(' / ')}
            </p>
          )}
          {user.bio && (
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-white/80">
              {user.bio}
            </p>
          )}
          {user.location && <p className="mt-2 text-sm text-white/35">📍 {user.location}</p>}

          <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Stat label="Followers" value={formatCount(stats.followers)} />
            <Stat label="Following" value={formatCount(stats.following)} />
            <Stat label="Posts" value={formatCount(stats.posts)} />
            <Stat label="Views" value={formatCount(stats.views)} />
          </dl>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
              <p className="label">Overall</p>
              <div className="mt-2">
                <RatingPill value={rating.overall} size="lg" count={rating.ratingsReceived} />
              </div>
              <p className="mt-2 text-xs text-white/35">
                {rating.ratingsReceived} rating{rating.ratingsReceived === 1 ? '' : 's'} ·{' '}
                {rating.raters} people
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
              <p className="label">Current · 30d</p>
              <div className="mt-2">
                <RatingPill value={rating.current} trend={rating.trend} size="lg" />
              </div>
              <p className="mt-2 text-xs text-white/35">
                {rating.delta === 0 && 'holding steady'}
                {rating.delta !== 0 && (
                  <span className={rating.delta > 0 ? 'text-mint' : 'text-fay-soft'}>
                    {rating.delta > 0 ? '+' : ''}
                    {rating.delta.toFixed(1)} vs previous 30 days
                  </span>
                )}
              </p>
            </div>
          </div>

          <p className="label mt-5">Rank of {ranks.total.toLocaleString()} creators</p>
          <dl className="mt-2 grid grid-cols-3 gap-2">
            <RankCell label="Overall" value={ranks.overall} />
            <RankCell label="Current" value={ranks.current} />
            <RankCell label="Rising" value={ranks.rising} />
          </dl>

          {topReactions(rating.reactions, 4).length > 0 && (
            <div className="mt-3">
              <ReactionBar reactions={topReactions(rating.reactions, 4)} />
            </div>
          )}

          <div className="mt-5">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-sm font-semibold">
                Level {level.level} — {level.name}
              </p>
              <p className="text-xs text-white/40">{user.points.toLocaleString()} pts</p>
            </div>
            <LevelMeter points={user.points} />
            <p className="mt-3 text-sm text-white/55">
              Goal: <span className="font-semibold text-white">{user.goal}</span>
            </p>
          </div>

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
                  rating={rating.overall}
                  count={rating.ratingsReceived}
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

        {/* Tabs --------------------------------------------------------- */}
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

        <div className="mt-4 space-y-4">
          {blocked ? (
            <EmptyState
              title="This profile is hidden"
              body="You and this person have blocked each other, so posts are not shown."
            />
          ) : tab === 'about' ? (
            <>
              <Journey name={user.display_name} journey={journey} history={history} />
              <section className="card p-6">
                <h2 className="font-display text-lg font-bold">What feeds this rating</h2>
                <p className="mt-1 text-sm text-white/45">
                  Ratings from the community are most of it. The rest is what the account
                  actually does.
                </p>
                <ul className="mt-4 space-y-3">
                  {[
                    { label: 'Consistency', value: rating.signals.consistency },
                    { label: 'Engagement', value: rating.signals.engagement },
                    { label: 'Follower growth', value: rating.signals.growth },
                    { label: 'Community participation', value: rating.signals.participation },
                    { label: 'Account history', value: rating.signals.history },
                  ].map((signal) => (
                    <li key={signal.label} className="flex items-center gap-3 text-sm">
                      <span className="w-44 shrink-0 text-white/55">{signal.label}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <span
                          className="block h-full rounded-full bg-gradient-to-r from-aura to-fay"
                          style={{ width: `${Math.round(signal.value * 10)}%` }}
                        />
                      </span>
                      <span className="w-8 text-right tabular-nums text-white/40">
                        {signal.value.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="card p-6">
                <h2 className="font-display text-lg font-bold">About</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <Row label="Joined" value={formatMonthYear(user.created_at)} />
                  <Row label="Trying to become" value={user.interests.join(', ') || '—'} />
                  <Row label="Location" value={user.location ?? 'Not shared'} />
                  <Row label="Current goal" value={user.goal} />
                  <Row
                    label="Challenges entered"
                    value={String(
                      new Set(
                        allPosts.filter((post) => post.challenge_id).map((post) => post.challenge_id),
                      ).size,
                    )}
                  />
                  <Row label="Likes received" value={formatCount(stats.likesReceived)} />
                </dl>
              </section>
            </>
          ) : (
            <>
              {tab === 'challenges' && posts.length > 0 && (
                <p className="text-sm text-white/45">
                  Entries in{' '}
                  {[
                    ...new Set(
                      shown
                        .map((post) => challengeById.get(post.challenge_id ?? '')?.title)
                        .filter(Boolean),
                    ),
                  ].join(', ')}
                </p>
              )}
              <PostList
                posts={posts}
                viewerId={viewer?.id ?? null}
                empty={
                  <EmptyState
                    title={
                      tab === 'challenges' ? 'No challenge entries yet' : 'Nothing posted yet'
                    }
                    body={
                      isSelf
                        ? 'Your first post earns 10 FayTarra points and goes straight into Discover.'
                        : `${user.display_name} has not posted here yet. Follow to be there when they do.`
                    }
                    cta={isSelf ? { href: '/create', label: 'Create a post' } : undefined}
                  />
                }
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function RankCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-center">
      <dt className="text-[10px] uppercase tracking-wide text-white/40">{label}</dt>
      <dd className="mt-0.5 font-display text-base font-extrabold tabular-nums">
        {value ? `#${value.toLocaleString()}` : '—'}
      </dd>
    </div>
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
