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
past two minutes, a file that only claims to be video, a 400MB upload,
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

### 9. Direct messages — `messaging-flow.mjs`

The seven scenarios that define messaging, with three real accounts in three
browser contexts: a one-way follow both ways round, a mutual follow, unfollow,
block, unblock, ordering, timestamps, and read/unread.

```bash
node scripts/e2e/messaging-flow.mjs
```

The checks worth keeping are the ones where the BROWSER still believes it may
send. The follow is broken — or the block is made — from a second tab of the
same account while a composer is already on screen, and the send is then made
anyway. If the mutual-follow rule lived in the UI those would go through; they
are refused by the action, by the service layer and by the trigger on the
table, and `dm-checks.sql` proves the last of those against direct SQL.

It also checks what nobody should be able to reach: a third account guessing
either side of somebody else's conversation URL, and a signed-out visitor
landing on the login page rather than in the thread.

### 10. Getting to a profile — `social-navigation.mjs`

Followers, following and notifications, as navigation. Four accounts with real
follows, likes, comments and ratings between them; every check ends by
clicking a person and confirming the profile that opens is theirs.

```bash
node scripts/e2e/social-navigation.mjs
```

Two traps it is written around, both of which produced false passes before
they were fixed:

  - A followers list lives at `/u/<handle>/followers`, so waiting for the path
    to "start with /u/" returns before the click has gone anywhere. The wait is
    for the path to CHANGE to a bare `/u/<handle>`.
  - The first `@handle` in a page's text is the VIEWER's own, in the
    navigation, on every page. Whose profile opened is read from the URL, and
    the page text is then checked for that same handle.

It also covers the block rule — a blocked account leaves both the notification
list and the follower list — and the phone layout.

### 11. The Videos feed — `videos-flow.mjs`

The full-screen video experience, with four real video posts made through the
real editor by two accounts and watched by a third. It needs the same fixtures
as `video-flow` and an EMPTY store.

```bash
node scripts/e2e/make-video-fixtures.mjs /tmp/fay-video-fixtures   # cached

STUB_PORT=54321 node scripts/e2e/gotrue-stub.mjs &
npm run build && npm start &
FIXTURES=/tmp/fay-video-fixtures node scripts/e2e/videos-flow.mjs
```

The checks worth keeping are the ones a screenshot cannot make, all read off
the DOM rather than inferred: how many `<video>` elements exist at all (two,
for four slides — the rest are posters), which one is playing (exactly one,
the one on screen), what the other one is allowed to preload, that scrolling
pauses and rewinds what you left, and that each clip's `videoWidth /
videoHeight` still matches the file that was uploaded — 9:16, 16:9 and 1:1 all
survive. Then the ordering: a liked video leads a newer one, a brand-new
account's first clip with no likes, no ratings and no followers still lands on
the first screenful, and a blocked account's videos disappear.

### 12. Profile colours — `profile-colours-flow.mjs`

Two accounts: one paints their profile, the other looks at it. Needs an EMPTY
store.

```bash
node scripts/e2e/profile-colours-flow.mjs
```

Nothing here is eyeballed. The colours are read back off the rendered page with
`getComputedStyle`, and "the text is still readable" is a computed WCAG
contrast ratio against the box the text is actually sitting on — a bright
yellow box has to clear 4.5:1 for its heading and its quieter text alike, or
the check fails.

The persistence half is six numbered scenarios: save, refresh; log out and log
back in; a second account seeing the same colours; changing them and the second
account seeing the change; that account refreshing; and a reset going back to
the default for everybody. Plus the ones that say where the colours actually
live — a third browser with nothing signed in sees them and has an empty
`localStorage` and `sessionStorage`, the rest of the site is not repainted
while viewing somebody else's profile, and one account saving their own colours
leaves the other account's alone.

Point `STUB` at the PostgREST stub as well and it reads the `users` row back
out of the database between steps, so "it saved" is the row holding
`profile_bg=black`, not a page that looks right:

```bash
BASE_URL=http://localhost:3100 STUB=http://127.0.0.1:55300 \
  node scripts/e2e/profile-colours-flow.mjs
```

Run it a second time with `EXPECT_NO_COLOURS=1` against a database that has
**not** had migration 0005 applied. It then checks the other half of the
contract: the page says so before anybody picks anything, the swatches and the
save button are disabled, and — the part that matters — the rest of a profile
edit still saves. The PostgREST stub rehearses that state:

```bash
PORT=55300 GOTRUE_PORT=54321 \
  MISSING_COLUMNS=users.profile_bg,users.profile_box \
  node scripts/e2e/postgrest-stub.mjs &
EXPECT_NO_COLOURS=1 BASE_URL=http://localhost:3100 \
  node scripts/e2e/profile-colours-flow.mjs
```

### 13. The Top 3 creators — `top-creators-flow.mjs`

Five accounts, follows made in a known order, and every answer read off the
rendered profile. Needs an EMPTY store.

```bash
node scripts/e2e/top-creators-flow.mjs
```

The check that earns its keep is the fourth follow. The default Top 3 is
*derived* from the follow order rather than written down when somebody follows
their third person, so a later follow cannot displace anybody — an
implementation that stored the three at follow time would pass every other
check here and fail that one. It also covers picking and reordering, the order
surviving a refresh, the same three appearing for another account, each name
and each photo opening the right profile, unfollowing dropping somebody out of
the Top 3 and out of the menu, filling the empty slot again, somebody staying
in the Top 3 without following back, and the phone layout.

Run it again with `EXPECT_NO_TOP_CREATORS=1` against a database that has not
had migration 0006 applied — the stub rehearses that with
`MISSING_COLUMNS=users.top_creators`. Profiles must still show their default
Top 3; only changing it is unavailable, and it has to say so rather than fail.

### 14. Running against PostgREST — `postgrest-stub.mjs`

Every browser suite here runs on the local JSON driver. Production does not,
and the last two production failures were both Supabase-only — a `where`
clause that the local driver answered correctly and PostgREST rejected.
Neither could have been caught by a test that never spoke the protocol.

This stands in for PostgREST over an in-memory dataset: `eq.`, `is.null`,
`in.()`, Range paging, the object Accept header, and the same 400 Postgres
returns when asked to compare a timestamp with the string "null". Set
`MISSING_COLUMNS=users.profile_bg,users.profile_box` (or `users.top_creators`)
to make it answer PGRST204 for a write touching those columns, which is what a
database running behind a migration does. That rehearsal is what caught the
`instanceof` in `isMissingRelation` failing across a bundler chunk boundary —
the guard was there, and it was not being reached. It proxies
`/auth/v1` to the GoTrue stub, so one origin serves both exactly as a real
project does, and `/api/health` reports `driver: supabase` against it.

```bash
STUB_PORT=54321 node scripts/e2e/gotrue-stub.mjs &
PORT=55300 GOTRUE_PORT=54321 node scripts/e2e/postgrest-stub.mjs &

SUPABASE_URL=http://127.0.0.1:55300 \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55300 \
SUPABASE_ANON_KEY=stub SUPABASE_SERVICE_ROLE_KEY=stub-secret \
  npm start &

node scripts/e2e/social-navigation.mjs     # or any other suite
```

Worth running any suite through it before believing a feature works in
production. `POST /__seed` takes `{table: [rows]}` for state the app has no UI
for — a profile with sixty followers, say — and `GET /__dump` returns
everything it holds.

### 15. What each page costs — `perf-report.mjs` + `seed-perf.py`

The instrumented stand-in counts every query and every row a page asks for, so
performance work can be aimed rather than guessed at. `seed-perf.py` fills it
with a small-but-real dataset (200 accounts, 600 posts, 2,500 ratings, 4,000
likes, 2,900 follows); `perf-report.mjs` signs an account up, follows a few
people, and measures every major route twice — once cold, once warm.

```bash
PORT=55400 GOTRUE_PORT=54321 node scripts/e2e/postgrest-stub.mjs &
python3 scripts/e2e/seed-perf.py 55400
SUPABASE_URL=http://127.0.0.1:55400 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55400 \
  SUPABASE_ANON_KEY=stub SUPABASE_SERVICE_ROLE_KEY=stub-secret npm start &
STUB=http://127.0.0.1:55400 node scripts/e2e/perf-report.mjs
```

It is worth re-running after any change to a service. The number to watch is
rows: a page that starts reading thousands of them has almost always picked up
a whole-table read, which is the shape of every performance problem this
codebase has had.

For reference, the run that prompted the optimisation pass and the one after
it:

| route | rows before | rows after |
| --- | --- | --- |
| `/home` | 20,340 | 103 |
| `/discover` | 11,145 | 292 |
| `/u/<handle>` | 9,963 | 133 |
| `/notifications` | 9,801 | 4 |
| all ten routes | 108,783 | 867 |

### Which store each suite wants

`auth-flow`, `video-flow`, `videos-flow`, `messaging-flow`,
`profile-colours-flow`, `top-creators-flow` and `social-navigation` create
their own accounts and want an EMPTY store
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
