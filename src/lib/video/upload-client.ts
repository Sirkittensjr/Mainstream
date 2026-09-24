import { Upload } from 'tus-js-client';
import type { Media } from '@/lib/types';

/**
 * Sending a file to wherever this deployment keeps its media.
 *
 * Three routes, one function, and the server picks which by answering
 * /api/upload/sign:
 *
 *   resumable — a video on Supabase. The file goes to Storage's TUS endpoint
 *     in chunks, straight from the browser. A phone's video is tens or
 *     hundreds of megabytes on a connection that comes and goes, so this is
 *     the only one of the three that can carry it: each chunk is its own
 *     request, a failed one is retried, and an interrupted upload resumes
 *     from the offset Storage already has rather than from zero.
 *   direct — a picture on Supabase. One signed PUT.
 *   post — no Supabase Storage here (the local driver), so the app takes it.
 *
 * In the first two the bytes never touch a FayTarra request. The server still
 * decides whether what landed is acceptable: it reads the stored object on
 * commit, and nothing is postable until that passes.
 */

/**
 * Supabase Storage's resumable endpoint requires exactly this chunk size for
 * every part but the last. It is not a tuning knob.
 */
const CHUNK_BYTES = 6 * 1024 * 1024;

export interface UploadProgress {
  /** 0 to 1. */
  ratio: number;
  phase: 'uploading' | 'checking';
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export interface UploadedMedia extends Media {
  width?: number;
  height?: number;
  duration?: number;
}

interface SignResponse {
  mode?: 'direct' | 'post' | 'resumable';
  path?: string;
  uploadUrl?: string;
  token?: string;
  /** Resumable only. */
  endpoint?: string;
  bucket?: string;
  apikey?: string;
  contentType?: string;
  error?: string;
}

interface CommitResponse {
  url?: string;
  kind?: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  error?: string;
}

export class UploadError extends Error {}

const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
};

const ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'video/x-m4v': 'video/mp4',
  'video/mp4v-es': 'video/mp4',
  'video/x-quicktime': 'video/quicktime',
};

const KNOWN = new Set(Object.values(BY_EXTENSION));

/**
 * What to tell the server a file is.
 *
 * `File.type` comes from the operating system and is regularly empty, generic
 * or a vendor spelling nobody else uses — a .mov dragged out of some apps
 * arrives as `application/octet-stream`. The extension is a better guess in
 * those cases, and either way it is only a guess: the server decides what the
 * file really is by reading its bytes.
 */
export function contentTypeFor(file: File): string {
  const declared = (file.type || '').toLowerCase();
  if (KNOWN.has(declared)) return declared;
  if (ALIASES[declared]) return ALIASES[declared];
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? declared;
}

export async function uploadMedia(
  body: Blob,
  contentType: string,
  options: UploadOptions = {},
): Promise<UploadedMedia> {
  const signed = await fetchJson<SignResponse>('/api/upload/sign', {
    contentType,
    size: body.size,
  });
  if (signed.error) throw new UploadError(signed.error);

  if (signed.mode === 'resumable' && signed.endpoint && signed.bucket && signed.path) {
    await sendResumable(body, contentType, signed, options);
    options.onProgress?.({ ratio: 1, phase: 'checking' });
    const committed = await fetchJson<CommitResponse>('/api/upload/commit', { path: signed.path });
    return toMedia(committed);
  }

  if (signed.mode === 'direct' && signed.uploadUrl && signed.path) {
    await send('PUT', signed.uploadUrl, body, {
      headers: { 'content-type': contentType, 'cache-control': 'max-age=31536000', 'x-upsert': 'true' },
      onProgress: (ratio) => options.onProgress?.({ ratio, phase: 'uploading' }),
      signal: options.signal,
    });
    options.onProgress?.({ ratio: 1, phase: 'checking' });
    const committed = await fetchJson<CommitResponse>('/api/upload/commit', { path: signed.path });
    return toMedia(committed);
  }

  const form = new FormData();
  form.append('file', body, `upload${extensionFor(contentType)}`);
  const raw = await send('POST', '/api/upload', form, {
    onProgress: (ratio) => options.onProgress?.({ ratio, phase: 'uploading' }),
    signal: options.signal,
  });
  options.onProgress?.({ ratio: 1, phase: 'checking' });
  return toMedia(JSON.parse(raw || '{}') as CommitResponse);
}

/**
 * The resumable upload itself.
 *
 * tus-js-client speaks the protocol Supabase Storage implements, including
 * the parts that are easy to get subtly wrong — offset negotiation, retry
 * backoff, and resuming against an upload the server already holds. The
 * fingerprint is the storage path, which the server derived from the session,
 * so a retry of the same file resumes rather than starting again.
 *
 * `onProgress` is the real number of bytes acknowledged by Storage. Nothing
 * here estimates or animates: if the connection stalls, the bar stalls, which
 * is the truth and is more useful than a number that keeps moving.
 */
function sendResumable(
  body: Blob,
  contentType: string,
  ticket: SignResponse,
  options: UploadOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new Upload(body, {
      endpoint: ticket.endpoint,
      retryDelays: [0, 1000, 3000, 6000, 12000],
      chunkSize: CHUNK_BYTES,
      // Storage needs the object's home in the metadata rather than the URL.
      metadata: {
        bucketName: ticket.bucket as string,
        objectName: ticket.path as string,
        contentType,
        cacheControl: '31536000',
      },
      headers: {
        authorization: `Bearer ${ticket.token ?? ''}`,
        ...(ticket.apikey ? { apikey: ticket.apikey } : {}),
        'x-upsert': 'true',
      },
      // Storage creates the upload first and takes the bytes in PATCHes
      // afterwards; it does not implement tus's creation-with-upload, and a
      // client that sends the first chunk with the creation request gets an
      // offset it did not expect and starts over, forever.
      uploadDataDuringCreation: false,
      removeFingerprintOnSuccess: true,
      fingerprint: async () => `faytarra:${ticket.path}`,
      onProgress: (sent, total) => {
        if (total > 0) options.onProgress?.({ ratio: sent / total, phase: 'uploading' });
      },
      onSuccess: () => resolve(),
      onError: (error) => reject(new UploadError(describe(error))),
    });

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Cancelled', 'AbortError'));
        return;
      }
      options.signal.addEventListener(
        'abort',
        () => {
          // `true` also tells Storage to forget the partial object, so a
          // cancelled upload does not leave anything behind to tidy up.
          void upload.abort(true).finally(() => {
            reject(new DOMException('Cancelled', 'AbortError'));
          });
        },
        { once: true },
      );
    }

    // Resume from whatever Storage already has of this exact object.
    void upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}

/**
 * What to tell somebody when a chunk is refused.
 *
 * Storage's own message is the useful part when there is one — "Payload too
 * large" is what a project whose upload limit has not been raised says, and
 * repeating it verbatim is more helpful than a generic failure.
 */
function describe(error: Error): string {
  const body = /response text: ([^,]+)/i.exec(error.message)?.[1] ?? '';
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    const message = parsed.message ?? parsed.error;
    if (message) {
      return /payload too large|exceeded the maximum allowed size/i.test(message)
        ? `Supabase Storage refused the file: ${message}. The project's upload size limit needs raising.`
        : message;
    }
  } catch {
    // Not JSON. The message below is all there is.
  }
  return error.message || 'The upload failed.';
}

function toMedia(response: CommitResponse): UploadedMedia {
  if (response.error || !response.url) {
    throw new UploadError(response.error ?? 'The upload did not go through.');
  }
  return {
    kind: response.kind === 'video' ? 'video' : 'image',
    url: response.url,
    ...(response.width && response.height
      ? { width: response.width, height: response.height }
      : {}),
    ...(response.duration ? { duration: response.duration } : {}),
  };
}

function extensionFor(contentType: string): string {
  const known: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
  };
  return known[contentType] ?? '';
}

async function fetchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && !parsed.error) {
    throw new UploadError(`The upload failed (${response.status}).`);
  }
  if (parsed.error) throw new UploadError(parsed.error);
  return parsed;
}

interface SendOptions {
  headers?: Record<string, string>;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

/**
 * XHR rather than fetch, purely for upload progress.
 *
 * `fetch` still cannot report how much of a request body has gone out, and a
 * 200MB upload with no progress bar is indistinguishable from a hung page.
 */
function send(
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit,
  { headers = {}, onProgress, signal }: SendOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.responseText);
        return;
      }
      let message = `The upload failed (${request.status}).`;
      try {
        const parsed = JSON.parse(request.responseText) as { error?: string; message?: string };
        message = parsed.error ?? parsed.message ?? message;
      } catch {
        // Not JSON — the status is all we have to go on.
      }
      reject(new UploadError(message));
    });
    request.addEventListener('error', () => reject(new UploadError('The upload failed.')));
    request.addEventListener('abort', () =>
      reject(new DOMException('Cancelled', 'AbortError')),
    );

    signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(body);
  });
}

/**
 * Takes a stored file back out again.
 *
 * Used when the upload succeeded and the post did not: without this the
 * bucket keeps a video nothing points at, and nobody would ever know it was
 * there. Best effort by design — a file that outlives its post is untidy, and
 * failing the whole flow over the tidying would be worse.
 */
export async function discardMedia(url: string): Promise<void> {
  try {
    await fetch('/api/upload/discard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      keepalive: true,
    });
  } catch {
    // Offline, or the page is going away. The object stays; nothing breaks.
  }
}
