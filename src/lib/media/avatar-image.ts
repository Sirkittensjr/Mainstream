/**
 * Shrinking a profile picture in the browser, before it is ever sent.
 *
 * Signup is the one place on FayTarra where a file travels as part of a Server
 * Action rather than going straight to storage, and it has to be: there is no
 * account yet, so there is no session to authorise an upload with, and an
 * upload endpoint that needs no account is free storage for anyone with a
 * script. Next.js caps a Server Action body at 1MB, and a photo off any phone
 * made in the last decade is several times that — which is how a perfectly
 * ordinary signup ended up as `Body exceeded 1 MB limit`.
 *
 * The fix is not a bigger limit. An avatar is drawn at 16 to 80 pixels across;
 * shipping 4MB of camera sensor to render it is waste whatever the ceiling is.
 * So the picture is decoded, cropped square, scaled to something an avatar can
 * actually use and re-encoded here, and what the form carries is a file of a
 * couple of hundred kilobytes at most.
 *
 * It re-encodes rather than passing the original through even when the
 * original is already small, which has a second benefit: an iPhone HEIC comes
 * out the far side as JPEG or WEBP, formats the server can identify.
 */

/** What the stored avatar is scaled to. Twice the largest place it is drawn. */
export const AVATAR_PX = 512;

/**
 * The most a prepared avatar may weigh.
 *
 * Comfortably inside the 1MB Server Action body so the rest of the form — and
 * the multipart framing around it — can never push a valid signup over.
 */
export const AVATAR_BUDGET_BYTES = 256 * 1024;

/** Encoder passes, best first. Every browser we support can write one of these. */
const FORMATS = ['image/webp', 'image/jpeg'] as const;
const QUALITIES = [0.82, 0.7, 0.6, 0.45] as const;

const EXTENSION: Record<string, string> = {
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
};

export class AvatarError extends Error {}

/** Decode a picked file, whatever the browser is willing to read it with. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Safari has refused some files here that <img> then reads happily.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new AvatarError('That file is not an image we can read.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const widthOf = (source: ImageBitmap | HTMLImageElement) =>
  'naturalWidth' in source ? source.naturalWidth : source.width;
const heightOf = (source: ImageBitmap | HTMLImageElement) =>
  'naturalHeight' in source ? source.naturalHeight : source.height;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Crop to a centred square and scale to `size`, on a white backing.
 *
 * The backing matters for the JPEG pass: a transparent PNG logo drawn onto an
 * empty canvas and written as JPEG comes out with a black surround, which in a
 * round avatar looks like a bug rather than a picture.
 */
function square(source: ImageBitmap | HTMLImageElement, size: number): HTMLCanvasElement {
  const width = widthOf(source);
  const height = heightOf(source);
  const side = Math.min(width, height);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) throw new AvatarError('This browser could not prepare that picture.');
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, size, size);
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source as CanvasImageSource,
    (width - side) / 2,
    (height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  return canvas;
}

/**
 * Turn a picked file into an avatar small enough to submit.
 *
 * Throws {@link AvatarError} when the file cannot be read or the browser has
 * no canvas encoder. Callers treat that as "sign up without the picture",
 * never as a reason to fail the signup.
 */
export async function prepareAvatar(file: File): Promise<File> {
  const source = await decode(file);
  if (widthOf(source) === 0 || heightOf(source) === 0) {
    throw new AvatarError('That file is not an image we can read.');
  }

  try {
    // Two sizes, so a photograph busy enough to resist the quality ladder
    // still lands inside the budget rather than being dropped.
    for (const size of [AVATAR_PX, AVATAR_PX / 2]) {
      const canvas = square(source, size);
      for (const type of FORMATS) {
        for (const quality of QUALITIES) {
          const blob = await toBlob(canvas, type, quality);
          // A browser that cannot write this format hands back a PNG instead
          // of honouring the request, so the result's own type is what counts.
          if (!blob || blob.type !== type) break;
          if (blob.size <= AVATAR_BUDGET_BYTES) {
            return new File([blob], `avatar${EXTENSION[type]}`, { type });
          }
        }
      }
    }
  } finally {
    if ('close' in source) source.close();
  }

  throw new AvatarError('That picture could not be shrunk down. Try a different one.');
}
