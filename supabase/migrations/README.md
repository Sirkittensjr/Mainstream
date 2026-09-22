# Migrations — what each one does, and what it touches

Read this before running anything against a database with data in it.

**Start here:** run [`../inspect.sql`](../inspect.sql) in the Supabase SQL
editor. It is read only — every statement is a `SELECT`, it creates nothing and
changes nothing — and its verdicts tell you which of these you actually need.

## Which files to run

| Your database | Run |
| --- | --- |
| No FayTarra tables (inspect section 1 errors or shows nothing) | `../schema.sql` only. It creates everything, already including both migrations. |
| Has FayTarra tables (inspect section 1 shows row counts) | `0001` then `0002`. **Do not run `schema.sql`** — you do not need it, and there is no reason to run 300 lines over a live database to get two changes. |

If inspect section 9 shows no `faytarra-media` bucket, create it in the
dashboard (**Storage → New bucket**, name `faytarra-media`, **Public**) rather
than with SQL. Uploads need it; nothing else does.

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
