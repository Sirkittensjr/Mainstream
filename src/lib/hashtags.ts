/**
 * What a hashtag is, once a post has been published.
 *
 * Posting is lib/video/hashtags.ts: that is where tags are typed, cleaned and
 * stored in a post's `tags` array. This is the other half — reading them back
 * off a post so they can be shown, linked and matched — and it is shared by
 * the server (hashtag pages, search) and the browser (the cards that draw
 * them), so both always agree on which posts a hashtag belongs to.
 *
 * A post's hashtags are its stored tags, then any hashtag written into its
 * caption that is not already one of them. The caption is never changed; this
 * only reads it.
 *
 * Matching ignores case: #Gaming and #gaming are one hashtag, with one page.
 */
import { cleanTag } from '@/lib/video/hashtags';

/**
 * The form every spelling of one hashtag shares, or null for something that
 * is not a hashtag at all (a tag that was nothing but punctuation).
 */
export function tagKey(raw: string): string | null {
  const tag = cleanTag(String(raw ?? '').normalize('NFC'));
  return tag ? tag.toLowerCase() : null;
}

/** Where a hashtag's page is. */
export function tagHref(key: string): string {
  return `/tag/${encodeURIComponent(key)}`;
}

/**
 * Hashtags written into a caption.
 *
 * A # that starts a word, followed by letters, numbers or underscores with at
 * least one letter among them — so "#3" in "be honest about #3" is a number,
 * not a hashtag, and the # in a link like example.com/page#top is not one
 * either. No lookbehind: older iPhones cannot parse it, and a regular
 * expression they cannot parse would break every page this ships in.
 */
const IN_CAPTION = /(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_]+)/gu;
const HAS_LETTER = /\p{L}/u;

export function captionHashtags(caption: string | null | undefined): string[] {
  const found: string[] = [];
  for (const match of String(caption ?? '').matchAll(IN_CAPTION)) {
    const word = match[2];
    if (HAS_LETTER.test(word)) found.push(word);
  }
  return found;
}

export interface PostHashtag {
  /** As the author wrote it, without the #. */
  label: string;
  /** What it links to and matches by. Null when it cannot be a hashtag. */
  key: string | null;
  /** Typed into the caption rather than stored as a tag. */
  fromCaption: boolean;
}

/**
 * Every hashtag a post carries, in the order it shows them: its stored tags
 * first, exactly as stored, then hashtags from its caption. One entry per
 * hashtag whatever its case — the first spelling is the one shown.
 */
export function postHashtags(post: {
  tags?: readonly string[] | null;
  caption?: string | null;
}): PostHashtag[] {
  const out: PostHashtag[] = [];
  const seen = new Set<string>();
  const add = (raw: string, fromCaption: boolean) => {
    const label = String(raw ?? '').trim().replace(/^#+/, '');
    if (!label) return;
    const key = tagKey(label);
    const identity = key ?? `raw:${label.toLowerCase()}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    out.push({ label, key, fromCaption });
  };
  for (const tag of post.tags ?? []) add(tag, false);
  for (const tag of captionHashtags(post.caption)) add(tag, true);
  return out;
}

/** Whether a post uses this hashtag, whatever case either is written in. */
export function postHasTag(
  post: { tags?: readonly string[] | null; caption?: string | null },
  key: string,
): boolean {
  return postHashtags(post).some((tag) => tag.key === key);
}
