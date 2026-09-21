import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CommentThread, type CommentItem } from '@/components/CommentThread';
import { DeletePostButton } from '@/components/DeletePostButton';
import { PageTopBar } from '@/components/PageTopBar';
import { PostCard } from '@/components/PostCard';
import { RatingPill, ReactionBar } from '@/components/RatingPill';
import { formatVotes, topReactions } from '@/lib/ratings';
import { getPost, hydratePosts, listComments, registerView } from '@/lib/services/posts';
import { getUser, hiddenUserIds } from '@/lib/services/users';
import { getViewer } from '@/lib/session';
import { toCardData } from '@/lib/view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) return { title: 'Post' };
  const author = await getUser(post.author_id);
  return {
    title: `${author?.display_name ?? 'Post'} on FayTarra`,
    description: post.caption.slice(0, 140),
  };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const post = await getPost(id);
  if (!post) notFound();

  const hidden = await hiddenUserIds(viewer?.id ?? null);
  if (hidden.has(post.author_id)) notFound();
  if (post.removed && viewer?.id !== post.author_id && viewer?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold">This post was removed</h1>
        <p className="mt-2 text-white/50">
          A moderator removed it for breaking the{' '}
          <Link href="/rules" className="underline">
            community rules
          </Link>
          .
        </p>
      </div>
    );
  }

  await registerView(post.id, viewer?.id ?? null);

  const [views, comments] = await Promise.all([
    hydratePosts([post], viewer?.id ?? null),
    listComments(post.id, viewer?.id ?? null),
  ]);
  const view = views[0];
  if (!view) notFound();

  const items: CommentItem[] = comments.map((comment) => ({
    id: comment.comment.id,
    body: comment.comment.body,
    createdAt: comment.comment.created_at,
    mine: comment.mine,
    author: {
      username: comment.author.username,
      displayName: comment.author.display_name,
      avatarUrl: comment.author.avatar_url,
    },
  }));

  return (
    <>
      <PageTopBar title="Post" />
      <div className="mx-auto max-w-2xl space-y-4 px-4 pt-4 lg:pt-8">
        {post.removed && (
          <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
            This post has been removed by a moderator
            {post.removed_reason ? `: ${post.removed_reason}` : '.'} Only you and moderators can
            see it.
          </p>
        )}
        <PostCard data={toCardData(view)} viewerId={viewer?.id ?? null} />

        <section className="card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold">Community rating</h2>
              <p className="mt-1 text-sm text-white/45">
                {view.rating.votes > 0
                  ? formatVotes(view.rating.votes)
                  : 'Not rated yet. First rating counts the most.'}
              </p>
            </div>
            <RatingPill value={view.rating.rating} size="lg" votes={view.rating.votes} />
          </div>
          {topReactions(view.rating.reactions, 6).length > 0 && (
            <div className="mt-4">
              <ReactionBar reactions={topReactions(view.rating.reactions, 6)} />
            </div>
          )}
        </section>

        <CommentThread
          postId={post.id}
          comments={items}
          viewer={
            viewer
              ? {
                  username: viewer.username,
                  displayName: viewer.display_name,
                  avatarUrl: viewer.avatar_url,
                }
              : null
          }
        />

        {viewer?.id === post.author_id && (
          <div className="flex justify-end pb-6">
            <DeletePostButton postId={post.id} />
          </div>
        )}
      </div>
    </>
  );
}
