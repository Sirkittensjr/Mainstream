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

/**
 * Whether what gets written will still be there later.
 *
 * The local JSON driver is fine on a developer's machine. On a serverless host
 * it writes to a per-instance temp directory that is wiped between instances,
 * so anything stored there is gone — which matters most at signup, where a
 * person would get a real Supabase Auth account whose FayTarra profile then
 * evaporates. That is worse than refusing, because it looks like it worked.
 */
export function storageIsDurable(): boolean {
  if (supabaseConfigured()) return true;
  return !(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export type { Driver, QueryOptions, Row, Schema, TableName } from './types';
export { supabaseConfigured };
