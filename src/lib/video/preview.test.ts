import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FULL_FRAME, type Crop, type Rotation } from './clips';
import { placeInFrame } from './preview';

/**
 * Where `drawFrame` (render.ts) puts one source pixel in the output frame,
 * re-derived from its own steps: translate to the centre, rotate, draw the crop
 * centred at one scale. The preview must put the same pixel in the same place.
 */
function rendered(
  point: { x: number; y: number },
  crop: Crop,
  rotation: Rotation,
  source: { width: number; height: number },
  frame: { width: number; height: number },
  fit: 'cover' | 'contain',
) {
  const cropWidth = source.width * crop.width;
  const cropHeight = source.height * crop.height;
  const upright = rotation % 180 === 0;
  const boxWidth = upright ? frame.width : frame.height;
  const boxHeight = upright ? frame.height : frame.width;
  const scale =
    fit === 'cover'
      ? Math.max(boxWidth / cropWidth, boxHeight / cropHeight)
      : Math.min(boxWidth / cropWidth, boxHeight / cropHeight);
  // Drawn centred on the origin, before the turn.
  const dx = (point.x - crop.x * source.width - cropWidth / 2) * scale;
  const dy = (point.y - crop.y * source.height - cropHeight / 2) * scale;
  const angle = (rotation * Math.PI) / 180;
  return {
    x: frame.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: frame.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

/** Where the preview element puts the same pixel, applying CSS's own rules. */
function previewed(
  point: { x: number; y: number },
  crop: Crop,
  rotation: Rotation,
  source: { width: number; height: number },
  frame: { width: number; height: number },
  fit: 'cover' | 'contain',
) {
  const place = placeInFrame({ crop, rotation }, source, frame, fit);
  assert.ok(place);
  const scale = place.width / source.width;
  // Untransformed position inside the element, relative to the turning point.
  const dx = point.x * scale - place.originX;
  const dy = point.y * scale - place.originY;
  const angle = (place.rotate * Math.PI) / 180;
  return {
    x: place.left + place.originX + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: place.top + place.originY + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

const PHONE_FRAME = { width: 196, height: 348.4 };
const LANDSCAPE = { width: 1920, height: 1080 };
const PORTRAIT = { width: 1080, height: 1920 };

describe('the preview puts every pixel where the render does', () => {
  const crops: [string, Crop][] = [
    ['the full frame', FULL_FRAME],
    ['a centred square', { x: 0.21875, y: 0, width: 0.5625, height: 1 }],
    ['an off-centre corner', { x: 0.1, y: 0.2, width: 0.4, height: 0.5 }],
  ];
  const points = [
    { x: 0, y: 0 },
    { x: 960, y: 540 },
    { x: 1500, y: 900 },
    { x: 300, y: 1000 },
  ];

  for (const [name, crop] of crops) {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      for (const fit of ['cover', 'contain'] as const) {
        for (const source of [LANDSCAPE, PORTRAIT]) {
          it(`${name}, turned ${rotation}°, ${fit}, ${source.width}x${source.height}`, () => {
            for (const point of points) {
              const a = rendered(point, crop, rotation, source, PHONE_FRAME, fit);
              const b = previewed(point, crop, rotation, source, PHONE_FRAME, fit);
              assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6,
                `(${point.x},${point.y}) rendered at ${a.x.toFixed(2)},${a.y.toFixed(2)}, previewed at ${b.x.toFixed(2)},${b.y.toFixed(2)}`);
            }
          });
        }
      }
    }
  }
});

describe('what that means for the common cases', () => {
  it('an untouched 9:16 recording exactly fills a 9:16 frame', () => {
    const place = placeInFrame({ crop: FULL_FRAME, rotation: 0 }, PORTRAIT, { width: 180, height: 320 }, 'cover');
    assert.deepEqual(place, { left: 0, top: 0, width: 180, height: 320, rotate: 0, originX: 90, originY: 160 });
  });

  it('an untouched landscape recording is centre-cropped, as object-cover would', () => {
    const place = placeInFrame({ crop: FULL_FRAME, rotation: 0 }, LANDSCAPE, { width: 180, height: 320 }, 'cover');
    assert.ok(place);
    assert.equal(place.height, 320);
    assert.ok(Math.abs(place.width - 568.89) < 0.01);
    assert.ok(Math.abs(place.left - (180 - place.width) / 2) < 1e-9, 'centred across');
  });

  it('a crop zooms in: the cropped part fills the frame, not the whole source', () => {
    const square = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const place = placeInFrame({ crop: square, rotation: 0 }, PORTRAIT, { width: 180, height: 320 }, 'cover');
    assert.ok(place);
    assert.ok(place.width > 180 * 1.9, `${place.width}px wide for a 180px frame`);
  });

  it('answers nothing rather than NaN before the frame or the source has a size', () => {
    assert.equal(placeInFrame({ crop: FULL_FRAME, rotation: 0 }, PORTRAIT, { width: 0, height: 0 }, 'cover'), null);
    assert.equal(placeInFrame({ crop: FULL_FRAME, rotation: 0 }, { width: 0, height: 0 }, PHONE_FRAME, 'cover'), null);
  });
});
