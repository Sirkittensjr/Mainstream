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
  'moderation_events', 'video_views', 'hashtags', 'post_hashtags',
];

/** Columns a migration adds to an existing table, and the migration that adds them. */
const ADDED_COLUMNS: { table: TableName; column: string; migration: string }[] = [
  { table: 'users', column: 'username_changed_at', migration: '0003' },
  { table: 'users', column: 'profile_bg', migration: '0005' },
  { table: 'users', column: 'profile_box', migration: '0005' },
  { table: 'users', column: 'profile_cover_url', migration: '0013' },
  { table: 'users', column: 'top_creators', migration: '0006' },
  { table: 'users', column: 'suspended_until', migration: '0014' },
  { table: 'posts', column: 'content_warning', migration: '0007' },
  { table: 'posts', column: 'review_state', migration: '0009' },
  { table: 'reports', column: 'cleared_at', migration: '0009' },
  // 0017 installs the view storage too (what 0010 adds), whatever the database
  // already has, so it is the one file to run for views.
  { table: 'posts', column: 'video_views', migration: '0017' },
  // Without these a Story or Big Message cannot keep its shape, and posting one
  // is refused rather than stored as a short message. See insert-post.ts.
  { table: 'posts', column: 'text_kind', migration: '0011' },
  { table: 'posts', column: 'text_title', migration: '0011' },
  { table: 'posts', column: 'text_style', migration: '0012' },
];

const MIGRATION_FOR_TABLE: Partial<Record<TableName, string>> = {
  messages: '0003',
  moderation_events: '0009',
  video_views: '0017',
  hashtags: '0015',
  post_hashtags: '0015',
};

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

/** A post id no post can have: asking about it reads and writes nothing. */
const NO_POST = '00000000-0000-0000-0000-000000000000';

/**
 * Whether plays are being counted, and how — the answer to "why is the eye on
 * 0" without reading a log.
 *
 *   counting  false when this database has nowhere to store views, which is
 *             what makes every report come back "unavailable"
 *   oneStep   whether record_video_play (migration 0017) decides and stores
 *             each play in the database; without it the app does, in two
 *             steps that are undone together
 *
 * The function is asked about a post that cannot exist, which it answers
 * "no-post" without reading anybody's views or writing anything.
 */
async function probeViews(schema: { missingTables: string[]; missingColumns: string[] }) {
  const storage =
    !schema.missingTables.includes('video_views') && !schema.missingColumns.includes('posts.video_views');
  if (!storage) {
    return {
      counting: false,
      oneStep: false,
      note:
        'No view storage: every play is answered "unavailable" and every eye stays where it is. ' +
        'Run supabase/migrations/0017_count_every_play.sql.',
    };
  }
  try {
    const outcome = await db().recordPlay({
      id: NO_POST,
      post_id: NO_POST,
      viewer_id: null,
      identity: 'health-check',
      dedupe_key: 'health-check',
      created_at: new Date().toISOString(),
    });
    const oneStep = outcome !== null;
    return {
      counting: true,
      oneStep,
      ...(oneStep || !supabaseConfigured()
        ? {}
        : {
            note:
              'Counting from the app in two steps. Run supabase/migrations/0017_count_every_play.sql ' +
              'to count each play in one step in the database.',
          }),
    };
  } catch (error) {
    return {
      counting: false,
      oneStep: false,
      note: error instanceof Error ? error.message : 'the view counter could not be reached',
    };
  }
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

  const views = probe.reachable
    ? await probeViews(schema)
    : { counting: false, oneStep: false };

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
      views,
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
