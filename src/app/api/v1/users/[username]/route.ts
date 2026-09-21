import { apiError, json, serialisePost, serialiseUser } from '@/lib/api';
import { hydratePosts, postsByAuthor } from '@/lib/services/posts';
import { userRating } from '@/lib/services/ratings';
import { rankHistory, userRanks } from '@/lib/services/rankings';
import { getUserByUsername, getUserStats } from '@/lib/services/users';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const user = await getUserByUsername(username);
  if (!user || user.status === 'banned') return apiError('Not found', 404);

  const viewer = await getViewer();
  const [rating, ranks, stats, history, posts] = await Promise.all([
    userRating(user.id),
    userRanks(user.id),
    getUserStats(user.id),
    rankHistory(user.id),
    postsByAuthor(user.id),
  ]);
  const views = await hydratePosts(posts.slice(0, 30), viewer?.id ?? null);

  return json({
    user: serialiseUser(user, rating),
    stats,
    ranks,
    rankHistory: history,
    posts: views.map(serialisePost),
  });
}
