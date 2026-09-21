import { apiError, json } from '@/lib/api';
import { submitRating } from '@/lib/services/ratings';
import { getViewer } from '@/lib/session';
import { REACTIONS, type Reaction } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Same integrity rules as the website — there is only one implementation. */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return apiError('Not signed in', 401);

  const body = (await request.json().catch(() => null)) as {
    targetType?: 'post' | 'user';
    targetId?: string;
    score?: number;
    reactions?: string[];
  } | null;
  if (!body?.targetId || (body.targetType !== 'post' && body.targetType !== 'user')) {
    return apiError('targetType and targetId are required', 422);
  }

  const result = await submitRating({
    raterId: viewer.id,
    targetType: body.targetType,
    targetId: body.targetId,
    score: Number(body.score),
    reactions: (body.reactions ?? []).filter((value): value is Reaction =>
      (REACTIONS as readonly string[]).includes(value),
    ),
  });
  return result.ok ? json(result) : apiError(result.error, 422);
}
