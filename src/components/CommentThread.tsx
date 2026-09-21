'use client';

import Link from 'next/link';
import { useOptimistic, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { commentAction, deleteCommentAction } from '@/app/actions';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';

export interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  author: { username: string; displayName: string; avatarUrl: string | null };
}

export function CommentThread({
  postId,
  comments,
  viewer,
}: {
  postId: string;
  comments: CommentItem[];
  viewer: { username: string; displayName: string; avatarUrl: string | null } | null;
}) {
  const [optimistic, addOptimistic] = useOptimistic(
    comments,
    (current: CommentItem[], next: CommentItem) => [...current, next],
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  function submit(formData: FormData) {
    const body = String(formData.get('body') || '').trim();
    if (!body || !viewer) return;
    if (inputRef.current) inputRef.current.value = '';
    startTransition(async () => {
      addOptimistic({
        id: `optimistic-${Date.now()}`,
        body,
        createdAt: new Date().toISOString(),
        mine: true,
        author: viewer,
      });
      const result = await commentAction(postId, body);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <section id="comments" className="card p-5">
      <h2 className="font-display text-lg font-bold">
        Comments <span className="text-white/30">{optimistic.length}</span>
      </h2>

      {viewer ? (
        <form action={submit} className="mt-4 flex items-start gap-3">
          <Avatar
            username={viewer.username}
            displayName={viewer.displayName}
            src={viewer.avatarUrl}
            size="sm"
            href={false}
          />
          <div className="flex-1">
            <textarea
              ref={inputRef}
              name="body"
              rows={2}
              maxLength={600}
              required
              placeholder="Say something useful. Support beats silence."
              className="w-full"
            />
            <button type="submit" disabled={pending} className="btn-primary mt-2 px-5 py-2 text-sm">
              {pending ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-4 text-sm text-white/50">
          <Link href="/login" className="font-semibold text-fay hover:underline">
            Sign in
          </Link>{' '}
          to join the conversation.
        </p>
      )}

      {error && <p className="mt-3 text-sm text-fay">{error}</p>}

      <ul className="mt-6 space-y-4">
        {optimistic.map((comment) => (
          <li key={comment.id} className="flex gap-3">
            <Avatar
              username={comment.author.username}
              displayName={comment.author.displayName}
              src={comment.author.avatarUrl}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/u/${comment.author.username}`}
                  className="text-sm font-semibold hover:underline"
                >
                  {comment.author.displayName}
                </Link>
                <span className="text-xs text-white/30">{timeAgo(comment.createdAt)}</span>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-relaxed text-white/80">
                {comment.body}
              </p>
            </div>
            {comment.mine && !comment.id.startsWith('optimistic-') && (
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await deleteCommentAction(comment.id, postId);
                    router.refresh();
                  })
                }
                className="self-start text-xs text-white/30 hover:text-fay"
              >
                Delete
              </button>
            )}
          </li>
        ))}
        {optimistic.length === 0 && (
          <li className="py-4 text-sm text-white/35">
            No comments yet. First one always means the most.
          </li>
        )}
      </ul>
    </section>
  );
}
