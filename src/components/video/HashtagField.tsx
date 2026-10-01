'use client';

import { useState } from 'react';
import { CloseIcon } from '@/components/Icons';
import { MAX_TAGS, MAX_TAG_LENGTH, addTag } from '@/lib/video/hashtags';

/**
 * The hashtag field on the posting screen.
 *
 * Space, comma and Enter all finish a tag, because all three are what people
 * do. The rules about what a tag IS live in lib/video/hashtags.ts.
 */

export function HashtagField({
  tags,
  onTags,
  disabled = false,
}: {
  tags: string[];
  onTags: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const full = tags.length >= MAX_TAGS;

  function commit(raw: string) {
    const next = addTag(tags, raw);
    if (next !== tags) onTags(next);
    setDraft('');
  }

  return (
    <div>
      <label className="label" htmlFor="video-tags">
        Hashtags
      </label>
      <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
        {tags.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2" data-hashtags>
            {tags.map((tag) => (
              <li key={tag.toLowerCase()}>
                <button
                  type="button"
                  onClick={() => onTags(tags.filter((entry) => entry !== tag))}
                  disabled={disabled}
                  className="chip gap-1.5 bg-white/10 hover:bg-white/15 disabled:opacity-40"
                  aria-label={`Remove #${tag}`}
                  data-hashtag={tag}
                >
                  #{tag}
                  <CloseIcon width={13} height={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id="video-tags"
          value={draft}
          disabled={disabled || full}
          maxLength={MAX_TAG_LENGTH + 1}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={full ? `That is ${MAX_TAGS} hashtags` : 'Add a hashtag'}
          onChange={(event) => {
            const value = event.target.value;
            // A space or a comma is the end of a tag wherever it is typed, so
            // nobody has to learn that Enter is the way to finish one.
            if (/[\s,]/.test(value)) {
              commit(value);
              return;
            }
            setDraft(value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Enter in a tag field adds the tag. It must not submit anything.
              event.preventDefault();
              commit(draft);
              return;
            }
            if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
              onTags(tags.slice(0, -1));
            }
          }}
          // A tag left in the box when somebody moves on is a tag they meant.
          onBlur={() => draft.trim() && commit(draft)}
          className="w-full border-0 bg-transparent px-2 py-1.5 text-base focus:ring-0"
        />
      </div>
      <p className="mt-1.5 text-xs text-white/35">
        {tags.length > 0
          ? `${tags.length} of ${MAX_TAGS}. Tap one to remove it.`
          : `Up to ${MAX_TAGS}. They are stored as tags, so search and Discover can find this.`}
      </p>
    </div>
  );
}
