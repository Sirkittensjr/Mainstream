import { json, serialisePost } from '@/lib/api';
import { followingFeed, recommendedFeed } from '@/lib/services/feed';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 25), 1), 50);
  const viewer = await getViewer();
  const tab = params.get('tab') === 'following' ? 'following' : 'recommended';
  const posts =
    tab === 'following' && viewer
      ? await followingFeed(viewer, limit)
      : await recommendedFeed(viewer, limit);
  return json({ tab, posts: posts.map(serialisePost) });
}
