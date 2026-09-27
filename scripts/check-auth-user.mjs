/**
 * What Supabase Auth actually holds for one address.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/check-auth-user.mjs someone@example.com
 *
 * Answers the only question that matters when somebody says "I confirmed my
 * email and it still wants me to confirm": is `email_confirmed_at` populated
 * on the authoritative record? Read-only — it changes nothing.
 *
 * The service-role key is read from the environment and never written
 * anywhere. Run it locally, not on a server, and do not paste the key into a
 * file.
 */
import { createClient } from '@supabase/supabase-js';

const address = (process.argv[2] || '').trim().toLowerCase();
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!address || !url || !key) {
  console.error(
    'Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-auth-user.mjs <email>',
  );
  process.exit(2);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// listUsers is paged; walk until the address turns up.
let user = null;
for (let page = 1; page <= 20 && !user; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error(`Could not read users: ${error.message}`);
    process.exit(1);
  }
  if (data.users.length === 0) break;
  user = data.users.find((candidate) => (candidate.email || '').toLowerCase() === address) ?? null;
}

if (!user) {
  console.log(`No Supabase Auth user for ${address}.`);
  process.exit(0);
}

const confirmed = Boolean(user.email_confirmed_at);
console.log(`
  id                  ${user.id}
  email               ${user.email}
  email_confirmed_at  ${user.email_confirmed_at ?? '(null)'}
  confirmed_at        ${user.confirmed_at ?? '(null)'}
  last_sign_in_at     ${user.last_sign_in_at ?? '(null)'}
  created_at          ${user.created_at}
  identities          ${(user.identities ?? []).length}

  ${confirmed
    ? 'VERIFIED — this account can sign in with a password.'
    : 'NOT VERIFIED — sign-in will be refused until a confirmation link is opened.'}
`);
