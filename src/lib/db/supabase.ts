import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Driver, QueryOptions, Row, TableName } from './types';

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'faytarra-media';

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
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
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  async query<T extends TableName>(table: T, options: QueryOptions<Row<T>> = {}) {
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
    if (options.limit != null) builder = builder.limit(options.limit);
    const { data, error } = await builder;
    if (error) throw new Error(`[supabase:${table}] ${error.message}`);
    return (data ?? []) as Row<T>[];
  }

  async get<T extends TableName>(table: T, id: string) {
    const { data, error } = await this.client.from(table).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`[supabase:${table}] ${error.message}`);
    return (data as Row<T> | null) ?? null;
  }

  async insert<T extends TableName>(table: T, row: Row<T>) {
    const { data, error } = await this.client
      .from(table)
      .insert(row as never)
      .select()
      .single();
    if (error) throw new Error(`[supabase:${table}] ${error.message}`);
    return data as Row<T>;
  }

  async insertMany<T extends TableName>(table: T, rows: Row<T>[]) {
    if (rows.length === 0) return [];
    const { data, error } = await this.client.from(table).insert(rows as never[]).select();
    if (error) throw new Error(`[supabase:${table}] ${error.message}`);
    return (data ?? []) as Row<T>[];
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    const { data, error } = await this.client
      .from(table)
      .update(patch as never)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`[supabase:${table}] ${error.message}`);
    return (data as Row<T> | null) ?? null;
  }

  async remove<T extends TableName>(table: T, id: string) {
    const { error } = await this.client.from(table).delete().eq('id', id);
    if (error) throw new Error(`[supabase:${table}] ${error.message}`);
  }

  async clear() {
    const tables: TableName[] = [
      'activity',
      'rank_snapshots',
      'ratings',
      'notifications',
      'reports',
      'blocks',
      'follows',
      'comments',
      'likes',
      'posts',
      'challenges',
      'users',
    ];
    for (const table of tables) {
      const { error } = await this.client
        .from(table)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw new Error(`[supabase:${table}] ${error.message}`);
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
