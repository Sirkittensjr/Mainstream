'use client';

import { useActionState, useState } from 'react';
import { createPostAction } from '@/app/actions';
import { SpeechBubble } from '@/components/SpeechBubble';
import { CATEGORIES } from '@/lib/types';
import { TEXT_KIND_COPY, TEXT_LIMITS, type TextKind } from '@/lib/text-posts';

/**
 * Writing one of the three text posts.
 *
 * One composer, not three: the fields differ but the form, the action and the
 * limits are the same machinery, and a long message is a short one with a title
 * and more room. What changes per kind is what is asked for and how much of it.
 *
 * THE COUNTER IS A COURTESY, NOT THE RULE. `maxLength` stops the typing and the
 * number says how much is left, but the limit that matters is the one the
 * server applies in `normaliseTextPost` — a form field can be edited, and a
 * request can skip the form altogether.
 *
 * It shows the bubble as it is typed, because the bubble is the point of the
 * feature: somebody writing a BIG message needs to see what thirty characters
 * look like at that size before they post it.
 */
export function TextComposer({ kind }: { kind: TextKind }) {
  const [state, formAction, pending] = useActionState<{ error?: string } | null, FormData>(
    createPostAction,
    null,
  );
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const limits = TEXT_LIMITS[kind];
  const titleLimit = kind === 'long' ? TEXT_LIMITS.long.title : 0;
  const ready = body.trim().length > 0 && (kind !== 'long' || title.trim().length > 0);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="text_kind" value={kind} />

      {kind === 'long' && (
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="text_title">
              Title
            </label>
            <Counter used={title.length} of={titleLimit} name="title" />
          </div>
          <input
            id="text_title"
            name="text_title"
            value={title}
            maxLength={titleLimit}
            autoFocus
            placeholder="What is it about?"
            onChange={(event) => setTitle(event.target.value)}
            className="mt-2 w-full text-base"
          />
        </div>
      )}

      <div>
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="caption">
            {kind === 'long' ? 'Message' : TEXT_KIND_COPY[kind].label}
          </label>
          <Counter used={body.length} of={limits.body} name="body" />
        </div>
        <textarea
          id="caption"
          name="caption"
          value={body}
          rows={kind === 'long' ? 9 : kind === 'big' ? 2 : 4}
          maxLength={limits.body}
          autoFocus={kind !== 'long'}
          placeholder={
            kind === 'big'
              ? 'LET US GO'
              : kind === 'long'
                ? 'Take your time. @mention anyone you want to bring in.'
                : 'What is up? @mention anyone you want to bring in.'
          }
          onChange={(event) => setBody(event.target.value)}
          className={`mt-2 w-full text-base ${kind === 'big' ? 'font-statement text-2xl uppercase' : ''}`}
        />
      </div>

      {/* What it will look like, which for a BIG message is most of the point. */}
      {ready && (
        <div data-text-preview>
          <p className="label mb-2">Preview</p>
          <div className="card overflow-hidden py-3">
            <SpeechBubble kind={kind} title={title} body={body} />
          </div>
        </div>
      )}

      <div>
        <label className="label" htmlFor="category">
          Category
        </label>
        <select id="category" name="category" defaultValue="Life" className="mt-2 w-full">
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tags">
          Tags (optional)
        </label>
        <input
          id="tags"
          name="tags"
          placeholder="beats, firstpost, homestudio"
          className="mt-2 w-full"
        />
      </div>

      {state?.error && (
        <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !ready}
        data-post-text
        className="btn-primary w-full py-4 disabled:opacity-40"
      >
        {pending ? 'Posting…' : 'Post'}
      </button>
    </form>
  );
}

/** How much room is left, going amber as it runs out. */
function Counter({ used, of, name }: { used: number; of: number; name: string }) {
  const left = of - used;
  return (
    <span
      data-text-counter={name}
      className={`text-[12px] font-semibold tabular-nums ${
        left <= 0 ? 'text-fay' : left <= of * 0.15 ? 'text-solar' : 'text-white/40'
      }`}
    >
      {used}/{of}
    </span>
  );
}
