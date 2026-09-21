import { json, serialiseUser } from '@/lib/api';
import { rankedCategories, rankings, type RankBoard } from '@/lib/services/rankings';
import { getViewer } from '@/lib/session';
import { CATEGORIES, type Category } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Rankings: the same data the Discover page renders. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const board = (params.get('board') === 'recent' ? 'recent' : 'overall') as RankBoard;
  const raw = params.get('category');
  const category = (CATEGORIES as readonly string[]).includes(raw ?? '')
    ? (raw as Category)
    : null;

  await getViewer();
  const [rows, categories] = await Promise.all([
    rankings({ board, category, limit: 50 }),
    rankedCategories(),
  ]);

  return json({
    board,
    category,
    categories,
    people: rows.map((row) => ({
      rank: row.rank,
      ...serialiseUser(row.user),
      followers: row.followers,
      category: row.category,
      rating: {
        overall: row.overall,
        overallVotes: row.overallVotes,
        last30Days: row.recent,
        last30DaysVotes: row.recentVotes,
        trend: row.trend,
      },
    })),
  });
}
