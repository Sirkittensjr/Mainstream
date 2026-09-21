import { json } from '@/lib/api';
import {
  RANK_BOARDS,
  RANK_PERIODS,
  rankings,
  type RankBoard,
  type RankPeriod,
} from '@/lib/services/rankings';
import { CATEGORIES, type Category } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const board = (RANK_BOARDS.find((entry) => entry.key === params.get('board'))?.key ??
    'overall') as RankBoard;
  const period = (RANK_PERIODS.find((entry) => entry.key === params.get('period'))?.key ??
    'all') as RankPeriod;
  const rawCategory = params.get('category');
  const category = (CATEGORIES as readonly string[]).includes(rawCategory ?? '')
    ? (rawCategory as Category)
    : null;

  const rows = await rankings({ board, period, category, limit: 50 });
  return json({
    board,
    period,
    category,
    rows: rows.map((row) => ({
      rank: row.rank,
      username: row.user.username,
      displayName: row.user.display_name,
      avatarUrl: row.user.avatar_url,
      followers: row.followers,
      overall: row.overall,
      current: row.current,
      trend: row.trend,
      metric: row.metric,
      metricLabel: row.metricLabel,
      category: row.category,
    })),
  });
}
