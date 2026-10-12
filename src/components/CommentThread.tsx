'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { commentAction, deleteCommentAction } from '@/app/actions';
import { timeAgo } from '@/lib/time';
import { AdminBadge } from './AdminBadge';
import { Avatar } from './Avatar';

export interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  /** The viewer wrote it, or owns the post it is on. Decided by the server. */
  canDelete: boolean;
  author: { username: string; displayName: string; avatarUrl: string | null; isAdmin?: boolean };
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
  /**
   * Comments deleted from this page, gone from it at once — before the page
   * comes back from the server without them.
   */
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const shown = comments
    .filter((comment) => !gone.has(comment.id))
    .map((comment) => ({ ...comment, replies: comment.replies.filter((reply) => !gone.has(reply.id)) }));
  const onRemoved = (id: string) => setGone((current) => new Set(current).add(id));

  return (
    <section id="comments" className="card p-5">
      <h2 className="font-display text-lg font-bold">
        Comments <span className="text-white/30" data-comment-count>{countAll(shown)}</span>
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
        {shown.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            postId={postId}
            viewer={viewer}
            onError={setError}
            onRemoved={onRemoved}
          />
        ))}
        {shown.length === 0 && (
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
  onRemoved,
}: {
  comment: CommentItem;
  postId: string;
  viewer: CommentViewer | null;
  onError: (message: string | null) => void;
  onRemoved: (id: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <li className="flex gap-3" data-comment-id={comment.id}>
      <Avatar
        username={comment.author.username}
        displayName={comment.author.displayName}
        src={comment.author.avatarUrl}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Link
              href={`/u/${comment.author.username}`}
              className="truncate text-sm font-semibold hover:underline"
            >
              {comment.author.displayName}
            </Link>
            {comment.author.isAdmin && <AdminBadge />}
          </span>
          <span className="text-xs text-white/30">{timeAgo(comment.createdAt)}</span>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-relaxed text-white/80">
          {comment.body}
        </p>

        <div className="mt-1 flex items-center gap-3">
          {viewer && !confirmingDelete && (
            <button
              type="button"
              onClick={() => setReplying((open) => !open)}
              // Padded out to a thumb's worth of target without moving the text.
              className="-mx-2 -my-1.5 px-2 py-1.5 text-xs font-semibold text-white/35 transition hover:text-fay"
            >
              {replying ? 'Cancel' : 'Reply'}
            </button>
          )}
          {/* Its author, and the owner of the post, may delete it. The server
              decides both, here and again when it is asked to. */}
          {comment.canDelete &&
            (confirmingDelete ? (
              // A comment cannot be brought back, and Delete sat a few pixels
              // from Reply — so the first tap asks.
              <span className="flex flex-wrap items-center gap-1 text-xs" data-comment-confirm-delete>
                <span className="text-white/55">
                  {comment.replies.length > 0
                    ? `Delete this comment and its ${comment.replies.length === 1 ? 'reply' : `${comment.replies.length} replies`}?`
                    : 'Delete this comment?'}
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="px-2 py-1.5 font-semibold text-white/60"
                >
                  No
                </button>
                <button
                  type="button"
                  disabled={pending}
                  data-comment-delete-confirm
                  onClick={() =>
                    startTransition(async () => {
                      onError(null);
                      const result = await deleteCommentAction(comment.id).catch(() => null);
                      setConfirmingDelete(false);
                      if (!result || !result.ok) {
                        onError(result?.error ?? 'That comment could not be deleted. Try again.');
                        return;
                      }
                      onRemoved(comment.id);
                      router.refresh();
                    })
                  }
                  className="px-2 py-1.5 font-semibold text-fay"
                >
                  {pending ? 'Deleting…' : 'Yes, delete'}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                data-comment-delete
                className="-mx-2 -my-1.5 px-2 py-1.5 text-xs text-white/30 transition hover:text-fay"
              >
                Delete
              </button>
            ))}
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
                onRemoved={onRemoved}
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
