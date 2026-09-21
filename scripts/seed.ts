/**
 * Seeds the active storage driver with the sample FayTarra community.
 *
 *   npm run seed          # seeds whichever driver is configured
 *   npm run reset         # wipes local data and re-seeds
 *
 * With Supabase configured, run supabase/schema.sql first.
 */
import { config } from 'dotenv';
import { buildSeedStore } from '../src/lib/seed/data';
import type { TableName } from '../src/lib/db/types';

config({ path: '.env.local' });
config({ path: '.env' });

async function main() {
  // Imported directly rather than through `@/lib/db`, which is server-only.
  const { supabaseConfigured, supabaseDriver } = await import('../src/lib/db/supabase');
  const { localDriver } = await import('../src/lib/db/local');
  const driver = supabaseConfigured() ? supabaseDriver() : localDriver();
  const store = buildSeedStore();

  console.log(`Seeding the ${driver.name} driver…`);
  console.log('Clearing existing rows…');
  await driver.clear();

  // Insert in dependency order so foreign keys hold in Postgres.
  const order: TableName[] = [
    'users',
    'challenges',
    'posts',
    'ratings',
    'likes',
    'comments',
    'follows',
    'blocks',
    'notifications',
    'reports',
    'activity',
    'rank_snapshots',
  ];

  for (const table of order) {
    const rows = store[table];
    if (rows.length === 0) continue;
    // Chunked so a large seed does not blow past request size limits.
    for (let i = 0; i < rows.length; i += 500) {
      await driver.insertMany(table, rows.slice(i, i + 500) as never[]);
    }
    console.log(`  ${table}: ${rows.length}`);
  }

  console.log('\nDone. Sign in with tommy@faytarra.app / faydemo123');
  console.log('Admin dashboard: admin@faytarra.app / faydemo123');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
