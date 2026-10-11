/**
 * A photo goes in and comes out as the same photo.
 *
 *   - its size is read from its header — width and height as a viewer sees
 *     them, EXIF rotation included — for JPEG, PNG, WebP and GIF
 *   - the upload route stores the exact bytes it was sent, in the format they
 *     are, and reports the size: nothing is cropped, resized or re-encoded
 *   - a post keeps that size, so it can hold the photo's own shape
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it, mock } from 'node:test';

const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-photo-'));
process.env.FAYTARRA_DATA_DIR = dataDir;

const uploader = {
  id: crypto.randomUUID(),
  username: 'photographer',
  role: 'user' as const,
  status: 'active' as const,
};

mock.module('next/cache', {
  namedExports: {
    revalidateTag: () => undefined,
    revalidatePath: () => undefined,
    unstable_cache: <T,>(fn: T) => fn,
  },
});
mock.module('../session', { namedExports: { getViewer: async () => uploader } });

/**
 * Supabase Storage, for the direct route: the browser has already PUT the file
 * under pending/, and the app only reads its first bytes and moves it.
 */
const bucket = new Map<string, Uint8Array>();
const moved: string[] = [];
mock.module('./storage', {
  namedExports: {
    ownsPendingPath: (p: string, userId: string) => p.startsWith(`pending/${userId}/`),
    inspectPending: async (p: string) => {
      const data = bucket.get(p);
      return data ? { size: data.length, head: data.slice(0, 4 * 1024 * 1024), tail: null } : null;
    },
    probePending: () => ({ width: null, height: null, seconds: null }),
    discardPending: async (p: string) => void bucket.delete(p),
    publishPending: async (p: string) => {
      moved.push(p);
      const destination = p.replace('pending/', 'media/');
      bucket.set(destination, bucket.get(p) as Uint8Array);
      bucket.delete(p);
      return `https://project.supabase.co/storage/v1/object/public/faytarra-media/${destination}`;
    },
  },
});

let imageSize: typeof import('./image-size').imageSize;
let upload: typeof import('@/app/api/upload/route').POST;
let sanitiseMedia: typeof import('@/lib/media').sanitiseMedia;
let commit: typeof import('@/app/api/upload/commit/route').POST;

before(async () => {
  ({ imageSize } = await import('./image-size'));
  ({ POST: upload } = await import('@/app/api/upload/route'));
  ({ sanitiseMedia } = await import('@/lib/media'));
  ({ POST: commit } = await import('@/app/api/upload/commit/route'));
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

// --- files, built byte by byte ------------------------------------------------

const bytes = (...parts: (number[] | Uint8Array | string)[]): Uint8Array => {
  const flat: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (const char of part) flat.push(char.charCodeAt(0));
    else flat.push(...part);
  }
  return Uint8Array.from(flat);
};
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
/** Something that stands in for compressed picture data, different every time. */
const noise = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 131 + length) & 0xfe);

function png(width: number, height: number): Uint8Array {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0], [0, 0, 0, 0],
    be32(64), 'IDAT', noise(64), [0, 0, 0, 0],
    be32(0), 'IEND', [0xae, 0x42, 0x60, 0x82],
  );
}

function gif(width: number, height: number): Uint8Array {
  return bytes('GIF89a', le16(width), le16(height), [0, 0, 0], noise(40), ';');
}

function webp(chunk: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Uint8Array {
  const body =
    chunk === 'VP8 '
      ? bytes([0x30, 0x01, 0x00], [0x9d, 0x01, 0x2a], le16(width), le16(height), noise(40))
      : chunk === 'VP8L'
        ? bytes([0x2f], le32(((width - 1) | ((height - 1) << 14)) >>> 0), noise(40))
        : bytes([0x08, 0, 0, 0], le24(width - 1), le24(height - 1), noise(40));
  return bytes('RIFF', le32(4 + 8 + body.length), 'WEBP', chunk, le32(body.length), body);
}

function exif(orientation: number, order: 'II' | 'MM'): Uint8Array {
  const n16 = order === 'II' ? le16 : be16;
  const n32 = order === 'II' ? le32 : be32;
  const tiff = bytes(
    order, n16(42), n32(8),
    n16(1), n16(0x0112), n16(3), n32(1), n16(orientation), [0, 0],
    n32(0),
  );
  return bytes([0xff, 0xe1], be16(2 + 6 + tiff.length), 'Exif\0\0', tiff);
}

function jpeg(
  width: number,
  height: number,
  { orientation, order = 'II', progressive = false, padding = 0 }: {
    orientation?: number;
    order?: 'II' | 'MM';
    progressive?: boolean;
    /** Bytes of other metadata ahead of the frame, as a camera writes. */
    padding?: number;
  } = {},
): Uint8Array {
  const app0 = bytes([0xff, 0xe0], be16(16), 'JFIF\0', [1, 1, 0], be16(72), be16(72), [0, 0]);
  const extra: Uint8Array[] = [];
  for (let left = padding; left > 0; left -= 60000) {
    const size = Math.min(60000, left);
    extra.push(bytes([0xff, 0xe2], be16(size + 2), noise(size)));
  }
  const sof = bytes(
    [0xff, progressive ? 0xc2 : 0xc0], be16(17), [8], be16(height), be16(width),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );
  return bytes(
    [0xff, 0xd8], app0,
    orientation ? exif(orientation, order) : [],
    ...extra, sof,
    [0xff, 0xda], be16(12), [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0], noise(200),
    [0xff, 0xd9],
  );
}

// --- the size of a picture -----------------------------------------------------

describe('reading a photo’s size from its header', () => {
  it('JPEG: portrait, landscape and square, baseline or progressive', () => {
    assert.deepEqual(imageSize(jpeg(3024, 4032), 'image/jpeg'), { width: 3024, height: 4032 });
    assert.deepEqual(imageSize(jpeg(4032, 3024), 'image/jpeg'), { width: 4032, height: 3024 });
    assert.deepEqual(imageSize(jpeg(2048, 2048, { progressive: true }), 'image/jpeg'), { width: 2048, height: 2048 });
  });

  it('JPEG: a phone’s “turn me a quarter” is applied, in either byte order', () => {
    // Stored as landscape pixels, shown as portrait.
    for (const orientation of [5, 6, 7, 8]) {
      assert.deepEqual(imageSize(jpeg(4032, 3024, { orientation }), 'image/jpeg'), { width: 3024, height: 4032 });
    }
    assert.deepEqual(imageSize(jpeg(4032, 3024, { orientation: 6, order: 'MM' }), 'image/jpeg'), { width: 3024, height: 4032 });
    // Upside down or mirrored keeps its shape.
    for (const orientation of [1, 2, 3, 4]) {
      assert.deepEqual(imageSize(jpeg(4032, 3024, { orientation }), 'image/jpeg'), { width: 4032, height: 3024 });
    }
  });

  it('JPEG: found behind a lot of camera metadata', () => {
    assert.deepEqual(imageSize(jpeg(8064, 6048, { orientation: 6, padding: 300_000 }), 'image/jpeg'), { width: 6048, height: 8064 });
  });

  it('PNG, GIF, and all three kinds of WebP', () => {
    assert.deepEqual(imageSize(png(1170, 2532), 'image/png'), { width: 1170, height: 2532 });
    assert.deepEqual(imageSize(gif(480, 270), 'image/gif'), { width: 480, height: 270 });
    assert.deepEqual(imageSize(webp('VP8 ', 1600, 900), 'image/webp'), { width: 1600, height: 900 });
    assert.deepEqual(imageSize(webp('VP8L', 1000, 1000), 'image/webp'), { width: 1000, height: 1000 });
    assert.deepEqual(imageSize(webp('VP8X', 16320, 12240), 'image/webp'), { width: 16320, height: 12240 });
  });

  it('a file it cannot read gives no size rather than a wrong one', () => {
    assert.equal(imageSize(bytes([0xff, 0xd8, 0xff, 0xd9], noise(20)), 'image/jpeg'), null);
    assert.equal(imageSize(jpeg(4032, 3024).slice(0, 24), 'image/jpeg'), null);
    assert.equal(imageSize(png(0, 10), 'image/png'), null);
    assert.equal(imageSize(bytes('RIFF', le32(30), 'WEBP', 'ABCD', noise(30)), 'image/webp'), null);
    assert.equal(imageSize(noise(100), 'image/png'), null);
  });
});

// --- uploading one ---------------------------------------------------------------

async function send(file: Uint8Array, name: string, declared: string) {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(file)], name, { type: declared }));
  const response = await upload(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function stored(url: unknown): Uint8Array {
  const name = String(url).replace('/api/media/', '');
  return new Uint8Array(readFileSync(path.join(dataDir, 'uploads', name)));
}

describe('the upload route keeps the photo exactly as it was', () => {
  const cases: [string, Uint8Array, string, string, number, number][] = [
    ['a portrait JPEG', jpeg(3024, 4032), 'portrait.jpg', '.jpg', 3024, 4032],
    ['a landscape PNG', png(1920, 1080), 'landscape.png', '.png', 1920, 1080],
    ['a square WebP', webp('VP8 ', 1080, 1080), 'square.webp', '.webp', 1080, 1080],
    ['a GIF', gif(480, 270), 'loop.gif', '.gif', 480, 270],
  ];

  for (const [label, file, name, extension, width, height] of cases) {
    it(`${label}: the same bytes, the same format, its own size`, async () => {
      const { status, body } = await send(file, name, 'application/octet-stream');
      assert.equal(status, 200);
      assert.equal(body.kind, 'image');
      assert.ok(String(body.url).endsWith(extension), `stored as ${extension}, not converted`);
      assert.deepEqual(stored(body.url), file, 'byte for byte what was sent');
      assert.deepEqual([body.width, body.height], [width, height]);
    });
  }

  it('a photo the camera stored sideways: the bytes are left alone, the size is the upright one', async () => {
    const file = jpeg(4032, 3024, { orientation: 6, padding: 120_000 });
    const { body } = await send(file, 'IMG_0001.JPG', 'image/jpeg');
    assert.deepEqual(stored(body.url), file, 'not rotated, re-encoded or stripped of its EXIF');
    assert.deepEqual([body.width, body.height], [3024, 4032]);
  });

  it('a PNG declared as JPEG is still stored as the PNG it is', async () => {
    const file = png(800, 600);
    const { body } = await send(file, 'wrong.jpg', 'image/jpeg');
    assert.ok(String(body.url).endsWith('.png'));
    assert.deepEqual(stored(body.url), file);
  });
});

describe('the direct-to-storage route keeps it exactly as it was too', () => {
  it('the uploaded object is moved, never rewritten, and its size reported', async () => {
    for (const [file, width, height] of [
      [jpeg(4032, 3024, { orientation: 6 }), 3024, 4032],
      [png(1170, 2532), 1170, 2532],
      [webp('VP8X', 2000, 1000), 2000, 1000],
    ] as const) {
      const pending = `pending/${uploader.id}/${crypto.randomUUID()}`;
      bucket.set(pending, file);
      const response = await commit(
        new Request('http://localhost/api/upload/commit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: pending }),
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.equal(moved.at(-1), pending);
      assert.deepEqual(bucket.get(pending.replace('pending/', 'media/')), file, 'the same bytes');
      assert.deepEqual([body.kind, body.width, body.height], ['image', width, height]);
    }
  });
});

describe('a post keeps the photo’s size', () => {
  it('including the very large ones a modern phone takes', () => {
    const [item] = sanitiseMedia([{ url: '/api/media/a.jpg', width: 12240, height: 16320 }]);
    assert.deepEqual([item.kind, item.width, item.height], ['image', 12240, 16320]);
  });

  it('a post from before sizes were recorded still works, with no size', () => {
    const [item] = sanitiseMedia([{ url: '/api/media/old.jpg' }]);
    assert.deepEqual(item, { kind: 'image', url: '/api/media/old.jpg' });
  });
});
