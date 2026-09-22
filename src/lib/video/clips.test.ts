import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FULL_FRAME,
  type Clip,
  canAdd,
  clipDuration,
  displaySize,
  isOverLength,
  moveClip,
  needsRender,
  normaliseClip,
  outputSize,
  remainingSeconds,
  totalDuration,
  updateClip,
} from './clips';
import { MAX_CLIPS, MAX_VIDEO_SECONDS } from './limits';

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: over.id ?? 'a',
  src: 'blob:x',
  label: 'clip',
  sourceDuration: 30,
  sourceWidth: 1920,
  sourceHeight: 1080,
  trimStart: 0,
  trimEnd: 30,
  crop: FULL_FRAME,
  rotation: 0,
  volume: 1,
  ...over,
});

describe('clip lengths', () => {
  it('measures a trimmed clip by what is left, not what was filmed', () => {
    assert.equal(clipDuration(clip({ trimStart: 4, trimEnd: 19 })), 15);
  });

  it('adds the clips up', () => {
    const clips = [clip({ id: 'a', trimEnd: 20 }), clip({ id: 'b', trimEnd: 25 })];
    assert.equal(totalDuration(clips), 45);
    assert.equal(remainingSeconds(clips), MAX_VIDEO_SECONDS - 45);
  });
});

describe('the three-minute rule', () => {
  it('lets a clip in while there is room', () => {
    assert.deepEqual(canAdd([clip({ trimEnd: 60 })], 60), { ok: true });
  });

  it('refuses a clip that would push the video over, and says how much room is left', () => {
    const result = canAdd([clip({ trimEnd: 170 })], 30);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : '', /10\.0s of room is left/);
  });

  it('tells somebody who is already full to make room, not to trim the new clip', () => {
    const result = canAdd([clip({ trimEnd: MAX_VIDEO_SECONDS })], 5);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : '', /Trim or remove a clip/);
  });

  it('accepts a clip that lands exactly on the limit', () => {
    assert.deepEqual(canAdd([clip({ trimEnd: 120 })], 60), { ok: true });
    assert.equal(isOverLength([clip({ trimEnd: 120 }), clip({ id: 'b', trimEnd: 60 })]), false);
  });

  it('caps the number of clips', () => {
    const many = Array.from({ length: MAX_CLIPS }, (_, i) => clip({ id: `c${i}`, trimEnd: 1 }));
    assert.equal(canAdd(many, 1).ok, false);
  });
});

describe('reordering', () => {
  const clips = [clip({ id: 'a' }), clip({ id: 'b' }), clip({ id: 'c' })];

  it('moves a clip later', () => {
    assert.deepEqual(moveClip(clips, 0, 2).map((c) => c.id), ['b', 'c', 'a']);
  });

  it('moves a clip earlier', () => {
    assert.deepEqual(moveClip(clips, 2, 0).map((c) => c.id), ['c', 'a', 'b']);
  });

  it('stays put at the ends rather than falling off them', () => {
    assert.deepEqual(moveClip(clips, 0, -1).map((c) => c.id), ['a', 'b', 'c']);
    assert.deepEqual(moveClip(clips, 2, 9).map((c) => c.id), ['a', 'b', 'c']);
  });
});

describe('normalising an edit', () => {
  it('keeps a trim inside the clip', () => {
    const edited = normaliseClip(clip({ trimStart: -5, trimEnd: 999 }));
    assert.equal(edited.trimStart, 0);
    assert.equal(edited.trimEnd, 30);
  });

  it('refuses to let a trim collapse to nothing', () => {
    const edited = normaliseClip(clip({ trimStart: 10, trimEnd: 10 }));
    assert.ok(clipDuration(edited) > 0.05, `got ${clipDuration(edited)}`);
  });

  it('keeps a crop rectangle inside the frame', () => {
    const edited = normaliseClip(clip({ crop: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 } }));
    assert.ok(edited.crop.x + edited.crop.width <= 1.0001);
    assert.ok(edited.crop.y + edited.crop.height <= 1.0001);
  });

  it('keeps volume between silent and as-recorded', () => {
    assert.equal(normaliseClip(clip({ volume: 4 })).volume, 1);
    assert.equal(normaliseClip(clip({ volume: -2 })).volume, 0);
  });

  it('edits only the clip it was asked to', () => {
    const clips = [clip({ id: 'a' }), clip({ id: 'b' })];
    const edited = updateClip(clips, 'b', { rotation: 90 });
    assert.equal(edited[0].rotation, 0);
    assert.equal(edited[1].rotation, 90);
  });
});

describe('the shape of the finished video', () => {
  it('keeps a landscape clip landscape', () => {
    assert.deepEqual(outputSize([clip()]), { width: 1080, height: 608 });
  });

  it('keeps a phone clip tall', () => {
    assert.deepEqual(outputSize([clip({ sourceWidth: 1080, sourceHeight: 1920 })]), {
      width: 608,
      height: 1080,
    });
  });

  it('keeps a square clip square', () => {
    assert.deepEqual(outputSize([clip({ sourceWidth: 1440, sourceHeight: 1440 })]), {
      width: 1080,
      height: 1080,
    });
  });

  it('turns the frame with the clip', () => {
    assert.deepEqual(displaySize(clip({ rotation: 90 })), { width: 1080, height: 1920 });
  });

  it('takes the crop into account', () => {
    assert.deepEqual(displaySize(clip({ crop: { x: 0, y: 0, width: 0.5, height: 1 } })), {
      width: 960,
      height: 1080,
    });
  });

  it('does not upscale a small clip', () => {
    assert.deepEqual(outputSize([clip({ sourceWidth: 640, sourceHeight: 480 })]), {
      width: 640,
      height: 480,
    });
  });
});

describe('deciding whether to re-encode', () => {
  const file = { name: 'a.mp4' } as File;

  it('posts one untouched clip as the file it already is', () => {
    assert.equal(needsRender([clip({ file })]), false);
  });

  it('re-encodes once there is more than one clip', () => {
    assert.equal(needsRender([clip({ id: 'a', file }), clip({ id: 'b', file })]), true);
  });

  for (const [what, patch] of [
    ['a trim', { trimEnd: 12 }],
    ['a rotation', { rotation: 90 as const }],
    ['a crop', { crop: { x: 0.1, y: 0, width: 0.8, height: 1 } }],
    ['a volume change', { volume: 0.3 }],
  ] as const) {
    it(`re-encodes after ${what}`, () => {
      assert.equal(needsRender([clip({ file, ...patch })]), true);
    });
  }

  it('re-encodes a recording, which has no file to post as-is', () => {
    assert.equal(needsRender([clip()]), true);
  });
});
