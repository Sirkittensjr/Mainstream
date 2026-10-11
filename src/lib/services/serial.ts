import 'server-only';

/**
 * Runs work for the same key one at a time, within this server process.
 *
 * For the moderation limits: two reports sent at the same moment by one
 * account must not both see "four hidden so far" and both hide a fifth and
 * sixth post. The database guarantees what it can on its own — one report per
 * account per post, and every hide is a conditional update — and this closes
 * the gap a count-then-act check leaves inside one process. Across several
 * processes the services re-count after acting and undo anything over the
 * limit, so the limit holds either way; this just means that path is rare.
 */
const queues = new Map<string, Promise<unknown>>();

export async function serially<T>(key: string, work: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(work, work);
  // What the next caller waits on: this run, settled either way.
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  try {
    return await run;
  } finally {
    // Nothing else queued behind it: forget the key rather than grow forever.
    if (queues.get(key) === settled) queues.delete(key);
  }
}
