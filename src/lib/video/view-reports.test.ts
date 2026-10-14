/**
 * Getting a play to the server: at once, without counting it twice, and
 * without losing it to a dropped connection or a closed page.
 *
 * Runs the real delivery code against a stand-in `fetch` and `localStorage`,
 * with the clock under the test's control, so each network outcome — an
 * answer, a failure, several failures, the page closing — can be produced on
 * demand. What the server does with a report is covered by the service tests
 * and the SQL checks; this is the browser's half.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  QUEUE_KEY,
  QUEUE_TTL_MS,
  RETRY_DELAYS_MS,
  flushOwedViews,
  noteViews,
  reportView,
  resetViewReportsForTests,
  viewsShown,
  watchViews,
} from './view-reports';

const POST = '7c000000-0000-4000-8000-000000000001';

/** A Storage over a Map, which can be told to refuse every call. */
class MemoryStorage {
  data = new Map<string, string>();
  broken = false;
  getItem(key: string) {
    if (this.broken) throw new Error('SecurityError');
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.broken) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string) {
    if (this.broken) throw new Error('SecurityError');
    this.data.delete(key);
  }
}

type Outcome = { status: number; body?: unknown } | 'network';

/** A fetch that answers with the next outcome in line, and remembers every request. */
function server(outcomes: Outcome[]) {
  const sent: { url: string; key: string; keepalive: boolean | undefined }[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    sent.push({
      url,
      key: (JSON.parse(String(init.body)) as { sessionKey: string }).sessionKey,
      keepalive: init.keepalive,
    });
    const outcome = outcomes.shift() ?? 'network';
    if (outcome === 'network') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(outcome.body ?? {}), { status: outcome.status });
  });
  return sent;
}

/** Lets the promise chains of an answered request run. */
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

const owed = (storage: MemoryStorage) =>
  JSON.parse(storage.data.get(QUEUE_KEY) ?? '[]') as { p: string; k: string; t: number }[];

let storage: MemoryStorage;

beforeEach(() => {
  resetViewReportsForTests();
  storage = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  mock.method(console, 'warn', () => undefined);
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** Every number the eye shows for POST, starting with what it shows now. */
function eye(rendered: () => number) {
  const shown = [viewsShown(POST, rendered())];
  watchViews(POST, () => {
    const now = viewsShown(POST, rendered());
    if (now !== shown[shown.length - 1]) shown.push(now);
  });
  return shown;
}

describe('a play is reported at once, and the eye shows only what is stored', () => {
  it('sends at once and moves the eye to the stored total when it is answered', async () => {
    const sent = server([{ status: 200, body: { ok: true, count: 8, counted: true } }]);
    let told = 0;
    watchViews(POST, () => (told += 1));

    reportView(POST, 'session-aaaaaaaa');
    assert.equal(sent.length, 1, 'sent without waiting for anything');
    assert.equal(sent[0].url, `/api/v1/posts/${POST}/views`);
    assert.equal(sent[0].keepalive, true, 'finished even if the page goes away');
    assert.equal(viewsShown(POST, 7), 7, 'nothing is shown that the database has not stored');

    await settle();
    assert.equal(viewsShown(POST, 7), 8, "the server's number, with the play in it");
    assert.equal(told, 1, 'whoever shows it was told once');
    assert.deepEqual(owed(storage), [], 'answered: owed nothing');
  });

  // The live symptom: the eye went 0 → 1 the moment the video started, then
  // back to 0 when the server answered that it had not stored the play.
  it('never shows 0 → 1 → 0: a play the server did not store is never on the eye', async () => {
    server([{ status: 200, body: { ok: true, count: 0, counted: false, reason: 'unavailable' } }]);
    const shown = eye(() => 0);
    reportView(POST, 'session-unavail1');
    await settle();
    assert.deepEqual(shown, [0], 'the eye stayed at the stored 0 throughout');
  });

  it('goes 0 → 1 when the play is stored, and stays 1 through stale and fresh renders', async () => {
    server([{ status: 200, body: { ok: true, count: 1, counted: true } }]);
    let rendered = 0;
    const shown = eye(() => rendered);
    reportView(POST, 'session-stored01');
    assert.deepEqual(shown, [0], 'not before the server says it is stored');
    await settle();
    assert.deepEqual(shown, [0, 1]);

    // A background refresh or a remount hands back the page from before the
    // play; then a fresh one with the stored total.
    rendered = 0;
    assert.equal(viewsShown(POST, rendered), 1, 'a stale render does not pull it back to 0');
    noteViews(POST, rendered);
    assert.equal(viewsShown(POST, rendered), 1);
    rendered = 1;
    assert.equal(viewsShown(POST, rendered), 1);
    assert.deepEqual(shown, [0, 1], 'and nothing else was ever shown');
  });

  it('stays at the stored number when the play was not counted', async () => {
    server([{ status: 200, body: { ok: true, count: 7, counted: false, reason: 'too-fast' } }]);
    const shown = eye(() => 7);
    reportView(POST, 'session-bbbbbbbb');
    await settle();
    assert.deepEqual(shown, [7], 'the eye shows what is stored, and never more');
  });

  it('shows a newer total from elsewhere, and never a lower one', () => {
    noteViews(POST, 12);
    assert.equal(viewsShown(POST, 10), 12, 'newer than the page was rendered with');
    noteViews(POST, 11);
    assert.equal(viewsShown(POST, 10), 12, 'a stale answer does not pull it back');
    assert.equal(viewsShown(POST, 20), 20, 'a fresher render wins');
  });

  it('applies answers that arrive out of order without going down', async () => {
    let release: (() => void) | undefined;
    const answers = [
      // The first play's answer is held back until after the second's.
      () => new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ ok: true, count: 1, counted: true })));
      }),
      async () => new Response(JSON.stringify({ ok: true, count: 2, counted: true })),
    ];
    mock.method(globalThis, 'fetch', async () => answers.shift()!());
    const shown = eye(() => 0);
    reportView(POST, 'session-order001');
    reportView(POST, 'session-order002');
    await settle();
    release?.();
    await settle();
    assert.deepEqual(shown, [0, 2], 'the late answer for 1 did not pull 2 back down');
  });

  it('reports one playback session once, however many times it is handed in', async () => {
    const sent = server([{ status: 200, body: { ok: true, count: 1, counted: true } }]);
    reportView(POST, 'session-cccccccc');
    reportView(POST, 'session-cccccccc');
    reportView(POST, 'session-cccccccc');
    assert.equal(sent.length, 1);
    await settle();
    assert.equal(viewsShown(POST, 0), 1, 'and the eye went up once');
  });

  it('reports every new playback session: three plays, three reports', async () => {
    const sent = server([
      { status: 200, body: { ok: true, count: 1, counted: true } },
      { status: 200, body: { ok: true, count: 2, counted: true } },
      { status: 200, body: { ok: true, count: 3, counted: true } },
    ]);
    for (const key of ['session-1xxxxxxx', 'session-2xxxxxxx', 'session-3xxxxxxx']) reportView(POST, key);
    await settle();
    assert.equal(sent.length, 3);
    assert.equal(viewsShown(POST, 0), 3);
  });
});

describe('a report that does not get through', () => {
  it('is retried under the same key until it is answered', async () => {
    const sent = server(['network', { status: 503 }, { status: 200, body: { ok: true, count: 5, counted: true } }]);
    reportView(POST, 'session-dddddddd');
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(viewsShown(POST, 4), 4, 'not shown while it is not stored');

    mock.timers.tick(RETRY_DELAYS_MS[0]);
    await settle();
    assert.equal(sent.length, 2);
    mock.timers.tick(RETRY_DELAYS_MS[1]);
    await settle();
    assert.equal(sent.length, 3);
    assert.deepEqual(new Set(sent.map((each) => each.key)), new Set(['session-dddddddd']), 'the same key every time');
    assert.equal(viewsShown(POST, 4), 5);
    assert.deepEqual(owed(storage), []);
  });

  it('is kept when every retry fails, and sent again — same key — on the next page', async () => {
    const sent = server(['network', 'network', 'network', 'network']);
    reportView(POST, 'session-eeeeeeee');
    await settle();
    for (const delay of RETRY_DELAYS_MS) {
      mock.timers.tick(delay);
      await settle();
    }
    assert.equal(sent.length, 1 + RETRY_DELAYS_MS.length);
    assert.equal(viewsShown(POST, 4), 4, 'never shown: the eye says what is stored');
    assert.deepEqual(owed(storage).map((each) => each.k), ['session-eeeeeeee'], 'kept for later');

    // The next page, once the network is back.
    resetViewReportsForTests();
    const again = server([{ status: 200, body: { ok: true, count: 5, counted: true } }]);
    flushOwedViews();
    await settle();
    assert.deepEqual(again.map((each) => each.key), ['session-eeeeeeee']);
    assert.equal(viewsShown(POST, 4), 5);
    assert.deepEqual(owed(storage), []);
  });

  it('is sent again after the page closed before the answer, and the server counts it once', async () => {
    // The request was in flight when the page went; keepalive finished it, but
    // nobody was left to hear the answer. The next page sends it again — and
    // the server, which has the key, answers "already counted".
    storage.data.set(QUEUE_KEY, JSON.stringify([{ p: POST, k: 'session-ffffffff', t: Date.now() }]));
    const sent = server([{ status: 200, body: { ok: true, count: 9, counted: false, reason: 'duplicate-session' } }]);
    flushOwedViews();
    await settle();
    assert.deepEqual(sent.map((each) => each.key), ['session-ffffffff']);
    assert.equal(viewsShown(POST, 0), 9, 'no second view on the eye either');
    assert.deepEqual(owed(storage), []);
  });

  it('is not retried when the server says it is not a report at all', async () => {
    const sent = server([{ status: 400, body: { ok: false, error: 'session-key' } }]);
    reportView(POST, 'session-gggggggg');
    await settle();
    mock.timers.tick(60_000);
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(viewsShown(POST, 3), 3);
    assert.deepEqual(owed(storage), []);
  });

  it('is dropped once it is a day old', async () => {
    storage.data.set(
      QUEUE_KEY,
      JSON.stringify([
        { p: POST, k: 'session-old-hhhhh', t: Date.now() - QUEUE_TTL_MS - 1 },
        { p: POST, k: 'session-new-hhhhh', t: Date.now() - 1_000 },
      ]),
    );
    const sent = server([{ status: 200, body: { ok: true, count: 1, counted: true } }]);
    flushOwedViews();
    await settle();
    assert.deepEqual(sent.map((each) => each.key), ['session-new-hhhhh']);
  });

  it('still goes when the browser will not store anything', async () => {
    storage.broken = true;
    const sent = server([{ status: 200, body: { ok: true, count: 1, counted: true } }]);
    reportView(POST, 'session-iiiiiiii');
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(viewsShown(POST, 0), 1);
  });
});
