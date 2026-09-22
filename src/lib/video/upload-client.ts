import type { Media } from '@/lib/types';

/**
 * Sending a file to wherever this deployment keeps its media.
 *
 * Two routes, one function. In production the server signs a URL and the file
 * goes straight to Supabase Storage, because a 250MB request body would be
 * refused long before it reached the app; the server then checks what landed
 * and publishes it. On the local driver the file is posted to the app itself.
 * Either way the caller gets a URL it can attach to a post, and neither way
 * lets the browser decide whether the file was acceptable.
 */

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
  mode?: 'direct' | 'post';
  path?: string;
  uploadUrl?: string;
  token?: string;
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
