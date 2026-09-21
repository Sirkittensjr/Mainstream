import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { FollowButton } from '@/components/FollowButton';
import { PageTopBar } from '@/components/PageTopBar';
import { RatingPill } from '@/components/RatingPill';
import { formatVotes, MIN_VOTES_FOR_RANKING } from '@/lib/ratings';
import {
  RANK_BOARDS,
  rankedCategories,
  rankings,
  userRanks,
  type RankBoard,
} from '@/lib/services/rankings';
import { CATEGORIES, type Category } from '@/lib/types';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Discover' };
export const dynamic = 'force-dynamic';

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; category?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  const board = (RANK_BOARDS.find((entry) => entry.key === params.board)?.key ??
    'overall') as RankBoard;
  const category = (CATEGORIES as readonly string[]).includes(params.category ?? '')
    ? (params.category as Category)
    : null;

  const [rows, categories, mine] = await Promise.all([
    rankings({ board, category, limit: 50 }),
    rankedCategories(),
    viewer ? userRanks(viewer.id) : Promise.resolve(null),
  ]);
  const active = RANK_BOARDS.find((entry) => entry.key === board)!;

  const href = (next: { board?: RankBoard; category?: string | null }) => {
    const search = new URLSearchParams();
    const merged = { board, category, ...next };
    if (merged.board !== 'overall') search.set('board', merged.board);
    if (merged.category) search.set('category', String(merged.category));
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
            The best rated people on FayTarra, by how much the community actually agrees — not by
            follower count.
          </p>
        </div>

        {viewer && mine && (
          <div className="card mb-5 flex items-center justify-between gap-4 p-5">
            <div>
              <p className="label">Where you sit</p>
              {mine.overall ? (
                <p className="mt-1 text-sm text-white/55">
                  #{mine.overall} overall
                  {mine.category && mine.categoryRank
                    ? ` · #${mine.categoryRank} in ${mine.category}`
                    : ''}{' '}
                  of {mine.total.toLocaleString()} rated people
                </p>
              ) : (
                <p className="mt-1 text-sm text-white/55">
                  {mine.votesNeeded} more rating{mine.votesNeeded === 1 ? '' : 's'} and you appear
                  here. Everyone needs {MIN_VOTES_FOR_RANKING}.
                </p>
              )}
            </div>
            <Link href={`/u/${viewer.username}`} className="text-sm font-semibold text-fay hover:underline">
              Profile
            </Link>
          </div>
        )}

        <div className="flex gap-2">
          {RANK_BOARDS.map((entry) => (
            <Link
              key={entry.key}
              href={href({ board: entry.key })}
              className={`chip ${board === entry.key ? 'chip-active' : 'hover:bg-white/10'}`}
            >
              {entry.label}
            </Link>
          ))}
        </div>
        <p className="mt-3 text-sm text-white/45">{active.blurb}</p>

        <div className="hide-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Link href={href({ category: null })} className={`chip ${!category ? 'chip-active' : 'hover:bg-white/10'}`}>
            All
          </Link>
          {categories.map((entry) => (
            <Link
              key={entry.category}
              href={href({ category: entry.category })}
              className={`chip ${category === entry.category ? 'chip-active' : 'hover:bg-white/10'}`}
            >
              {entry.category}
              <span className="text-[11px] opacity-50">{entry.people}</span>
            </Link>
          ))}
        </div>

        <h2 className="mt-7 font-display text-2xl font-extrabold tracking-tight">
          {category ?? 'Everyone'}
        </h2>
        <p className="text-sm text-white/35">{active.label}</p>

        <ol className="mt-4 space-y-2 pb-10">
          {rows.map((row) => (
            <li
              key={row.user.id}
              className={`card flex items-center gap-3 p-4 ${
                row.user.id === viewer?.id ? 'border-fay/40' : ''
              }`}
            >
              <span
                className={`w-8 shrink-0 text-center font-display text-lg font-extrabold tabular-nums ${
                  row.rank <= 3 ? 'gradient-text' : 'text-white/30'
                }`}
              >
                {row.rank}
              </span>
              <Avatar
                username={row.user.username}
                displayName={row.user.display_name}
                src={row.user.avatar_url}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/u/${row.user.username}`}
                  className="block truncate font-semibold hover:underline"
                >
                  {row.user.display_name}
                </Link>
                <p className="truncate text-xs text-white/40">
                  @{row.user.username} · {formatVotes(row.votes)}
                  {row.category ? ` · ${row.category}` : ''}
                </p>
              </div>
              <RatingPill
                value={row.rating}
                trend={board === 'recent' ? row.trend : undefined}
                votes={row.votes}
              />
              {viewer && viewer.id !== row.user.id && (
                <div className="hidden sm:block">
                  <FollowButton userId={row.user.id} initialFollowing={false} signedIn />
                </div>
              )}
            </li>
          ))}
          {rows.length === 0 && (
            <EmptyState
              title="Nobody here yet"
              body={`People appear once they have at least ${MIN_VOTES_FOR_RANKING} ratings, so a handful of votes cannot jump the queue.`}
              cta={{ href: '/home?tab=recommended', label: 'Browse posts' }}
            />
          )}
        </ol>
      </div>
    </>
  );
}
