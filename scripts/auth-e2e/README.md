# Authentication tests

Two harnesses that check the Supabase Auth integration without needing a
Supabase project.

## 1. The database side — `supabase-shim.sql` + `schema-checks.sql`

Runs against any Postgres 16. The shim creates the bits of a Supabase project
that exist before FayTarra's own SQL does (`auth.users`, `auth.uid()`,
`storage.buckets`); the checks then prove the behaviour the app relies on.

```bash
createdb faytarra_test
psql -v ON_ERROR_STOP=1 -d faytarra_test -f scripts/auth-e2e/supabase-shim.sql
psql -v ON_ERROR_STOP=1 -d faytarra_test -f supabase/schema.sql
psql -d faytarra_test -f scripts/auth-e2e/schema-checks.sql
```

It checks that a new `auth.users` row gets a FayTarra profile in the same
transaction, that `public.users` has no password column, that a duplicate or
missing username aborts the whole signup, that usernames collide
case-insensitively, that an email change is mirrored, that a profile cannot
exist without an auth user, that deleting the auth user cascades the profile
and its posts away, and that RLS is on everywhere. Steps 3, 4, 5 and 7 are
*expected* to print an error — that is the check passing.

## 2. The app side — `gotrue-stub.mjs` + `auth-flow.mjs`

`gotrue-stub.mjs` speaks GoTrue's HTTP protocol (signup, password grant, PKCE
code exchange, refresh, `/user`, logout, recover, resend) with real HS256 JWTs
and real PKCE challenge checking. It exists so the flow can be exercised
without network access to a Supabase project; everything above it — the app,
`@supabase/ssr`, `@supabase/supabase-js`, the cookies — is the real thing.
Emails are appended to an outbox file instead of being sent.

```bash
npm i -D playwright            # not a project dependency

STUB_PORT=54321 node scripts/auth-e2e/gotrue-stub.mjs &

cat > .env.local <<'ENV'
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=anything
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV

npm run build && npm start &   # NEXT_PUBLIC_* are baked in at build time
node scripts/auth-e2e/auth-flow.mjs
```

It drives a real browser through: signed-out browsers being kept out of
`/create`, `/settings`, `/notifications` and `/admin`; signing up; being unable
to sign in before confirming; the confirmation link; the profile matching what
was typed; posting; the session surviving a new tab but not a different
browser; `/api/v1/me` refusing an unauthenticated caller; signing out; signing
back in by username; the earlier post still being there; a wrong password being
refused; a username not being claimable twice; the password reset round trip;
and the old password no longer working.
