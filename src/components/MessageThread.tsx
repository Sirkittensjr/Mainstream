'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendMessageAction } from '@/app/actions';
import { timeAgo } from '@/lib/time';

export interface ThreadMessage {
  id: string;
  body: string;
  mine: boolean;
  createdAt: string;
}

/**
 * One conversation.
 *
 * `open` is false once the two people no longer follow each other. The
 * composer is replaced with an explanation rather than hidden, because a
 * disabled box with no reason is worse than a sentence saying why. The rule is
 * enforced on the server and in the database regardless of what this renders.
 */
export function MessageThread({
  username,
  displayName,
  open,
  messages,
}: {
  username: string;
  displayName: string;
  viewerId: string;
  open: boolean;
  messages: ThreadMessage[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  function submit(formData: FormData) {
    const body = String(formData.get('body') || '').trim();
    if (!body) return;
    setError(null);
    if (input.current) input.current.value = '';
    startTransition(async () => {
      const result = await sendMessageAction(username, body);
      if (!result.ok) {
        setError(result.error);
        // Nothing was sent, so give them their words back.
        if (input.current) input.current.value = body;
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <ol className="flex min-h-[30vh] flex-col justify-end gap-2 pb-4">
        {messages.length === 0 && (
          <li className="py-8 text-center text-sm text-white/35">
            Nothing here yet. Say hello to {displayName}.
          </li>
        )}
        {messages.map((message) => (
          <li
            key={message.id}
            className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                message.mine
                  ? 'bg-fay/20 text-white'
                  : 'border border-white/[0.08] bg-white/[0.04] text-white/85'
              }`}
            >
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                {message.body}
              </p>
              <p className="mt-1 text-[11px] text-white/30">{timeAgo(message.createdAt)}</p>
            </div>
          </li>
        ))}
        <div ref={bottom} />
      </ol>

      {open ? (
        <form action={submit} className="sticky bottom-0 bg-ink-950/90 pb-6 pt-2 backdrop-blur">
          {error && (
            <p role="alert" className="mb-2 rounded-2xl border border-fay/40 bg-fay/10 px-4 py-2.5 text-sm text-fay-soft">
              {error}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={input}
              name="body"
              rows={1}
              maxLength={2000}
              required
              placeholder={`Message ${displayName}`}
              className="max-h-40 w-full flex-1"
            />
            <button type="submit" disabled={pending} className="btn-primary shrink-0 px-5 py-3">
              {pending ? '…' : 'Send'}
            </button>
          </div>
        </form>
      ) : (
        <div className="card mb-8 p-5 text-sm text-white/55">
          <p className="font-semibold text-white">You cannot message each other right now.</p>
          <p className="mt-1">
            Messages need both of you to follow each other.{' '}
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
