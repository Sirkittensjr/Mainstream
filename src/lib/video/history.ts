/**
 * Undo and redo for the editing project.
 *
 * The editor grew into something people make a sequence of decisions in —
 * trim this, mute that, drag a line of text, crop one clip — and the one thing
 * missing was a way back from any of them. This is that: a stack of snapshots
 * of the whole project, because the project is small (a handful of clips'
 * numbers and a few lines of text) and a per-field change log would be a lot of
 * machinery to undo a drag.
 *
 * WHAT IS SNAPSHOTTED is the edit, not the media: clip ids, trims, volumes,
 * crops and rotations, the text overlays, and whether the post is silent. Never
 * the recordings themselves — those are object URLs that outlive any of this,
 * and copying them would be copying a reference anyway.
 *
 * COALESCING IS THE WHOLE DIFFICULTY. Dragging a trim grip fires a change on
 * every pointermove, and an undo stack that recorded each one would need forty
 * taps to undo one drag. So changes carry a label — `trim:<clip id>`,
 * `volume:<clip id>`, `text` — and a change with the same label arriving within
 * `COALESCE_MS` of the last one replaces it rather than stacking on it. One
 * drag is one entry; a drag, then a different clip's drag, is two.
 */

export interface Snapshot<T> {
  /** What the project looked like. */
  state: T;
  /** What kind of change produced it, for coalescing. */
  label: string;
  /** When it was recorded, in milliseconds. */
  at: number;
}

export interface History<T> {
  past: Snapshot<T>[];
  future: Snapshot<T>[];
}

/** Changes of the same kind within this long are treated as one. */
export const COALESCE_MS = 500;

/** How far back it is possible to go. Beyond this the oldest is forgotten. */
export const HISTORY_LIMIT = 50;

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

/**
 * Records the state the project is LEAVING, before a change is applied.
 *
 * Past-only: `present` is whatever the editor is holding right now, so it is
 * not stored twice. Recording anything also drops the future — once a new
 * change is made, the things that were undone are no longer ahead of anybody.
 */
export function record<T>(
  history: History<T>,
  leaving: T,
  label: string,
  now = Date.now(),
): History<T> {
  const last = history.past[history.past.length - 1];
  // The same kind of change, still in progress: the entry already on the stack
  // is the state this drag STARTED from, and that is the one to keep.
  if (last && last.label === label && now - last.at <= COALESCE_MS) {
    return {
      past: [...history.past.slice(0, -1), { ...last, at: now }],
      future: [],
    };
  }
  const past = [...history.past, { state: leaving, label, at: now }];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: [],
  };
}

export const canUndo = <T>(history: History<T>): boolean => history.past.length > 0;
export const canRedo = <T>(history: History<T>): boolean => history.future.length > 0;

/**
 * One step back. Hands over the state to restore and the history to keep.
 *
 * `present` goes onto the future so redo has somewhere to come back from.
 * Returns null when there is nothing to undo, so a caller can leave the project
 * untouched rather than restoring an undefined.
 */
export function undo<T>(
  history: History<T>,
  present: T,
  now = Date.now(),
): { state: T; history: History<T> } | null {
  const last = history.past[history.past.length - 1];
  if (!last) return null;
  return {
    state: last.state,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, { state: present, label: last.label, at: now }],
    },
  };
}

/** One step forward again, undoing an undo. */
export function redo<T>(
  history: History<T>,
  present: T,
  now = Date.now(),
): { state: T; history: History<T> } | null {
  const next = history.future[history.future.length - 1];
  if (!next) return null;
  return {
    state: next.state,
    history: {
      past: [...history.past, { state: present, label: next.label, at: now }],
      future: history.future.slice(0, -1),
    },
  };
}
