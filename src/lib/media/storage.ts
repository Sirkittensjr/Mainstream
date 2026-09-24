import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { probeVideoParts, type VideoProbe } from '@/lib/video/probe';

/**
 * Where an upload actually goes.
 *
 * A video can be 250MB, and a request body on most serverless hosts cannot be
 * anywhere near that — Vercel stops at 4.5MB. So the bytes never travel
 * through FayTarra: the server signs a URL for one specific object, the
 * browser sends the file straight to Supabase Storage, and the server then
 * checks what landed.
 *
 * Two things make that safe rather than a hole:
 *
 *   1. Every object is signed into `pending/<user id>/…`. The signature is for
 *      that one path, so a signed URL cannot be pointed at anybody else's
 *      file, and the user id in the path is the server's, never the client's.
 *   2. Nothing under `pending/` is a valid post attachment (see media.ts). An
 *      upload only becomes postable when `publish` MOVES it to `media/…`, and
 *      `publish` is on the other side of the size and duration checks. Skipping
 *      the check means skipping the move, which means having nothing to post.
 */

const PENDING = 'pending';
export const PUBLISHED = 'media';

/** How much of an object is pulled back to read its duration out of it. */
const PROBE_EDGE_BYTES = 4 * 1024 * 1024;

export function bucketName(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || 'faytarra-media';
}

function storageUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
}

/** Whether uploads can go straight to storage on this deployment. */
export function directUploadsAvailable(): boolean {
  return Boolean(storageUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let client: SupabaseClient | null = null;
function storage() {
  client ??= createClient(storageUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client.storage.from(bucketName());
}

export const publicUrlFor = (path: string): string =>
  `${storageUrl()}/storage/v1/object/public/${bucketName()}/${path}`;

export interface UploadTicket {
  /** The object's path while it is being checked. Handed back on commit. */
  path: string;
  /** Where the browser PUTs the bytes. */
  uploadUrl: string;
  token: string;
}

export async function createPendingUpload(
  userId: string,
  fileName: string,
): Promise<UploadTicket> {
  const path = pendingPathFor(userId, fileName);
  const { data, error } = await storage().createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new Error(error?.message ?? 'Could not start the upload.');
  }
  return { path, uploadUrl: data.signedUrl, token: data.token };
}

/** Where this person's uploads live while they are being checked. */
export function pendingPathFor(userId: string, fileName: string): string {
  return `${PENDING}/${userId}/${fileName}`;
}

/**
 * Supabase Storage's resumable (TUS) endpoint.
 *
 * The one-shot signed PUT above is fine for a picture. It is not fine for a
 * video off a phone: the whole file is one request, so a dropped connection
 * starts again from zero, and the request has to fit whatever the project and
 * its gateway allow in a single body. A resumable upload sends the file in
 * chunks, each one its own request, and can pick up where it stopped — which
 * is what makes a 100MB clip over mobile data a normal thing to do rather
 * than a gamble.
 *
 * It is authorised with the uploader's OWN access token, never the service
 * role, and the storage policies from migration 0007 only let that token
 * write under `pending/<their id>/`.
 */
export function resumableEndpoint(): string {
  return `${storageUrl()}/storage/v1/upload/resumable`;
}

/** Is this path one this person is allowed to be committing? */
export function ownsPendingPath(path: string, userId: string): boolean {
  return (
    typeof path === 'string' &&
    path.startsWith(`${PENDING}/${userId}/`) &&
    !path.includes('..') &&
    /^[A-Za-z0-9/._-]+$/.test(path) &&
    path.length < 256
  );
}

export interface PendingObject {
  size: number;
  head: Uint8Array;
  tail: Uint8Array | null;
}

/** The size of an uploaded object, and enough of its bytes to identify it. */
export async function inspectPending(path: string): Promise<PendingObject | null> {
  const files = await storage().list(path.slice(0, path.lastIndexOf('/')), {
    search: path.slice(path.lastIndexOf('/') + 1),
    limit: 1,
  });
  const entry = files.data?.[0];
  const size = (entry?.metadata as { size?: number } | undefined)?.size;
  if (!entry || typeof size !== 'number') return null;

  const head = await range(path, 0, Math.min(size, PROBE_EDGE_BYTES) - 1);
  if (!head) return null;
  const tail =
    size > PROBE_EDGE_BYTES ? await range(path, Math.max(0, size - PROBE_EDGE_BYTES), size - 1) : null;

  return { size, head, tail };
}

async function range(path: string, from: number, to: number): Promise<Uint8Array | null> {
  // The storage client has no range option, so this is a plain ranged GET
  // against the same signed object the client just wrote.
  const { data, error } = await storage().createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return null;
  const response = await fetch(data.signedUrl, { headers: { Range: `bytes=${from}-${to}` } });
  if (!response.ok && response.status !== 206) return null;
  return new Uint8Array(await response.arrayBuffer());
}

export function probePending(object: PendingObject): VideoProbe {
  return probeVideoParts(object.head, object.tail);
}

/**
 * Moves a checked upload to where posts may reference it, and returns its URL.
 *
 * This is the only way a path stops being `pending/`, which is what makes the
 * checks above impossible to route around.
 */
export async function publishPending(path: string): Promise<string> {
  const destination = `${PUBLISHED}/${path.slice(`${PENDING}/`.length)}`;
  const { error } = await storage().move(path, destination);
  if (error) throw new Error(error.message);
  return publicUrlFor(destination);
}

/** Is this published URL one of this person's own uploads? */
export function ownsPublishedUrl(url: string, userId: string): boolean {
  const prefix = publicUrlFor(`${PUBLISHED}/${userId}/`);
  return (
    typeof url === 'string' &&
    url.startsWith(prefix) &&
    !url.includes('..') &&
    url.length < 512 &&
    /^[A-Za-z0-9:/._-]+$/.test(url)
  );
}

/**
 * Removes a published object, unless a post is using it.
 *
 * The check is the point: this only exists to clean up after a post that
 * failed to be created, and a file that turns out to be on a post is not
 * rubbish. The lookup is a scan of the posts table's media, which is cheap
 * next to deleting somebody's video by mistake.
 */
export async function discardPublished(url: string): Promise<{ inUse: boolean; removed: boolean }> {
  const { db } = await import('@/lib/db');
  const posts = await db().query('posts');
  const used = posts.some((post) => post.media.some((item) => item.url === url));
  if (used) return { inUse: true, removed: false };

  const path = url.slice(publicUrlFor('').length);
  const { error } = await storage().remove([path]);
  return { inUse: false, removed: !error };
}

export async function discardPending(path: string): Promise<void> {
  // Best effort: a rejected upload that lingers is untidy, not dangerous.
  await storage().remove([path]).catch(() => undefined);
}
