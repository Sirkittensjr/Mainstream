/**
 * Which images the optimiser should be asked to touch.
 *
 * Next refuses SVG by default, and it is right to: an SVG is a document that
 * can carry script, and serving one from our own origin through the optimiser
 * would hand it our cookies. Turning that protection off to make a placeholder
 * load is a bad trade — a vector is already tiny and resizing it gains
 * nothing, so it is served as it is.
 *
 * Uploads cannot be SVG in the first place (see file-type.ts, which decides
 * from the bytes), so this only ever applies to FayTarra's own generated
 * cover art.
 */
export function isVectorImage(url: string): boolean {
  const path = url.split('?')[0].toLowerCase();
  return path.endsWith('.svg') || path.startsWith('/api/cover/');
}

/**
 * Every quality the optimiser may be asked for.
 *
 * next.config.mjs allows exactly these in `images.qualities`, and Next answers
 * a request for any other with 400 `"q" parameter (quality) of N is not
 * allowed` — the picture never loads, nothing is logged on the server, and the
 * page looks as if the image were simply missing. That is how every profile's
 * background photo went blank: ProfileBackdrop asked for 70 after the list
 * became 75 and 90. Use one of these rather than a number; image.test.ts
 * checks this list against next.config.mjs and every `quality` in the app.
 */
export const IMAGE_QUALITY = {
  /** Next's own default: every picture without a reason to differ. */
  standard: 75,
  /** Post photos in a list: their resized copy is the photo most people see. */
  photo: 90,
} as const;
