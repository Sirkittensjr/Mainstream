import { json, serialisePost, serialiseUser } from '@/lib/api';
import { discover } from '@/lib/services/discover';
import { getViewer } from '@/lib/session';
import { CATEGORIES, type Category } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get('category');
  const category = (CATEGORIES as readonly string[]).includes(raw ?? '')
    ? (raw as Category)
    : null;
  const viewer = await getViewer();
  const feeds = await discover({ viewer, category, perSection: 12 });

  return json({
    rising: feeds.rising.map(serialisePost),
    trending: feeds.trending.map(serialisePost),
    new: feeds.fresh.map(serialisePost),
    shots: feeds.shots.map(serialisePost),
    creators: feeds.risingCreators.map((card) => ({
      ...serialiseUser(card.user),
      followers: card.followers,
      rating: { overall: card.rating, current: card.current, trend: card.trend },
      category: card.topCategory,
    })),
  });
}
