'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendMessageAction } from '@/app/actions';
import { timeAgo, timestamp } from '@/lib/time';

export interface ThreadMessage {
  id: string;
  body: string;
  mine: boolean;
  createdAt: string;
}

/** How often an open conversation looks for new messages. */
const POLL_MS = 6000;

/**
 * One conversation.
 *
 * `open` is false once the two people no longer follow each other. The composer
 * is replaced with an explanation rather than hidden, because a disabled box
 * with no reason is worse than a sentence saying why. Whatever this renders,
 * the rule is enforced in the action, in the service layer and by a trigger on
 * the table — hiding the box is not what stops a message being sent.
 *
 * A block is not a closed thread, it is no thread: the page 404s before this
 * renders, the same way a blocked account disappears everywhere else.
 */
export function MessageThread({
  username,
  displayName,
  open,
  hadUnread,
  messages,
}: {
  username: string;
  displayName: string;
  viewerId: string;
  open: boolean;
  hadUnread: boolean;
  messages: ThreadMessage[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<ThreadMessage[]>([]);
  /**
   * Whether a SEND is in flight — deliberately not `useTransition`'s pending.
   *
   * A refresh is a transition too, so gating the composer on that meant the
   * first Enter after opening a conversation landed while the read-marking
   * refresh was still running and was swallowed without a word. Only an actual
   * send may stop another one.
   */
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // The server marked this thread read while rendering, but the navigation
  // badge beside it was rendered from a count taken before that. One refresh
  // puts the badge right rather than leaving it wrong until the next click.
  useEffect(() => {
    if (hadUnread) router.refresh();
  }, [hadUnread, router]);

  // New messages, without a reload. Polling rather than a socket: it is a few
  // lines, it needs no new infrastructure, and it stops entirely when the tab
  // is in the background, which is where a conversation spends most of its
  // life.
  useEffect(() => {
    if (!open) return;
    let timer = 0;
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
      timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open, router]);

  // Anything the server has confirmed is no longer in flight.
  useEffect(() => {
    setSending((current) => {
      const settled = current.filter(
        (draft) => !messages.some((message) => message.mine && message.body === draft.body),
      );
      return settled.length === current.length ? current : settled;
    });
  }, [messages]);

  const shown = [...messages, ...sending];

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [shown.length]);

  function grow(element: HTMLTextAreaElement) {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }

  /**
   * Sends what is in the box.
   *
   * Reached from the form's action, so it still works with JavaScript off —
   * the button is a real submit button and the composer is a real form. Enter
   * asks the same form to submit rather than taking a second path.
   */
  function send(formData: FormData) {
    const element = input.current;
    const body = String(formData.get('body') || '').trim() || (element?.value.trim() ?? '');
    if (!body || busy) return;

    setBusy(true);
    setError(null);
    if (element) {
      element.value = '';
      grow(element);
    }
    // Shown straight away so the conversation feels like a conversation. It is
    // replaced by the real row on the next render, or taken back if the server
    // refuses it.
    const draft: ThreadMessage = {
      id: `sending-${Date.now()}`,
      body,
      mine: true,
      createdAt: new Date().toISOString(),
    };
    setSending((current) => [...current, draft]);

    startTransition(async () => {
      try {
        const result = await sendMessageAction(username, body);
        if (!result.ok) {
          setSending((current) => current.filter((entry) => entry.id !== draft.id));
          setError(result.error);
          // Nothing was sent, so give them their words back.
          if (element) {
            element.value = body;
            grow(element);
          }
          return;
        }
        router.refresh();
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <>
      <ol className="flex min-h-[38vh] flex-col justify-end gap-2 pb-4">
        {shown.length === 0 && (
          <li className="py-8 text-center text-sm text-white/35">
            Nothing here yet. Say hello to {displayName}.
          </li>
        )}
        {shown.map((message) => (
          <li
            key={message.id}
            className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`min-w-0 max-w-[80%] rounded-2xl px-4 py-2.5 ${
                message.mine
                  ? 'bg-fay/20 text-white'
                  : 'border border-white/[0.08] bg-white/[0.04] text-white/85'
              } ${message.id.startsWith('sending-') ? 'opacity-60' : ''}`}
            >
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                {message.body}
              </p>
              <p className="mt-1 text-[11px] text-white/30">
                <time dateTime={message.createdAt} title={timestamp(message.createdAt)}>
                  {message.id.startsWith('sending-') ? 'Sending…' : timeAgo(message.createdAt)}
                </time>
              </p>
            </div>
          </li>
        ))}
        <div ref={bottom} />
      </ol>

      {open ? (
        // Docked above the bottom navigation on a phone, which is fixed to the
        // very bottom of the screen and would otherwise sit on top of this.
        <form
          ref={form}
          action={send}
          className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] bg-ink-950/90 pb-3 pt-2 backdrop-blur lg:bottom-0 lg:pb-6"
        >
          {error && (
            <p
              role="alert"
              className="mb-2 rounded-2xl border border-fay/40 bg-fay/10 px-4 py-2.5 text-sm text-fay-soft"
            >
              {error}
            </p>
          )}
          <div className="flex items-end gap-2">
            <label htmlFor="message-body" className="sr-only">
              Message {displayName}
            </label>
            <textarea
              id="message-body"
              ref={input}
              name="body"
              rows={1}
              maxLength={2000}
              placeholder={`Message ${displayName}`}
              onInput={(event) => grow(event.currentTarget)}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter is a new line. `isComposing` keeps
                // this out of the way of an input method still choosing a word.
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                form.current?.requestSubmit();
              }}
              className="max-h-40 w-full min-w-0 flex-1 resize-none"
            />
            <button type="submit" disabled={busy} className="btn-primary min-h-[46px] shrink-0 px-5 py-3">
              {busy ? '…' : 'Send'}
            </button>
          </div>
          <p className="mt-1.5 hidden text-[11px] text-white/25 lg:block">
            Enter to send · Shift + Enter for a new line
          </p>
        </form>
      ) : (
        <div className="card mb-8 p-5 text-sm text-white/55">
          <p className="font-semibold text-white">You cannot message each other right now.</p>
          <p className="mt-1">
            Messages need both of you to follow each other. Follow @{username} back — or ask them
            to — and this conversation opens again with everything still in it.{' '}
            <Link href={`/u/${username}`} className="text-fay hover:underline">
              View @{username}
            </Link>
            .
          </p>
        </div>
      )}
    </>
  );
}
