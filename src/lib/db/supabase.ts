import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isMissingRelation, throwQueryError } from './errors';
import type { Driver, QueryOptions, Row, TableName } from './types';

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
 * Supabase driver. Uses the service role key on the server so that the app can
 * enforce its own rules (blocking, moderation, FayTarra points) in one place; the
 * SQL schema still ships row level security for any direct client access.
 */
class SupabaseDriver implements Driver {
  readonly name = 'supabase' as const;
  private client: SupabaseClient;

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
      let builder = this.client.from(table).select('*');
      for (const [key, value] of Object.entries(options.where ?? {})) {
        builder = builder.eq(key, value as never);
      }
      for (const [key, values] of Object.entries(options.in ?? {})) {
        if (values) builder = builder.in(key, values as never[]);
      }
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

  async clear() {
    const tables: TableName[] = [
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
