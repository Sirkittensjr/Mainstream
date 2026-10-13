import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isMissingRelation, throwQueryError } from './errors';
import type { CounterColumn, Driver, QueryOptions, Row, TableName } from './types';

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'faytarra-media';

/** Supabase's own per-response cap. Paging in this size means one round trip per 1000 rows. */
const PAGE_SIZE = 1000;

/**
 * A ceiling on any single full-table read, so one runaway query cannot pull the
 * whole database into a serverless function's memory. Hitting it is a signal
 * that the aggregate it feeds needs to move into SQL.
 */
const HARD_CAP = 50_000;

/** The URL, under either name. See src/lib/supabase/config.ts for why both. */
function url(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
}

export function supabaseConfigured(): boolean {
  return Boolean(url() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * The subset of a PostgREST filter builder this driver needs, so the
 * translation below can be tested without a database or a network.
 */
export interface Filterable {
  eq(column: string, value: never): Filterable;
  is(column: string, value: null): Filterable;
  in(column: string, values: never[]): Filterable;
  like(column: string, pattern: string): Filterable;
}

/**
 * A LIKE pattern matching text that starts with `prefix`, and nothing else.
 *
 * `%` and `_` are LIKE's wildcards and `\` its escape, and all three can be in
 * what somebody typed — `_` is in hashtags — so each is escaped rather than left
 * to widen the match.
 */
export function prefixPattern(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Applies a query's `where` and `in` clauses to a PostgREST builder.
 *
 * One detail here is not obvious and took the signed-in site down once.
 * PostgREST filters are literals in a URL, so `.eq(column, null)` serialises
 * to `column=eq.null` and asks Postgres to cast the STRING "null" to that
 * column's type. Against a timestamp that is
 * `invalid input syntax for type timestamp with time zone: "null"` — a 400,
 * and therefore a thrown error on every page that runs the query. NULL is
 * matched with `is`.
 *
 * The local driver has always compared with `=== null`, so both drivers now
 * agree that `where: { read_at: null }` means "has not been read".
 */
export function applyFilters(
  builder: Filterable,
  where: Record<string, unknown> | undefined,
  inFilters: Record<string, unknown[] | undefined> | undefined,
  startsWith?: Record<string, string | undefined>,
): Filterable {
  let next = builder;
  for (const [key, value] of Object.entries(where ?? {})) {
    next = value === null ? next.is(key, null) : next.eq(key, value as never);
  }
  for (const [key, values] of Object.entries(inFilters ?? {})) {
    if (values) next = next.in(key, values as never[]);
  }
  for (const [key, prefix] of Object.entries(startsWith ?? {})) {
    if (prefix !== undefined) next = next.like(key, prefixPattern(prefix));
  }
  return next;
}

/**
 * PostgREST's "no such function", and Postgres's. A database that has not run
 * migration 0015 has no `increment_counter`.
 */
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);

/**
 * Supabase driver. Uses the service role key on the server so that the app can
 * enforce its own rules (blocking, moderation, FayTarra points) in one place; the
 * SQL schema still ships row level security for any direct client access.
 */
class SupabaseDriver implements Driver {
  readonly name = 'supabase' as const;
  private client: SupabaseClient;
  /** False once the database has said it has no `increment_counter`. */
  private atomicIncrement = true;

  constructor() {
    this.client = createClient(
      url(),
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  async query<T extends TableName>(table: T, options: QueryOptions<Row<T>> = {}) {
    // Supabase caps a single response at `max-rows` (1000 by default). An
    // unbounded query that silently stopped at 1000 would not error — it would
    // just return the wrong answer, and the ratings, rankings and admin totals
    // are all computed from full-table reads. So page through explicitly.
    const wanted = options.limit ?? Infinity;
    const out: Row<T>[] = [];

    for (let from = 0; out.length < wanted; from += PAGE_SIZE) {
      const size = Math.min(PAGE_SIZE, wanted - out.length);
      const base = this.client.from(table).select('*');
      // `applyFilters` is deliberately typed against the small shape it needs
      // rather than PostgREST's builder generics, which do not survive being
      // passed through a function. Same object, same methods, either way.
      let builder = applyFilters(
        base as unknown as Filterable,
        options.where as Record<string, unknown> | undefined,
        options.in as Record<string, unknown[] | undefined> | undefined,
        options.startsWith as Record<string, string | undefined> | undefined,
      ) as unknown as typeof base;
      if (options.orderBy) {
        builder = builder.order(String(options.orderBy), { ascending: !options.desc });
      }
      // A stable tiebreak, or two pages can repeat and skip rows.
      builder = builder.order('id', { ascending: true });
      builder = builder.range(from, from + size - 1);

      const { data, error } = await builder;
      if (error) throwQueryError(table, error);
      const page = (data ?? []) as Row<T>[];
      out.push(...page);
      if (page.length < size) break;

      if (out.length >= HARD_CAP) {
        console.warn(
          `[faytarra] ${table} read hit the ${HARD_CAP} row cap. Aggregates over this table ` +
            'are no longer exact — move them into SQL.',
        );
        break;
      }
    }

    return out;
  }

  async get<T extends TableName>(table: T, id: string) {
    const { data, error } = await this.client.from(table).select('*').eq('id', id).maybeSingle();
    if (error) throwQueryError(table, error);
    return (data as Row<T> | null) ?? null;
  }

  async insert<T extends TableName>(table: T, row: Row<T>) {
    const { data, error } = await this.client
      .from(table)
      .insert(row as never)
      .select()
      .single();
    if (error) throwQueryError(table, error);
    return data as Row<T>;
  }

  async insertMany<T extends TableName>(table: T, rows: Row<T>[]) {
    if (rows.length === 0) return [];
    const { data, error } = await this.client.from(table).insert(rows as never[]).select();
    if (error) throwQueryError(table, error);
    return (data ?? []) as Row<T>[];
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    const { data, error } = await this.client
      .from(table)
      .update(patch as never)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throwQueryError(table, error);
    return (data as Row<T> | null) ?? null;
  }

  async remove<T extends TableName>(table: T, id: string) {
    const { error } = await this.client.from(table).delete().eq('id', id);
    if (error) throwQueryError(table, error);
  }

  async removeWhere<T extends TableName>(table: T, where: Partial<Row<T>>) {
    const entries = Object.entries(where).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return 0;
    const { error, count } = await this.client
      .from(table)
      .delete({ count: 'exact' })
      .match(Object.fromEntries(entries) as Record<string, unknown>);
    if (error) throwQueryError(table, error);
    return count ?? 0;
  }

  async updateWhere<T extends TableName>(table: T, where: Partial<Row<T>>, patch: Partial<Row<T>>) {
    const entries = Object.entries(where).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return 0;
    // One UPDATE … WHERE: Postgres evaluates the condition and writes the row
    // under the same row lock, so of two racing requests only one matches.
    let builder = this.client.from(table).update(patch as never);
    for (const [column, value] of entries) {
      builder = value === null ? builder.is(column, null) : builder.eq(column, value as never);
    }
    const { data, error } = await builder.select('id');
    if (error) throwQueryError(table, error);
    return (data ?? []).length;
  }

  async increment<T extends TableName>(
    table: T,
    id: string,
    column: CounterColumn<Row<T>>,
    by = 1,
  ) {
    if (this.atomicIncrement) {
      // `update … set n = n + by … returning n`, in the database, under the
      // row's lock. See increment_counter in migration 0015.
      const { data, error } = await this.client.rpc('increment_counter', {
        target_table: table,
        target_id: id,
        target_column: column,
        amount: by,
      });
      if (!error) return typeof data === 'number' ? data : data == null ? null : Number(data);
      if (!MISSING_FUNCTION.has(error.code ?? '')) throwQueryError(table, error);
      this.atomicIncrement = false;
      console.warn(
        '[faytarra] This database has no increment_counter function, so counters are ' +
          'updated by read-then-write, which can lose one of two simultaneous updates. ' +
          'Run supabase/migrations/0015_hashtags_and_counters.sql to fix that.',
      );
    }
    // The fallback until the migration is run: read, add, write.
    const row = await this.get(table, id);
    if (!row) return null;
    const current = Number((row as unknown as Record<string, unknown>)[column] ?? 0);
    const next = (Number.isFinite(current) ? current : 0) + by;
    await this.update(table, id, { [column]: next } as Partial<Row<T>>);
    return next;
  }

  async clear() {
    const tables: TableName[] = [
      'post_hashtags',
      'hashtags',
      'messages',
      'ratings',
      'notifications',
      'reports',
      'blocks',
      'follows',
      'comments',
      'likes',
      'posts',
      'users',
    ];
    for (const table of tables) {
      const { error } = await this.client
        .from(table)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (!error) continue;
      try {
        throwQueryError(table, error);
      } catch (thrown) {
        // A table this database never had is nothing to clear.
        if (!isMissingRelation(thrown)) throw thrown;
      }
    }
  }

  async putMedia(fileName: string, contentType: string, data: Uint8Array) {
    const { error } = await this.client.storage
      .from(BUCKET)
      .upload(fileName, data, { contentType, upsert: true });
    if (error) throw new Error(`[supabase:storage] ${error.message}`);
    const { data: pub } = this.client.storage.from(BUCKET).getPublicUrl(fileName);
    return pub.publicUrl;
  }
}

const globalRef = globalThis as typeof globalThis & { __faySupabaseDriver?: SupabaseDriver };

export function supabaseDriver(): Driver {
  globalRef.__faySupabaseDriver ??= new SupabaseDriver();
  return globalRef.__faySupabaseDriver;
}
