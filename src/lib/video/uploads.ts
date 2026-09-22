import 'server-only';
import { EXTENSION_FOR, type SniffedType } from '@/lib/file-type';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_SECONDS_ENFORCED,
  formatMegabytes,
} from './limits';
import type { VideoProbe } from './probe';

/**
 * The rules an upload has to satisfy, in one place, so the two routes that
 * accept uploads cannot drift apart on what they allow.
 */

/** What may be uploaded at all, keyed by the type sniffed from the bytes. */
export const UPLOADABLE: SniffedType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

export const isVideoType = (type: SniffedType): boolean => type.startsWith('video/');

export const maxBytesFor = (type: SniffedType): number =>
  isVideoType(type) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

export const extensionFor = (type: SniffedType): string => EXTENSION_FOR[type];

export type Refusal = { ok: false; error: string; status: number };
export type Allowed = { ok: true };

export function checkSize(type: SniffedType, size: number): Allowed | Refusal {
  const limit = maxBytesFor(type);
  if (size > limit) {
    return {
      ok: false,
      status: 413,
      error: isVideoType(type)
        ? `That video is ${formatMegabytes(size)}. Videos can be up to ${formatMegabytes(limit)}.`
        : `That image is ${formatMegabytes(size)}. Images can be up to ${formatMegabytes(limit)}.`,
    };
  }
  return { ok: true };
}

/**
 * The length rule, enforced on what the file says rather than what the editor
 * promised. A request that never went near the editor gets the same answer.
 *
 * A video whose length cannot be read is refused rather than waved through:
 * "we could not check" must not become "it is fine". The editor's own output
 * always states its length at one end of the file or the other, so this only
 * ever rejects something genuinely unreadable.
 */
export function checkDuration(probe: VideoProbe): Allowed | Refusal {
  if (probe.seconds === null) {
    return {
      ok: false,
      status: 422,
      error:
        'We could not read how long that video is, so it cannot be posted. ' +
        'Try exporting it again, or record it in the editor.',
    };
  }
  if (probe.seconds > MAX_VIDEO_SECONDS_ENFORCED) {
    const minutes = MAX_VIDEO_SECONDS / 60;
    return {
      ok: false,
      status: 422,
      error: `That video is ${Math.round(probe.seconds)} seconds. FayTarra videos can be up to ${minutes} minutes — trim it in the editor.`,
    };
  }
  return { ok: true };
}
