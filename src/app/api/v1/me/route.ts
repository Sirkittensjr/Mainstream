import { apiError, json, serialiseUser } from '@/lib/api';
import { userRating } from '@/lib/services/ratings';
import { userRanks } from '@/lib/services/rankings';
import { getUserStats } from '@/lib/services/users';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return apiError('Not signed in', 401);
  const [rating, ranks, stats] = await Promise.all([
    userRating(viewer.id),
    userRanks(viewer.id),
    getUserStats(viewer.id),
  ]);
  return json({ user: serialiseUser(viewer, rating), ranks, stats });
}
