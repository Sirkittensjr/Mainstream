import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TextOverlay } from '@/lib/types';
import { MAX_TEXT_SCALE, MIN_TEXT_SCALE } from '@/lib/types';
import {
  EDGE,
  MIN_TEXT_SECONDS,
  TEXT_BASE,
  clampOverlay,
  clampScale,
  fitCenter,
  newOverlay,
  pinch,
  placeOverlay,
  resizeFromHandle,
  scaleOf,
  seekToShow,
  showingAt,
  spotOf,
  textSize,
  trimOverlay,
  windowOf,
} from './overlays';

const line = (over: Partial<TextOverlay> = {}): TextOverlay => ({
  text: 'hello',
  x: 0.5,
  y: 0.5,
  size: 'l',
  tone: 'light',
  ...over,
});

describe('a new line of text', () => {
  it('starts in the middle of the frame', () => {
    const made = newOverlay();
    assert.equal(made.x, 0.5);
    assert.equal(made.y, 0.5);
  });

  it('and shows for the whole video until it is timed', () => {
    assert.deepEqual(windowOf(newOverlay(), 10), { from: 0, to: 10 });
    assert.equal(showingAt(newOverlay(), 0, 10), true);
    assert.equal(showingAt(newOverlay(), 9.9, 10), true);
  });
});

describe('dragging a line around the frame', () => {
  it('puts it exactly where it was dropped', () => {
    const moved = clampOverlay(line(), 0.25, 0.75);
    assert.deepEqual({ x: moved.x, y: moved.y }, { x: 0.25, y: 0.75 });
  });

  it('keeps it on screen rather than letting it be lost off an edge', () => {
    const off = clampOverlay(line(), -3, 9);
    assert.equal(off.x, EDGE);
    assert.equal(off.y, 1 - EDGE);
  });

  it('changes nothing else about it', () => {
    const moved = clampOverlay(line({ text: 'keep me', tone: 'fay', from: 1, to: 2 }), 0.3, 0.3);
    assert.equal(moved.text, 'keep me');
    assert.equal(moved.tone, 'fay');
    assert.deepEqual([moved.from, moved.to], [1, 2]);
  });

  it('survives a NaN from a pointer event rather than vanishing', () => {
    const moved = clampOverlay(line(), Number.NaN, 0.4);
    assert.equal(moved.x, 0.5);
  });
});

describe('a line made before free placement', () => {
  /** Posts in the wild carry `at` and no coordinates; they must not all pile up
   *  in the middle of the frame the first time somebody scrolls past them. */
  it('is drawn at the stop its author chose', () => {
    const legacy = { text: 'old', at: 'bottom', size: 'm', tone: 'light' } as TextOverlay;
    const spot = spotOf(legacy);
    assert.equal(spot.x, 0.5);
    assert.ok(spot.y > 0.7, `${spot.y}`);
    assert.ok(spotOf({ ...legacy, at: 'top' }).y < 0.3);
    assert.equal(spotOf({ ...legacy, at: 'middle' }).y, 0.5);
  });

  it('and coordinates win when it has both', () => {
    assert.equal(spotOf(line({ at: 'top', y: 0.9 })).y, 0.9);
  });

  it('falls back to the middle when it has neither', () => {
    const bare = { text: 'bare', size: 'm', tone: 'light' } as TextOverlay;
    assert.deepEqual(spotOf(bare), { x: 0.5, y: 0.5 });
  });
});

describe('when a line is on screen', () => {
  const timed = line({ from: 2, to: 5 });

  it('shows inside its window and nowhere else', () => {
    assert.equal(showingAt(timed, 1.9, 10), false);
    assert.equal(showingAt(timed, 2, 10), true);
    assert.equal(showingAt(timed, 3.5, 10), true);
    assert.equal(showingAt(timed, 5, 10), true);
    assert.equal(showingAt(timed, 5.2, 10), false);
  });

  /** A poster frame, or any surface with no playhead to ask. */
  it('shows everywhere when there is no playhead', () => {
    assert.equal(showingAt(timed, undefined, 10), true);
    assert.equal(showingAt(timed, Number.NaN, 10), true);
  });

  it('shows throughout when it was never timed', () => {
    for (const when of [0, 4, 9.99]) assert.equal(showingAt(line(), when, 10), true);
  });

  it('is clamped to the video it is on', () => {
    assert.deepEqual(windowOf(line({ from: -4, to: 99 }), 10), { from: 0, to: 10 });
  });

  it('treats a backwards window as the whole video rather than hiding forever', () => {
    assert.equal(showingAt(line({ from: 8, to: 2 }), 5, 10), true);
  });
});

describe('trimming when a line shows', () => {
  it('moves the start without touching the end', () => {
    const cut = trimOverlay(line({ from: 0, to: 8 }), 'from', 3, 10);
    assert.deepEqual([cut.from, cut.to], [3, 8]);
  });

  it('moves the end without touching the start', () => {
    const cut = trimOverlay(line({ from: 1, to: 8 }), 'to', 4, 10);
    assert.deepEqual([cut.from, cut.to], [1, 4]);
  });

  it('will not let one handle pass the other', () => {
    const squashed = trimOverlay(line({ from: 2, to: 5 }), 'from', 9, 10);
    assert.ok(squashed.from! <= 5 - MIN_TEXT_SECONDS + 1e-9, `${squashed.from}`);
    const other = trimOverlay(line({ from: 2, to: 5 }), 'to', 0, 10);
    assert.ok(other.to! >= 2 + MIN_TEXT_SECONDS - 1e-9, `${other.to}`);
  });

  it('stays inside the video', () => {
    assert.equal(trimOverlay(line({ from: 0, to: 4 }), 'to', 99, 10).to, 10);
    assert.equal(trimOverlay(line({ from: 2, to: 4 }), 'from', -5, 10).from, 0);
  });

  it('leaves the words and the look alone', () => {
    const cut = trimOverlay(line({ text: 'words', tone: 'fay' }), 'from', 2, 10);
    assert.equal(cut.text, 'words');
    assert.equal(cut.tone, 'fay');
  });
});

/* ------------------------------------------------- several lines at once */

describe('several lines on one video', () => {
  const total = 10;
  const project = [
    line({ text: 'one', from: 0, to: 3 }),
    line({ text: 'two', from: 2, to: 5 }),
    line({ text: 'three', from: 6, to: 9 }),
  ];
  const onScreen = (now: number) =>
    project.filter((entry) => showingAt(entry, now, total)).map((entry) => entry.text);

  it('each shows only in its own window', () => {
    assert.deepEqual(onScreen(1), ['one']);
    assert.deepEqual(onScreen(5.5), []);
    assert.deepEqual(onScreen(7), ['three']);
  });

  it('and two can be on screen together where their windows overlap', () => {
    assert.deepEqual(onScreen(2.5), ['one', 'two']);
  });

  it('trimming one leaves every other line exactly as it was', () => {
    const trimmed = project.map((entry, i) => (i === 1 ? trimOverlay(entry, 'to', 4, total) : entry));
    assert.deepEqual(trimmed[0], project[0]);
    assert.deepEqual(trimmed[2], project[2]);
    assert.deepEqual([trimmed[1].from, trimmed[1].to], [2, 4]);
  });

  it('timing is in seconds of the whole video, not of the clip it lands in', () => {
    // A line from 4s to 7s across a 3s clip and a 5s clip: one window, in
    // project time, straddling the join — not reset at the second clip.
    const across = line({ from: 4, to: 7 });
    assert.equal(showingAt(across, 3.5, 8), false);
    assert.equal(showingAt(across, 4.5, 8), true);
    assert.equal(showingAt(across, 6.9, 8), true);
  });
});

describe('picking a line brings it on screen', () => {
  it('moves the playhead to where it starts when it is not showing', () => {
    assert.equal(seekToShow(line({ from: 2, to: 4 }), 7.1, 10), 2);
  });

  it('leaves the playhead alone when it already is', () => {
    assert.equal(seekToShow(line({ from: 2, to: 4 }), 3, 10), null);
    assert.equal(seekToShow(line(), 9, 10), null);
  });
});

/* ------------------------------------------------------------------ size */

describe('how big a line is', () => {
  it('is relative to the frame, and the same as before on a phone-width frame', () => {
    // 5.64% and 3.85% of a 390px frame are the old 22px and 15px.
    assert.ok(Math.abs((TEXT_BASE.l.cqw / 100) * 390 - 22) < 0.1);
    assert.ok(Math.abs((TEXT_BASE.m.cqw / 100) * 390 - 15) < 0.1);
  });

  it('a line never pinched is its plain size', () => {
    assert.equal(scaleOf(line()), 1);
    assert.deepEqual(textSize(line({ size: 'l' })), TEXT_BASE.l);
  });

  it('a pinched line is that much bigger or smaller', () => {
    assert.deepEqual(textSize(line({ size: 'l', scale: 2 })), { cqw: 11.28, px: 44 });
    assert.equal(textSize(line({ size: 'm', scale: 0.5 })).px, 7.5);
  });

  it('is held between the smallest and largest sizes, whatever is stored', () => {
    assert.equal(clampScale(99), MAX_TEXT_SCALE);
    assert.equal(clampScale(0.01), MIN_TEXT_SCALE);
    assert.equal(clampScale(Number.NaN), 1);
    assert.equal(clampScale(-2), 1);
    assert.equal(scaleOf(line({ scale: 40 })), MAX_TEXT_SCALE);
  });
});

/* -------------------------------------------------------------- pinching */

describe('pinching a line', () => {
  const frame = { width: 200, height: 356 };
  const start = { x: 0.5, y: 0.5, scale: 1 };
  const centre = { x: 100, y: 178 };

  it('pinching outward makes it bigger', () => {
    const out = pinch(start, { x: 80, y: 178 }, { x: 120, y: 178 }, { x: 60, y: 178 }, { x: 140, y: 178 }, frame);
    assert.equal(out.scale, 2);
  });

  it('pinching inward makes it smaller', () => {
    const inward = pinch(start, { x: 60, y: 178 }, { x: 140, y: 178 }, { x: 80, y: 178 }, { x: 120, y: 178 }, frame);
    assert.equal(inward.scale, 0.5);
  });

  it('a pinch centred on the line keeps it exactly where it was', () => {
    const out = pinch(start, { x: 80, y: 178 }, { x: 120, y: 178 }, { x: 60, y: 178 }, { x: 140, y: 178 }, frame);
    assert.ok(Math.abs(out.x - 0.5) < 1e-9 && Math.abs(out.y - 0.5) < 1e-9, JSON.stringify(out));
    void centre;
  });

  it('stays anchored around the fingers: the point between them stays put', () => {
    // Fingers either side of a point 40px right of the line's centre.
    const a0 = { x: 130, y: 178 };
    const b0 = { x: 150, y: 178 };
    const out = pinch(start, a0, b0, { x: 120, y: 178 }, { x: 160, y: 178 }, frame);
    assert.equal(out.scale, 2);
    // The centre was 40px left of the anchor; doubled, it is 80px left of it.
    assert.ok(Math.abs(out.x * frame.width - (140 - 80)) < 1e-6, `${out.x * frame.width}`);
  });

  it('moving both fingers together carries the line along', () => {
    const out = pinch(start, { x: 80, y: 178 }, { x: 120, y: 178 }, { x: 80, y: 218 }, { x: 120, y: 218 }, frame);
    assert.equal(out.scale, 1);
    assert.ok(Math.abs(out.y * frame.height - 218) < 1e-6);
  });

  it('stops growing at the largest size instead of pushing the line away', () => {
    const big = pinch({ x: 0.5, y: 0.5, scale: MAX_TEXT_SCALE }, { x: 90, y: 178 }, { x: 110, y: 178 }, { x: 10, y: 178 }, { x: 190, y: 178 }, frame);
    assert.equal(big.scale, MAX_TEXT_SCALE);
    assert.ok(Math.abs(big.x - 0.5) < 1e-9);
  });

  it('two fingers landing on the same spot change nothing', () => {
    const same = pinch(start, { x: 100, y: 178 }, { x: 101, y: 178 }, { x: 10, y: 178 }, { x: 190, y: 178 }, frame);
    assert.equal(same.scale, 1);
  });
});

describe('the resize handle', () => {
  const frame = { width: 200, height: 356 };
  const start = { x: 0.5, y: 0.5, scale: 1 };

  it('dragged outward grows the line, inward shrinks it', () => {
    assert.equal(resizeFromHandle(start, { x: 130, y: 178 }, { x: 160, y: 178 }, frame), 2);
    assert.equal(resizeFromHandle(start, { x: 160, y: 178 }, { x: 130, y: 178 }, frame), 0.5);
  });

  it('within the size limits', () => {
    assert.equal(resizeFromHandle(start, { x: 110, y: 178 }, { x: 199, y: 178 }, frame), MAX_TEXT_SCALE);
  });
});

describe('keeping a resized line inside the frame', () => {
  it('a bigger line sits further from the edges', () => {
    assert.deepEqual(fitCenter(0.95, 0.5, 0.3, 0.05), { x: 0.7, y: 0.5 });
    assert.deepEqual(fitCenter(0.5, 0.02, 0.1, 0.2), { x: 0.5, y: 0.2 });
  });

  it('a small line keeps the usual margin', () => {
    assert.deepEqual(fitCenter(0.99, 0.01, 0.01, 0.01), { x: 1 - EDGE, y: EDGE });
  });

  it('a line wider than the frame is centred', () => {
    assert.equal(fitCenter(0.1, 0.5, 0.7, 0.05).x, 0.5);
  });

  it('survives nonsense', () => {
    assert.deepEqual(fitCenter(Number.NaN, 0.5, Number.NaN, 0.1), { x: 0.5, y: 0.5 });
  });
});

describe('a gesture applied to a line', () => {
  it('changes its place and size and nothing else', () => {
    const before = line({ text: 'keep', tone: 'fay', from: 1, to: 4 });
    const after = placeOverlay(before, { x: 0.3, y: 0.6, scale: 1.75 });
    assert.deepEqual(after, { ...before, x: 0.3, y: 0.6, scale: 1.75 });
  });

  it('a scale of 1 is stored as no scale at all', () => {
    assert.equal('scale' in placeOverlay(line({ scale: 2 }), { x: 0.5, y: 0.5, scale: 1 }), false);
  });
});
