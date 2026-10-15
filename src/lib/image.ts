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
