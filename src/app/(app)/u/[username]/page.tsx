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
import { TopCreators } from '@/components/TopCreators';
import { RateButton } from '@/components/RateSheet';
import { formatCount } from '@/lib/format';
import { profileSkin } from '@/lib/profile-theme';
import { formatVotes, topReactions } from '@/lib/ratings';
import { hydratePosts, postsByAuthor } from '@/lib/services/posts';
import { myRating, userRating } from '@/lib/services/ratings';
import { userRanks } from '@/lib/services/rankings';
import {
  getUserByUsername,
  getUserStats,
  isBlockedEitherWay,
  isFollowing,
} from '@/lib/services/users';
import { canMessage } from '@/lib/services/messages';
import { eligibleCreators, topCreators } from '@/lib/services/top-creators';
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

  const [stats, following, allPosts, rating, ranks, mine, messageable, top, pickable] =
    await Promise.all([
      getUserStats(user.id),
      viewer && !isSelf ? isFollowing(viewer.id, user.id) : Promise.resolve(false),
      postsByAuthor(user.id),
      userRating(user.id),
      userRanks(user.id),
      myRating(viewer?.id ?? null, 'user', user.id),
      viewer && !isSelf ? canMessage(viewer.id, user.id) : Promise.resolve(false),
      topCreators(user.id, viewer?.id ?? null),
      // Only the owner gets the list to choose from, and only they can change it.
      isSelf ? eligibleCreators(user.id) : Promise.resolve([]),
    ]);

  const requested = Number.parseInt(show ?? '', 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 20), 200) : 20;
  const posts = blocked ? [] : await hydratePosts(allPosts.slice(0, limit), viewer?.id ?? null);
  const moreHref = `/u/${user.username}?${new URLSearchParams({
    ...(tab === 'about' ? { tab } : {}),
    show: String(Math.min(limit + 20, 200)),
  })}`;
  const rated = rating.overallVotes > 0;

  // The owner's colours, or null when they have not picked any. Only custom
  // properties come out of this — the layout below is the same either way.
  const skin = profileSkin(user.profile_bg, user.profile_box);

  return (
    <>
      <PageTopBar title={`@${user.username}`} />
      <div
        className={skin ? 'profile-skin min-h-[100dvh]' : undefined}
        style={skin?.style as React.CSSProperties | undefined}
        data-profile-skin={skin ? 'on' : undefined}
      >
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

            <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
              <Stat
                label="Followers"
                value={formatCount(stats.followers)}
                href={`/u/${user.username}/followers`}
              />
              <Stat
                label="Following"
                value={formatCount(stats.following)}
                href={`/u/${user.username}/following`}
              />
              <Stat label="Posts" value={formatCount(stats.posts)} />
            </div>

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
                {isSelf
                  ? 'Not ranked yet — rankings build as more people rate you.'
                  : 'Not ranked yet.'}
              </p>
            )}

            {topReactions(rating.reactions, 4).length > 0 && (
              <div className="mt-4">
                <ReactionBar reactions={topReactions(rating.reactions, 4)} />
              </div>
            )}

            {/* Directly under the rating, and deliberately small: three names
                the owner picked, not a leaderboard. */}
            {!blocked && (
              <TopCreators
                slots={top.slots}
                owner={`@${user.username}`}
                canEdit={isSelf}
                options={pickable.map((person) => ({
                  id: person.id,
                  username: person.username,
                  displayName: person.display_name,
                  avatarUrl: person.avatar_url,
                }))}
              />
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
                  {/* Only appears while the follow is mutual. The rule is
                      enforced on the server and in the database either way. */}
                  {messageable && (
                    <Link
                      href={`/messages/${user.username}`}
                      className="btn-ghost px-6 py-2.5 text-sm"
                    >
                      Message
                    </Link>
                  )}
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

          <nav className="profile-tabs mt-6 flex gap-2">
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
      </div>
    </>
  );
}

/**
 * One number on a profile.
 *
 * Followers and Following take an `href` and become links to the list behind
 * them; Posts has no list of its own and stays plain text. The tap target is
 * the whole number-and-label pair, sized for a thumb.
 *
 * Spans rather than a description list, because two of the three are now
 * navigation and `<dt>`/`<dd>` are not allowed inside a link.
 */
function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <>
      <span className="font-display text-base font-bold">{value}</span>
      <span className="text-white/40">{label}</span>
    </>
  );

  if (!href) {
    return <span className="flex items-baseline gap-1.5">{inner}</span>;
  }

  return (
    <Link
      href={href}
      className="-mx-2 flex min-h-[44px] items-baseline gap-1.5 rounded-xl px-2 py-2.5 transition hover:bg-white/[0.06]"
    >
      {inner}
    </Link>
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
