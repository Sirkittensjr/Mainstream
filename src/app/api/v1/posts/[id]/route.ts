import { apiError, json, serialisePost } from '@/lib/api';
import { underReview } from '@/lib/auto-review-rules';
import { getPost, hydratePosts, listComments } from '@/lib/services/posts';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post || post.removed) return apiError('Not found', 404);

  const viewer = await getViewer();
  // Under review is hidden from the API too, for the same reason it is hidden
  // from a direct link: an endpoint that still serves it makes the hide
  // decorative. The author and an admin are the two who need to see it.
  if (underReview(post) && viewer?.id !== post.author_id && viewer?.role !== 'admin') {
    return apiError('Not found', 404);
  }

  const [views, comments] = await Promise.all([
    hydratePosts([post], viewer?.id ?? null),
    listComments(post.id, viewer?.id ?? null),
  ]);
  if (!views[0]) return apiError('Not found', 404);

  return json({
    post: serialisePost(views[0]),
    comments: comments.map((entry) => ({
      id: entry.comment.id,
      body: entry.comment.body,
      createdAt: entry.comment.created_at,
      author: {
        username: entry.author.username,
        displayName: entry.author.display_name,
        avatarUrl: entry.author.avatar_url,
      },
    })),
  });
}
