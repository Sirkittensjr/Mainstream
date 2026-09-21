import 'server-only';
import { localDriver } from './local';
import { supabaseConfigured, supabaseDriver } from './supabase';
import type { Driver } from './types';

let warned = false;

/**
 * Picks the storage driver. Supabase whenever it is configured, otherwise the
 * bundled local JSON store so `npm run dev` works with zero setup.
 */
export function db(): Driver {
  if (supabaseConfigured()) return supabaseDriver();

  if (process.env.NODE_ENV === 'production' && !warned) {
    warned = true;
    // Worth saying loudly: on most hosts the filesystem is ephemeral or
    // read-only, so a production deploy on this driver silently loses every
    // account, post and rating on restart.
    console.warn(
      '[faytarra] Running on the local JSON driver in production. Data is stored in ' +
        './.data and will not survive a restart or redeploy. Set ' +
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use Supabase.',
    );
  }
  return localDriver();
}

export type { Driver, QueryOptions, Row, Schema, TableName } from './types';
export { supabaseConfigured };
