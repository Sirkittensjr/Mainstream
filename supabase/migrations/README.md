# Migrations — what each one does, and what it touches

Read this before running anything against a database with data in it.

**Start here:** run [`../inspect.sql`](../inspect.sql) in the Supabase SQL
editor, then [`../inspect-rows.sql`](../inspect-rows.sql) if the first says the
tables exist. Both are read only — catalogue queries and counts, nothing
created, changed or locked — and the `verdict` column tells you which of these
files you actually need. `inspect.sql` works even on a project where FayTarra
has never been installed.

## Which files to run

`inspect.sql` row 1 tells you which:

| Row 1 says | Run |
| --- | --- |
| `0 of 9` — EMPTY PROJECT | `../schema.sql` only. It creates everything, already including both migrations. |
| `9 of 9` — ALL PRESENT | `0001`, `0002`, `0003`, then `0005`, `0006`, `0007`, `0008` and `0009`. **Do not run `schema.sql`** — you do not need it, and there is no reason to run 350 lines over a live database to get a few changes. |
| anything between | Stop and ask. A half-installed schema needs looking at, not a migration. |

If the storage bucket row shows `none`, create it in the dashboard
(**Storage → New bucket**, name `faytarra-media`, **Public**) rather than with
SQL. Uploads need it; nothing else does.

### Order matters: schema before keys

Setting `SUPABASE_SERVICE_ROLE_KEY` switches the app off its local fallback and
onto Supabase. If the tables are not there yet, every page that reads data
returns 500 — measured: `/`, `/home` and `/discover` all fail while `/signup`
still answers, because signup reads nothing. So create the schema first, then
set the key. `/api/health` reports `reachable: false` with the driver's own
error if you get this the wrong way round.

---

## 0001_supabase_auth.sql

Moves identity to Supabase Auth. Safe to run twice.

| Step | Statement | What it touches | Risk |
| --- | --- | --- | --- |
| 0 | Counts profiles with no `auth.users` row and raises if any exist | Nothing — read only | **None.** This is the guard; see below |
| 1 | `add constraint users_id_fkey foreign key (id) references auth.users (id) on delete cascade` | Adds a constraint | None. Fails harmlessly if it cannot hold |
| 1 | `create unique index users_username_lower_idx on public.users (lower(username))` | Adds an index | Fails if you already have two usernames differing only in case. Check with the query below |
| 2 | `create or replace function public.handle_new_user()` + trigger on `auth.users` | Adds a function and trigger | None. Makes new signups create a profile automatically |
| 3 | `handle_user_email_change()` + trigger | Adds a function and trigger | None |
| 4 | `enable row level security` + two policies on `public.users` | Adds policies | None. Nothing is dropped except policies of the same name being replaced |
| 5 | `alter table public.users drop column if exists password_hash` | **Deletes a column and its data** | **Irreversible** — see below |

Case-clash check, before you run it:

```sql
select lower(username), count(*) from public.users
group by lower(username) having count(*) > 1;
```

### Step 5 is the only destructive statement

It drops `password_hash`. That is deliberate and it is the point of the
migration — FayTarra has no password code left, so the column can only hold
hashes nothing will ever read. But it cannot be undone, and a scrypt hash
cannot be handed to Supabase Auth, so **anyone who signed up under the old
system has to create their account again.**

It is the **last** statement in the file on purpose. Everything else has
already succeeded by the time it runs, so a failure anywhere leaves your
database exactly as it was.

### Profiles with no auth user

Step 0 refuses to continue if `public.users` holds rows whose `id` is not in
`auth.users`. That is the state of any database created before Supabase Auth:
profiles exist, and nobody has an auth account, because the old system stored
passwords itself.

Without that guard the migration dropped the password column and *then* failed
to add the foreign key — passwords gone, link missing, half applied. The guard
runs first and touches nothing.

See who they are:

```sql
select id, email, username, created_at
from public.users u
where not exists (select 1 from auth.users a where a.id = u.id)
order by created_at;
```

Then choose:

- **Nobody real signed up yet** (seeded or test rows) — delete them and run the
  migration. Cascades will take their posts, ratings and follows with them:
  ```sql
  delete from public.users u
  where not exists (select 1 from auth.users a where a.id = u.id);
  ```
- **Real people signed up** — do not delete them. Create an auth account for
  each, reusing the same `id` so their posts, followers and ratings stay
  attached, then have them use **Forgot password** to set a password. Their id
  must be preserved, so this is done through the Admin API rather than SQL —
  ask before doing it and it can be scripted against `admin.auth.admin
  .createUser({ id, email, email_confirm: true })`.

## 0002_mvp_hardening.sql

Closes a privilege-escalation hole. Safe to run twice. **Nothing in this file
is destructive** — no drops, no deletes, no data rewritten.

| Step | Statement | What it touches | Risk |
| --- | --- | --- | --- |
| 1 | `revoke all on public.users from anon, authenticated`, then `grant select (…13 columns)` and `grant update (5 columns)` | Permissions only | None to data. This is the security fix |
| 2 | `add column if not exists parent_id` on `comments` + index | Adds a nullable column | None. Existing comments get `null` |
| 3 | Eight `create index if not exists` | Adds indexes | None. Brief write locks while each builds |

## 0003_messages_and_username_changes.sql

Adds direct messages and lets people change their @username. Safe to run twice.
**Nothing in this file is destructive** — no drops, no deletes, no existing row
rewritten.

| Step | Statement | What it touches | Risk |
| --- | --- | --- | --- |
| 1 | `add column if not exists username_changed_at` on `users` | Adds a nullable column | None. Existing rows get `null`, meaning "never changed", so everyone may change once immediately |
| 2 | `create table if not exists public.messages` + four indexes + `enable row level security` | Adds a new table | None to existing data |
| 3 | `enforce_message_permitted()` + a `before insert` trigger on `messages` | Adds a function and trigger | None |

### Why the trigger, when the app already checks

A rule that lives only in application code is one forgotten call site away from
not existing, and hiding a button is not enforcement at all. The trigger runs
inside the insert, so **no** request can write a message between two people who
do not both follow each other — not the app, not a leaked key, not a direct SQL
session holding the service role.

It refuses with `not_mutual_follow`, or `blocked` when either person has
blocked the other. `scripts/e2e/dm-checks.sql` proves both, plus that a one-way
follow is not enough, that unfollowing stops new messages, and that neither API
role can read anybody's messages.

### What happens to history when somebody unfollows

Nothing is deleted. The conversation stops being writable and the app will not
open it, but silently destroying what two people said to each other because one
of them unfollowed would be its own kind of wrong. It stays private either way:
`messages` has RLS on with no policies, so the anon and authenticated roles
cannot read a single row.

### Why step 1 matters

Supabase grants `anon` and `authenticated` full table access by default and
relies on RLS. **RLS decides which rows are visible — it cannot stop a
permitted row from being read or written column by column.** With the
`people can edit their own profile` policy in place, that meant anybody signed
in could PATCH their own profile row through the REST API with the anon key —
which ships to every browser — and set `role = 'admin'`, clear a ban, or
restore a `trusted` flag a moderator had revoked. The same table-wide `SELECT`
handed out every mirrored email address.

A column-level `REVOKE` does not fix it: a table-level grant covers every
column and outranks it. So the table grant is removed and only the safe columns
are granted back — `SELECT` on everything except `email`, and `UPDATE` on the
five fields a person owns.

Run [`../../scripts/e2e/rls-checks.sql`](../../scripts/e2e/rls-checks.sql)
afterwards to prove it. Every line marked "must fail" is expected to print an
error; that is the check passing.

**If you add a column to `public.users` later, add it to that grant list**, or
it will be invisible to the API roles.

---

## 0004_video_uploads.sql

Makes room for video in the storage bucket.

**Touches:** one row in `storage.buckets` — `file_size_limit` and
`allowed_mime_types`. No table is created, altered or dropped, and no stored
object is created, moved or deleted. Safe to run twice.

**Why:** FayTarra videos are up to 250MB. A bucket with no `file_size_limit`
inherits the project's global upload limit, which is 50MB on a new project, so
a video upload would be refused by Storage before the app saw it.

**Before it will work:** the bucket cannot exceed the project's global limit,
and that one is not settable from SQL. Raise it in the dashboard first —
**Settings → Storage → "Upload file size limit"** → 250MB — then run this file.

It prints the bucket's current limits before and after, so you can see exactly
what changed. Nothing in the app depends on it apart from uploads bigger than
the global limit; posts, ratings, feeds and everything else are unaffected.

If `verdict` comes back `NOT APPLIED`, the bucket is not called
`faytarra-media` — check `SUPABASE_STORAGE_BUCKET` and use that name instead.

---

## 0005_profile_colours.sql

Lets people paint their own profile. Safe to run twice. **Nothing in this file
is destructive** — no drops, no deletes, no existing row rewritten.

| Step | Statement | What it touches | Risk |
| --- | --- | --- | --- |
| 1 | `add column if not exists profile_bg` and `profile_box` on `users` | Adds two nullable columns | None. Existing rows get `null`, which means the default look |
| 2 | `grant select (profile_bg, profile_box)` to both API roles and `grant update` to `authenticated` | Permissions only | None. Required because 0002 replaced the table grant with a column list |

**What is stored is a key, not a colour** — `'purple'`, `'yellow-bright'` and
so on, from the list in `src/lib/profile-theme.ts`. A key the app does not
recognise renders as the default, so the worst a value written straight through
the REST API can do is change how that person's own profile looks. Nothing from
this column reaches a stylesheet.

**Not running it is survivable.** The app catches the missing column, says so
once in the server log, and tells anybody who picks a colour that the feature
is not switched on. Display name, bio, avatar, location and interests keep
saving exactly as before, because the colours are written by their own UPDATE
rather than sharing one with the rest of the profile. `/api/health` names `0005`
under `schema.migrations` until it has been run.

---

## 0006_top_creators.sql

Adds the Top 3 favourite creators. Safe to run twice. **Nothing in this file is
destructive** — no drops, no deletes, no existing row rewritten.

| Step | Statement | What it touches | Risk |
| --- | --- | --- | --- |
| 1 | `add column if not exists top_creators text[]` on `users` | Adds one nullable column | None. Existing rows get `null`, which means the default |
| 2 | `grant select (top_creators)` to both API roles and `grant update` to `authenticated` | Permissions only | None. Required because 0002 replaced the table grant with a column list |

**The default needs no storage.** Until somebody picks for themselves, their
Top 3 is the first three accounts they followed, read from `follows` when the
profile renders. That is why a fourth follow never displaces anybody, and why
the list cannot drift out of step with who they actually follow.

**What it holds is account ids.** Names and pictures are looked up in `users`
at render time, so a Top 3 survives somebody changing their @handle, and there
is no second copy of anybody anywhere.

**The follow rule is enforced on the way in and again on the way out.** Saving
checks every id is somebody that person currently follows; rendering filters
the stored list to who they still follow. A row written straight through the
REST API naming a stranger therefore shows as an empty slot rather than a name.

**Not running it is survivable.** Every profile still shows its default Top 3 —
only changing it is unavailable, and the app says so rather than failing.
`/api/health` names `0006` under `schema.migrations` until it has been run.

---

## 0007_resumable_uploads.sql

Lets a video reach Supabase Storage at all, and adds the content warning
checkbox's column. Safe to run twice. **Nothing in this file is destructive** —
no drops, no deletes, no existing row rewritten, no stored object touched.

| Step | Statement | What it touches | Risk |
| --- | --- | --- | --- |
| 1 | `update storage.buckets set file_size_limit = 262144000` | One bucket setting | None. Raises the ceiling; never lowers it |
| 2 | Three policies on `storage.objects` for `pending/<uid>/` | Permissions only | None to data. This is what makes the upload possible |
| 3 | `add column if not exists content_warning` on `posts` | Adds one column with a default | None. Existing posts become `false`, which is what they have always meant |

**This is the fix for "Payload too large".** A video off a phone is tens or
hundreds of megabytes, so the browser uploads it straight to Storage in chunks
(the resumable/TUS endpoint) rather than through the app. Two things have to be
true for that to work, and neither is the app's to arrange:

1. **The size limits.** A bucket with no `file_size_limit` inherits the
   project's global upload limit — 50MB on a new project, which a 19-second
   iPhone clip clears easily. Storage answers `413 Payload too large` and the
   app repeats what it said. Step 1 raises the bucket's own ceiling to 250MB.
   **The project-wide limit is not settable from SQL**: raise it first in the
   dashboard under **Settings → Storage → "Upload file size limit"** → 250MB.
2. **The policies.** The resumable endpoint is authorised with the uploader's
   own access token, not the service role, so Storage's row level security
   decides. Step 2 lets a signed-in account write, read and finish objects
   under `pending/<their own id>/` — and nowhere else. Until they exist, every
   chunk is refused.

Nothing here lets anybody publish anything. An upload lands in `pending/`, and
only the server — with the service role, after checking the bytes, the type,
the size and the duration — moves it to `media/`, which is the only prefix a
post may reference.

**Not running it:** videos cannot be uploaded on a Supabase deployment, and the
content warning checkbox stores nothing (the app notices the missing column,
says so once in the log, and posts normally without it). `/api/health` names
`0007` under `schema.migrations` until the column exists; the storage side is
not visible there, so check it with the `verdict` this file prints.

---

## 0008_first_admin.sql

Promotes exactly one existing account — `admin@faytarra.com` — to
`role = 'admin'`. Nothing else. Safe to run twice.

| Step | Statement | What it touches | Risk |
| --- | --- | --- | --- |
| 1 | `update public.users set role = 'admin' where lower(email) = 'admin@faytarra.com'` | One column on one row | None to anything else. It does not touch the password, the session or the email confirmation |
| 2 | `select … from public.users where role = 'admin'` | Nothing — a read-back | None |

**Why this is SQL and not a button.** The admin role already existed: the
column is in `public.users`, `requireAdmin()` gates /admin and every admin
action against it, and the API roles are not granted `UPDATE` on `role`, so a
signed-in person cannot promote themselves through PostgREST. What did not exist
was a *first* admin, and the app only lets an admin make an admin — which is the
correct shape for it. Somebody has to be made one from outside, deliberately and
auditably.

**The account must already exist and be verified.** If there is no FayTarra
account for the address, this raises a warning and changes nothing rather than
inventing a user with no auth record behind it. Create it through /signup,
confirm the email, then run the file again. It never creates, demotes or grants
anybody else anything.

**Not running it:** nobody can open /admin at all, because nobody holds the
role. The rest of the site is unaffected.

`admin-checks.sql` in `scripts/e2e/` proves this file is re-runnable and that a
signed-in person holding the anon key cannot make themselves an admin, demote
the admin, promote anyone else, or read the admin's email.

---

## 0009_auto_review.sql

The automatic temporary review: when ten different accounts report the same
post, it is hidden while somebody looks at it. Three additive parts, safe to run
twice. **No table is dropped, no column rewritten, no existing post changed.**

| Step | Statement | What it touches | Risk |
| --- | --- | --- | --- |
| 1 | `delete from public.reports a using public.reports b where (a.created_at, a.id) > (b.created_at, b.id)` | Duplicate report rows | **The only delete in this file.** It folds repeat reports by the same account on the same target down to the oldest one, which is what has to be true before the unique index can exist. See below |
| 2 | `create unique index reports_one_per_reporter_idx on (reporter_id, target_type, target_id)` | An index | None to data |
| 3 | `add column if not exists cleared_at` on `reports`, plus a partial index | One nullable column | None. Existing reports stay `null`, which means "still counts" |
| 4 | Four columns on `posts`: `review_state`, `review_started_at`, `review_expires_at`, `review_reports` | Adds columns with safe defaults | None. Existing posts get `null` / `0`, which means "not under review" |
| 5 | `create table if not exists public.moderation_events` | A new table | None |
| 6 | `enable row level security` on it, and `revoke all` from `anon` and `authenticated` | Permissions only | None to data |

**About step 1.** It is a delete, so it is worth being clear about. The rows it
removes are the same account reporting the same thing more than once; the oldest
row survives with its reason and its note. Nothing a *different* account
reported is touched, and no report against a different target is touched. The
count that hides a post has to mean "ten people" rather than "one person
pressing a button ten times", and a rule that lives only in application code is
one forgotten call site away from not existing — so the database enforces it.
After this, a repeat report updates the existing row instead of adding one.

The comparison is on `(created_at, id)` rather than `created_at` alone because
two reports can share a timestamp — rows inserted by one statement all get the
same `now()`, and so does anything bulk-imported. Comparing the timestamp on its
own removes neither of a tied pair, and step 2 then fails on rows step 1 was
supposed to have folded. `(created_at, id)` is a total order, so exactly one row
of every group survives. (Measured: it does fail without the tie-break.)

**`review_state` is deliberately separate from `removed`.** Removed is a
decision; this is a pause. Keeping them apart is what stops a temporary hide
being read as a verdict later, by a person or by a query. `temporary_review`
expires at `review_expires_at`; `admin_hold` has no expiry, because an
administrator holding something is not undone by a clock.

**Nothing is granted to the API roles.** The app reads and writes all of this
with the service role, which bypasses RLS. The policies exist so that a leaked
anon key cannot read the moderation log — and "who reported this" least of all.

**Not running it:** the automatic review switches itself off and says so once in
the log. Reporting, the reports queue and every manual moderation action carry
on working exactly as before; nothing 500s and no post is hidden. `/api/health`
names `0009` under `schema.migrations` until the table exists.
