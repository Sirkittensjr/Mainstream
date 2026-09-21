import { json, serialisePost } from '@/lib/api';
import { homeFeed } from '@/lib/services/feed';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 25);
  const viewer = await getViewer();
  const posts = await homeFeed(viewer, Math.min(Math.max(limit, 1), 50));
  return json({ posts: posts.map(serialisePost) });
}
