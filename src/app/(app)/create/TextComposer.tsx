'use client';

import { useActionState, useState } from 'react';
import { createPostAction } from '@/app/actions';
import { SpeechBubble } from '@/components/SpeechBubble';
import { CATEGORIES } from '@/lib/types';
import {
  BIG_STYLES,
  BIG_STYLE_COPY,
  TEXT_KIND_COPY,
  TEXT_LIMITS,
  type BigStyle,
  type TextKind,
} from '@/lib/text-posts';
import { BIG_LOOKS } from '@/components/SpeechBubble';

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
  const [style, setStyle] = useState<BigStyle>('glow');

  const limits = TEXT_LIMITS[kind];
  const titleLimit = kind === 'story' ? TEXT_LIMITS.story.title : 0;
  const ready = body.trim().length > 0 && (kind !== 'story' || title.trim().length > 0);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="text_kind" value={kind} />
      {kind === 'big' && <input type="hidden" name="text_style" value={style} />}

      {kind === 'story' && (
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
            {kind === 'story' ? 'Message' : TEXT_KIND_COPY[kind].label}
          </label>
          <Counter used={body.length} of={limits.body} name="body" />
        </div>
        <textarea
          id="caption"
          name="caption"
          value={body}
          rows={kind === 'story' ? 9 : kind === 'big' ? 2 : 4}
          maxLength={limits.body}
          autoFocus={kind !== 'story'}
          placeholder={
            kind === 'big'
              ? 'LET US GO'
              : kind === 'story'
                ? 'Take your time. @mention anyone you want to bring in.'
                : 'What is up? @mention anyone you want to bring in.'
          }
          onChange={(event) => setBody(event.target.value)}
          className={`mt-2 w-full text-base ${kind === 'big' ? 'font-statement text-2xl uppercase' : ''}`}
        />
      </div>

      {/* FOUR, not a colour picker. Two wells would let somebody put orange on
          yellow; a short list cannot be made unreadable. */}
      {kind === 'big' && (
        <div>
          <p className="label mb-2">Colour</p>
          <div className="flex gap-2" data-big-styles>
            {BIG_STYLES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setStyle(option)}
                aria-pressed={style === option}
                aria-label={BIG_STYLE_COPY[option]}
                data-big-style={option}
                className={`flex-1 rounded-2xl border p-1.5 transition ${
                  style === option ? 'border-fay' : 'border-white/10 hover:border-white/25'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-12 place-items-center rounded-xl ${BIG_LOOKS[option].bubble}`}
                >
                  <span
                    className={`font-statement text-[20px] leading-none ${BIG_LOOKS[option].text}`}
                  >
                    Aa
                  </span>
                </span>
                <span className="mt-1 block text-center text-[11px] text-white/50">
                  {BIG_STYLE_COPY[option]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* What it will look like, which for a BIG message is most of the point. */}
      {ready && (
        <div data-text-preview>
          <p className="label mb-2">Preview</p>
          <div className="card overflow-hidden py-3">
            <SpeechBubble kind={kind} title={title} body={body} style={style} />
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
