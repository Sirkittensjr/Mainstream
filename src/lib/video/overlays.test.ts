import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TextOverlay } from '@/lib/types';
import {
  EDGE,
  MIN_TEXT_SECONDS,
  clampOverlay,
  newOverlay,
  showingAt,
  spotOf,
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
