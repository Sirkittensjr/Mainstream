import { NextResponse } from 'next/server';
import { db, storageIsDurable, supabaseConfigured } from '@/lib/db';
import { authConfigured, missingAuthVars } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

/**
 * Is this deployment actually wired up?
 *
 * Reports booleans, variable NAMES and error messages only — never a key, so
 * this is safe to leave public. The point is to answer "did my environment
 * variables reach the running deployment, and does the database behind them
 * work" without reading build logs.
 *
 * It really queries the database rather than only checking that a key is set.
 * Configured-but-unreachable is the dangerous state: the app switches off the
 * local fallback and every page that reads data starts failing, so a health
 * check that called that "ready" would be pointing the wrong way at exactly
 * the moment it mattered.
 */
async function probeDatabase(): Promise<{ reachable: boolean; error?: string }> {
  try {
    await db().query('users', { limit: 1 });
    return { reachable: true };
  } catch (error) {
    // The driver puts the table name and Supabase's own message in here, which
    // is what distinguishes "no such table" from "bad key" from "wrong URL".
    return { reachable: false, error: error instanceof Error ? error.message : 'unknown error' };
  }
}

export async function GET() {
  const missing = missingAuthVars();
  const durable = storageIsDurable();
  const configured = supabaseConfigured();
  const probe = await probeDatabase();

  const ready = missing.length === 0 && durable && probe.reachable;

  return NextResponse.json(
    {
      ready,
      auth: {
        configured: authConfigured(),
        missing,
      },
      database: {
        driver: configured ? 'supabase' : 'local-json',
        durable,
        reachable: probe.reachable,
        ...(probe.error ? { error: probe.error } : {}),
        ...(configured || durable
          ? {}
          : {
              note:
                'Local JSON store on an ephemeral filesystem: nothing written here survives. ' +
                'Set SUPABASE_SERVICE_ROLE_KEY.',
            }),
        ...(configured && !probe.reachable
          ? {
              note:
                'Supabase is configured but the query failed. Usually the schema has not been ' +
                'created yet (run supabase/schema.sql) or the service role key is wrong. Pages ' +
                'that read data will be returning 500 until this is fixed.',
            }
          : {}),
      },
      // Confirmation and password-reset emails link back to this.
      siteUrl:
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        (process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : null),
    },
    { status: ready ? 200 : 503 },
  );
}
