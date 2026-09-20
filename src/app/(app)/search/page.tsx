import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { FollowButton } from '@/components/FollowButton';
import { LevelBadge } from '@/components/LevelBadge';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { SearchIcon } from '@/components/Icons';
import { SectionHeader } from '@/components/EmptyState';
import { search } from '@/lib/services/search';
import { CATEGORIES } from '@/lib/types';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Search' };
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const viewer = await getViewer();
  const results = await search(query, viewer?.id ?? null);
  const nothing =
    query &&
    results.people.length === 0 &&
    results.posts.length === 0 &&
    results.categories.length === 0 &&
    results.challenges.length === 0;

  return (
    <>
      <PageTopBar title="Search" />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <form action="/search" className="relative">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            name="q"
            defaultValue={query}
            autoFocus={!query}
            placeholder="People, posts, categories, challenges"
            className="w-full py-4 pl-12"
            aria-label="Search RISE"
          />
        </form>

        {!query && (
          <div className="mt-8">
            <SectionHeader title="Browse categories" />
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((category) => (
                <Link
                  key={category}
                  href={`/discover?category=${encodeURIComponent(category)}`}
                  className="chip hover:bg-white/10"
                >
                  {category}
                </Link>
              ))}
            </div>
          </div>
        )}

        {nothing && (
          <p className="mt-10 text-center text-sm text-white/40">
            Nothing matched &ldquo;{query}&rdquo;. Try a name, a tag or a category.
          </p>
        )}

        {results.people.length > 0 && (
          <section className="mt-8">
            <SectionHeader title="People" />
            <ul className="space-y-2">
              {results.people.map((entry) => (
                <li key={entry.user.id} className="card flex items-center gap-3 p-4">
                  <Avatar
                    username={entry.user.username}
                    displayName={entry.user.display_name}
                    src={entry.user.avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/u/${entry.user.username}`}
                      className="block truncate font-semibold hover:underline"
                    >
                      {entry.user.display_name}
                    </Link>
                    <p className="truncate text-xs text-white/40">
                      @{entry.user.username} · {entry.followers} followers
                    </p>
                  </div>
                  <LevelBadge level={entry.level} name={entry.levelName} size="xs" />
                  {viewer && viewer.id !== entry.user.id && (
                    <FollowButton
                      userId={entry.user.id}
                      initialFollowing={false}
                      signedIn={Boolean(viewer)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {results.challenges.length > 0 && (
          <section className="mt-8">
            <SectionHeader title="Challenges" />
            <ul className="space-y-2">
              {results.challenges.map((challenge) => (
                <li key={challenge.slug}>
                  <Link
                    href={`/challenges/${challenge.slug}`}
                    className="card block p-4 transition hover:border-white/20"
                  >
                    <p className="font-display font-bold">{challenge.title}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-white/45">
                      {challenge.description}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {results.categories.length > 0 && (
          <section className="mt-8">
            <SectionHeader title="Categories" />
            <div className="flex flex-wrap gap-2">
              {results.categories.map((category) => (
                <Link
                  key={category}
                  href={`/discover?category=${encodeURIComponent(category)}`}
                  className="chip hover:bg-white/10"
                >
                  {category}
                </Link>
              ))}
            </div>
          </section>
        )}

        {results.posts.length > 0 && (
          <section className="mt-8 pb-10">
            <SectionHeader title="Posts" />
            <PostList posts={results.posts} viewerId={viewer?.id ?? null} />
          </section>
        )}
      </div>
    </>
  );
}
