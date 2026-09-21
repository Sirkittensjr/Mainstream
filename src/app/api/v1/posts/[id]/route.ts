import { apiError, json, serialisePost } from '@/lib/api';
import { getPost, hydratePosts, listComments } from '@/lib/services/posts';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post || post.removed) return apiError('Not found', 404);

  const viewer = await getViewer();
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
