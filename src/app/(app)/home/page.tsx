import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { LoadMore } from '@/components/LoadMore';
import { FEED_MAX, FEED_PAGE, followingFeed, recommendedFeed } from '@/lib/services/feed';
import { discoverPosts } from '@/lib/services/discovery';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

/**
 * Home is where browsing happens, so all three ways of browsing live here.
 *
 * None of them is a new feed: Following and Recommended are the same two
 * functions they always were, and Discover calls the same `discoverPosts` the
 * /discover page calls, with its default board. That page is still there, with
 * its boards, categories and people — this tab is its front door, and the link
 * under the tab is how you get to the rest of it.
 */
const TABS = ['following', 'recommended', 'discover'] as const;
type Tab = (typeof TABS)[number];

const TITLES: Record<Tab, string> = {
  following: 'Following',
  recommended: 'Recommended',
  discover: 'Discover',
};

const BLURBS: Record<Tab, string> = {
  following: 'Everything from the people you follow, newest first.',
  recommended: 'Good posts from people you might not have found yet.',
  discover: 'What the community has rated highest.',
};

/**
 * The Discover tab, borrowed whole from the Discover page.
 *
 * Same function, same default board, same ranking — the only thing added is
 * the "is there more" answer the feed components expect, which is worked out
 * by asking for one post past the page.
 */
async function discoverFeed(viewerId: string | null, limit: number) {
  const posts = await discoverPosts({ board: 'top', viewerId, limit: limit + 1 });
  return { posts: posts.slice(0, limit), hasMore: posts.length > limit };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; show?: string }>;
}) {
  const { tab, show } = await searchParams;
  const viewer = await getViewer();
  const asked = TABS.includes((tab ?? '') as Tab) ? (tab as Tab) : null;
  // Signed-out visitors have nobody to follow, so Following is not offered to
  // them and Recommended is where they land.
  const current: Tab = asked ?? (viewer ? 'following' : 'recommended');
  const active: Tab = current === 'following' && !viewer ? 'recommended' : current;

  // "Show more" grows the page rather than paginating, so the posts already
  // read stay where they were and nothing is lost on the way back.
  const requested = Number.parseInt(show ?? '', 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, FEED_PAGE), FEED_MAX)
    : FEED_PAGE;

  const feed =
    active === 'following' && viewer
      ? await followingFeed(viewer, limit)
      : active === 'discover'
        ? await discoverFeed(viewer?.id ?? null, limit)
        : await recommendedFeed(viewer, limit);

  const moreHref = `/home?${new URLSearchParams({
    ...(active === 'following' ? {} : { tab: active }),
    show: String(Math.min(limit + FEED_PAGE, FEED_MAX)),
  })}`;

  return (
    <>
      <PageTopBar />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 hidden lg:block">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">{TITLES[active]}</h1>
          <p className="mt-1 text-white/45">{BLURBS[active]}</p>
        </div>

        {/* Three tabs, and the one you are on is filled in. Scrollable rather
            than wrapped, so nothing reflows on a narrow phone. */}
        <nav
          aria-label="Feed"
          className="hide-scrollbar mb-4 flex gap-2 overflow-x-auto"
        >
          {(viewer ? TABS : TABS.filter((entry) => entry !== 'following')).map((entry) => (
            <Link
              key={entry}
              href={entry === 'following' ? '/home' : `/home?tab=${entry}`}
              aria-current={entry === active ? 'page' : undefined}
              className={`chip shrink-0 capitalize ${
                entry === active ? 'chip-active' : 'hover:bg-white/10'
              }`}
            >
              {entry}
            </Link>
          ))}
          {active === 'discover' && (
            <Link href="/discover" className="chip shrink-0 text-white/50 hover:bg-white/10">
              Boards and people
            </Link>
          )}
        </nav>

        {!viewer && (
          <div className="card mb-4 flex items-center gap-4 p-5">
            <div className="min-w-0">
              <p className="font-display text-lg font-bold">You are browsing as a guest.</p>
              <p className="text-sm text-white/50">Join to post, follow people and rate things.</p>
            </div>
            <Link href="/signup" className="btn-primary ml-auto shrink-0 px-5 py-2.5 text-sm">
              Join
            </Link>
          </div>
        )}

        <PostList
          posts={feed.posts}
          viewerId={viewer?.id ?? null}
          empty={
            active === 'following' ? (
              <EmptyState
                title="Your following feed is quiet"
                body="Follow a few people and their posts land here. Discover is full of people worth following."
                cta={{ href: '/home?tab=discover', label: 'Find people' }}
              />
            ) : active === 'discover' ? (
              <EmptyState
                title="Nothing to discover yet"
                body="Rated posts show up here as the community weighs in. Post something and it could be the first."
                cta={{ href: '/create', label: 'Create a post' }}
              />
            ) : (
              <EmptyState
                title="Nothing here yet"
                body="Be the first. Post something and people will see it."
                cta={{ href: '/create', label: 'Create a post' }}
              />
            )
          }
        />

        {feed.posts.length > 0 && (
          <LoadMore
            href={moreHref}
            hasMore={feed.hasMore && limit < FEED_MAX}
            endNote={
              active === 'following' ? (
                <>
                  That is everything from your follows.{' '}
                  <Link href="/home?tab=recommended" className="underline hover:text-white/60">
                    See what else is good
                  </Link>
                  .
                </>
              ) : active === 'discover' ? (
                <>
                  That is the top of the board.{' '}
                  <Link href="/discover" className="underline hover:text-white/60">
                    Trending, categories and people
                  </Link>
                  .
                </>
              ) : (
                <>
                  That is everything for now.{' '}
                  <Link href="/home?tab=discover" className="underline hover:text-white/60">
                    Discover more
                  </Link>
                  .
                </>
              )
            }
          />
        )}
      </div>
    </>
  );
}
