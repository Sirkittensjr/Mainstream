# End-to-end tests

Harnesses that check FayTarra end to end without needing a Supabase project:
the SQL against a real Postgres, and the app against a GoTrue-protocol stub.

## 1. The database side — `supabase-shim.sql` + `schema-checks.sql`

Runs against any Postgres 16. The shim creates the bits of a Supabase project
that exist before FayTarra's own SQL does (`auth.users`, `auth.uid()`,
`storage.buckets`); the checks then prove the behaviour the app relies on.

```bash
createdb faytarra_test
psql -v ON_ERROR_STOP=1 -d faytarra_test -f scripts/e2e/supabase-shim.sql
psql -v ON_ERROR_STOP=1 -d faytarra_test -f supabase/schema.sql
psql -d faytarra_test -f scripts/e2e/schema-checks.sql
psql -d faytarra_test -f scripts/e2e/rls-checks.sql
psql -d faytarra_test -f scripts/e2e/dm-checks.sql
```

`rls-checks.sql` is the one to re-run after touching grants or policies. It
proves that somebody holding only the anon key cannot read an email address,
and that a signed-in person cannot PATCH their own profile row to
`role = 'admin'`, lift their own ban, restore a revoked `trusted` flag or take
another person's username — while still being able to edit their own bio and
not anybody else's. Every line marked "must fail" is expected to print an
error; that is the check passing.

`dm-checks.sql` proves the messaging rule is enforced by the DATABASE, not just
the UI: strangers cannot message, a one-way follow is not enough, mutual follows
work in both directions, a block stops it, unfollowing stops new messages while
history survives, and neither API role can read a single message row. The lines
marked "must fail" are expected to print an error.

`schema-checks.sql` checks that a new `auth.users` row gets a FayTarra profile in the same
transaction, that `public.users` has no password column, that a duplicate or
missing username aborts the whole signup, that usernames collide
case-insensitively, that an email change is mirrored, that a profile cannot
exist without an auth user, that deleting the auth user cascades the profile
and its posts away, and that RLS is on everywhere. Steps 3, 4, 5 and 7 are
*expected* to print an error — that is the check passing.

## 2. The app side — `gotrue-stub.mjs` + `auth-flow.mjs` + `social-flow.mjs`

`gotrue-stub.mjs` speaks GoTrue's HTTP protocol (signup, password grant, PKCE
code exchange, refresh, `/user`, logout, recover, resend) with real HS256 JWTs
and real PKCE challenge checking. It exists so the flow can be exercised
without network access to a Supabase project; everything above it — the app,
`@supabase/ssr`, `@supabase/supabase-js`, the cookies — is the real thing.
Emails are appended to an outbox file instead of being sent.

Both browser suites need Playwright, which is deliberately not a project
dependency:

```bash
npm i -D playwright

STUB_PORT=54321 node scripts/e2e/gotrue-stub.mjs &

cat > .env.local <<'ENV'
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=anything
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV

npm run build && npm start &   # NEXT_PUBLIC_* are baked in at build time
node scripts/e2e/auth-flow.mjs
```

### 3. The social product — `social-flow.mjs`

Same setup as above, plus the seeded community. Point the stub at the local
store so the sample accounts can actually sign in:

```bash
npm run reset                                    # seed the local JSON store
STUB_PORT=54321 STUB_SEED_FROM=.data/faytarra.json \
  node scripts/e2e/gotrue-stub.mjs &
npm run build && npm start &
node scripts/e2e/social-flow.mjs
```

It covers posting with a real image upload, an upload that only claims to be an
image being refused, liking, commenting, replying, following, rating a post,
rating a profile, Overall against Last 30 days, both feeds, "Show more",
notifications for every action including replies, search, the rankings and
category rankings, Discover's post boards, reporting, blocking and unblocking,
the admin dashboard (and a normal account being turned away from it), profile
edits persisting, phone-width layout on every main screen, every link on the
feed resolving, and a clean browser console.

### 4. Logging out — `logout-flow.mjs`

Same setup. Runs the whole flow twice, at desktop and phone width: sign in,
open the account menu from the navigation, log out, land on the homepage, and
then verify the sign-out actually happened on the server rather than only in
the browser — the API no longer recognises the session, a refresh does not
restore it, the gated routes are closed again, and a brand new tab in the same
browser is signed out too.

```bash
node scripts/e2e/logout-flow.mjs
```

### 5. Signup keeps what you typed — `signup-form-state.mjs`

React resets a `<form action={…}>` once the action settles, so uncontrolled
inputs are wiped by any server-side validation failure — one missed interest
used to cost the person their email, username, display name, bio and location.
This is the regression guard, run at desktop and phone width: submit with a
field missing, confirm the error appears beside the control it belongs to, and
confirm everything else is still filled in. The password is expected to be
cleared.

```bash
node scripts/e2e/signup-form-state.mjs
```

### 6. Messaging, usernames, Discover and ratings — `features-flow.mjs`

Starts from a **completely empty database** — no seed, no demo accounts — and
creates three real accounts through the real signup flow, so it exercises
exactly what a brand-new FayTarra looks like.

```bash
node scripts/e2e/features-flow.mjs
```

Covers: a new account being discoverable and a zero-engagement post appearing in
Discover; Discover falling back to your own post when nothing else exists and
dropping it once somebody else posts; a single rating of 10 displaying as 10.0
with "1 rating"; a second rating of 8 making it 9.0; no page explaining the
ranking maths; messaging refused one-way and at the URL not just the button;
messaging working both ways once mutual; unfollowing closing the composer while
history survives; and a username change that keeps the account id, posts,
profile and ratings, refuses a handle in use, refuses reserved handles, and
applies a cooldown.

---

`auth-flow.mjs` drives a real browser through: signed-out browsers being kept out of
`/create`, `/settings`, `/notifications` and `/admin`; signing up; being unable
to sign in before confirming; the confirmation link; the profile matching what
was typed; posting; the session surviving a new tab but not a different
browser; `/api/v1/me` refusing an unauthenticated caller; signing out; signing
back in by username; the earlier post still being there; a wrong password being
refused; a username not being claimable twice; the password reset round trip;
and the old password no longer working.

### 7. Video — `make-video-fixtures.mjs` + `video-flow.mjs`

The whole video creator, in a real browser: uploading a file, recording clips
from the camera with a microphone, reordering, deleting, trimming, cropping,
rotating, muting, combining, choosing a thumbnail, captioning, posting, and
watching the result from a second account on desktop and at phone width. It
finishes by proving that text posts, photo posts, likes, comments, ratings and
Discover still work exactly as before.

There is no ffmpeg in this container and none is needed. The fixtures are made
the same way the feature makes video — canvas plus `MediaRecorder` — so they
are exactly the kind of file the code will meet, including the awkward one: a
live recording whose container never states its own duration. Chromium's fake
camera and microphone mean `getUserMedia`, the permission prompt and the audio
track are all real code paths.

```bash
node scripts/e2e/make-video-fixtures.mjs /tmp/fay-video-fixtures   # ~3.5 min, cached

STUB_PORT=54321 node scripts/e2e/gotrue-stub.mjs &
npm run build && npm start &
FIXTURES=/tmp/fay-video-fixtures node scripts/e2e/video-flow.mjs
```

Its last section is the one to re-run after touching uploads: it makes the
requests somebody would make if they skipped the editor entirely — a video
past three minutes, a file that only claims to be video, a 400MB upload,
another person's pending object, a path climbing out of its own folder, and
the same calls with no account at all.

### 8. The production upload path — `storage-stub.mjs` + `storage-roundtrip.mts`

A deployment with Supabase does not send uploads through the app: a 250MB
request body is refused by every serverless host long before it arrives
(Vercel stops at 4.5MB). The server signs a URL, the browser PUTs the file
straight to Storage, and the server reads it back to check it. None of that
runs on the local driver, so without this the one path production actually
uses would be the one path never exercised.

`storage-stub.mjs` speaks Storage's HTTP protocol — signed upload URLs, ranged
reads, list, move, delete — and the app's own module drives it through the real
`@supabase/storage-js` client.

```bash
STORAGE_PORT=54500 node scripts/e2e/storage-stub.mjs &
STORAGE_PORT=54500 FIXTURES=/tmp/fay-video-fixtures \
  npx tsx --conditions=react-server scripts/e2e/storage-roundtrip.mts
```

`--conditions=react-server` is what satisfies the `server-only` import; without
it the module refuses to load outside a server component, which is the point
of that import.

It proves the round trip end to end and, just as importantly, that a video
past the limit is caught **after** it has landed: read from both ends of a 6MB
object, refused, and deleted rather than left in the bucket.

### Which store each suite wants

`auth-flow` and `video-flow` create their own accounts and want an EMPTY store
(`echo '{}' > .data/faytarra.json`). `signup-form-state`, `logout-flow` and
`social-flow` sign in as the seeded demo accounts and check against them —
`signup-form-state` takes `tommy` as its already-taken username — so those need
`npm run seed` first. Running them against the wrong one reports failures that
are not failures.

### A note on running these back to back

`social-flow` and `features-flow` change the data they run against — follows,
ratings, usernames — so a second run on the same store starts from a different
place and will report failures that are not failures. Re-seed between runs, and
stop the previous server first: a server still holding the old store in memory
will flush it back over the file you just seeded.
