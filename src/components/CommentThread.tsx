'use client';

import Link from 'next/link';
import { useId, useRef, useState, useTransition } from 'react';
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
  author: { username: string; displayName: string; avatarUrl: string | null; isAdmin?: boolean };
  replies: CommentItem[];
}

export interface CommentViewer {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** How long a comment may be. The same number the action enforces. */
const LIMIT = 600;

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
        <p
          role="alert"
          className="mt-3 rounded-2xl border border-fay/40 bg-fay/10 px-4 py-2.5 text-sm text-fay-soft"
        >
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
  /**
   * Delete asks first.
   *
   * It used to be an 11px word sitting a few pixels from Reply, and one tap
   * removed a comment with nothing to undo it. Now the first tap turns it into
   * a question and the second one does it, which is enough to stop a thumb
   * that was aiming at Reply.
   */
  const [confirming, setConfirming] = useState(false);
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

        <div className="-ml-2 mt-0.5 flex items-center gap-1">
          {viewer && (
            <button
              type="button"
              onClick={() => setReplying((open) => !open)}
              className="flex min-h-[40px] items-center rounded-full px-2 text-xs font-semibold text-white/45 transition hover:bg-white/[0.06] hover:text-fay"
            >
              {replying ? 'Cancel' : 'Reply'}
            </button>
          )}
          {comment.mine &&
            (confirming ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await deleteCommentAction(comment.id, postId);
                      router.refresh();
                    })
                  }
                  className="flex min-h-[40px] items-center rounded-full px-2 text-xs font-semibold text-fay transition hover:bg-fay/10"
                >
                  {pending ? 'Deleting…' : 'Delete for good'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="flex min-h-[40px] items-center rounded-full px-2 text-xs text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                >
                  Keep it
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="flex min-h-[40px] items-center rounded-full px-2 text-xs text-white/40 transition hover:bg-white/[0.06] hover:text-fay"
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
  const [length, setLength] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const router = useRouter();

  function submit(formData: FormData) {
    const body = String(formData.get('body') || '').trim();
    if (!body) return;
    onError(null);
    if (inputRef.current) inputRef.current.value = '';
    setLength(0);
    startTransition(async () => {
      const result = await commentAction(postId, body, parentId);
      if (!result.ok) {
        onError(result.error);
        // Nothing was posted, so give them their words back.
        if (inputRef.current) inputRef.current.value = body;
        setLength(body.length);
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
      <div className="min-w-0 flex-1">
        <label className="sr-only" htmlFor={fieldId}>
          {placeholder}
        </label>
        <textarea
          id={fieldId}
          ref={inputRef}
          name="body"
          rows={compact ? 1 : 2}
          maxLength={LIMIT}
          required
          placeholder={placeholder}
          onInput={(event) => setLength(event.currentTarget.value.length)}
          className="w-full"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className={`btn-primary min-h-[40px] text-sm ${compact ? 'px-4' : 'px-5'}`}
          >
            {pending ? 'Posting…' : compact ? 'Reply' : 'Comment'}
          </button>
          {/* Silent until it is nearly a problem, rather than counting at
              somebody from the first keystroke. */}
          {length > LIMIT - 100 && (
            <span className="text-xs tabular-nums text-white/40">{LIMIT - length} left</span>
          )}
        </div>
      </div>
    </form>
  );
}
