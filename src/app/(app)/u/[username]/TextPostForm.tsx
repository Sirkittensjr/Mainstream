'use client';

import { useActionState } from 'react';
import { createPostAction } from '@/app/actions';
import { CATEGORIES } from '@/lib/types';

/**
 * Writing something with no picture attached.
 *
 * This is where text-post creation went when `+` became a camera button. It sits
 * on the Text shelf of somebody's own profile, next to the text posts it makes —
 * which is a better place for it than a tab on a page about creating: you come
 * here to see what you have written, and writing another is the obvious thing to
 * want.
 *
 * The same `createPostAction` every other post goes through, with no media field
 * at all. Nothing about rate limits, mentions, categories or moderation is
 * special-cased for it: a text post is an ordinary FayTarra post that happens to
 * carry nothing.
 */
export function TextPostForm() {
  const [state, formAction, pending] = useActionState<{ error?: string } | null, FormData>(
    createPostAction,
    null,
  );

  return (
    <form action={formAction} className="card space-y-3 p-4" data-text-post-form>
      <label className="label" htmlFor="text-post-caption">
        Write something
      </label>
      <textarea
        id="text-post-caption"
        name="caption"
        rows={4}
        maxLength={1200}
        required
        placeholder="What is on your mind? @mention anyone you want to bring in."
        className="w-full text-base"
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[9rem] flex-1">
          <label className="label" htmlFor="text-post-category">
            Category
          </label>
          <select id="text-post-category" name="category" className="mt-2 w-full">
            {CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          data-text-post-submit
          className="btn-primary min-h-[48px] px-6"
        >
          {pending ? 'Posting…' : 'Post'}
        </button>
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-fay-soft">
          {state.error}
        </p>
      )}
    </form>
  );
}
