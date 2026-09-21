'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
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
  replies: CommentItem[];
}

export interface CommentViewer {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

function countAll(items: CommentItem[]): number {
  return items.reduce((total, item) => total + 1 + item.replies.length, 0);
}

export function CommentThread({
  postId,
  comments,
  viewer,
}: {
  postId: string;
  comments: CommentItem[];
  viewer: CommentViewer | null;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <section id="comments" className="card p-5">
      <h2 className="font-display text-lg font-bold">
        Comments <span className="text-white/30">{countAll(comments)}</span>
      </h2>

      {viewer ? (
        <CommentBox
          postId={postId}
          parentId={null}
          viewer={viewer}
          onError={setError}
          placeholder="Say something useful. Support beats silence."
        />
      ) : (
        <p className="mt-4 text-sm text-white/50">
          <Link href="/login" className="font-semibold text-fay hover:underline">
            Sign in
          </Link>{' '}
          to join the conversation.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-2xl border border-fay/40 bg-fay/10 px-4 py-2.5 text-sm text-fay-soft">
          {error}
        </p>
      )}

      <ul className="mt-6 space-y-5">
        {comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            postId={postId}
            viewer={viewer}
            onError={setError}
          />
        ))}
        {comments.length === 0 && (
          <li className="py-4 text-sm text-white/35">
            No comments yet. First one always means the most.
          </li>
        )}
      </ul>
    </section>
  );
}

function CommentRow({
  comment,
  postId,
  viewer,
  onError,
}: {
  comment: CommentItem;
  postId: string;
  viewer: CommentViewer | null;
  onError: (message: string | null) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <li className="flex gap-3">
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

        <div className="mt-1 flex items-center gap-3">
          {viewer && (
            <button
              type="button"
              onClick={() => setReplying((open) => !open)}
              className="text-xs font-semibold text-white/35 transition hover:text-fay"
            >
              {replying ? 'Cancel' : 'Reply'}
            </button>
          )}
          {comment.mine && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteCommentAction(comment.id, postId);
                  router.refresh();
                })
              }
              className="text-xs text-white/30 transition hover:text-fay"
            >
              Delete
            </button>
          )}
        </div>

        {replying && viewer && (
          <CommentBox
            postId={postId}
            parentId={comment.id}
            viewer={viewer}
            onError={onError}
            onDone={() => setReplying(false)}
            placeholder={`Reply to ${comment.author.displayName}…`}
            compact
          />
        )}

        {comment.replies.length > 0 && (
          <ul className="mt-4 space-y-4 border-l border-white/[0.07] pl-4">
            {comment.replies.map((reply) => (
              <CommentRow
                key={reply.id}
                comment={reply}
                postId={postId}
                viewer={viewer}
                onError={onError}
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function CommentBox({
  postId,
  parentId,
  viewer,
  onError,
  onDone,
  placeholder,
  compact = false,
}: {
  postId: string;
  parentId: string | null;
  viewer: CommentViewer;
  onError: (message: string | null) => void;
  onDone?: () => void;
  placeholder: string;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  function submit(formData: FormData) {
    const body = String(formData.get('body') || '').trim();
    if (!body) return;
    onError(null);
    if (inputRef.current) inputRef.current.value = '';
    startTransition(async () => {
      const result = await commentAction(postId, body, parentId);
      if (!result.ok) {
        onError(result.error);
        // Nothing was posted, so give them their words back.
        if (inputRef.current) inputRef.current.value = body;
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form action={submit} className={`flex items-start gap-3 ${compact ? 'mt-3' : 'mt-4'}`}>
      {!compact && (
        <Avatar
          username={viewer.username}
          displayName={viewer.displayName}
          src={viewer.avatarUrl}
          size="sm"
          href={false}
        />
      )}
      <div className="flex-1">
        <textarea
          ref={inputRef}
          name="body"
          rows={compact ? 1 : 2}
          maxLength={600}
          required
          placeholder={placeholder}
          className="w-full"
        />
        <button
          type="submit"
          disabled={pending}
          className={`btn-primary mt-2 text-sm ${compact ? 'px-4 py-1.5' : 'px-5 py-2'}`}
        >
          {pending ? 'Posting…' : compact ? 'Reply' : 'Comment'}
        </button>
      </div>
    </form>
  );
}
