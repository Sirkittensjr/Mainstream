/**
 * How big a picture is, read from the first bytes of the file.
 *
 * Only the header is read — nothing is decoded and nothing is changed. The
 * stored file stays exactly the bytes that were uploaded; this is just enough
 * to record its width and height on the post, so the post can hold a space of
 * the photo's own shape while it loads instead of guessing one and cropping to
 * it.
 *
 * The size is the one a viewer sees. A phone often stores a portrait photo as
 * landscape pixels and an EXIF note saying "turn me a quarter"; browsers obey
 * that note when they draw it, so for orientations 5–8 the width and height
 * are swapped here to match.
 */
import type { SniffedType } from '@/lib/file-type';

export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u32le = (b: Uint8Array, i: number) => ((b[i + 3] << 24) >>> 0) + ((b[i + 2] << 16) | (b[i + 1] << 8) | b[i]);
const ascii = (b: Uint8Array, i: number, text: string) =>
  [...text].every((char, k) => b[i + k] === char.charCodeAt(0));

const valid = (size: ImageSize | null): ImageSize | null =>
  size && size.width > 0 && size.height > 0 ? size : null;

export function imageSize(bytes: Uint8Array, type: SniffedType): ImageSize | null {
  try {
    switch (type) {
      case 'image/jpeg':
        return valid(jpegSize(bytes));
      case 'image/png':
        return bytes.length >= 24 && ascii(bytes, 12, 'IHDR')
          ? valid({ width: u32be(bytes, 16), height: u32be(bytes, 20) })
          : null;
      case 'image/gif':
        return bytes.length >= 10 ? valid({ width: u16le(bytes, 6), height: u16le(bytes, 8) }) : null;
      case 'image/webp':
        return valid(webpSize(bytes));
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Start-of-frame markers: every JPEG flavour except the four that are not frames. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(b: Uint8Array): ImageSize | null {
  let orientation = 1;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff && i < b.length) i += 1; // fill bytes
    const marker = b[i];
    // Markers that stand alone, with no length after them.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // the image began without a frame header
    const length = u16be(b, i + 1);
    if (length < 2) return null;
    if (marker === 0xe1 && ascii(b, i + 3, 'Exif\0\0')) {
      orientation = exifOrientation(b, i + 9, i + 1 + length) ?? orientation;
    }
    if (SOF.has(marker)) {
      const height = u16be(b, i + 4);
      const width = u16be(b, i + 6);
      return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
    }
    i += 1 + length;
  }
  return null;
}

/** The Orientation tag (0x0112) from the first IFD of an EXIF block. */
function exifOrientation(b: Uint8Array, tiff: number, end: number): number | null {
  const little = ascii(b, tiff, 'II');
  if (!little && !ascii(b, tiff, 'MM')) return null;
  const read16 = (at: number) => (little ? u16le(b, at) : u16be(b, at));
  const read32 = (at: number) => (little ? u32le(b, at) : u32be(b, at));
  const ifd = tiff + read32(tiff + 4);
  if (ifd + 2 > end) return null;
  const entries = read16(ifd);
  for (let n = 0; n < entries; n += 1) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > end) return null;
    if (read16(entry) === 0x0112) {
      const value = read16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  if (ascii(b, 12, 'VP8 ')) {
    // A lossy key frame: start code, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, 'VP8X')) {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}
