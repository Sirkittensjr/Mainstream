import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { CategoryChips } from '@/components/CategoryChips';
import { EmptyState } from '@/components/EmptyState';
import { LevelBadge } from '@/components/LevelBadge';
import { PageTopBar } from '@/components/PageTopBar';
import { RatingPill } from '@/components/RatingPill';
import {
  RANK_BOARDS,
  RANK_PERIODS,
  rankings,
  userRanks,
  type RankBoard,
  type RankPeriod,
} from '@/lib/services/rankings';
import { CATEGORIES, type Category } from '@/lib/types';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Rankings' };
export const dynamic = 'force-dynamic';

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; period?: string; category?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  const board = (RANK_BOARDS.find((entry) => entry.key === params.board)?.key ??
    'overall') as RankBoard;
  const period = (RANK_PERIODS.find((entry) => entry.key === params.period)?.key ??
    'all') as RankPeriod;
  const category = (CATEGORIES as readonly string[]).includes(params.category ?? '')
    ? (params.category as Category)
    : null;

  const [rows, mine] = await Promise.all([
    rankings({ board, period, category, limit: 50 }),
    viewer ? userRanks(viewer.id) : Promise.resolve(null),
  ]);
  const active = RANK_BOARDS.find((entry) => entry.key === board)!;

  const href = (next: { board?: RankBoard; period?: RankPeriod; category?: string | null }) => {
    const search = new URLSearchParams();
    const merged = { board, period, category, ...next };
    if (merged.board !== 'overall') search.set('board', merged.board);
    if (merged.period !== 'all') search.set('period', merged.period);
    if (merged.category) search.set('category', String(merged.category));
    const value = search.toString();
    return value ? `/rankings?${value}` : '/rankings';
  };

  return (
    <>
      <PageTopBar title="Rankings" />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 hidden lg:block">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Rankings</h1>
          <p className="mt-1 text-white/45">
            Nobody ranks here for having a big account. You rank for how good the work is and how
            people are responding to it.
          </p>
        </div>

        {viewer && mine && (
          <div className="card mb-5 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="label">Your rank</p>
                <p className="mt-1 text-sm text-white/50">
                  out of {mine.total.toLocaleString()} active creators
                  {mine.category ? ` · ${mine.category} #${mine.categoryRank}` : ''}
                </p>
              </div>
              <Link
                href={`/u/${viewer.username}`}
                className="text-sm font-semibold text-fay hover:underline"
              >
                Profile
              </Link>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3">
              <RankCell label="Overall" value={mine.overall} />
              <RankCell label="Current" value={mine.current} />
              <RankCell label="Rising" value={mine.rising} />
            </dl>
          </div>
        )}

        <div className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
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
          {RANK_PERIODS.map((entry) => (
            <Link
              key={entry.key}
              href={href({ period: entry.key })}
              className={`chip ${period === entry.key ? 'chip-active' : 'hover:bg-white/10'}`}
            >
              {entry.label}
            </Link>
          ))}
        </div>

        <div className="mt-3">
          <CategoryChips basePath={href({ category: null })} active={category} />
        </div>

        <h2 className="mt-7 font-display text-2xl font-extrabold uppercase tracking-tight">
          {active.label}
          {category ? ` · ${category}` : ''}
        </h2>
        <p className="text-sm text-white/35">
          {RANK_PERIODS.find((entry) => entry.key === period)!.label}
        </p>

        <ol className="mt-4 space-y-2 pb-10">
          {rows.map((row) => (
            <li
              key={row.user.id}
              className={`card flex items-center gap-3 p-4 ${
                row.user.id === viewer?.id ? 'border-fay/40' : ''
              }`}
            >
              <span
                className={`w-9 shrink-0 text-center font-display text-lg font-extrabold tabular-nums ${
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
                  @{row.user.username} · {row.followers.toLocaleString()} followers ·{' '}
                  {row.ratings} ratings
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {board === 'rising' ? (
                  <span className="font-display text-base font-bold tabular-nums text-mint">
                    {row.metric.toFixed(1)}
                  </span>
                ) : (
                  <RatingPill
                    value={row.metric}
                    trend={board === 'current' ? row.trend : undefined}
                    size="sm"
                  />
                )}
                <span className="text-[10px] uppercase tracking-wide text-white/30">
                  {row.metricLabel}
                </span>
              </div>
              <div className="hidden shrink-0 sm:block">
                <LevelBadge level={row.level} name={row.levelName} size="xs" />
              </div>
            </li>
          ))}
          {rows.length === 0 && (
            <EmptyState
              title="Nobody on this board yet"
              body="Boards fill up as people post, rate and respond. Be the first name on it."
              cta={{ href: '/create', label: 'Create a post' }}
            />
          )}
        </ol>
      </div>
    </>
  );
}

function RankCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 px-3 py-3 text-center">
      <dt className="text-[10px] uppercase tracking-wide text-white/40">{label}</dt>
      <dd className="mt-0.5 font-display text-xl font-extrabold tabular-nums">
        {value ? `#${value.toLocaleString()}` : '—'}
      </dd>
    </div>
  );
}
