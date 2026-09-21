import { NextResponse } from 'next/server';
import { storageIsDurable, supabaseConfigured } from '@/lib/db';
import { authConfigured, missingAuthVars } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

/**
 * Is this deployment actually wired up?
 *
 * Reports booleans and variable NAMES only — never a value, so this is safe to
 * leave public. The point is to answer "did my environment variables reach the
 * running deployment" without reading build logs, since the usual failure is a
 * build that predates the variables rather than a variable that was never set.
 */
export function GET() {
  const missing = missingAuthVars();
  const durable = storageIsDurable();
  const database = supabaseConfigured();

  const ready = missing.length === 0 && durable;

  return NextResponse.json(
    {
      ready,
      auth: {
        configured: authConfigured(),
        missing,
      },
      database: {
        driver: database ? 'supabase' : 'local-json',
        durable,
        ...(database
          ? {}
          : {
              note: durable
                ? 'Local JSON store. Fine for development, not for a deployment.'
                : 'Local JSON store on an ephemeral filesystem: nothing written here survives. ' +
                  'Set SUPABASE_SERVICE_ROLE_KEY.',
            }),
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
