import { shelfFor } from './media';
import type { Media } from './types';

/**
 * A profile's tabs, in the order they are shown. Posts first, because Posts is
 * where a profile opens — a bar whose first chip is not the one filled in reads
 * as a bug.
 */
export const PROFILE_TABS = ['posts', 'videos', 'text', 'about'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
export type ProfileShelf = Exclude<ProfileTab, 'about'>;
export const PROFILE_SHELVES: ProfileShelf[] = ['posts', 'videos', 'text'];

/** How many posts a shelf opens with, and how many more each "Show more" adds. */
export const SHELF_PAGE = 20;
/** The furthest "Show more" goes on one page. */
export const SHELF_MAX = 200;

export function profileTabFrom(value: string | null | undefined): ProfileTab {
  return PROFILE_TABS.includes((value ?? '') as ProfileTab) ? (value as ProfileTab) : 'posts';
}

/**
 * What each shelf holds. Posts is everything — photos, videos and anything
 * written; Videos and Text are that same list filtered by `shelfFor`. The order
 * is the order given, which is newest first.
 */
export function shelfPosts<T extends { media: Media[] }>(posts: T[], shelf: ProfileShelf): T[] {
  if (shelf === 'posts') return posts;
  return posts.filter((post) => shelfFor(post.media) === shelf);
}

/**
 * The first page of every shelf, worked out from one list.
 *
 * The open shelf shows as far as `show` asked for; the others their first page.
 * `wanted` is every post any of those pages shows, each once and in the original
 * order — so the page hydrates (likes, comments, authors) one set of posts, not
 * three overlapping ones, and nothing past the pages is hydrated at all.
 */
export function shelfPages<T extends { id: string; media: Media[] }>(
  posts: T[],
  open: ProfileTab,
  show: number,
) {
  const shelves = {} as Record<ProfileShelf, { all: T[]; page: T[]; limit: number }>;
  const ids = new Set<string>();
  for (const shelf of PROFILE_SHELVES) {
    const all = shelfPosts(posts, shelf);
    const limit = shelf === open ? show : SHELF_PAGE;
    const page = all.slice(0, limit);
    for (const post of page) ids.add(post.id);
    shelves[shelf] = { all, page, limit };
  }
  return { shelves, wanted: posts.filter((post) => ids.has(post.id)) };
}

/** `?show=` read the way the profile always has: 20 to 200, 20 when absent. */
export function shelfLimit(show: string | undefined): number {
  const requested = Number.parseInt(show ?? '', 10);
  return Number.isFinite(requested)
    ? Math.min(Math.max(requested, SHELF_PAGE), SHELF_MAX)
    : SHELF_PAGE;
}

/**
 * A tab's address. Posts is the profile itself; the others keep the `?tab=` the
 * profile has always used. `show` is kept only when it is more than a first page,
 * so the address says what the shelf is showing.
 */
export function shelfHref(username: string, tab: ProfileTab, show = SHELF_PAGE): string {
  const params = new URLSearchParams({
    ...(tab === 'posts' ? {} : { tab }),
    ...(show > SHELF_PAGE ? { show: String(show) } : {}),
  });
  const query = params.toString();
  return `/u/${username}${query ? `?${query}` : ''}`;
}
