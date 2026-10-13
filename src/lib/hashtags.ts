/**
 * Hashtags: what one is, how two are the same, and where one lives.
 *
 * A post's hashtags are every `#word` in what it says — the caption of a photo
 * or a video, the words of a text post, a story's title — together with the
 * tags it was posted with (the video posting screen collects those as a list;
 * see lib/video/hashtags.ts). They are found in what was PUBLISHED: nothing
 * here runs while somebody is typing, and a tag only exists on FayTarra once a
 * post carrying it does.
 *
 * Two spellings are one hashtag when they differ only in case — `#Gaming`,
 * `#gaming` and `#GAMING` are the same page — so every comparison, every URL
 * and every stored key uses `normaliseHashtag`. How a tag is DISPLAYED keeps
 * the casing somebody typed.
 *
 * Pure, and shared by the server (indexing, the hashtag page, search) and the
 * browser (turning `#words` into links), so both agree on exactly what is and
 * is not a hashtag.
 */

import type { HashtagRecord, PostHashtag } from './types';

/** The longest hashtag recognised. A longer run of letters is just text. */
export const MAX_HASHTAG_LENGTH = 50;

/** The most hashtags one post is filed under. Enough for anybody; a ceiling for spam. */
export const MAX_HASHTAGS_PER_POST = 30;

/**
 * A `#` that starts a hashtag, and the word after it.
 *
 * Not after a letter, a digit, `_`, `/`, `&` or another `#`: that is the middle
 * of a word (`C#`), a link (`example.com/page#section`), an HTML entity
 * (`&#39;`) or a run of hashes, none of which anybody meant as a tag.
 */
const HASHTAG = /(?<![\p{L}\p{N}\p{M}_/&#])#([\p{L}\p{N}\p{M}_]+)/gu;

/** At least one letter. `#1` and `#31` are numbers, not tags. */
const HAS_LETTER = /\p{L}/u;

export interface Hashtag {
  /** The key: lowercased and Unicode-normalised. What URLs and the index use. */
  tag: string;
  /** As somebody wrote it, without the `#`. What is shown. */
  display: string;
}

/**
 * The one form of a hashtag, or null if this is not one.
 *
 * Accepts it with or without the leading `#`, so `Gaming`, `#Gaming` and
 * `%23gaming` out of a URL all arrive at `gaming`.
 */
export function normaliseHashtag(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const word = raw.normalize('NFKC').trim().replace(/^#+/, '');
  if (!word || word.length > MAX_HASHTAG_LENGTH) return null;
  if (!/^[\p{L}\p{N}\p{M}_]+$/u.test(word) || !HAS_LETTER.test(word)) return null;
  return word.toLowerCase();
}

/** As a hashtag, keeping its casing, or null. */
function asHashtag(raw: string): Hashtag | null {
  const display = raw.normalize('NFKC').trim().replace(/^#+/, '');
  const tag = normaliseHashtag(display);
  return tag ? { tag, display } : null;
}

/** Every hashtag written in some text, in order, each once. */
export function extractHashtags(text: string | null | undefined): Hashtag[] {
  if (!text) return [];
  const found = new Map<string, Hashtag>();
  for (const match of text.normalize('NFKC').matchAll(HASHTAG)) {
    const hashtag = asHashtag(match[1]);
    if (hashtag && !found.has(hashtag.tag)) found.set(hashtag.tag, hashtag);
  }
  return [...found.values()];
}

/** The parts of a post that can carry hashtags. */
export interface Tagged {
  caption: string;
  text_title?: string | null;
  tags?: readonly string[] | null;
}

/**
 * Every hashtag a post is filed under: its title, its words and its tags, in
 * that order, each once whatever its casing, at most MAX_HASHTAGS_PER_POST.
 *
 * Photo, video and text posts are all the same here — a caption is a caption
 * and a text post's words are its caption — which is what makes one hashtag
 * page hold all three.
 */
export function postHashtags(post: Tagged): Hashtag[] {
  const found = new Map<string, Hashtag>();
  const add = (hashtag: Hashtag | null) => {
    if (hashtag && !found.has(hashtag.tag)) found.set(hashtag.tag, hashtag);
  };
  for (const hashtag of extractHashtags(post.text_title)) add(hashtag);
  for (const hashtag of extractHashtags(post.caption)) add(hashtag);
  for (const tag of post.tags ?? []) add(asHashtag(String(tag)));
  return [...found.values()].slice(0, MAX_HASHTAGS_PER_POST);
}

/** Whether a post is filed under this (normalised) hashtag. */
export function hasHashtag(post: Tagged, tag: string): boolean {
  return postHashtags(post).some((hashtag) => hashtag.tag === tag);
}

/** A post's tags that are hashtags but not already written in its words. */
export function extraTags(post: Tagged): Hashtag[] {
  const written = new Set([
    ...extractHashtags(post.text_title).map((hashtag) => hashtag.tag),
    ...extractHashtags(post.caption).map((hashtag) => hashtag.tag),
  ]);
  const found = new Map<string, Hashtag>();
  for (const raw of post.tags ?? []) {
    const hashtag = asHashtag(String(raw));
    if (hashtag && !written.has(hashtag.tag) && !found.has(hashtag.tag)) {
      found.set(hashtag.tag, hashtag);
    }
  }
  return [...found.values()];
}

/** The hashtag's own page. Always the normalised form, so one tag is one page. */
export function hashtagHref(raw: string): string {
  const tag = normaliseHashtag(raw) ?? raw.replace(/^#+/, '').toLowerCase();
  return `/tag/${encodeURIComponent(tag)}`;
}

/** A piece of text: words, or a hashtag to draw as a link. */
export type TextPart = { text: string; hashtag?: Hashtag };

/**
 * Text cut into words and hashtags, for drawing. Joining every part's `text`
 * gives back exactly what was passed in.
 */
export function splitHashtags(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(HASHTAG)) {
    const hashtag = asHashtag(match[1]);
    if (!hashtag || match.index === undefined) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[0], hashtag });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * What somebody typed into search, as a hashtag to look up — `Gaming` and
 * `#Gaming` alike. Only a single word is a hashtag; a phrase is a search.
 */
export function hashtagQuery(query: string): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  return words.length === 1 ? normaliseHashtag(words[0]) : null;
}

/**
 * The index rows for a set of posts: every hashtag once, and every post under
 * each of its hashtags.
 *
 * For filling an index that has never been written — the seed, and a local
 * store saved before hashtags were indexed. Oldest post first, so a hashtag's
 * display is how it was written the first time.
 */
export function hashtagIndexFor(
  posts: readonly (Tagged & { id: string; created_at: string })[],
  makeId: () => string,
): { hashtags: HashtagRecord[]; post_hashtags: PostHashtag[] } {
  const hashtags = new Map<string, HashtagRecord>();
  const post_hashtags: PostHashtag[] = [];
  const oldestFirst = [...posts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const post of oldestFirst) {
    for (const { tag, display } of postHashtags(post)) {
      if (!hashtags.has(tag)) {
        hashtags.set(tag, { id: makeId(), tag, display, created_at: post.created_at });
      }
      post_hashtags.push({ id: makeId(), post_id: post.id, tag, post_created_at: post.created_at });
    }
  }
  return { hashtags: [...hashtags.values()], post_hashtags };
}
