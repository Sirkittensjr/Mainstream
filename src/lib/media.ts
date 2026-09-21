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
 * So a stored URL has to be one this deployment issued.
 */

const LOCAL_PREFIX = '/api/media/';

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
    return /^[A-Za-z0-9._/-]+$/.test(name) && !name.includes('..');
  }

  return false;
}

export interface UnsafeMedia {
  kind?: unknown;
  url?: unknown;
  poster?: unknown;
}

/** Keeps only the media entries this deployment actually stored. */
export function sanitiseMedia(input: unknown, max = 6): { kind: 'image' | 'video'; url: string }[] {
  if (!Array.isArray(input)) return [];
  const out: { kind: 'image' | 'video'; url: string }[] = [];
  for (const entry of input as UnsafeMedia[]) {
    if (out.length >= max) break;
    if (!entry || typeof entry !== 'object') continue;
    const url = typeof entry.url === 'string' ? entry.url : '';
    if (!isOwnMediaUrl(url)) continue;
    out.push({ kind: entry.kind === 'video' ? 'video' : 'image', url });
  }
  return out;
}

/** An avatar is either one of our own uploads or nothing. */
export function sanitiseAvatarUrl(input: unknown): string | null {
  return typeof input === 'string' && isOwnMediaUrl(input) ? input : null;
}
