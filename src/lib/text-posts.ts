/**
 * The three shapes a text post comes in.
 *
 * FayTarra's text posts are all one thing visually — words in a speech bubble
 * pointing at whoever said them — and differ only in how much room the words
 * get and how loud they are:
 *
 *   short   a quick thought, up to 200 characters
 *   long    a title and up to 1,000 characters, previewed in the feed
 *   big     up to 30 characters, set very large, meant as a statement
 *
 * STORED ON THE EXISTING POST, not in a table of its own. A text post has
 * always been a post with a caption and no media; this adds which of the three
 * it is, and a title for the one kind that has one. The words themselves stay
 * in `caption`, so search, mentions, moderation, feeds and every existing post
 * keep working untouched — and a post written before any of this existed has no
 * kind, which reads as `short` and gets the bubble like everything else.
 *
 * The limits live here because they are enforced twice: the composer counts
 * down against them, and the server action clamps to them. A limit that only
 * exists in a textarea's `maxLength` is a suggestion.
 */

export const TEXT_KINDS = ['short', 'long', 'big'] as const;
export type TextKind = (typeof TEXT_KINDS)[number];

export const TEXT_LIMITS = {
  short: { body: 200 },
  long: { title: 30, body: 1000 },
  big: { body: 30 },
} as const;

/** How much of a long message's body the feed shows before "Read more". */
export const LONG_PREVIEW = 50;

/** What each kind is for, shown on the chooser and used by the tests. */
export const TEXT_KIND_COPY: Record<TextKind, { label: string; hint: string }> = {
  short: { label: 'Short Message', hint: 'Share a quick thought.' },
  long: { label: 'Long Message', hint: 'Tell the full story.' },
  big: { label: 'BIG Message', hint: 'Make a statement.' },
};

/** The kind a post is, forgiving anything that is not one of the three. */
export function textKindOf(value: unknown): TextKind | null {
  return TEXT_KINDS.includes(value as TextKind) ? (value as TextKind) : null;
}

/**
 * How a post should be DRAWN.
 *
 * A post with no stored kind is a text post from before there were kinds, and
 * it reads as `short`: one bubble, normal size, no title. That is what keeps
 * every post already in the database working and looking like the rest.
 */
export function drawnAs(post: { text_kind?: string | null; caption: string; media?: unknown[] }):
  | TextKind
  | null {
  if (post.media && post.media.length > 0) return null;
  if (!post.caption.trim()) return null;
  return textKindOf(post.text_kind) ?? 'short';
}

/** The longest a body may be for a given kind. */
export const bodyLimit = (kind: TextKind): number => TEXT_LIMITS[kind].body;

/**
 * A text post as it will be stored, clamped to its own kind's limits.
 *
 * Returns an error rather than a post when there is nothing to say, so the
 * caller can tell somebody why instead of storing an empty bubble. Titles are
 * only kept for `long`, because a title on a 30-character statement is a second
 * statement.
 */
export function normaliseTextPost(
  kindInput: unknown,
  titleInput: unknown,
  bodyInput: unknown,
): { ok: true; kind: TextKind; title: string | null; body: string } | { ok: false; error: string } {
  const kind = textKindOf(kindInput) ?? 'short';
  const limits = TEXT_LIMITS[kind];

  const body = String(bodyInput ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, limits.body);

  const title =
    kind === 'long'
      ? String(titleInput ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, TEXT_LIMITS.long.title)
      : null;

  if (!body) {
    return {
      ok: false,
      error:
        kind === 'long' ? 'Write the message before posting it.' : 'Write something to post.',
    };
  }
  if (kind === 'long' && !title) {
    return { ok: false, error: 'A long message needs a title.' };
  }
  return { ok: true, kind, title: title || null, body };
}

/**
 * The part of a long message the feed shows.
 *
 * Cut at a word boundary where there is one near enough, because a preview that
 * stops mid-word reads as broken rather than as abbreviated. Nothing is cut at
 * all when the body is already within the limit, so a short "long" message
 * shows whole and offers no Read more it does not need.
 */
export function previewOf(body: string, limit = LONG_PREVIEW): { text: string; clipped: boolean } {
  const whole = body.trim();
  if (whole.length <= limit) return { text: whole, clipped: false };

  const cut = whole.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour a word boundary in the last third, or a long word would lose
  // most of the preview to it.
  const text = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return { text: text.trimEnd(), clipped: true };
}
