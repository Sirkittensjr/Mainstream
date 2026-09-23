import { NextResponse } from 'next/server';
import { db, isMissingRelation, storageIsDurable, supabaseConfigured } from '@/lib/db';
import type { TableName } from '@/lib/db';
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

/**
 * Which tables the code expects but this database does not have.
 *
 * A deployment can be perfectly reachable and still be running a schema older
 * than the code — that is exactly what happens when a migration has not been
 * applied — and until it is named, the only symptom is a page that fails. Each
 * table is probed for one row, because that is the one question the driver can
 * answer without knowing anything about Postgres catalogues.
 */
const TABLES: TableName[] = [
  'users', 'posts', 'likes', 'comments', 'follows',
  'blocks', 'ratings', 'notifications', 'reports', 'messages',
];

/** Columns a migration adds to an existing table, and the migration that adds them. */
const ADDED_COLUMNS: { table: TableName; column: string; migration: string }[] = [
  { table: 'users', column: 'username_changed_at', migration: '0003' },
  { table: 'users', column: 'profile_bg', migration: '0005' },
  { table: 'users', column: 'profile_box', migration: '0005' },
  { table: 'users', column: 'top_creators', migration: '0006' },
];

const MIGRATION_FOR_TABLE: Partial<Record<TableName, string>> = { messages: '0003' };

async function probeSchema(): Promise<{
  missingTables: string[];
  missingColumns: string[];
  migrations: string[];
}> {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  const migrations = new Set<string>();
  // Only Supabase has a schema to be behind. The local JSON driver stores
  // whatever it is handed, so a row without a column is a row that was written
  // before the feature existed, not a migration nobody ran.
  const columnsMatter = supabaseConfigured();

  for (const table of TABLES) {
    try {
      const rows = await db().query(table, { limit: 1 });
      for (const { table: owner, column, migration } of columnsMatter ? ADDED_COLUMNS : []) {
        // Only a row can tell us a column is absent; an empty table is not
        // evidence either way, so it is left unreported rather than guessed at.
        if (owner !== table || rows.length === 0) continue;
        if (!(column in (rows[0] as unknown as Record<string, unknown>))) {
          missingColumns.push(`${table}.${column}`);
          migrations.add(migration);
        }
      }
    } catch (error) {
      if (!isMissingRelation(error)) continue;
      missingTables.push(table);
      const migration = MIGRATION_FOR_TABLE[table];
      if (migration) migrations.add(migration);
    }
  }

  return { missingTables, missingColumns, migrations: [...migrations].sort() };
}

/**
 * Which build is answering.
 *
 * "It is pushed" and "it is live" are different claims, and without this the
 * only way to tell them apart is to go looking for a feature and guess at why
 * it is not there. Vercel sets these on every deployment; locally they are
 * absent and the field says so. A short commit sha and a branch name are not
 * secrets — they are what you need to answer "is my change deployed yet".
 */
function build() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || null;
  return {
    commit: sha ? sha.slice(0, 7) : null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    environment: process.env.VERCEL_ENV || (process.env.NODE_ENV ?? null),
  };
}

export async function GET() {
  const missing = missingAuthVars();
  const durable = storageIsDurable();
  const configured = supabaseConfigured();
  const probe = await probeDatabase();
  const schema = probe.reachable
    ? await probeSchema()
    : { missingTables: [], missingColumns: [], migrations: [] };

  const ready = missing.length === 0 && durable && probe.reachable;

  return NextResponse.json(
    {
      ready,
      build: build(),
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
      schema: {
        upToDate: schema.migrations.length === 0,
        missingTables: schema.missingTables,
        missingColumns: schema.missingColumns,
        ...(schema.migrations.length > 0
          ? {
              note:
                'The database is behind the code. Run ' +
                schema.migrations
                  .map((id) => `supabase/migrations/${id}_*.sql`)
                  .join(' and ') +
                ' against it. The features these add are switched off until then; ' +
                'the rest of FayTarra is unaffected.',
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
