/**
 * Seeds the active storage driver with the sample FayTarra community.
 *
 *   npm run seed          # seeds whichever driver is configured
 *   npm run reset         # wipes local data and re-seeds
 *
 * With Supabase configured, run supabase/schema.sql first.
 *
 * Sample accounts are REAL Supabase Auth users: the script asks Supabase to
 * create each one with a confirmed address, and the profile rows are keyed by
 * the ids Supabase hands back. Nothing here hashes or stores a password.
 */
import { createClient } from '@supabase/supabase-js';
import { buildSeedStore, SEED_PASSWORD } from '../src/lib/seed/data';
import type { Schema, TableName } from '../src/lib/db/types';

// Node's own env-file loader (20.12+), so this script needs no dependency of
// its own — one less package that `next build` has to resolve.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Not present, which is fine: the local driver needs no configuration.
  }
}

type Store = { [K in TableName]: Schema[K][] };

/**
 * Creates one Supabase Auth user per seeded profile and rewrites the store so
 * every id is the id Supabase issued. Existing auth users are reused, so the
 * script can be run again without tripping over itself.
 */
async function createAuthUsers(store: Store): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Seeding Supabase needs SUPABASE_SERVICE_ROLE_KEY so the sample accounts can be ' +
        'created in Supabase Auth.',
    );
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Remove any auth users left over from a previous seed, so ids line up with
  // the profile rows we are about to write.
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const seeded = new Set(store.users.map((user) => user.email.toLowerCase()));
  for (const user of existing?.users ?? []) {
    if (user.email && seeded.has(user.email.toLowerCase())) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }

  const idMap = new Map<string, string>();
  for (const user of store.users) {
    const { data, error } = await admin.auth.admin.createUser({
      email: user.email,
      password: SEED_PASSWORD,
      // Sample accounts skip the confirmation mail; real signups do not.
      email_confirm: true,
      user_metadata: {
        username: user.username,
        display_name: user.display_name,
        bio: user.bio,
        location: user.location ?? '',
        avatar_url: user.avatar_url ?? '',
        interests: user.interests,
      },
    });
    if (error || !data.user) {
      throw new Error(`Could not create ${user.email} in Supabase Auth: ${error?.message}`);
    }
    idMap.set(user.id, data.user.id);
  }

  remapIds(store, idMap);
}

/** Points every user reference in the seed at its new Supabase Auth id. */
function remapIds(store: Store, idMap: Map<string, string>): void {
  const swap = (id: string): string => idMap.get(id) ?? id;

  for (const user of store.users) user.id = swap(user.id);
  for (const post of store.posts) post.author_id = swap(post.author_id);
  for (const like of store.likes) like.user_id = swap(like.user_id);
  for (const comment of store.comments) comment.user_id = swap(comment.user_id);
  for (const follow of store.follows) {
    follow.follower_id = swap(follow.follower_id);
    follow.following_id = swap(follow.following_id);
  }
  for (const block of store.blocks) {
    block.blocker_id = swap(block.blocker_id);
    block.blocked_id = swap(block.blocked_id);
  }
  for (const rating of store.ratings) {
    rating.rater_id = swap(rating.rater_id);
    if (rating.target_type === 'user') rating.target_id = swap(rating.target_id);
  }
  for (const notification of store.notifications) {
    notification.user_id = swap(notification.user_id);
    if (notification.actor_id) notification.actor_id = swap(notification.actor_id);
  }
  for (const report of store.reports) {
    report.reporter_id = swap(report.reporter_id);
    if (report.target_type === 'user') report.target_id = swap(report.target_id);
  }
}

async function main() {
  // Imported directly rather than through `@/lib/db`, which is server-only.
  const { supabaseConfigured, supabaseDriver } = await import('../src/lib/db/supabase');
  const { localDriver } = await import('../src/lib/db/local');
  const onSupabase = supabaseConfigured();
  const driver = onSupabase ? supabaseDriver() : localDriver();
  const store = buildSeedStore();

  console.log(`Seeding the ${driver.name} driver…`);
  console.log('Clearing existing rows…');
  await driver.clear();

  if (onSupabase) {
    console.log('Creating the sample accounts in Supabase Auth…');
    await createAuthUsers(store);
  }

  // Insert in dependency order so foreign keys hold in Postgres.
  const order: TableName[] = [
    'users',
    'posts',
    'ratings',
    'likes',
    'comments',
    'follows',
    'blocks',
    'notifications',
    'reports',
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

  console.log(`\nDone. Sign in with tommy@faytarra.app / ${SEED_PASSWORD}`);
  console.log(`Admin dashboard: admin@faytarra.app / ${SEED_PASSWORD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
