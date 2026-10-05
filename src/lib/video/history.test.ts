import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  emptyHistory,
  record,
  redo,
  undo,
} from './history';

/** A stand-in for the project: one number is enough to tell the states apart. */
type Project = { trim: number };

describe('a fresh history', () => {
  it('has nothing to undo or redo', () => {
    const history = emptyHistory<Project>();
    assert.equal(canUndo(history), false);
    assert.equal(canRedo(history), false);
    assert.equal(undo(history, { trim: 1 }), null);
    assert.equal(redo(history, { trim: 1 }), null);
  });
});

describe('stepping back and forward', () => {
  it('restores what the project was before the change', () => {
    const history = record(emptyHistory<Project>(), { trim: 0 }, 'trim:a', 0);
    const stepped = undo(history, { trim: 5 });
    assert.deepEqual(stepped?.state, { trim: 0 });
  });

  it('and redo puts the change back', () => {
    const history = record(emptyHistory<Project>(), { trim: 0 }, 'trim:a', 0);
    const back = undo(history, { trim: 5 })!;
    const forward = redo(back.history, back.state)!;
    assert.deepEqual(forward.state, { trim: 5 });
  });

  it('walks back through several changes in order', () => {
    let history = emptyHistory<Project>();
    history = record(history, { trim: 0 }, 'trim:a', 0);
    history = record(history, { trim: 1 }, 'volume:a', 2000);
    history = record(history, { trim: 2 }, 'trim:b', 4000);

    const first = undo(history, { trim: 3 })!;
    assert.deepEqual(first.state, { trim: 2 });
    const second = undo(first.history, first.state)!;
    assert.deepEqual(second.state, { trim: 1 });
    const third = undo(second.history, second.state)!;
    assert.deepEqual(third.state, { trim: 0 });
    assert.equal(canUndo(third.history), false);
  });

  it('a new change drops whatever had been undone', () => {
    const history = record(emptyHistory<Project>(), { trim: 0 }, 'trim:a', 0);
    const back = undo(history, { trim: 5 })!;
    assert.equal(canRedo(back.history), true);
    const changed = record(back.history, back.state, 'volume:a', 9000);
    assert.equal(canRedo(changed), false);
  });
});

describe('one drag is one undo', () => {
  /** The reason this module exists: a trim drag fires on every pointermove. */
  it('collapses a run of the same change into a single entry', () => {
    let history = emptyHistory<Project>();
    let at = 0;
    for (let step = 0; step < 40; step += 1) {
      history = record(history, { trim: step }, 'trim:a', at);
      at += 16;
    }
    assert.equal(history.past.length, 1, `${history.past.length} entries`);
    // And the one entry is where the drag STARTED, not where it was halfway.
    assert.deepEqual(history.past[0].state, { trim: 0 });
  });

  it('so undoing a drag returns to before it began', () => {
    let history = emptyHistory<Project>();
    for (let step = 0; step < 10; step += 1) {
      history = record(history, { trim: step }, 'trim:a', step * 16);
    }
    assert.deepEqual(undo(history, { trim: 10 })?.state, { trim: 0 });
  });

  it('but two different clips are two entries', () => {
    let history = emptyHistory<Project>();
    history = record(history, { trim: 0 }, 'trim:a', 0);
    history = record(history, { trim: 1 }, 'trim:b', 10);
    assert.equal(history.past.length, 2);
  });

  it('and the same clip again after a pause is a second entry', () => {
    let history = emptyHistory<Project>();
    history = record(history, { trim: 0 }, 'trim:a', 0);
    history = record(history, { trim: 1 }, 'trim:a', COALESCE_MS + 1);
    assert.equal(history.past.length, 2);
  });

  it('a different kind of change on the same clip is its own entry', () => {
    let history = emptyHistory<Project>();
    history = record(history, { trim: 0 }, 'trim:a', 0);
    history = record(history, { trim: 1 }, 'volume:a', 10);
    assert.equal(history.past.length, 2);
  });
});

describe('the stack does not grow without bound', () => {
  it('forgets the oldest once it is full', () => {
    let history = emptyHistory<Project>();
    for (let step = 0; step < HISTORY_LIMIT + 20; step += 1) {
      history = record(history, { trim: step }, `trim:${step}`, step * 10_000);
    }
    assert.equal(history.past.length, HISTORY_LIMIT);
    // The oldest ones went, the newest stayed.
    assert.deepEqual(history.past[history.past.length - 1].state, {
      trim: HISTORY_LIMIT + 19,
    });
  });
});

describe('what it stores', () => {
  it('keeps the states it was handed, not copies that drift', () => {
    const before: Project = { trim: 3 };
    const history = record(emptyHistory<Project>(), before, 'trim:a', 0);
    assert.equal(history.past[0].state, before);
  });

  it('never loses a state to coalescing that a later undo needs', () => {
    // A drag, then a pause, then another drag: undoing twice walks back through
    // both, not past them.
    let history = emptyHistory<Project>();
    history = record(history, { trim: 0 }, 'trim:a', 0);
    history = record(history, { trim: 1 }, 'trim:a', 100);
    history = record(history, { trim: 2 }, 'trim:a', 5000);
    history = record(history, { trim: 3 }, 'trim:a', 5100);
    assert.equal(history.past.length, 2);
    const first = undo(history, { trim: 4 })!;
    assert.deepEqual(first.state, { trim: 2 });
    assert.deepEqual(undo(first.history, first.state)?.state, { trim: 0 });
  });
});
