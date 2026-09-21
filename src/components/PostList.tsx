import type { PostView } from '@/lib/services/posts';
import { toCardData } from '@/lib/view';
import { PostCard } from './PostCard';

export function PostList({
  posts,
  viewerId,
  empty,
}: {
  posts: PostView[];
  viewerId: string | null;
  empty?: React.ReactNode;
}) {
  if (posts.length === 0) return <>{empty ?? null}</>;
  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard key={post.post.id} data={toCardData(post)} viewerId={viewerId} />
      ))}
    </div>
  );
}
