/**
 * Hashtags on a post, as things rather than as text.
 *
 * A hashtag typed into a caption is decoration: it looks like a tag and does
 * nothing. FayTarra posts have had a `tags` array since the beginning — it is
 * what search and Discover read — so the posting screen collects them AS tags
 * and sends them as tags. Nothing is appended to the caption.
 */

/** What `createPost` keeps. Stated here so nobody is surprised by a silent drop. */
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 30;

/**
 * One tag out of whatever somebody typed, or nothing if it was not a tag.
 *
 * A leading # is dropped rather than refused: typing it is a habit, not a
 * mistake. Letters, numbers and underscores in any script survive; everything
 * else goes, because punctuation inside a tag is almost always a typo.
 */
export function cleanTag(raw: string): string | null {
  const tag = raw
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .slice(0, MAX_TAG_LENGTH);
  return tag.length > 0 ? tag : null;
}

/** Adds a tag, ignoring duplicates (whatever their case) and anything over the limit. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = cleanTag(raw);
  if (!tag || tags.length >= MAX_TAGS) return tags;
  const already = tags.some((existing) => existing.toLowerCase() === tag.toLowerCase());
  return already ? tags : [...tags, tag];
}

/**
 * The tags a post is actually stored with.
 *
 * The posting screen sends a list, which is the point of collecting them as
 * tags; an older client sending one string is still split on spaces and
 * commas. Either way nothing arrives in the caption and nothing trusted: the
 * same cleaning, de-duplicating and limit run over whatever turned up.
 */
export function normaliseTags(input: string | string[] | undefined | null): string[] {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[\s,]+/);
  let tags: string[] = [];
  for (const entry of raw) tags = addTag(tags, String(entry));
  return tags;
}
