import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { LoadMore } from '@/components/LoadMore';
import { FEED_MAX, FEED_PAGE, followingFeed, recommendedFeed } from '@/lib/services/feed';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; show?: string }>;
}) {
  const { tab, show } = await searchParams;
  const viewer = await getViewer();
  // Signed-out visitors have nobody to follow, so they get Recommended.
  const onFollowing = Boolean(viewer) && tab !== 'recommended';

  // "Show more" grows the page rather than paginating, so the posts already
  // read stay where they were and nothing is lost on the way back.
  const requested = Number.parseInt(show ?? '', 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, FEED_PAGE), FEED_MAX)
    : FEED_PAGE;

  const feed =
    onFollowing && viewer
      ? await followingFeed(viewer, limit)
      : await recommendedFeed(viewer, limit);

  const moreHref = `/home?${new URLSearchParams({
    ...(onFollowing ? {} : { tab: 'recommended' }),
    show: String(Math.min(limit + FEED_PAGE, FEED_MAX)),
  })}`;

  return (
    <>
      <PageTopBar />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 hidden lg:block">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            {onFollowing ? 'Following' : 'Recommended'}
          </h1>
          <p className="mt-1 text-white/45">
            {onFollowing
              ? 'Everything from the people you follow, newest first.'
              : 'Good posts from people you might not have found yet.'}
          </p>
        </div>

        {viewer ? (
          <div className="mb-4 flex gap-2">
            <Link href="/home" className={`chip ${onFollowing ? 'chip-active' : 'hover:bg-white/10'}`}>
              Following
            </Link>
            <Link
              href="/home?tab=recommended"
              className={`chip ${!onFollowing ? 'chip-active' : 'hover:bg-white/10'}`}
            >
              Recommended
            </Link>
          </div>
        ) : (
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
            onFollowing ? (
              <EmptyState
                title="Your following feed is quiet"
                body="Follow a few people and their posts land here. Discover is full of people worth following."
                cta={{ href: '/discover', label: 'Find people' }}
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
              onFollowing ? (
                <>
                  That is everything from your follows.{' '}
                  <Link href="/home?tab=recommended" className="underline hover:text-white/60">
                    See what else is good
                  </Link>
                  .
                </>
              ) : (
                <>
                  That is everything for now.{' '}
                  <Link href="/discover" className="underline hover:text-white/60">
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
