import type { Clip } from './clips';

/**
 * Where a clip's picture sits inside the preview frame, so the preview shows
 * the crop and the quarter turn the render will apply.
 *
 * THE SAME ARITHMETIC AS `drawFrame` in render.ts, expressed as a box for a
 * `<video>` element instead of as a canvas draw. The render takes the crop
 * rectangle out of the source, turns it, and scales it with one number to
 * meet the output frame — `cover` fills it, `contain` fits inside it — centred.
 * Here the whole source is laid out at that same scale with the crop's centre
 * on the frame's centre, the frame clips everything outside it, and the turn
 * is a CSS rotation about that same centre. Same scale, same centre, same turn,
 * so the same pixels end up in the same place.
 *
 * Before this the preview was `object-cover` on the raw source, which is right
 * only for a clip with no crop and no turn: a clip cropped to 1:1 was previewed
 * full-frame and posted square, which is a preview of a different video.
 */
export interface Placement {
  /** The element's box, in px from the frame's top-left. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Degrees, clockwise, about `origin`. */
  rotate: number;
  /** The point it turns about, in px from the ELEMENT's top-left. */
  originX: number;
  originY: number;
}

export function placeInFrame(
  clip: Pick<Clip, 'crop' | 'rotation'>,
  /** The source's own pixel size — the element's `videoWidth`/`videoHeight`. */
  source: { width: number; height: number },
  frame: { width: number; height: number },
  fit: 'cover' | 'contain',
): Placement | null {
  if (!(frame.width > 0 && frame.height > 0 && source.width > 0 && source.height > 0)) return null;

  const cropWidth = Math.max(1, source.width * clip.crop.width);
  const cropHeight = Math.max(1, source.height * clip.crop.height);

  // After a quarter turn the box the crop has to meet is the frame on its side.
  const upright = clip.rotation % 180 === 0;
  const boxWidth = upright ? frame.width : frame.height;
  const boxHeight = upright ? frame.height : frame.width;

  const scale =
    fit === 'cover'
      ? Math.max(boxWidth / cropWidth, boxHeight / cropHeight)
      : Math.min(boxWidth / cropWidth, boxHeight / cropHeight);

  const width = source.width * scale;
  const height = source.height * scale;
  // The crop's centre, in the element's own px.
  const originX = (clip.crop.x + clip.crop.width / 2) * width;
  const originY = (clip.crop.y + clip.crop.height / 2) * height;

  return {
    left: frame.width / 2 - originX,
    top: frame.height / 2 - originY,
    width,
    height,
    rotate: clip.rotation,
    originX,
    originY,
  };
}
