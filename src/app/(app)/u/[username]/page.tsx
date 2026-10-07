import type { Metadata } from 'next';
import { AdminBadge } from '@/components/AdminBadge';
import { isAdminRole } from '@/lib/admin-badge';
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
import { PlusIcon } from '@/components/Icons';
import { CreatePostMenu } from '@/components/CreatePostMenu';
import { shelfFor, type PostShelf } from '@/lib/media';
import { TextPostForm } from './TextPostForm';
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

/**
 * The profile's shelves.
 *
 * Posts first, because Posts is where a profile opens — a bar whose first chip is
 * not the one filled in reads as a bug. Each shelf is the same list filtered by
 * what its posts carry — see `shelfFor` — so nothing was migrated and an old post
 * lands on the right one the first time somebody looks.
 *
 * Their owner also gets a way to ADD to two of them here: a pre-recorded video
 * under Videos, and a written post under Text. Both are also in the Create post
 * sheet at the top of the page; these are the same destinations, offered next to
 * the thing they make.
 */
const TABS = ['posts', 'videos', 'text', 'about'] as const;

/** What an empty shelf says. Three lists deserve three answers. */
const SHELF_EMPTY: Record<PostShelf, { title: string; mine: string; theirs: string }> = {
  videos: {
    title: 'No videos yet',
    mine: 'Record one with the + button, or upload one you already have.',
    theirs: 'has not posted a video yet. Follow to be there when they do.',
  },
  posts: {
    title: 'No photo posts yet',
    mine: 'A photo and something to say. It shows up here.',
    theirs: 'has not posted a photo yet. Follow to be there when they do.',
  },
  text: {
    title: 'Nothing written yet',
    mine: 'Say something. No picture needed.',
    theirs: 'has not written anything yet. Follow to be there when they do.',
  },
};

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
  const shelf = tab === 'about' ? null : (tab as PostShelf);

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
      postsByAuthor(user.id, viewer),
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
  // One query, three shelves. The filter is on what a post carries rather than on
  // a column, so `postsByAuthor` — and the rule it already applies about what a
  // given viewer may see — is untouched.
  const shelved = shelf ? allPosts.filter((post) => shelfFor(post.media) === shelf) : [];
  const posts = blocked ? [] : await hydratePosts(shelved.slice(0, limit), viewer?.id ?? null);
  const counts = {
    videos: allPosts.filter((post) => shelfFor(post.media) === 'videos').length,
    posts: allPosts.filter((post) => shelfFor(post.media) === 'posts').length,
    text: allPosts.filter((post) => shelfFor(post.media) === 'text').length,
  };
  const moreHref = `/u/${user.username}?${new URLSearchParams({
    ...(tab === 'posts' ? {} : { tab }),
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
          {/* `relative z-10`, and it is load-bearing. `.card` carries
              `backdrop-blur-xl`, and a backdrop-filter creates a stacking
              context — so the ••• menu's `z-40` dropdown is trapped inside this
              header and cannot rise above anything outside it. The shelf tab bar
              comes later in the document, so it painted OVER the open menu, and a
              count badge landing on "Block" made that button unclickable. Raising
              the header itself is what lets the menu inside it win; it changes no
              layout, only paint order. */}
          <header className="card relative z-10 p-6">
            <div className="flex items-start gap-4">
              <Avatar
                username={user.username}
                displayName={user.display_name}
                src={user.avatar_url}
                size="xl"
                href={false}
              />
              <div className="min-w-0 flex-1">
                <h1 className="flex min-w-0 items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
                  <span className="truncate">{user.display_name}</span>
                  {isAdminRole(user.role) && <AdminBadge size="md" />}
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
                  {/* The general way in, beside Edit profile: Photo, Text,
                      Upload video, Record video. Record video opens the same
                      VideoStudio the `+` button does, by the same route. */}
                  <CreatePostMenu variant="button" />
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

          {/* Scrollable, because four chips and a count each do not fit across a
              small phone — and cutting one off the end would hide a whole shelf. */}
          <nav className="profile-tabs -mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((entry) => (
              // A plain anchor, not a `<Link>`, and deliberately. The shelf lives
              // in a search param on a `force-dynamic` page, and a client-side
              // navigation that only changes a search param was intermittently
              // applied as no change at all: the click fired, the RSC request was
              // answered 200, and the URL never moved — so tapping a shelf did
              // nothing perhaps a third of the time. `prefetch={false}` reduced it
              // without fixing it. A full navigation cannot be swallowed, and this
              // is a page-level view switch rather than an in-page interaction, so
              // the cost is a reload the server was doing all of anyway.
              <a
                key={entry}
                href={entry === 'posts' ? `/u/${user.username}` : `/u/${user.username}?tab=${entry}`}
                data-profile-tab={entry}
                aria-current={tab === entry ? 'page' : undefined}
                // A `chip`'s own padding makes a 34px-tall pill, which is fine
                // for a filter and too small for the navigation these four are:
                // the shelves are how somebody gets at their own videos, photos
                // and writing, so they are given a thumb-sized target.
                className={`chip min-h-[44px] shrink-0 px-4 text-sm capitalize ${tab === entry ? 'chip-active' : 'hover:bg-white/10'}`}
              >
                {entry}
                {entry !== 'about' && counts[entry] > 0 && (
                  <span className="tabular-nums opacity-60">{counts[entry]}</span>
                )}
              </a>
            ))}
          </nav>

          <div className="mt-4 space-y-4 pb-10">
            {blocked ? (
              <EmptyState
                title="This profile is hidden"
                body="One of you has blocked the other, so posts are not shown."
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
                {/* The owner's way to ADD to this shelf. Videos and Text are the
                    two kinds of creation that used to live behind the Create
                    page's toggle; they are here now, next to what they make.
                    Photos keep their own page, which is what /create is. */}
                {isSelf && shelf === 'videos' && (
                  <Link
                    href="/create/video?upload=1"
                    data-upload-video
                    className="btn-ghost min-h-[52px] w-full py-3.5"
                  >
                    <PlusIcon width={17} height={17} /> Upload a video you already have
                  </Link>
                )}
                {isSelf && shelf === 'posts' && (
                  <Link
                    href="/create"
                    data-new-photo-post
                    className="btn-ghost min-h-[52px] w-full py-3.5"
                  >
                    <PlusIcon width={17} height={17} /> New photo post
                  </Link>
                )}
                {isSelf && shelf === 'text' && <TextPostForm />}

                <PostList
                  posts={posts}
                  viewerId={viewer?.id ?? null}
                  empty={
                    <EmptyState
                      title={SHELF_EMPTY[shelf ?? 'posts'].title}
                      body={
                        isSelf
                          ? SHELF_EMPTY[shelf ?? 'posts'].mine
                          : `${user.display_name} ${SHELF_EMPTY[shelf ?? 'posts'].theirs}`
                      }
                      cta={
                        isSelf && shelf === 'videos'
                          ? { href: '/create/video', label: 'Record a video' }
                          : isSelf && shelf === 'posts'
                            ? { href: '/create', label: 'New photo post' }
                            : undefined
                      }
                    />
                  }
                />
                <LoadMore href={moreHref} hasMore={shelved.length > posts.length} />
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
