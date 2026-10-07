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
psql -d faytarra_test -f scripts/e2e/admin-checks.sql
psql -d faytarra_test -f scripts/e2e/auto-review-checks.sql
```

The shim's `storage.buckets` carries `file_size_limit` and `allowed_mime_types`
because `schema.sql` sets them. Without those columns `schema.sql` aborts partway
through under `ON_ERROR_STOP=1`, which silently skips everything after it — the
grants and the RLS block included, which is most of what these files test.

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

`admin-checks.sql` proves the admin role is enforced by the DATABASE, not by
the application: migration 0008 promotes exactly one account and is safe to
re-run, and a signed-in person holding the anon key cannot make themselves an
admin, demote the admin, promote anyone else, or read the admin's email — while
still being able to edit their own bio in the same session. The lines marked
"must fail" are expected to print an error; that is the check passing.

`auto-review-checks.sql` proves the automatic ten-report review is enforced by
the DATABASE and not only by the app: one account cannot report the same thing
twice (a unique index, not a code path), `review_state` cannot be set to
anything the app does not mean, neither API role can read *or write* the
moderation log, and a signed-in person cannot restore a hidden post, forge a
report count, clear the reports counting toward the threshold, mark one reviewed
or delete one to get back under it. The lines marked "must fail" are expected to
print an error; the five `UPDATE 0` / `DELETE 0` lines in section 4 are the
check passing too — row level security makes them no-ops rather than errors,
and section 5 reads everything back to prove nothing moved. It cleans up after
itself, so it is re-runnable.

```bash
psql -d faytarra_test -f scripts/e2e/auto-review-checks.sql
```

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

### 3c. The official admin badge — `admin-badge.mjs`

The badge is granted by one thing, `role = 'admin'` in the database. These
checks cover the two ways that goes wrong: an admin not carrying it somewhere
they are shown, and somebody who is not an admin managing to wear one.

```bash
ADMIN_EMAILS=admin@faytarra.com npm start &
node scripts/e2e/admin-badge.mjs
```

Covers, at desktop and phone width: the badge on the admin's profile name,
their post card, their comment on somebody else's post, search results, a
following list and a notification; an ordinary account carrying none anywhere;
and — the important one — an ordinary account renaming itself "FayTarra Admin"
and pasting `<span data-admin-badge>` into its bio, then getting back text
rather than a badge. It also checks /api/v1/me exposes `isAdmin` and never
`role`, and that the display name "FayTarra Admin" is reserved: an ordinary
account is refused it in every casing, spacing, punctuation and lookalike
variation tried, an administrator may use it and keeps the badge with it, and
an ordinary name that merely mentions FayTarra still saves.

**Counting badges is scoped.** A profile can legitimately show one lower down,
on a Top 3 card naming an admin the person follows, so checks about whose NAME
is badged look inside the `h1` rather than counting the page.

### 3b. The admin's second step — `admin-step-up.mjs`

An administrator signs in with a password like anybody else, then has to type a
code emailed to the admin address before /admin opens. The code is
Supabase's — `signInWithOtp` issues it, `verifyOtp` checks it — so what these
checks cover is what FayTarra decides: that the dashboard stays shut until the
code is entered, and that a wrong, stale, reused or superseded code does not
open it.

```bash
STUB_PORT=54321 STUB_RESEND_COOLDOWN_MS=500 node scripts/e2e/gotrue-stub.mjs &
ADMIN_EMAILS=admin@faytarra.com ADMIN_CODE_COOLDOWN_SECONDS=3 \
  ADMIN_SESSION_SECRET=test-secret npm start &
node scripts/e2e/admin-step-up.mjs
```

The stub issues real codes — eight digits, as the project does — and writes
them to the outbox, which
stands in for the inbox; `POST /auth/v1/__expire-otp` ages the outstanding one
so expiry is deterministic rather than a race against a short lifetime.

Covers: login emails a code and lands on the verification screen; the code
appears nowhere on the page, in its source, or in the URL, and the address is
masked; /admin and every deep tab stay shut until the code is entered; a wrong
code is refused and counts down the attempts; the right one opens the
dashboard; a used, superseded or expired code does not; a run of wrong codes is
cut off; rapid requests do not send a code each; a normal account gets no code,
cannot open the verification screen, and cannot open /admin even holding the
admin's proof cookie; and signing out drops the proof so the code is asked for
again.

**A note on detecting the dashboard.** These harnesses look for the tab links
only the dashboard renders, never for the words "admin dashboard" — the
verification screen's own copy contains that phrase, so a text match passes on
the wrong page. `admin-access.mjs` was written that way at first and passed
while proving nothing.

### 3a. Who may open /admin — `admin-access.mjs`

The route guard, asked for directly rather than looked for in the navigation —
hiding a link is not a lock, so every check types the URL.

```bash
ADMIN_EMAILS=admin@faytarra.com npm start &
node scripts/e2e/admin-access.mjs
```

Signed out lands on /login with `next=/admin`; a normal account is turned away
from /admin and from every deep tab, with none of the dashboard leaking into
the response and no Admin link offered; the admin account gets through. It also
checks that nothing in settings lets somebody set their own role, and that
/api/v1/me never exposes a role field to anybody — admin included.

`ADMIN_EMAILS` is how the role is applied on sign-in locally; in production
migration 0008 sets the same column.

### 3d. The automatic ten-report review — `auto-review-flow.mjs`

Ten different accounts reporting the same post hide it while somebody looks —
for at most 24 hours, and never as a verdict.

```bash
ADMIN_EMAILS=admin@faytarra.com ADMIN_SESSION_SECRET=test-secret \
  FAY_REVIEW_WINDOW_MINUTES=2 npm start &
FAY_REVIEW_WINDOW_MINUTES=2 node scripts/e2e/auto-review-flow.mjs
```

`FAY_REVIEW_WINDOW_MINUTES` shortens the window so the expiry can be watched
happening instead of waited out for a day. It may only ever **shorten** it:
`clampWindow` in `src/lib/auto-review-rules.ts` caps it at the documented 24
hours, and the unit tests in `auto-review-rules.test.ts` cover the default and
the clamp. Pass the same value to the app and to the harness — the harness uses
it to know what wording to expect and how long to wait, and skips the expiry
section (saying so) if the window is longer than five minutes.

Two minutes, not one: filing ten reports through the dialog takes most of a
minute, and a one-minute window can lapse before the check that the post is
*gone* has run — which reads as a product failure and is not one.

Twelve accounts get created, so give it a few minutes.

Covers, in order of how badly it would matter if it were wrong:

- **One account is not ten.** Twelve reports from one person is one report row
  and no hide; nine different accounts is no hide; the tenth hides it.
- **Hidden means hidden.** Gone from the feeds, from Discover, from search,
  from the author's public profile as others see it, from `/post/<id>` and from
  `/api/v1/posts/<id>` — the author and an administrator still see it, because
  the author was told it exists and an admin cannot review what they cannot see.
- **Only an administrator can act.** `/admin` and its tabs are asked for
  directly, not looked for in the navigation; no restore, remove, hold or clear
  control is served to anybody else; the author cannot un-hide their own post;
  every write method on the post API is refused, so there is no count to forge.
- **Nothing is deleted.** Clearing the threshold leaves all ten report rows with
  their reasons and reporters, marked `cleared_at`, and leaves the automatic hide
  in `moderation_events`. Ten *fresh* reports hide it again, which is the proof
  that clearing reset the count rather than switched it off.
- **It is temporary.** The window runs out with no sweep, no cron and no admin,
  and the post is in a feed again. Looking at the queue afterwards records it as
  an *expiry* with no actor, not as a decision.
- **Nobody learns who reported them.** No reporter handle or id appears in the
  admin queue's text or its markup, or in either notification the author gets —
  while what reporters wrote is still shown to the admin.
- **A removal is not a ban.** After Remove permanently the author's status is
  still `active`, and they get a notification saying it was removed.
- **Hold** stops the clock without expiring, and the post stays hidden.
- **A moderator can see there is something waiting** — the overview counts it
  and the Reports tab carries its own badge, separate from the report count,
  because a hide with a clock on it is more urgent than a queued report.

The author's messages are **notifications**, not direct messages: the harness
checks no `messages` row was created, because the mutual-follow rule that
governs DMs is not being bent so that FayTarra can talk to somebody.

**Videos need nothing of their own.** A video on FayTarra *is* a post, and the
videos feed is `visiblePosts` filtered to posts with video media, so it is the
same code path. The only thing the media changes is the noun in the author's
notification, hence text fixtures here rather than a recorded clip.

### 4c. Recording on a phone — `mobile-record-flow.mjs`

The camera flow at phone size, from the + in the bottom navigation to the video
being in somebody else's feed. Chromium's fake camera and microphone stand in for
the lens, so getUserMedia, the permission prompt, MediaRecorder, the audio track,
the upload and the post are all real code paths.

```bash
node scripts/e2e/mobile-record-flow.mjs
```

Runs at iPhone-13 viewport on a Chromium engine (the descriptor's WebKit user
agent is dropped — a WebKit UA on a Chromium engine is a lie the app might
behave differently for, and what is being tested here is the viewport and touch
input).

**The flow is three stages**, and the suite walks them in order:

```
camera  →  record  →  Next  →  EDIT  →  Next  →  POST
```

The editing stage is a screen of its own between the camera and the caption. Its
four tools are Trim, Sound, Text and Cover, and the suite checks that none of the
POSTING decisions — caption, category, tags, content warning — is reachable from
it. Editing should feel like editing.

**What each tool costs, because two of them were designed around it.** Trim
changes the bytes, so it goes through the existing real-time render pass; the
suite records a 6-second take, trims it to 3, and reads the finished post's own
duration back from `/api/v1/posts/<id>` — asked of the app, not of a file, so the
same check works on the local driver and against the Supabase stubs. Sound and
Text do NOT change the bytes: they are stored on the post and applied by the
player, because `needsRender` returning false for an untouched recording is the
only thing stopping a two-minute take from costing a two-minute re-encode, and
burning either one in would flip that for every video carrying them. The suite
asserts both halves — the render pass runs for the trim and never runs for the
untouched take.

Covers, in the order somebody walks it:

- **Getting there.** The **+ in the bottom navigation is the camera**. It is
  labelled "Record a video", it links straight to `/create/video`, and the
  viewfinder is what opens — there is no Create page in between and no Post/Video
  toggle to choose from, because tapping + on a phone is already a decision to
  film something. (The general four-way chooser lives on Home and the profile
  instead, and is covered further down — the point of the two doors is that this
  one has nothing in it.) The suite asserts all of that, and that the Create page was
  demoted rather than deleted: `/create` still answers, still carries the photo
  form, and no longer has a `role="tab"` anywhere — checked over `fetch` so the
  camera is not torn down to find out. It also offers the camera back, through a
  `data-to-camera` link, for somebody who landed there wanting to film something.
  Uploading stays reachable in both directions: a camera-roll button on the
  camera, and the file chooser behind the X.
- **The camera screen.** The preview measured to fill the whole viewport, with
  `object-fit: cover` and its top edge at 0 — a letterboxed preview between two
  solid bars is the thing that makes a web camera feel like a web page. The
  2-minute budget, front/rear switching that keeps the camera open, flash shown
  only where the camera reports a torch, every control at least 44px, and the
  close and record buttons clear of the top and bottom edges the notch and home
  indicator occupy. Also the **three duration caps** — 15s, 60s and 2 minutes —
  all three offered and labelled, the full two minutes chosen to begin with (so
  nothing anybody could film before is out of reach), each one a tap target, the
  chooser gone while filming, and picking one moving the budget the clock and the
  shutter's ring are both measured against: choosing 15s makes the clock read 0:15
  and going back makes it read 2:00 again. The budget is the cap or what is left of
  the two minutes, whichever is smaller, so a cap never promises more than it can
  give. And the **sound control**: recording with the microphone off is a real
  `getUserMedia` with no audio track rather than a muted one, so the suite reads
  the track count off the live stream and not the button's state. It is not the
  "Add sound" of a music-library app — FayTarra has no track catalogue, and a
  button that looked like one and did nothing would be worse than not having it.
- **Recording.** That nothing claims to be recording before it is, that the REC
  indicator then appears and says so in words, and that the shutter's ring is
  partly filled — read off the SVG arc's `stroke-dashoffset`, so it is the real
  progress and not a class name.
- **The review.** Full screen, `object-fit: contain` (nothing about the take may
  be cropped while it is being judged), play and pause, a scrubber that spans the
  whole recording and moves the video when dragged, a sound control that really
  mutes the element, the camera released while it plays, and **Cover** going to
  the editing stage already opened on the cover tool.
- **The editing stage.** No posting fields present; the video measured at 38% or
  more of the screen and uncropped; the four tools in order and each at least
  44px; a thumb-sized timeline; a new take landing on Trim; the end handle
  shortening what is kept and the timeline following it; Reset restoring the whole
  take; text appearing over the video as it is typed and moving up the frame;
  the clip's own Mute silencing the preview (and, after posting, the file itself,
  decoded to RMS 0); Next rendering over the editor before the posting screen, and
  Post not rendering a second time; the cover tool being the same `CoverPicker` the
  posting screen uses; and Retake dropping the take it goes back past rather than
  adding a second clip.
- **The posting stage.** That it says so, offers a way back to editing, shows the
  text on the final preview, and has a Post button at least 52px tall that is on
  screen without scrolling for it.
- **The posting screen.** That a phone opens on the video, a caption, a cover, a
  content warning and Post — with the description, category and tags folded away
  behind More options and **provably still there** when it is opened.
- **The post.** The upload route the server chose, the video reaching the Videos
  feed and the normal feed **as seen by a second account**, and the content
  warning in front of it.
- **The profile shelves.** Posts, Videos, Text and About, in that order — Posts
  first because that is the shelf a profile opens on — each a tap target and the
  row fitting the phone. The video that was just recorded is on **Videos**, with
  "upload a video you already have" beside it going to `/create/video?upload=1` —
  the chooser, not the camera. **Text** carries the writing form that used to be a
  tab on the Create page, and a post written there lands on that shelf and
  provably not on Videos. **Posts** points at `/create` for a photo post and does
  not list the video. Nothing was migrated to make this work: each shelf is the
  same list filtered by what its posts carry, so an old post lands on the right
  one by itself.
- **The general Create post path**, which is the other door and deliberately not
  the `+`. Home and your own profile each carry a `data-create-post` trigger whose
  sheet offers four kinds, and the suite checks all four are there, in order, each
  at least 44px, with the sheet fitting the phone — and, the part that matters,
  that every one of them points at a route that already exists:

  ```
  photo         /create?kind=photo
  text          /create?kind=text
  upload-video  /create/video?upload=1
  record-video  /create/video
  ```

  Then it follows two of them: **Record video** must land on the same
  `/create/video` the `+` lands on and show the same full-screen viewfinder — if
  it went anywhere else there would be two cameras — and **Upload video** must
  land on the chooser with the camera off. **Photo** and **Text** are one composer
  leading with different halves of itself, so the suite compares the positions of
  the picker and the caption and checks that neither kind has lost the other half.
  It finishes by writing a post through that path and finding it on the Text
  shelf, because a chooser nothing can be posted from is not worth offering.
- **Desktop.** The file picker still offered and still first at desktop width,
  reached through `/create/video?upload=1`.

**Two of these checks are worth knowing about.**

The first is `an untouched recording was NOT re-encoded in the browser`. The
render pass announces itself as "Preparing your video…", and for a recording
nobody edited it must never run — re-encoding costs a real-time pass, two more
minutes on a two-minute video, to arrive back at bytes the upload routes already
accept. The check watches for that label throughout the post.

The second is that **both feeds are checked from somebody else's account**.
Neither feed recommends you your own posts — `videoFeed` filters on
`post.author_id !== viewerId` deliberately — so looking as the author is a
question with no right answer, and a check that can only fail is not a check.

**An imported video goes through the editing stage too**, which
`video-upload-flow.mjs` had to be told about — trimming, a cover, sound and text
are no less useful for a file than for a recording, so on a phone a chosen file
lands in the editor and reaching the caption means tapping Next. That suite has a
`reachPostingScreen` helper which taps it when the editor is showing and does
nothing on a desktop, where there is no such stage.

**The camera opens itself at phone width**, which is why `/create/video` has a
second door. A bare `/create/video` opens the viewfinder on a phone; `?upload=1`
lands on the chooser with the camera off, which is what the profile's "upload a
video you already have" wants and what every suite handing over a file from disk
wants. `video-flow.mjs`, `video-upload-flow.mjs`, `videos-flow.mjs` and
`video-cover-flow.mjs` all go through that door. The phone condition is narrow AND
coarse — `(max-width: 639px) and (pointer: coarse)`, evaluated once on mount — so
a small desktop window is not a phone and desktop is untouched.

**Why the shelf tabs are plain anchors.** They used to be `<Link>`s, and tapping
one did nothing perhaps a third of the time. The shelf lives in a search param on
a `force-dynamic` page, and a client-side navigation that only changes a search
param was intermittently applied as no change at all: the click fired, the RSC
request was answered 200, and the URL never moved. Measured by clicking all four
shelves twice from a fresh load each time — three of eight stuck. `prefetch={false}`
took it to one in eight; plain anchors took it to zero, because a full navigation
cannot be swallowed. Switching shelf is a page-level view switch rather than an
in-page interaction, so the cost is a reload the server was doing all of anyway.

The same measurement on **Home's feed tabs** found one tap in six doing nothing,
so those are plain anchors now too — it was the same bug on the same pattern, and
it predates the Create post work rather than coming from it.

**Why the profile header is `relative z-10`.** `.card` carries `backdrop-blur-xl`,
and a backdrop-filter creates a stacking context — so the ••• menu's `z-40`
dropdown cannot rise above anything OUTSIDE that header, and the shelf tab bar
comes later in the document. The tab bar painted over the open menu, and once
Posts moved to the front of the bar the Videos count badge landed on **Block** and
made that button unclickable. Raising the header changes no layout, only paint
order. The suite clicks Block on somebody else's profile rather than hit-testing
it, because on a menu the click IS the bug; `videos-flow.mjs` blocks and unblocks
an account too, which is how this was found.

**A suite that crashes prints no `FAIL` line.** This one died inside
`locator.click`, so grepping its output for `^FAIL` said zero failures and
grepping for `ALL CHECKS PASSED` said nothing at all — an empty result that is
easy to read as success. Check the exit code, or count `^PASS` against the
expected total; every suite here exits non-zero when it has not passed.

The suite's `openShelf` helper waits for the tab to claim `aria-current` rather
than for `networkidle`, which is waiting for the render rather than the network.
That mattered while these were soft navigations and is still the honest thing to
wait for.

**On TUS.** Against the local driver `/api/upload/sign` answers `post`, so the
resumable branch does not run and the suite says so rather than claiming
otherwise. To exercise it, run the same suite through the Supabase stubs
(section 15) — `sign` then answers `resumable` and the checks assert the TUS
endpoint was used:

```bash
STUB_PORT=54321 node scripts/e2e/gotrue-stub.mjs &
STORAGE_PORT=54500 node scripts/e2e/storage-stub.mjs &
PORT=55300 GOTRUE_PORT=54321 STORAGE_PORT=54500 node scripts/e2e/postgrest-stub.mjs &
SUPABASE_URL=http://127.0.0.1:55300 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55300 \
  SUPABASE_ANON_KEY=stub SUPABASE_SERVICE_ROLE_KEY=stub-secret npm start &
node scripts/e2e/mobile-record-flow.mjs
```

**State matters for the video suites.** `videos-flow.mjs` asserts an exact number
of slides, so reseed (`npm run reset`) before it — video posts left behind by
another suite make it fail on a count, not on a fault.

### 4d. Several clips, one video — `multi-clip-flow.mjs`

Record 3s, stop, record 4s, stop, record 5s, tap **Next**, and the editor must
treat the three as ONE project: all three arrive, clip 1 plays and clip 2 takes
over by itself, each clip trims on its own while the others survive, and the
posted file is all three trimmed clips in order at 1080x1920.

The camera keeps itself open between segments, so stopping one is not a decision
to stop filming and **Next** (`data-camera-next`) is the only way out. The suite
asserts that too — a first segment that dropped somebody into the editor would
make a second one impossible.

```bash
OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
  node scripts/e2e/multi-clip-flow.mjs
```

**The editor as a whole.** The video is measured under every tool and must be
the same height in each, and over half the screen — it used to drop from 358px
to 227px on a 390x664 phone the moment Sound opened. The top strip is the whole
project with the selected clip outlined, zooming into one clip only for Trim.
Each clip's level is read off the PREVIEW (`data-clip-volume` on the slot on
screen), including a slider moved while it plays, and the suite asserts it goes
through a Web Audio gain node (`data-clip-audio="gain"`), because
`HTMLMediaElement.volume` is read-only on iOS Safari. Mute and unmute must bring
a 50% clip back to 50%. Crop and Turn are read off the preview too: a square crop
of a 9:16 clip is magnified ~1.78x, as the render will. Next renders over the
editor; Cancel lands back with every edit; the posting screen previews the
rendered file; its Edit chip reopens this editor with every clip; an unchanged
project is not rendered twice, and Post only uploads.

**What was wrong, and where.** Not in the camera and not in the backend. The
camera accumulates segments correctly — `addSource` appends with a functional
`setClips`, so takes cannot race each other away — and `renderClips` has always
walked `clips` in order, seeking to each one's `trimStart` and playing to its
`trimEnd`, so the FILE that got posted was always the whole project. The handoff
into the editor was the problem, two props wide:

```
clip={clips[0]}                                   // one clip, not the array
src={previewUrl ?? clips[0].src}                  // and previewUrl is...
previewUrl = finished?.previewUrl ?? (clips.length === 1 ? clips[0].src : null)
```

With two or more clips and no render yet that `previewUrl` is `null`, so the
editor fell back to `clips[0].src` and `onTrim` only ever patched `clips[0]`. A
three-clip project played take one on a loop, offered one set of trim handles, and
said so in its own panel — "trimming a single clip is on the desktop editor".
The editor takes `clips={clips}` now and trims by clip id.

**Why not just render first and preview that.** The render pass is real time. A
90-second project would cost 90 seconds of waiting before the first frame, and
again after every trim. So the clips are played in sequence instead, from their
own object URLs, and `lib/video/playlist.ts` does the arithmetic between PROJECT
time (how far into the finished video) and SOURCE time (where that is inside one
clip's file). That module is unit-tested on its own — the join belonging to the
clip that is starting rather than the one that ended is what makes playback
advance instead of stalling on a frame.

**Two video elements, taking turns.** One plays while the other holds the next
clip, already seeked to its first kept frame; at the join they swap and the
waiting one is told to play. One element re-pointing its `src` would show black
for as long as the decode took, which is the gap this exists to avoid. The suite
reads `data-clip-slot` to prove the handover is a real swap to a different file
rather than the same clip replayed, and that it happens near the join:

```
PASS  the second clip takes over on its own  — slot 0 -> 1
PASS  and it is a different file, not the same one replayed  — b3eb9f86 -> b3700d5e
PASS  the handover happens near the join rather than late  — crossed at 4.05s
```

**The output frame.** A project that starts upright renders to **1080x1920**, and
the suite reads the posted media's own width and height back to prove it. This
used to scale the LONG edge to 1080, so a 1080x1920 recording came out 608x1080 —
a vertical post rendered at little more than half the width it was filmed at.
Clips FILL that frame: a 9:16 recording fills it exactly, and anything wider is
centre-cropped rather than letterboxed, because bars baked down a vertical post
look like a mistake. A project that starts LANDSCAPE keeps its own shape and
letterboxes into it, because somebody uploading a 16:9 video from a desktop did
not ask for two thirds of its width to be thrown away. Either way one scale is
applied to both axes, which is what "never stretched" means. See `outputFrame`.

**The editor's shape, and why the black band was there.** The picture used to be
laid across the whole screen with `object-contain`. A phone screen is TALLER than
9:16 — 390x844 is 0.46 against 0.5625 — so a vertical recording is wider than the
screen it was being fitted into: `contain` matched its width and left about 150px
of black split above and below, while the render filled 1080x1920 with `cover`. The
preview was a preview of a different video.

The fix is settled by arithmetic rather than taste. A full-width 9:16 frame on a
390px phone wants to be **693px tall against a 664px viewport**, so a picture that
shares the height with a toolbar cannot be 9:16: putting it in the 390x415 space
above one and covering threw away 40% of the frame, and fitting brought the bands
straight back. So the picture is the WHOLE screen, met with `outputFrame`'s own
fit, and the controls float over its lower part on a scrim. The suite measures all
of it: the video at `390x664` in a `390x664` viewport, **4% of the frame's height
lost to the crop**, `objectFit: cover`, and the free area above the controls
reaching `0px`.

**The editor is five bands, and the video is one of them.** Top bar, the open
clip as a filmstrip of its own frames, the video, the tools, the clips. What this
replaced put the video full-bleed behind everything and floated the controls over
its lower third — the largest possible picture, permanently half-covered by the
thing editing it. Laying the bands out costs width, because a 9:16 box in the
space left over is about 200px wide on a 390x664 screen, and buys a picture
nothing is drawn on. The suite measures the band order, that they all fit, that
the video gets the largest one, and that it is a true 9:16 box met with `cover` —
the same rule `renderClips` uses, so 0% of the frame is lost to the crop and what
is on screen is the shape that gets posted.

**A recording is posted at 1080x1920, whatever the sensor gave.** `recordedFile`
wraps a recording as a File precisely so `needsRender` lets an untouched clip skip
the render pass — and skipping it posted the camera's own dimensions as the
finished video. An iPhone hands back **1920x1080** and Chromium's fake device
**1216x2160**, so the viewfinder's full-screen 9:16 crop was not what got posted,
and no CSS container downstream can turn a landscape file into a portrait one.
Clips now carry `fromCamera`, which makes `outputFrame` return the vertical frame
for them and `needsRender` true unless the recording already is 1080x1920. The
saving is still taken where it can be — an upload from the camera roll keeps its
own shape, and a camera that really does give 1080x1920 skips the pass — so it is
only paid when the frame would otherwise be wrong. mobile-record-flow asserts the
posted media's own width and height, which is the check that was missing: the
three-clip suite had always covered the rendered path, and the single untouched
recording was the one nothing measured.

**The clips are their own frames.** A row of numbered grey boxes is a form; a row
of the actual frames is an editor, and it is how somebody picks the clip they mean
— by recognising it, not by remembering that the cat one was third. `useClipFrames`
reads six frames across each clip's WHOLE source, keyed on the source rather than
on the trim so that dragging a handle never invalidates them, and the one-frame
thumbnail for an unselected clip is just the middle frame of that same strip, so a
clip is read once rather than twice. The suite asserts every clip in the strip
paints a frame (`3 of 3`) and that the open one is a filmstrip (`6 frames`).

Also covered: the controls sitting in the lower part rather than pushing the video
into a box, and the open tool's sheet being a short strip BELOW the video rather
than the floating panel that used to take over the middle of the screen; the
selected clip opening out on the timeline with a draggable grip at each end while
the other clips stay beside it (`7.6s → 6.9s` from one drag, with nothing opened
over the video to do it); per-clip selection and trimming, with the whole project
getting shorter each time (measured 12.1s → 10.1s → 8.6s → 7.6s); the clock over
the video rather than buried in the controls; the **+** on the end of the timeline
opening the camera and the new take JOINING the project (`3 → 4 clips`) rather
than replacing it; **Delete** taking the selected clip back out again
(`4 → 3 clips`, `9.0s → 6.9s`) without dropping out of the editor; **Resize**
offering the desktop editor's own five shapes and really cropping the clip; text
appearing over the video as it is typed, staying clear of the controls, and being
tappable on the video itself to reopen that line; a true 9:16 preview on the
posting screen; and the posted file's own duration against the kept clips, read
live at the moment **Next** is tapped rather than from a number captured before
the last cut. Then the same editor on a smaller Android viewport — one clip still
gets a timeline, because that is where its trim handles are, and a second clip
makes the two-clip project the three-clip run never passes through — and Retake on
the only clip going back to the camera rather than leaving an editor with nothing
in it.

**The posted duration: two separate bugs, and what is left.**

*The server was mis-reading the file.* `fragmentedDuration` measured a fragmented
MP4 to the START of its last fragment, leaning on the tolerance in limits.ts to
cover that fragment's own length — which assumes fragments are about a second,
true when `recorder.start(1000)` is honoured and the machine keeps up. Under load
it is not: a real 6.57s render came out as three fragments, the last starting at
2.787s and carrying the remaining 3.8s, and the file was recorded as **2.787s**.
More than half the length gone — and the shorter the number, the more of the
length limit a long upload slips past. It now sums the samples the last fragment
actually holds, from `trun`, falling back to `tfhd`'s default and then `trex`'s.
Checked against four real renders, where the server's answer now matches the
browser's own to the millisecond: 8.224, 8.464, 6.145, 6.567.

*The render's length was whatever wall clock it happened to take.* Both the frame
cadence and the recording ran off a wall-clock `setInterval`, so a machine that
could not keep up changed the length AND put the pictures out of step with it.
Frames are now paced on the SOURCE — `round(progress * OUTPUT_FPS)` frames by the
time the source has played `progress` seconds — so the video cannot play fast or
slow; and each clip gets a recording window of exactly its kept length, with the
recorder held across the dead time spent fetching and seeking the next clip.

*What is left is MediaRecorder's.* It records in real time, so when the main
thread blocks the recorder keeps running and no timer can shut the window on the
beat. The same fixed 6.90s project, measured end to end — before: 49%, 51%, 73%,
84%, 88%, 124%, 134%. After: 101%, 101%, 113%, 85%. The median is 101% and the
tail is roughly ±15%, which is what the suite's band allows.

Three cleverer designs were tried and discarded, each documented at `playInto`:
pausing on a stall detector (thrashed the recorder thirty times a second and
dragged a 0.3s clip out to 1.8s), steering a control loop on accumulated recorded
time (could only shed time, so a clip ending mid-hold stayed short — 76%), and
topping that shortfall back up (overcorrected to 117%, because the pause latency
it compensated for is exactly what it cannot measure).

Closing the tail means not recording in real time at all: encoding frames with
explicit timestamps through WebCodecs (`VideoEncoder`/`AudioEncoder` plus a muxer
— `mp4-muxer` is on the registry) makes duration exact by construction and wholly
independent of load. That is a new dependency and a second encode path, so it has
not been done here.

**The tappable part of the video is a flex sibling, not a percentage.** A
tap-to-play region of `inset-0` put its own centre underneath the editing panel,
so tapping the middle of the screen hit a trim label — measured with the panel's
top edge 230px down a 664px screen. It is now the `flex-1` space between the top
bar and the controls, which is right at any screen size, and the suite asserts
that region ends exactly where the controls begin.

**Text is drawn inside that free zone** in the editor, which makes the zone the
safe area structurally rather than by guessing how tall whichever panel is open
happens to be. The trade-off, stated in the component too: a bottom-anchored line
sits a little higher in the editor than in the finished video, where it is drawn
over the whole frame. The posting screen and the post itself both use the full-frame
variant, so the faithful preview is the last thing seen before posting.

### 4e. The selected clip is the clip on screen — `editor-clip-sync-flow.mjs`

Found on an iPhone: Clip 3 highlighted, the Trim panel saying "Clip 3 of 3", and
the preview showing Clip 1 — then **Next** failing with "The browser would not
play this clip back." After every step the suite compares what the tools act on
(`data-editor-selected-clip`) with the clip in the visible player slot
(`data-clip-id`), and that each id is always the same FILE, so a slot labelled
one clip while playing another is caught too. It picks Clip 1/2/3 forwards,
backwards and in rapid taps; trims each clip; changes levels, mutes and turns;
undoes and redoes; plays the project through (1 -> 2 -> 3 for its trimmed length,
then back to Clip 1 with Clip 1 selected); deletes a clip and adds one; and taps
**Next**.

It runs under the iPhone's playback rule: an element may start with sound only
inside a tap, or once it has been started inside one. Chromium's own
`--autoplay-policy=user-gesture-required` is looser and did not reproduce the
error, so an init script applies the rule per element, as iOS does
(`IOS_PLAY_RULE=0` turns it off). Every other video suite runs with
`no-user-gesture-required`, which is why none of them caught it.

```bash
OUTBOX=/tmp/fay-outbox.jsonl CHROMIUM_PATH=/opt/pw-browsers/chromium \
  node scripts/e2e/editor-clip-sync-flow.mjs
```

### 4a. Video covers — `video-cover-flow.mjs`

The picture that stands in for a video before anybody plays it: a frame picked
off the scrubber, an image the creator supplied, or neither — in which case a
frame is taken anyway.

```bash
node scripts/e2e/video-cover-flow.mjs
```

Records its own short fixture in the browser, so there is nothing to build
first. The fixture changes colour every second, which is what makes "a
different frame" something a test can actually see.

Covers: publishing with nothing chosen still getting a cover; the scrubber
selecting a different frame; a supplied image winning over the frame and
falling back when removed; the cover being stored as its own file and never
the video; the video still playing from its original URL; the cover appearing
on Home, the profile, Search, Recommended, Discover and the Videos feed; a
second account being offered no way to change it; and — the one that matters
for orphans — that choosing, replacing and removing covers uploads NOTHING
until the post is published, so exactly two files are stored per post.

Two notes on surfaces. Recommended, Discover and the Videos feed deliberately
leave your OWN posts out, so those are checked from a second account; and
Discover ranks by community rating, so the check is scoped to the post's
category rather than racing hundreds of already-rated seeded posts.

### 5a. Opening a tab clears its badge — `mark-read-on-open.mjs`

Notifications and Messages both mark themselves read because the page was
OPENED, with no button to press. These are the checks for the three ways that
goes wrong: a badge that will not clear without a reload, a read state that
does not survive a refresh (marked only in the browser), and something that
arrives afterwards failing to count as new again.

```bash
node scripts/e2e/mark-read-on-open.mjs
```

Two real accounts at desktop and phone width. Every count is confirmed twice —
once as the number painted in the navigation, and once from `/api/unread`, so
a badge that merely looks right cannot pass. It also checks that a third
account's unread state is untouched, and that nobody is told their own sent
messages are unread.

### 6a. The confirmation loop — `verification-login.mjs`

The regression guard for "I confirmed my email and it still asks me to confirm
it". Signs up, confirms **from a browser that never saw the signup** (what a
phone does with a link mailed to it), then logs in and checks the account is
not sent back to the verification page — and that a refresh keeps the session.

```bash
AUTH_EMAIL_COOLDOWN_SECONDS=2 node scripts/e2e/verification-login.mjs
```

It also demonstrates the root cause directly: a `{{ .ConfirmationURL }}`-style
PKCE link opened in another browser cannot be exchanged, so the address stays
unconfirmed, while the token-hash link for the same account confirms fine from
that same browser. If anyone puts `{{ .ConfirmationURL }}` back into the
templates, that check is the alarm.

### 6. Verification and password recovery — `auth-email-flow.mjs`

The branded emails, "send verification email again", and the whole
forgot-password journey. The GoTrue stub behaves like GoTrue here: it refuses a
resend that comes too soon (429 `over_email_send_rate_limit`) and refuses one
for an address that is already confirmed, which is how the app's claim to have
sent an email gets checked against whether one was actually sent.

```bash
STUB_PORT=54321 STUB_RESEND_COOLDOWN_MS=2000 node scripts/e2e/gotrue-stub.mjs &
AUTH_EMAIL_COOLDOWN_SECONDS=5 npm start &
AUTH_EMAIL_COOLDOWN_SECONDS=5 node scripts/e2e/auth-email-flow.mjs
```

`AUTH_EMAIL_COOLDOWN_SECONDS` shortens the app's own per-address cooldown (30s
in production) so the run does not sit through it twice; both the app and the
harness need the same value.

Covers, at desktop and phone width: a verification email being generated with a
one-time code on the configured origin; resend producing a genuinely new email
and saying so; the countdown; the server refusing a resend submitted past the
disabled button, and saying why rather than claiming success; an already
confirmed address being told so instead of being mailed; the link confirming
the account and signing in; "Forgot password?" answering identically for an
address with and without an account; the reset page rejecting a short or
mismatched password; the show/hide toggle; the reset landing on the login page
with confirmation; the old password no longer working and the new one working;
and a used reset link refusing to be replayed. It also checks the built
templates in `supabase/templates/` for branding, Supabase's own variables, no
localhost, no scripts or remote images, and a plain-text alternative.

Where the emails themselves are configured — the dashboard templates, the
Site URL that keeps links off localhost, custom SMTP and the DNS records — is
`supabase/templates/README.md`.

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

The video EDITOR, in a real browser — the advanced half, behind "Add another
clip". For the ordinary one-video-off-a-phone path and how the bytes get to
Storage, see `video-upload-flow.mjs` below. It covers: uploading a file, recording clips
from the camera with a microphone, reordering, deleting, trimming, cropping,
rotating, muting, combining, choosing a thumbnail, captioning, posting, and
watching the result from a second account on desktop and at phone width. It
finishes by proving that text posts, photo posts, likes, comments, ratings and
Discover still work exactly as before.

Recording here goes through the review step — a take is watched back before it
is kept — so this suite keeps each one with "Film another", which is the
multi-clip path it is exercising. For the phone-first camera flow, see
`mobile-record-flow.mjs` above.

Its Discover check is filtered to the category the video was posted in, on
purpose: the unfiltered /discover is the top 30 of everything recent ranked by
likes, comments and views, so a minutes-old post with one comment sits around
90th of ~94 in the seeded dataset and cannot appear there however correct
everything else is. The unfiltered check was asserting the shape of the sample
data.

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

### 8. Posting a video the way a phone does — `video-upload-flow.mjs`

The transport, measured rather than watched. A video must go from the browser
straight to Supabase Storage, in chunks, and no part of it may ever be a
request body the app receives — which is exactly what was wrong when an
iPhone clip came back "Payload too large".

```bash
STUB_PORT=54321 node scripts/e2e/gotrue-stub.mjs &
STORAGE_PORT=54500 node scripts/e2e/storage-stub.mjs &
PORT=55300 GOTRUE_PORT=54321 STORAGE_PORT=54500 node scripts/e2e/postgrest-stub.mjs &

# built and started against that one origin, exactly as production is
BASE_URL=http://localhost:3100 STUB=http://127.0.0.1:55300 \
  node scripts/e2e/video-upload-flow.mjs
```

The checks that matter are arithmetic: how many bytes Storage received (asked
of Storage, because Chromium reports a streamed request body as zero), and the
largest body the app got, which has to stay metadata-sized. It also covers the
composer being plain — one video, no clips, no combining — a 9MB file that no
single serverless request could carry, refusals that happen before a byte
moves, cancelling mid-upload, two taps on Post making one post, and the
finished video appearing in the normal feed, the Videos feed, the profile and
search.

`EXPECT_INTERRUPTION=1`, with the storage stub started as
`STORAGE_FAIL_AT=7000000`, refuses one chunk in the middle of a 14MB upload.
The upload has to finish anyway, and the bytes sent have to stay well under
twice the file — that is the difference between resuming and starting again.

### 9. The production upload path — `storage-stub.mjs` + `storage-roundtrip.mts`

A deployment with Supabase does not send uploads through the app: a 250MB
request body is refused by every serverless host long before it arrives
(Vercel stops at 4.5MB). The server signs a URL, the browser PUTs the file
straight to Storage, and the server reads it back to check it. None of that
runs on the local driver, so without this the one path production actually
uses would be the one path never exercised.

`storage-stub.mjs` speaks Storage's HTTP protocol — signed upload URLs, the
resumable (TUS) endpoint a video actually arrives through, ranged reads, list,
move and delete — and the app's own module drives it through the real
`@supabase/storage-js` client. `STORAGE_LIMIT` makes it refuse an oversized
object with the same words Storage uses; `STORAGE_FAIL_AT` refuses one chunk
mid-upload.

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

### 10. Direct messages — `messaging-flow.mjs`

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

### 11. Getting to a profile — `social-navigation.mjs`

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

### 12. The Videos feed — `videos-flow.mjs`

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

### 13. Profile colours — `profile-colours-flow.mjs`

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

### 14. The Top 3 creators — `top-creators-flow.mjs`

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

### 15. Running against PostgREST — `postgrest-stub.mjs`

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

### 15b. Text posts on a database that is behind — `text-posts-schema-flow.mjs`

The regression guard for a Big Message composed as violet arriving in the feed
as a small white Short Message. That happened only on Supabase: a project that
had not run `0011` had no `text_kind` column, and the app dropped the kind and
colour and stored the words anyway. The local JSON driver stores whatever it is
handed, so no suite on it could have shown it.

This one runs the app on the Supabase driver against the PostgREST stub, and
moves the database underneath ONE running server with `POST /__missing`: no
text columns, then `0011` without `0012`, then both. At each step a post either
keeps exactly the shape its preview showed or is refused with the draft left in
the composer, and the stub's `/__dump` is read to prove nothing else was stored.
The last step checks that running the migration takes effect on the very next
post, with no restart in between.

`NEXT_PUBLIC_SUPABASE_URL` is baked in at build time and the server reads it
too, so this needs a build pointed at the stub:

```bash
STUB_PORT=54321 OUTBOX=/tmp/fay-outbox.jsonl node scripts/e2e/gotrue-stub.mjs &
PORT=55300 GOTRUE_PORT=54321 node scripts/e2e/postgrest-stub.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55300 NEXT_PUBLIC_SUPABASE_ANON_KEY=stub npm run build
PORT=3100 SUPABASE_URL=http://127.0.0.1:55300 SUPABASE_ANON_KEY=stub \
  SUPABASE_SERVICE_ROLE_KEY=stub-secret node .next/standalone/server.js &
BASE_URL=http://localhost:3100 STUB=http://127.0.0.1:55300 \
  node scripts/e2e/text-posts-schema-flow.mjs
```

The stub's `MISSING_COLUMNS` now applies to inserts as well as updates, and
`POST /__missing` with `{"columns": ["posts.text_style"]}` changes it while
running.

### 16. What each page costs — `perf-report.mjs` + `seed-perf.py`

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

`auth-flow`, `features-flow`, `video-flow`, `videos-flow`, `video-upload-flow`,
`video-cover-flow`, `mobile-record-flow`, `multi-clip-flow`, `editor-clip-sync-flow`,
`messaging-flow`,
`profile-colours-flow`, `top-creators-flow`, `auto-review-flow`, `admin-badge`
and `social-navigation` create their own accounts and want an EMPTY store
(`echo '{}' > .data/faytarra.json`). `signup-form-state`, `logout-flow` and
`social-flow` sign in as the seeded demo accounts and check against them —
`signup-form-state` takes `tommy` as its already-taken username — so those need
`npm run seed` first. Running them against the wrong one reports failures that
are not failures: `features-flow` against the seeded store fails three Discover
checks, because Discover is a ranked board and a brand-new post with no ratings
is not entitled to a place on it next to hundreds of seeded ones. That is the
ranking working.

**The admin suites need the admin's email in the environment**, and they do not
all use the same one: `admin-badge.mjs` signs its admin up as
`admin@faytarra.com` while the seeded store's admin is `admin@faytarra.app`.
`ADMIN_EMAILS` takes a list, so one server can satisfy both:

```bash
ADMIN_EMAILS=admin@faytarra.com,admin@faytarra.app \
  ADMIN_SESSION_SECRET=any-long-string npm start &
```

Without it every badge check fails at once, which looks like the badge being
broken and is only the account never having been made an admin.

### A note on running these back to back

`social-flow` and `features-flow` change the data they run against — follows,
ratings, usernames — so a second run on the same store starts from a different
place and will report failures that are not failures. Re-seed between runs, and
stop the previous server first: a server still holding the old store in memory
will flush it back over the file you just seeded.
