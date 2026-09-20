import type { Metadata } from 'next';
import Link from 'next/link';
import { CategoryChips } from '@/components/CategoryChips';
import { CreatorRow } from '@/components/CreatorRow';
import { EmptyState, SectionHeader } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { SparkIcon } from '@/components/Icons';
import { categoryCounts, discover } from '@/lib/services/discover';
import { CATEGORIES, type Category } from '@/lib/types';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Discover' };
export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'rising', label: 'Rising' },
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'shots', label: 'Give me a shot' },
] as const;

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  const category = (CATEGORIES as readonly string[]).includes(params.category ?? '')
    ? (params.category as Category)
    : null;
  const tab = TABS.find((entry) => entry.key === params.tab)?.key ?? 'rising';

  const [feeds, counts] = await Promise.all([
    discover({ category, viewer, perSection: 15 }),
    categoryCounts(),
  ]);
  const countMap = new Map(counts.map((entry) => [entry.category as string, entry.posts]));

  const posts =
    tab === 'trending'
      ? feeds.trending
      : tab === 'new'
        ? feeds.fresh
        : tab === 'shots'
          ? feeds.shots
          : feeds.rising;

  const query = (next: Record<string, string | null>) => {
    const search = new URLSearchParams();
    const merged = { category, tab, ...next };
    if (merged.category) search.set('category', String(merged.category));
    if (merged.tab && merged.tab !== 'rising') search.set('tab', String(merged.tab));
    const value = search.toString();
    return value ? `/discover?${value}` : '/discover';
  };

  return (
    <>
      <PageTopBar title="Discover" />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 hidden lg:block">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Discover</h1>
          <p className="mt-1 text-white/45">
            Ranked by momentum, not follower count. This is where unknown creators get found.
          </p>
        </div>

        <CategoryChips basePath="/discover" active={category} counts={countMap} />

        <div className="mt-4 flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
          {TABS.map((entry) => (
            <Link
              key={entry.key}
              href={query({ tab: entry.key })}
              className={`chip ${tab === entry.key ? 'chip-active' : 'hover:bg-white/10'}`}
            >
              {entry.key === 'shots' && <SparkIcon width={13} height={13} />}
              {entry.label}
            </Link>
          ))}
        </div>

        {tab === 'rising' && feeds.risingCreators.length > 0 && (
          <section className="mt-6">
            <SectionHeader
              title="Creators to watch"
              subtitle="Momentum this week, weighted so small accounts can win"
            />
            <CreatorRow creators={feeds.risingCreators} viewerId={viewer?.id ?? null} />
          </section>
        )}

        <section className="mt-6">
          <SectionHeader
            title={TABS.find((entry) => entry.key === tab)!.label}
            subtitle={
              tab === 'rising'
                ? 'Posts outperforming the size of the audience behind them'
                : tab === 'trending'
                  ? 'What the whole platform is engaging with right now'
                  : tab === 'new'
                    ? 'Just posted. Be the first person to see it.'
                    : 'Creators who asked the community for a shot. These rotate every few hours.'
            }
          />
          {tab === 'shots' && (
            <p className="mb-4 rounded-2xl border border-ember/20 bg-ember/[0.07] px-4 py-3 text-sm text-white/60">
              Nobody is promised a viral post. What RISE promises is a turn — every shot post
              rotates through this page, and new posts start near the front.{' '}
              <Link href="/create" className="font-semibold text-ember hover:underline">
                Ask for yours
              </Link>
              .
            </p>
          )}
          <PostList
            posts={posts}
            viewerId={viewer?.id ?? null}
            empty={
              <EmptyState
                title="Nothing here yet"
                body={
                  category
                    ? `No ${category} posts yet. Post one and you will be the whole category for a minute.`
                    : 'No posts match this view yet.'
                }
                cta={{ href: '/create', label: 'Create a post' }}
              />
            }
          />
        </section>
      </div>
    </>
  );
}
