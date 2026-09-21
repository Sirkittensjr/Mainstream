import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { followingFeed, recommendedFeed } from '@/lib/services/feed';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const viewer = await getViewer();
  // Signed-out visitors have nobody to follow, so they get Recommended.
  const onFollowing = Boolean(viewer) && tab !== 'recommended';

  const posts = onFollowing && viewer ? await followingFeed(viewer) : await recommendedFeed(viewer);

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
          posts={posts}
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

        <p className="py-10 text-center text-xs text-white/25">
          {onFollowing ? (
            <>
              That is everything from your follows.{' '}
              <Link href="/home?tab=recommended" className="underline hover:text-white/60">
                See what else is good
              </Link>
              .
            </>
          ) : (
            'That is everything for now.'
          )}
        </p>
      </div>
    </>
  );
}
