import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { CategoryChips } from '@/components/CategoryChips';
import { EmptyState } from '@/components/EmptyState';
import { LevelBadge } from '@/components/LevelBadge';
import { PageTopBar } from '@/components/PageTopBar';
import { leaderboard, type Board } from '@/lib/services/leaderboards';
import { CATEGORIES, type Category } from '@/lib/types';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Leaderboards' };
export const dynamic = 'force-dynamic';

const BOARDS: { key: Board; label: string; blurb: string }[] = [
  {
    key: 'rising',
    label: 'Rising this week',
    blurb: 'RISE points earned in the last 7 days. Participation, not popularity.',
  },
  {
    key: 'fastest',
    label: 'Fastest growing',
    blurb: 'New followers relative to audience size, so small accounts can top this.',
  },
  {
    key: 'challengers',
    label: 'Top challenge creators',
    blurb: 'Most challenge entries. Show up every week and you land here.',
  },
];

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; category?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  const board = (BOARDS.find((entry) => entry.key === params.board)?.key ?? 'rising') as Board;
  const category = (CATEGORIES as readonly string[]).includes(params.category ?? '')
    ? (params.category as Category)
    : null;

  const rows = await leaderboard({ board, category, limit: 25 });
  const active = BOARDS.find((entry) => entry.key === board)!;
  const href = (next: { board?: Board; category?: string | null }) => {
    const search = new URLSearchParams();
    const merged = { board, category, ...next };
    if (merged.board && merged.board !== 'rising') search.set('board', merged.board);
    if (merged.category) search.set('category', String(merged.category));
    const value = search.toString();
    return value ? `/leaderboards?${value}` : '/leaderboards';
  };

  return (
    <>
      <PageTopBar title="Leaderboards" />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 hidden lg:block">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Leaderboards</h1>
          <p className="mt-1 text-white/45">
            Nobody ranks here for having a big account. You rank for what you did this week.
          </p>
        </div>

        <div className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {BOARDS.map((entry) => (
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

        <div className="mt-4">
          <CategoryChips basePath={href({ category: null })} active={category} />
        </div>

        <h2 className="mt-7 font-display text-2xl font-extrabold uppercase tracking-tight">
          {active.label}
          {category ? ` · ${category}` : ''}
        </h2>

        <ol className="mt-4 space-y-2 pb-10">
          {rows.map((row) => (
            <li
              key={row.user.id}
              className={`card flex items-center gap-3 p-4 ${
                row.user.id === viewer?.id ? 'border-ember/40' : ''
              }`}
            >
              <span
                className={`w-8 shrink-0 text-center font-display text-lg font-extrabold ${
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
                  @{row.user.username} · {row.followers.toLocaleString()} followers
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-base font-bold">{row.metric.toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-wide text-white/30">
                  {row.metricLabel}
                </p>
              </div>
              <div className="hidden shrink-0 sm:block">
                <LevelBadge level={row.level} name={row.levelName} size="xs" />
              </div>
            </li>
          ))}
          {rows.length === 0 && (
            <EmptyState
              title="Nobody on this board yet"
              body="This board fills up as people post, comment and enter challenges. Be the first name on it."
              cta={{ href: '/create', label: 'Create a post' }}
            />
          )}
        </ol>
      </div>
    </>
  );
}
