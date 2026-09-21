/**
 * What a file actually is, read from its first bytes.
 *
 * The browser's `File.type` is whatever the client says it is, so an upload
 * declared `image/png` can hold anything at all. Sniffing the real signature
 * means only genuine images and video get stored, and the type we serve the
 * file back with is the type it really is.
 */
export type SniffedType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'video/mp4'
  | 'video/webm'
  | 'video/quicktime';

export const EXTENSION_FOR: Record<SniffedType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

const starts = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (bytes: Uint8Array, text: string, offset: number): boolean =>
  [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

export function sniffType(bytes: Uint8Array): SniffedType | null {
  if (bytes.length < 16) return null;

  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (ascii(bytes, 'RIFF', 0) && ascii(bytes, 'WEBP', 8)) return 'image/webp';
  // Matroska/WebM. Both share the EBML header, so the doctype decides.
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';

  // ISO base media: "ftyp" at offset 4, then a brand.
  if (ascii(bytes, 'ftyp', 4)) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }

  return null;
}
