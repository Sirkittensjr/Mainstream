/**
 * What the public landing page's carousel shows.
 *
 * Real posts first: the newest visitors should see what people actually put on
 * FayTarra. A young platform does not always have enough of them, though, and
 * the answer to that is never to invent people — so the carousel is topped up
 * with preview cards that say they are previews, carry no username, and show
 * their rating as an example rather than as somebody's score.
 *
 * Plain functions over plain shapes, so the rules can be tested without a
 * database. The server half, which reads the posts, is services/landing.ts.
 */
import { isVectorImage } from '@/lib/image';
import type { Category, Media } from '@/lib/types';

/** The fewest cards the carousel shows; real posts first, previews after. */
export const SHOWCASE_MIN = 5;
/** The most it shows. Enough to browse, few enough to stay light. */
export const SHOWCASE_MAX = 8;
/** One person filling the carousel would not show what FayTarra is. */
const PER_AUTHOR = 2;

export interface ShowcaseThumb {
  url: string;
  kind: 'image' | 'video';
}

/**
 * The picture a card shows for a post: the photo, or a video's poster.
 *
 * Never the video itself — the carousel loads no video at all, so nothing can
 * autoplay and nothing heavier than a picture is fetched. A video without a
 * poster is left out rather than shown blank. Generated cover art is left out
 * too: it is what sample content points at, not something a person uploaded.
 */
export function showcaseThumb(media: Media[]): ShowcaseThumb | null {
  const first = media[0];
  if (!first) return null;
  const url = first.kind === 'video' ? first.poster : first.url;
  if (!url || isVectorImage(url)) return null;
  return { url, kind: first.kind };
}

export interface ShowcaseCandidate {
  id: string;
  authorId: string;
  category: Category;
  media: Media[];
  contentWarning: boolean;
  /** The confidence-adjusted rating score — the same order Discover uses. */
  score: number;
  createdAt: string;
}

/**
 * The posts worth putting in front of somebody who has never been here.
 *
 * Only posts with a picture, and never one its author covered with a content
 * warning — a stranger has not chosen to see it. Best rated first, then
 * newest, taken a category at a time so the carousel shows the range of what
 * people post rather than ten photos of the same thing.
 */
export function pickShowcase<T extends ShowcaseCandidate>(
  posts: T[],
  limit = SHOWCASE_MAX,
): T[] {
  const ordered = posts
    .filter((post) => !post.contentWarning && showcaseThumb(post.media))
    .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));

  const perAuthor = new Map<string, number>();
  const byCategory = new Map<Category, T[]>();
  for (const post of ordered) {
    const count = perAuthor.get(post.authorId) ?? 0;
    if (count >= PER_AUTHOR) continue;
    perAuthor.set(post.authorId, count + 1);
    const list = byCategory.get(post.category) ?? [];
    list.push(post);
    byCategory.set(post.category, list);
  }

  // Round robin: the best of each category, then the second best, and so on.
  const picked: T[] = [];
  while (picked.length < limit && byCategory.size > 0) {
    for (const [category, list] of byCategory) {
      const next = list.shift();
      if (next) picked.push(next);
      if (list.length === 0) byCategory.delete(category);
      if (picked.length >= limit) break;
    }
  }
  return picked;
}

/** The illustration a preview card is drawn with. */
export type PreviewArt = 'nature' | 'cat' | 'art' | 'gaming' | 'car' | 'music';

export interface PreviewPost {
  key: string;
  art: PreviewArt;
  /** What kind of post it is, standing where a creator's name would. */
  topic: string;
  caption: string;
  category: Category;
  /** Shown labelled "Example" — nobody gave it this. */
  exampleRating: number;
}

/**
 * The range of FayTarra in six posts nobody made.
 *
 * In this order so that a carousel needing only two of them still gets a
 * photograph and a cat.
 */
export const PREVIEW_POSTS: PreviewPost[] = [
  {
    key: 'nature',
    art: 'nature',
    topic: 'Nature photography',
    caption: 'Golden hour from the ridge. Worth the 5am alarm.',
    category: 'Photography',
    exampleRating: 9.1,
  },
  {
    key: 'cat',
    art: 'cat',
    topic: 'Everyday moments',
    caption: 'Supervisor on duty. He did not approve of the new couch.',
    category: 'Life',
    exampleRating: 8.8,
  },
  {
    key: 'art',
    art: 'art',
    topic: 'Art',
    caption: 'Three weeks of layers. Finally finished this one.',
    category: 'Art',
    exampleRating: 8.6,
  },
  {
    key: 'gaming',
    art: 'gaming',
    topic: 'Gaming',
    caption: 'Clutched a 1v4 last night. Still shaking.',
    category: 'Gaming',
    exampleRating: 8.3,
  },
  {
    key: 'car',
    art: 'car',
    topic: 'Cars & hobbies',
    caption: 'Saturday detail on the old coupe. Every hour was worth it.',
    category: 'Other',
    exampleRating: 8.9,
  },
  {
    key: 'music',
    art: 'music',
    topic: 'Music',
    caption: 'First demo of the new track. Be honest.',
    category: 'Music',
    exampleRating: 8.4,
  },
];

/** How many preview cards to add after `real` real posts. */
export function previewsNeeded(real: number): number {
  return Math.max(0, Math.min(PREVIEW_POSTS.length, SHOWCASE_MIN - real));
}

/** A real post, as the carousel draws it. Serialisable: it crosses to the client. */
export interface ShowcasePostCard {
  type: 'post';
  id: string;
  thumb: ShowcaseThumb;
  caption: string;
  category: Category;
  author: { username: string; displayName: string; avatarUrl: string | null };
  rating: number | null;
  votes: number;
  likes: number;
}

export interface ShowcasePreviewCard extends PreviewPost {
  type: 'preview';
}

export type ShowcaseCard = ShowcasePostCard | ShowcasePreviewCard;

/** Real posts, then as many previews as it takes to fill the carousel. */
export function withPreviews(real: ShowcasePostCard[]): ShowcaseCard[] {
  const previews = PREVIEW_POSTS.slice(0, previewsNeeded(real.length)).map(
    (preview): ShowcasePreviewCard => ({ ...preview, type: 'preview' }),
  );
  return [...real, ...previews];
}

/**
 * The card positions either side of the active one, wrapping around.
 *
 * -1 is the card to its left, 1 the card to its right. With few cards a card
 * is placed on whichever side is nearer, so two cards never stack in one spot.
 */
export function slideOffset(index: number, active: number, total: number): number {
  if (total <= 1) return 0;
  let offset = (((index - active) % total) + total) % total;
  if (offset > total / 2) offset -= total;
  // An even count leaves one card exactly opposite; keep it on the right.
  if (offset === -total / 2) offset = total / 2;
  return offset;
}
