import 'server-only';
import { localDriver } from './local';
import { supabaseConfigured, supabaseDriver } from './supabase';
import type { Driver } from './types';

/**
 * Picks the storage driver. Supabase whenever it is configured, otherwise the
 * bundled local JSON store so `npm run dev` works with zero setup.
 */
export function db(): Driver {
  return supabaseConfigured() ? supabaseDriver() : localDriver();
}

export type { Driver, QueryOptions, Row, Schema, TableName } from './types';
export { supabaseConfigured };
