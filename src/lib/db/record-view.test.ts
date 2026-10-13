/**
 * Driver.recordView on Supabase: a counted view and its post's total move
 * together, or not at all.
 *
 * The failure this exists for, as it happened: the view row was stored, then
 * raising `posts.video_views` failed — a permission, a timeout, anything. The
 * player retried under the same playback-session key, the retry found the row,
 * was told "already counted", and that view was never added to the number on
 * the eye. Every later report from that playback session was a duplicate, so
 * nothing could ever repair it.
 *
 * These run the real driver against a small stand-in for the Supabase client
 * that keeps rows in memory, so each database outcome — the function there,
 * the function missing, the total refusing to move — can be produced on demand.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FUNCTION_RECHECK_MS, SupabaseDriver } from './supabase';
import type { VideoView } from '@/lib/types';

type Row = Record<string, unknown>;
type Answer = { data: unknown; error: { message: string; code?: string } | null };
type Rpc = (args: Row, tables: Map<string, Row[]>) => Answer;

/** Just enough of supabase-js for the driver's view path, over in-memory tables. */
function fakeClient(rpcs: Record<string, Rpc>) {
  const tables = new Map<string, Row[]>([
    ['posts', []],
    ['video_views', []],
  ]);
  const calls: string[] = [];

  function from(table: string) {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row = {};
    let shape: 'many' | 'single' | 'maybeSingle' = 'many';
    const filters: [string, unknown][] = [];
    const query = {
      select: () => query,
      insert: (row: Row) => ((op = 'insert'), (payload = row), query),
      update: (patch: Row) => ((op = 'update'), (payload = patch), query),
      delete: () => ((op = 'delete'), query),
      eq: (column: string, value: unknown) => (filters.push([column, value]), query),
      is: (column: string, value: unknown) => (filters.push([column, value]), query),
      single: () => ((shape = 'single'), query),
      maybeSingle: () => ((shape = 'maybeSingle'), query),
      then(resolve: (answer: Answer) => unknown, reject?: (error: unknown) => unknown) {
        try {
          return Promise.resolve(run()).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      },
    };
    const matches = (row: Row) => filters.every(([column, value]) => (row[column] ?? null) === value);
    const shaped = (rows: Row[]): unknown => (shape === 'many' ? rows : (rows[0] ?? null));
    function run(): Answer {
      calls.push(`${op} ${table}`);
      const rows = tables.get(table)!;
      if (op === 'insert') {
        if (table === 'video_views' && rows.some((row) => row.dedupe_key === payload.dedupe_key)) {
          return { data: null, error: { message: 'duplicate key value', code: '23505' } };
        }
        rows.push({ ...payload });
        return { data: shaped([{ ...payload }]), error: null };
      }
      if (op === 'update') {
        const hit = rows.filter(matches);
        for (const row of hit) Object.assign(row, payload);
        return { data: shaped(hit.map((row) => ({ id: row.id }))), error: null };
      }
      if (op === 'delete') {
        tables.set(table, rows.filter((row) => !matches(row)));
        return { data: null, error: null };
      }
      return { data: shaped(rows.filter(matches).map((row) => ({ ...row }))), error: null };
    }
    return query;
  }

  const client = {
    from,
    async rpc(name: string, args: Row): Promise<Answer> {
      calls.push(`rpc ${name}`);
      const handler = rpcs[name];
      if (!handler) {
        return { data: null, error: { message: `Could not find the function public.${name}`, code: 'PGRST202' } };
      }
      return handler(args, tables);
    },
  };
  return { client: client as unknown as SupabaseClient, tables, calls };
}

/** increment_counter as migration 0015 has it. */
const incrementCounter: Rpc = (args, tables) => {
  const post = tables.get('posts')!.find((row) => row.id === args.target_id);
  if (!post) return { data: null, error: null };
  post[String(args.target_column)] = Number(post[String(args.target_column)] ?? 0) + Number(args.amount);
  return { data: post[String(args.target_column)], error: null };
};

/** increment_counter on a database where the app's role may not call it. */
const incrementRefused: Rpc = () => ({
  data: null,
  error: { message: 'permission denied for function increment_counter', code: '42501' },
});

/** record_video_view as migration 0016 has it: one transaction. */
const recordVideoView: Rpc = (args, tables) => {
  const post = tables.get('posts')!.find((row) => row.id === args.target_post);
  if (!post) return { data: [{ counted: false, total: null }], error: null };
  const views = tables.get('video_views')!;
  if (views.some((row) => row.dedupe_key === args.view_key)) {
    return { data: [{ counted: false, total: post.video_views }], error: null };
  }
  views.push({ id: args.view_id, post_id: args.target_post, dedupe_key: args.view_key });
  post.video_views = Number(post.video_views) + 1;
  return { data: [{ counted: true, total: post.video_views }], error: null };
};

const POST = '7a990000-0000-4000-8000-000000000001';

function view(key: string): VideoView {
  return {
    id: crypto.randomUUID(),
    post_id: POST,
    viewer_id: null,
    identity: 'anon:browser-1',
    dedupe_key: `${POST}:anon:browser-1:${key}`,
    created_at: new Date().toISOString(),
  };
}

function setup(rpcs: Record<string, Rpc>, total = 0) {
  const fake = fakeClient(rpcs);
  fake.tables.get('posts')!.push({ id: POST, video_views: total });
  return { ...fake, driver: new SupabaseDriver(fake.client) };
}

const totalOf = (tables: Map<string, Row[]>) => tables.get('posts')![0].video_views;
const rowsOf = (tables: Map<string, Row[]>) => tables.get('video_views')!.length;

beforeEach(() => {
  mock.method(console, 'warn', () => undefined);
  mock.method(console, 'error', () => undefined);
});
afterEach(() => mock.restoreAll());

describe('with record_video_view (migration 0016)', () => {
  it('stores the view and its total in one call', async () => {
    const { driver, tables, calls } = setup({ record_video_view: recordVideoView }, 4);
    assert.deepEqual(await driver.recordView(view('session-one')), { counted: true, total: 5 });
    assert.deepEqual(calls, ['rpc record_video_view']);
    assert.equal(totalOf(tables), 5);
    assert.equal(rowsOf(tables), 1);
  });

  it('answers a second copy of the same report with the stored total, counting nothing', async () => {
    const { driver, tables } = setup({ record_video_view: recordVideoView }, 4);
    const report = view('session-one');
    await driver.recordView(report);
    assert.deepEqual(await driver.recordView({ ...report, id: crypto.randomUUID() }), {
      counted: false,
      total: 5,
    });
    assert.equal(totalOf(tables), 5);
  });

  it('says so when there is no such post', async () => {
    const { driver } = setup({ record_video_view: recordVideoView });
    const missing = { ...view('session-one'), post_id: '7a990000-0000-4000-8000-0000000000ff' };
    assert.deepEqual(await driver.recordView(missing), { counted: false, total: null });
  });

  it('throws a refusal rather than working around it, and has written nothing', async () => {
    const { driver, tables, calls } = setup({
      record_video_view: () => ({ data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } }),
    });
    await assert.rejects(driver.recordView(view('session-one')), /statement timeout/);
    assert.deepEqual(calls, ['rpc record_video_view'], 'no second, separate write');
    assert.equal(rowsOf(tables), 0);
  });
});

describe('without it, until 0016 is applied', () => {
  it('stores the row, then raises the total', async () => {
    const { driver, tables, calls } = setup({ increment_counter: incrementCounter }, 2);
    assert.deepEqual(await driver.recordView(view('session-one')), { counted: true, total: 3 });
    assert.deepEqual(calls, ['rpc record_video_view', 'insert video_views', 'rpc increment_counter']);
    assert.equal(rowsOf(tables), 1);
  });

  it('takes the row back out when the total cannot be raised, so the retry still counts', async () => {
    let refuse = true;
    const { driver, tables } = setup({
      increment_counter: (args, all) => (refuse ? incrementRefused(args, all) : incrementCounter(args, all)),
    });
    const report = view('session-one');

    await assert.rejects(driver.recordView(report), /permission denied/);
    assert.equal(rowsOf(tables), 0, 'no view row left behind to answer "already counted"');
    assert.equal(totalOf(tables), 0);

    // Whatever refused it is fixed; the player sends the same report again.
    refuse = false;
    assert.deepEqual(await driver.recordView({ ...report, id: crypto.randomUUID() }), {
      counted: true,
      total: 1,
    });
    assert.equal(rowsOf(tables), 1);
    assert.equal(totalOf(tables), 1, 'the view is in the total exactly once');
  });

  it('answers a duplicate with the stored total', async () => {
    const { driver, tables } = setup({ increment_counter: incrementCounter }, 7);
    const report = view('session-one');
    await driver.recordView(report);
    assert.deepEqual(await driver.recordView({ ...report, id: crypto.randomUUID() }), {
      counted: false,
      total: 8,
    });
    assert.equal(totalOf(tables), 8);
  });

  it('looks for the function again later instead of giving up on it for good', async () => {
    const rpcs: Record<string, Rpc> = { increment_counter: incrementCounter };
    const { driver, calls } = setup(rpcs);
    await driver.recordView(view('session-one'));
    await driver.recordView(view('session-two'));
    assert.equal(calls.filter((call) => call === 'rpc record_video_view').length, 1, 'asked once, then believed');

    // The migration is applied; a while later the same server notices.
    rpcs.record_video_view = recordVideoView;
    const later = Date.now() + FUNCTION_RECHECK_MS + 1;
    mock.method(Date, 'now', () => later);
    calls.length = 0;
    assert.deepEqual(await driver.recordView(view('session-three')), { counted: true, total: 3 });
    assert.deepEqual(calls, ['rpc record_video_view']);
  });
});
