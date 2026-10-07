/**
 * The three shapes a text post comes in.
 *
 * FayTarra's text posts are all one thing visually — words in a speech bubble
 * pointing at whoever said them — and differ only in how much room the words
 * get and how loud they are:
 *
 *   short   a quick thought, up to 200 characters
 *   story   a title and up to 1,000 characters, previewed in the feed
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

export const TEXT_KINDS = ['short', 'story', 'big'] as const;
export type TextKind = (typeof TEXT_KINDS)[number];

/**
 * What a story message used to be called.
 *
 * Read, never written. The kind was `long` for exactly as long as it took to
 * name the feature properly, and a draft or a row written in that window still
 * has to open as the thing it is.
 */
const KIND_ALIASES: Record<string, TextKind> = { long: 'story' };

export const TEXT_LIMITS = {
  short: { body: 200 },
  story: { title: 30, body: 1000 },
  big: { body: 30 },
} as const;

/** How much of a story's body the feed shows before "Read more". */
export const STORY_PREVIEW = 50;

/** What each kind is for, shown on the chooser and used by the tests. */
export const TEXT_KIND_COPY: Record<
  TextKind,
  { label: string; hint: string; limits: string[] }
> = {
  short: {
    label: 'Short Message',
    hint: 'Share a quick thought.',
    limits: ['Max 200 characters'],
  },
  story: {
    label: 'Story Message',
    hint: 'Tell the full story.',
    limits: ['Title (max 30 characters)', 'Body (max 1,000 characters)'],
  },
  big: {
    label: 'Big Message',
    hint: 'Make a statement.',
    limits: ['Max 30 characters'],
  },
};

/** The kind a post is, forgiving anything that is not one of the three. */
export function textKindOf(value: unknown): TextKind | null {
  if (TEXT_KINDS.includes(value as TextKind)) return value as TextKind;
  return KIND_ALIASES[value as string] ?? null;
}

/**
 * How a BIG message is coloured.
 *
 * Four, not a picker. The brief is a dark bubble with one or two FayTarra
 * colours on it, or a two-colour gradient behind white — and the way that stays
 * tasteful is by being a short list somebody chooses from rather than two
 * colour wells they can put orange on yellow with.
 *
 * `glow` is the default because it is the quietest of the four: the statement
 * is the type, and the colour is on the words rather than behind them.
 */
export const BIG_STYLES = ['glow', 'night', 'violet', 'dusk'] as const;
export type BigStyle = (typeof BIG_STYLES)[number];

export const BIG_STYLE_COPY: Record<BigStyle, string> = {
  glow: 'Glow',
  night: 'Night',
  violet: 'Violet',
  dusk: 'Dusk',
};

export const bigStyleOf = (value: unknown): BigStyle =>
  BIG_STYLES.includes(value as BigStyle) ? (value as BigStyle) : 'glow';

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

/** The columns a text post's shape lives in, beyond its words. */
export const TEXT_COLUMNS = ['text_kind', 'text_title', 'text_style'] as const;
export type TextColumn = (typeof TEXT_COLUMNS)[number];

/**
 * Whether a text post can be stored WITHOUT one of its columns and still be
 * drawn exactly as its author saw it in the composer.
 *
 * This is the rule for a database that is behind the code. Leaving a column out
 * is only acceptable when nothing anybody can see depends on it:
 *
 *   - a SHORT message without its kind reads back as kind-less, and a kind-less
 *     text post is drawn as a short message — the same bubble, the same size;
 *   - a BIG message in `glow` without its style reads back as null, and null is
 *     `glow`.
 *
 * Everything else would come back as something else. A big message without its
 * kind is a small white bubble; a violet one without its style is a white one;
 * a story without its title has lost words. Those are refused rather than
 * stored, because a post that changes shape between Preview and Post is the
 * thing this feature cannot do.
 */
export function survivesWithout(
  post: { text_kind?: string | null; text_title?: string | null; text_style?: string | null },
  column: TextColumn,
): boolean {
  const value = post[column];
  if (value === null || value === undefined) return true;
  if (column === 'text_kind') {
    return textKindOf(value) === 'short' && !post.text_title && !post.text_style;
  }
  if (column === 'text_style') return bigStyleOf(value) === 'glow';
  return false;
}

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
    kind === 'story'
      ? String(titleInput ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, TEXT_LIMITS.story.title)
      : null;

  if (!body) {
    return {
      ok: false,
      error:
        kind === 'story' ? 'Write the message before posting it.' : 'Write something to post.',
    };
  }
  if (kind === 'story' && !title) {
    return { ok: false, error: 'A story needs a title.' };
  }
  return { ok: true, kind, title: title || null, body };
}

/**
 * The part of a story the feed shows.
 *
 * Cut at a word boundary where there is one near enough, because a preview that
 * stops mid-word reads as broken rather than as abbreviated. Nothing is cut at
 * all when the body is already within the limit, so a short "long" message
 * shows whole and offers no Read more it does not need.
 */
export function previewOf(body: string, limit = STORY_PREVIEW): { text: string; clipped: boolean } {
  const whole = body.trim();
  if (whole.length <= limit) return { text: whole, clipped: false };

  const cut = whole.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour a word boundary in the last third, or a long word would lose
  // most of the preview to it.
  const text = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return { text: text.trimEnd(), clipped: true };
}
