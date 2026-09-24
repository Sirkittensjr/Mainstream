'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { commentAction } from '@/app/actions';
import { Avatar } from '@/components/Avatar';
import { CloseIcon } from '@/components/Icons';
import { Portal } from '@/components/Portal';
import { timeAgo } from '@/lib/time';

export interface VideoComment {
  id: string;
  body: string;
  createdAt: string;
  author: { username: string; displayName: string; avatarUrl: string | null };
}

export interface CommenterInfo {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Comments, over the video rather than instead of it.
 *
 * The video keeps playing behind this: the sheet is rendered in a portal at
 * the top of the page, so nothing in the feed unmounts, re-renders its
 * player, or loses a second of playback. Closing it puts nothing back,
 * because nothing was taken away.
 *
 * It is the same comments as everywhere else — read through the post API that
 * already serves them, written through the same `commentAction` the post page
 * uses. There is no second comment system here, and no comment is fetched
 * until somebody asks to see one.
 */
export function VideoComments({
  postId,
  comments,
  loading,
  error,
  viewer,
  onClose,
  onPosted,
}: {
  postId: string;
  /** Null while the first load is in flight. */
  comments: VideoComment[] | null;
  loading: boolean;
  error: string | null;
  /** Who is writing, for the optimistic row. Null when signed out. */
  viewer: CommenterInfo | null;
  onClose: () => void;
  onPosted: (comment: VideoComment) => void;
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Sits above the on-screen keyboard.
   *
   * A fixed element does not move when iOS opens the keyboard — the page does
   * not resize, the visual viewport does. Reading that is the only way to
   * know how much of the screen is left, and without it the box somebody is
   * typing into is behind the keyboard.
   */
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const measure = () => {
      const hidden = window.innerHeight - viewport.height - viewport.offsetTop;
      setKeyboard(Math.max(0, Math.round(hidden)));
    };
    measure();
    viewport.addEventListener('resize', measure);
    viewport.addEventListener('scroll', measure);
    return () => {
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
    };
  }, []);

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setProblem(null);
    const result = await commentAction(postId, text);
    setSending(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setBody('');
    // Shown straight away rather than after a round trip. The id is the
    // server's next time the sheet loads; until then this is the same comment
    // by the same person, which is what the person who wrote it needs to see.
    onPosted({
      id: `pending-${Date.now()}`,
      body: text,
      createdAt: new Date().toISOString(),
      author: viewer ?? { username: 'you', displayName: 'You', avatarUrl: null },
    });
    requestAnimationFrame(() => {
      list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
    });
  }

  return (
    <Portal>
      {/* The video stays visible above this, and tapping it closes. */}
      <button
        type="button"
        aria-label="Close comments"
        onClick={onClose}
        className="fixed inset-0 z-[70] cursor-default bg-black/40"
      />
      <section
        role="dialog"
        aria-modal="false"
        aria-label="Comments"
        style={{ bottom: keyboard }}
        className="fixed inset-x-0 z-[71] flex max-h-[68dvh] flex-col rounded-t-3xl border-t border-white/10 bg-ink-950/95 backdrop-blur-xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:top-20 sm:max-h-none sm:w-[380px] sm:rounded-3xl sm:border"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.07] px-4 py-3">
          <h2 className="font-display text-base font-bold">
            Comments
            {comments ? <span className="ml-2 text-sm text-white/40">{comments.length}</span> : null}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="ml-auto rounded-full p-1.5 text-white/50 transition hover:text-white"
          >
            <CloseIcon />
          </button>
        </header>

        {/* overscroll-contain: reaching the end of the comments must not carry
            on into the feed behind and scroll to the next video. */}
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {loading && !comments ? (
            <p className="py-6 text-center text-sm text-white/40">Loading comments…</p>
          ) : error ? (
            <p className="py-6 text-center text-sm text-fay-soft">{error}</p>
          ) : comments && comments.length > 0 ? (
            <ul className="space-y-4">
              {comments.map((comment) => (
                <li key={comment.id} className="flex gap-3">
                  <Avatar
                    username={comment.author.username}
                    displayName={comment.author.displayName}
                    src={comment.author.avatarUrl}
                    size="xs"
                    href={`/u/${comment.author.username}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2">
                      <Link
                        href={`/u/${comment.author.username}`}
                        className="truncate text-[13px] font-semibold hover:underline"
                      >
                        {comment.author.displayName}
                      </Link>
                      <time
                        dateTime={comment.createdAt}
                        className="shrink-0 text-[11px] text-white/35"
                      >
                        {timeAgo(comment.createdAt)}
                      </time>
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm leading-snug text-white/85">
                      {comment.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-white/40">
              No comments yet. Say the first thing.
            </p>
          )}
        </div>

        <footer className="shrink-0 border-t border-white/[0.07] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {problem && <p className="mb-2 px-1 text-xs text-fay-soft">{problem}</p>}
          {viewer ? (
            <div className="flex items-end gap-2">
              <textarea
                ref={input}
                rows={1}
                value={body}
                maxLength={600}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Add a comment…"
                aria-label="Add a comment"
                className="max-h-24 min-h-[44px] flex-1 resize-none py-2.5 text-base"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || body.trim().length === 0}
                className="btn-primary min-h-[44px] shrink-0 px-5 py-2.5 text-sm"
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          ) : (
            <Link href="/login?next=/videos" className="btn-ghost w-full py-3 text-sm">
              Sign in to comment
            </Link>
          )}
        </footer>
      </section>
    </Portal>
  );
}
