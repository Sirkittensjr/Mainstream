import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { LevelMeter } from '@/components/LevelBadge';
import { homeFeed } from '@/lib/services/feed';
import { hydratePosts, visiblePosts } from '@/lib/services/posts';
import { followingIds } from '@/lib/services/users';
import { levelFor } from '@/lib/progression';
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
  const onlyFollowing = tab === 'following';

  const posts = onlyFollowing && viewer ? await followingFeed(viewer.id) : await homeFeed(viewer);
  const level = viewer ? levelFor(viewer.points) : null;

  return (
    <>
      <PageTopBar />

      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 hidden lg:block">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Your feed</h1>
          <p className="mt-1 text-white/45">
            People you follow, plus creators FayTarra thinks you should see before anyone else does.
          </p>
        </div>

        {viewer && level ? (
          <div className="card mb-4 p-4 xl:hidden">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="font-display text-base font-bold">
                Level {level.level} — {level.name}
              </p>
              <p className="text-xs text-white/40">{viewer.points.toLocaleString()} pts</p>
            </div>
            <LevelMeter points={viewer.points} />
          </div>
        ) : (
          !viewer && (
            <div className="card mb-4 flex items-center gap-4 p-5">
              <div className="min-w-0">
                <p className="font-display text-lg font-bold">You are browsing as a guest.</p>
                <p className="text-sm text-white/50">
                  Join to post, follow and start your own FayTarra level.
                </p>
              </div>
              <Link href="/signup" className="btn-primary ml-auto shrink-0 px-5 py-2.5 text-sm">
                Join
              </Link>
            </div>
          )
        )}

        {viewer && (
          <div className="mb-4 flex gap-2">
            <Link
              href="/home"
              className={`chip ${!onlyFollowing ? 'chip-active' : 'hover:bg-white/10'}`}
            >
              For you
            </Link>
            <Link
              href="/home?tab=following"
              className={`chip ${onlyFollowing ? 'chip-active' : 'hover:bg-white/10'}`}
            >
              Following
            </Link>
          </div>
        )}

        <PostList
          posts={posts}
          viewerId={viewer?.id ?? null}
          empty={
            onlyFollowing ? (
              <EmptyState
                title="Nothing from your follows yet"
                body="Follow a few creators and their posts will land here. Discover is full of people who just started."
                cta={{ href: '/discover', label: 'Find creators' }}
              />
            ) : (
              <EmptyState
                title="The feed is empty"
                body="Be the first. Post something and it goes straight into Discover for everyone else."
                cta={{ href: '/create', label: 'Create a post' }}
              />
            )
          }
        />

        <p className="py-10 text-center text-xs text-white/25">
          That is everything for now. Check{' '}
          <Link href="/discover" className="underline hover:text-white/60">
            Discover
          </Link>{' '}
          for creators you have never seen.
        </p>
      </div>
    </>
  );
}

async function followingFeed(viewerId: string) {
  const [posts, following] = await Promise.all([
    visiblePosts(viewerId),
    followingIds(viewerId),
  ]);
  return hydratePosts(
    posts.filter((post) => following.has(post.author_id)).slice(0, 40),
    viewerId,
  );
}
