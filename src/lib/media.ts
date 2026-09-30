/**
 * Which media URLs FayTarra will store.
 *
 * The create form posts its media list as a hidden field, and the settings
 * form posts an avatar URL. Both are just strings from the browser, so
 * without this anybody could attach any URL on the internet to their post:
 * an off-site tracking pixel that logs the IP of everyone who scrolls past,
 * content that never passed the upload checks, or a link that starts working
 * differently after a moderator has approved it.
 *
 * So a stored URL has to be one this deployment issued, AND one that finished
 * being checked. A large upload goes straight to Supabase Storage rather than
 * through this app (see media/storage.ts), which means the bytes exist before
 * anything has looked at them; they sit under `pending/` until the size and
 * duration checks pass and the object is moved to `media/`. Refusing
 * `pending/` here is what makes those checks unavoidable.
 */

import {
  MAX_TEXT_OVERLAYS,
  MAX_TEXT_OVERLAY_LENGTH,
  type Media,
  type MediaKind,
  type TextOverlay,
} from './types';

const LOCAL_PREFIX = '/api/media/';

/** Uploads that have been checked live here. Anything else in the bucket has not. */
const PUBLISHED_PREFIX = 'media/';
const PENDING_PREFIX = 'pending/';

/** The public prefix Supabase Storage serves this project's bucket from. */
function storagePrefix(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!base) return null;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'faytarra-media';
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/`;
}

export function isOwnMediaUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > 512) return false;

  if (url.startsWith(LOCAL_PREFIX)) {
    // One path segment, no traversal, no query string smuggling.
    const name = url.slice(LOCAL_PREFIX.length);
    return /^[A-Za-z0-9._-]+$/.test(name) && !name.includes('..');
  }

  const prefix = storagePrefix();
  if (prefix && url.startsWith(prefix)) {
    const name = url.slice(prefix.length);
    if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.includes('..')) return false;
    // An upload nobody has checked yet is not something a post may point at.
    if (name.startsWith(PENDING_PREFIX)) return false;
    // Objects from before the checked/unchecked split sit at the bucket root.
    return name.startsWith(PUBLISHED_PREFIX) || !name.includes('/');
  }

  return false;
}

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v'];

/**
 * Whether a URL points at video, decided by the name the SERVER gave it.
 *
 * The upload route names every object after the type it sniffed out of the
 * bytes, so the extension is a fact rather than a claim. Taking the caller's
 * word for `kind` would let an image be posted as a video and vice versa.
 */
export function mediaKindForUrl(url: string): MediaKind {
  const path = url.split('?')[0].toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => path.endsWith(extension)) ? 'video' : 'image';
}

export interface UnsafeMedia {
  kind?: unknown;
  url?: unknown;
  poster?: unknown;
  width?: unknown;
  height?: unknown;
  duration?: unknown;
  muted?: unknown;
  text?: unknown;
}

const dimension = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8192
    ? Math.round(value)
    : undefined;

const seconds = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 24 * 3600
    ? Math.round(value * 100) / 100
    : undefined;

const TEXT_POSITIONS = new Set(['top', 'middle', 'bottom']);
const TEXT_SIZES = new Set(['m', 'l']);
const TEXT_TONES = new Set(['light', 'dark', 'fay']);

/**
 * The text overlays on one video, from whatever the client sent.
 *
 * Every field is checked against a fixed set rather than passed through. The
 * strings are rendered as React text so they cannot become markup, but they are
 * still somebody's words on a page: the length is capped so one overlay cannot
 * paper over a video, the count is capped so four cannot become four hundred,
 * and anything blank after trimming is dropped rather than stored as an empty
 * box. Position, size and tone are enumerations because an arbitrary colour or
 * offset is how text ends up unreadable or off-screen.
 */
function sanitiseTextOverlays(input: unknown): TextOverlay[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: TextOverlay[] = [];
  for (const entry of input) {
    if (out.length >= MAX_TEXT_OVERLAYS) break;
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const text =
      typeof candidate.text === 'string'
        ? candidate.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_OVERLAY_LENGTH)
        : '';
    if (!text) continue;
    out.push({
      text,
      at: TEXT_POSITIONS.has(candidate.at as string)
        ? (candidate.at as TextOverlay['at'])
        : 'bottom',
      size: TEXT_SIZES.has(candidate.size as string)
        ? (candidate.size as TextOverlay['size'])
        : 'm',
      tone: TEXT_TONES.has(candidate.tone as string)
        ? (candidate.tone as TextOverlay['tone'])
        : 'light',
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Keeps only the media entries this deployment actually stored. */
export function sanitiseMedia(input: unknown, max = 6): Media[] {
  if (!Array.isArray(input)) return [];
  const out: Media[] = [];
  for (const entry of input as UnsafeMedia[]) {
    if (out.length >= max) break;
    if (!entry || typeof entry !== 'object') continue;
    const url = typeof entry.url === 'string' ? entry.url : '';
    if (!isOwnMediaUrl(url)) continue;

    const item: Media = { kind: mediaKindForUrl(url), url };
    // A poster is another stored file and gets exactly the same treatment.
    if (typeof entry.poster === 'string' && isOwnMediaUrl(entry.poster)) {
      item.poster = entry.poster;
    }
    const width = dimension(entry.width);
    const height = dimension(entry.height);
    if (width && height) {
      item.width = width;
      item.height = height;
    }
    const length = seconds(entry.duration);
    if (length && item.kind === 'video') item.duration = length;

    // Playback properties, video only. Opted in one at a time because this
    // function rebuilds media from scratch — anything not named here is dropped,
    // which is what stops a client inventing fields the app will later trust.
    if (item.kind === 'video') {
      if (entry.muted === true) item.muted = true;
      const overlays = sanitiseTextOverlays(entry.text);
      if (overlays) item.text = overlays;
    }

    out.push(item);
  }
  return out;
}

/** An avatar is either one of our own uploads or nothing. */
export function sanitiseAvatarUrl(input: unknown): string | null {
  return typeof input === 'string' && isOwnMediaUrl(input) ? input : null;
}

/**
 * The video a post leads with, if it has one.
 *
 * A post can carry a mix of pictures and clips; the Videos feed plays the
 * first clip and leaves the rest of the post to the post page.
 */
export function firstVideo(media: Media[]): Media | null {
  return media.find((item) => item.kind === 'video') ?? null;
}

/**
 * Which shelf of a profile a post belongs on.
 *
 * The profile is three lists — Videos, Posts, Text — and this is the only rule
 * that decides which. It is derived from the media a post carries rather than
 * stored on it, so nothing had to be migrated and an old post lands in the right
 * place the first time somebody looks.
 *
 * A post with both a video and photos counts as a video: the video is the thing
 * people came to watch, and putting it under Posts would hide it from the shelf
 * it belongs on.
 */
export type PostShelf = 'videos' | 'posts' | 'text';

export function shelfFor(media: Media[]): PostShelf {
  if (media.some((item) => item.kind === 'video')) return 'videos';
  if (media.length > 0) return 'posts';
  return 'text';
}
