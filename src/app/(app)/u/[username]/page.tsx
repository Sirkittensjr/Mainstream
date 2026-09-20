import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { FollowButton } from '@/components/FollowButton';
import { Journey } from '@/components/Journey';
import { LevelBadge, RiseMeter } from '@/components/LevelBadge';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { ProfileMenu } from '@/components/ProfileMenu';
import { formatCount, levelFor } from '@/lib/rise';
import { hydratePosts, postsByAuthor } from '@/lib/services/posts';
import {
  getJourney,
  getUserByUsername,
  getUserStats,
  isBlockedEitherWay,
  isFollowing,
} from '@/lib/services/users';
import { db } from '@/lib/db';
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

  const [stats, following, allPosts, journey, challenges] = await Promise.all([
    getUserStats(user.id),
    viewer && !isSelf ? isFollowing(viewer.id, user.id) : Promise.resolve(false),
    postsByAuthor(user.id),
    getJourney(user),
    db().query('challenges'),
  ]);

  const challengeById = new Map(challenges.map((entry) => [entry.id, entry]));
  const shown = tab === 'challenges' ? allPosts.filter((post) => post.challenge_id) : allPosts;
  const posts = blocked ? [] : await hydratePosts(shown.slice(0, 40), viewer?.id ?? null);
  const level = levelFor(user.rise_points);

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
                  <span className="chip border-ember/40 bg-ember/10 text-ember">Suspended</span>
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

          <div className="mt-5">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-sm font-semibold">
                RISE Level {level.level} — {level.name}
              </p>
              <p className="text-xs text-white/40">{user.rise_points.toLocaleString()} pts</p>
            </div>
            <RiseMeter points={user.rise_points} />
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
              <Journey name={user.display_name} journey={journey} />
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
                        ? 'Your first post earns 10 RISE points and goes straight into Discover.'
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
