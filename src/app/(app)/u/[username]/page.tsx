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
import { PencilIcon, PlusIcon } from '@/components/Icons';
import { ProfileBackdrop } from '@/components/ProfileBackdrop';
import { CreatePostMenu } from '@/components/CreatePostMenu';
import { mediaKindForUrl, sanitiseAvatarUrl } from '@/lib/media';
import { ProfileShelves } from '@/components/ProfileShelves';
import {
  PROFILE_TABS,
  profileTabFrom,
  shelfHref,
  shelfLimit,
  shelfPages,
  SHELF_MAX,
  type ProfileShelf,
  type ProfileTab,
} from '@/lib/profile-shelves';
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
 * The profile's shelves — see `PROFILE_TABS`.
 *
 * Posts is everything somebody has posted, newest first: photos, videos and
 * written posts alike. Videos and Text are that same list filtered by what each
 * post carries — see `shelfFor` — so nothing was migrated and an old post lands
 * on the right one the first time somebody looks.
 *
 * Their owner also gets a way to ADD to them here: a photo post under Posts, a
 * pre-recorded video under Videos, and a written post under Text. All are also in
 * the Create post sheet at the top of the page; these are the same destinations,
 * offered next to the thing they make.
 */
const SHELF_EMPTY: Record<ProfileShelf, { title: string; mine: string; theirs: string }> = {
  videos: {
    title: 'No videos yet',
    mine: 'Record one with the + button, or upload one you already have.',
    theirs: 'has not posted a video yet. Follow to be there when they do.',
  },
  posts: {
    title: 'No posts yet',
    mine: 'Photos, videos and anything you write all show up here.',
    theirs: 'has not posted anything yet. Follow to be there when they do.',
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
  const tab = profileTabFrom(tabParam);

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

  // One query, three shelves. The filter is on what a post carries rather than on
  // a column, so `postsByAuthor` — and the rule it already applies about what a
  // given viewer may see — is untouched.
  //
  // Every shelf's first page is rendered now, so switching tab in the browser
  // is instant and needs nothing from the server. The open shelf goes as far as
  // `?show=` asked; the others stop at their first page; and the posts on those
  // pages are hydrated together, once — never the whole profile.
  const { shelves, wanted } = shelfPages(allPosts, tab, shelfLimit(show));
  const hydrated = blocked ? [] : await hydratePosts(wanted, viewer?.id ?? null);
  const views = new Map(hydrated.map((view) => [view.post.id, view]));
  const pageOf = (shelf: ProfileShelf) =>
    shelves[shelf].page.flatMap((post) => views.get(post.id) ?? []);
  const rated = rating.overallVotes > 0;

  // The owner's background photo, if it is still a picture FayTarra stored.
  // Checked here as well as when it was saved: the row can be written through
  // the API too, and a profile is never pointed at anybody else's server.
  const storedCover = sanitiseAvatarUrl(user.profile_cover_url);
  const cover = storedCover && mediaKindForUrl(storedCover) === 'image' ? storedCover : null;

  // The owner's colours, or null when they have not picked any. Only custom
  // properties come out of this — the layout below is the same either way.
  const skin = profileSkin(user.profile_bg, user.profile_box, { photo: Boolean(cover) });
  // A gradient or a photo is painted by the backdrop behind the whole page;
  // the column must not cover it with the gradient's flat stand-in colour.
  const seeThrough = Boolean(cover || skin?.background?.gradient);

  return (
    <>
      <PageTopBar title={`@${user.username}`} />
      {/* Behind everything — sidebar, profile and rail — not just this column. */}
      <ProfileBackdrop background={skin?.background ?? null} photo={cover} />
      <div
        className={skin ? 'profile-skin min-h-[100dvh]' : undefined}
        style={
          skin
            ? ({
                ...skin.style,
                ...(seeThrough ? { backgroundColor: 'transparent' } : {}),
              } as React.CSSProperties)
            : undefined
        }
        data-profile-skin={skin ? 'on' : undefined}
        data-profile-cover={cover ? 'photo' : undefined}
      >
        {/* Wider on a desktop: the profile is the page, not a card in it. */}
        <div className="mx-auto max-w-2xl px-4 pt-4 lg:max-w-[880px] lg:px-6 lg:pt-0">
          {/* On a desktop, a window onto the background before the card starts —
              the owner's colour or photo, with the picture overlapping it. */}
          <div aria-hidden className="hidden h-28 lg:block" />
          {/* `relative z-10`, and it is load-bearing. `.card` carries
              `backdrop-blur-xl`, and a backdrop-filter creates a stacking
              context — so the ••• menu's `z-40` dropdown is trapped inside this
              header and cannot rise above anything outside it. The shelf tab bar
              comes later in the document, so it painted OVER the open menu, and a
              count badge landing on "Block" made that button unclickable. Raising
              the header itself is what lets the menu inside it win; it changes no
              layout, only paint order. */}
          {/* On a desktop the order changes, and only the order: who this is,
              then what you can do here, then everything else. One copy of each
              control either way — the buttons move up with `order`, they are not
              drawn twice. */}
          <header
            className="card relative z-10 flex flex-col p-6 lg:px-8 lg:pb-8 lg:pt-0"
            data-profile-header
          >
            <div className="flex items-start gap-4 lg:order-1 lg:items-end lg:gap-6">
              <span className="shrink-0 rounded-full lg:-mt-16 lg:ring-[6px] lg:ring-ink-900/90">
                <Avatar
                  username={user.username}
                  displayName={user.display_name}
                  src={user.avatar_url}
                  size="profile"
                  href={false}
                />
              </span>
              <div className="min-w-0 flex-1 lg:pb-1">
                <h1 className="flex min-w-0 items-center gap-2 font-display text-2xl font-extrabold tracking-tight lg:text-4xl">
                  <span className="truncate">{user.display_name}</span>
                  {isAdminRole(user.role) && <AdminBadge size="md" />}
                </h1>
                <p className="text-white/45 lg:mt-1 lg:text-lg">@{user.username}</p>
                {user.status === 'suspended' && (
                  <span className="chip mt-2 border-fay/40 bg-fay/10 text-fay">Suspended</span>
                )}
              </div>
            </div>

            {user.bio && (
              <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-white/80 lg:order-3 lg:mt-6 lg:max-w-[62ch] lg:text-base">
                {user.bio}
              </p>
            )}

            {user.interests.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 lg:order-3 lg:mt-4">
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
            {user.location && (
              <p className="mt-3 text-sm text-white/35 lg:order-3">📍 {user.location}</p>
            )}

            {/* The numbers. A phone keeps its line of three and its two rating
                boxes; a desktop lays all five out as one row of tiles. */}
            <div className="lg:order-3 lg:mt-7 lg:grid lg:grid-cols-[3fr_2fr] lg:gap-3">
              <div
                className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm lg:mt-0 lg:grid lg:grid-cols-3 lg:items-stretch lg:gap-3"
                data-profile-stats
              >
                <Stat label="Posts" value={formatCount(stats.posts)} />
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
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 lg:mt-0">
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
            </div>

            {ranks.overall ? (
              <p className="mt-3 text-sm text-white/50 lg:order-3">
                <Link href="/discover" className="font-semibold text-white hover:underline">
                  #{ranks.overall}
                </Link>{' '}
                of {ranks.total.toLocaleString()} rated people
                {ranks.category && ranks.categoryRank
                  ? ` · #${ranks.categoryRank} in ${ranks.category}`
                  : ''}
              </p>
            ) : (
              <p className="mt-3 text-sm text-white/35 lg:order-3">
                {isSelf
                  ? 'Not ranked yet — rankings build as more people rate you.'
                  : 'Not ranked yet.'}
              </p>
            )}

            {topReactions(rating.reactions, 4).length > 0 && (
              <div className="mt-4 lg:order-3">
                <ReactionBar reactions={topReactions(rating.reactions, 4)} />
              </div>
            )}

            {/* Directly under the rating, and deliberately small: three names
                the owner picked, not a leaderboard. */}
            {!blocked && (
              <div className="lg:order-3 lg:mt-2">
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
              </div>
            )}

            <div
              className="mt-5 flex flex-wrap items-center gap-2 lg:order-2 lg:mt-6 lg:gap-3"
              data-profile-actions
            >
              {isSelf ? (
                <>
                  <Link
                    href="/settings"
                    data-edit-profile
                    className="btn-primary min-h-[48px] px-7 text-[15px] lg:min-h-[52px] lg:px-8 lg:text-base"
                  >
                    <PencilIcon width={18} height={18} /> Edit profile
                  </Link>
                  {/* The general way in, beside Edit profile: Photo, Text,
                      Upload video, Record video. Record video opens the same
                      VideoStudio the `+` button does, by the same route. */}
                  <CreatePostMenu
                    variant="button"
                    quiet
                    className="min-h-[48px] px-6 text-[15px] lg:min-h-[52px] lg:text-base"
                  />
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

          <ProfileShelves
            tabs={PROFILE_TABS.map((entry) => ({
              tab: entry,
              href: shelfHref(
                user.username,
                entry,
                entry === 'about' ? undefined : shelves[entry].limit,
              ),
              count: entry === 'about' ? null : shelves[entry].all.length,
            }))}
            panels={
              Object.fromEntries(
                PROFILE_TABS.map((entry) => [
                  entry,
                  blocked ? (
                    <EmptyState
                      title="This profile is hidden"
                      body="One of you has blocked the other, so posts are not shown."
                    />
                  ) : entry === 'about' ? (
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
                    <Shelf
                      shelf={entry}
                      posts={pageOf(entry)}
                      hasMore={shelves[entry].all.length > shelves[entry].page.length}
                      moreHref={shelfHref(
                        user.username,
                        entry,
                        Math.min(shelves[entry].limit + 20, SHELF_MAX),
                      )}
                      isSelf={isSelf}
                      viewerId={viewer?.id ?? null}
                      displayName={user.display_name}
                    />
                  ),
                ]),
              ) as Record<ProfileTab, React.ReactNode>
            }
          />
        </div>
      </div>
    </>
  );
}

/**
 * One shelf of posts: the owner's way to add to it, its first page, and more.
 */
function Shelf({
  shelf,
  posts,
  hasMore,
  moreHref,
  isSelf,
  viewerId,
  displayName,
}: {
  shelf: ProfileShelf;
  posts: Awaited<ReturnType<typeof hydratePosts>>;
  hasMore: boolean;
  moreHref: string;
  isSelf: boolean;
  viewerId: string | null;
  displayName: string;
}) {
  return (
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
        <Link href="/create" data-new-photo-post className="btn-ghost min-h-[52px] w-full py-3.5">
          <PlusIcon width={17} height={17} /> New photo post
        </Link>
      )}
      {isSelf && shelf === 'text' && <TextPostForm />}

      <PostList
        posts={posts}
        viewerId={viewerId}
        empty={
          <EmptyState
            title={SHELF_EMPTY[shelf].title}
            body={isSelf ? SHELF_EMPTY[shelf].mine : `${displayName} ${SHELF_EMPTY[shelf].theirs}`}
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
      <LoadMore href={moreHref} hasMore={hasMore} />
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
      <span className="font-display text-base font-bold lg:text-3xl lg:leading-none">{value}</span>
      <span className="text-white/40 lg:text-sm">{label}</span>
    </>
  );
  // On a desktop each number is a tile of its own, like the two ratings beside it.
  const tile =
    'lg:mx-0 lg:min-h-[108px] lg:flex-col lg:items-start lg:justify-between lg:gap-3 lg:rounded-2xl lg:border lg:border-white/[0.07] lg:bg-black/20 lg:p-4';

  if (!href) {
    return (
      <span
        className={`-mx-2 flex min-h-[44px] items-baseline gap-1.5 rounded-xl px-2 py-2.5 ${tile}`}
        data-profile-stat={label.toLowerCase()}
      >
        {inner}
      </span>
    );
  }

  return (
    <Link
      href={href}
      data-profile-stat={label.toLowerCase()}
      className={`-mx-2 flex min-h-[44px] items-baseline gap-1.5 rounded-xl px-2 py-2.5 transition hover:bg-white/[0.06] ${tile}`}
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
