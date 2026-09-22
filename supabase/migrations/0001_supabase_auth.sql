-- ---------------------------------------------------------------------------
-- Move authentication to Supabase Auth.
--
-- Run this once against an existing FayTarra database. Fresh installs get the
-- same result from supabase/schema.sql.
--
-- After this migration, `auth.users` is the source of truth for identity and
-- passwords. `public.users` is a PROFILE keyed by the auth user id — FayTarra
-- never sees or stores a password.
-- ---------------------------------------------------------------------------

-- 0. Refuse to start if this would half-apply -----------------------------
-- Step 1 links every profile to an auth user. On a database created before
-- Supabase Auth, profiles exist and `auth.users` is empty, so that link cannot
-- be made — and if the password column had already been dropped by then, the
-- migration would stop with the old hashes destroyed and the link still
-- missing. So this check runs FIRST and changes nothing, and the destructive
-- step is deliberately LAST: a failure anywhere leaves the database exactly as
-- it was.
do $$
declare
  orphans bigint;
begin
  select count(*) into orphans
  from public.users u
  where not exists (select 1 from auth.users a where a.id = u.id);

  if orphans > 0 then
    raise exception
      'Refusing to migrate: % profile row(s) in public.users have no matching '
      'auth.users account, so they cannot be linked to Supabase Auth. Nothing '
      'has been changed. These are accounts from before Supabase Auth. Decide '
      'what should happen to them first — see supabase/migrations/README.md, '
      '"Profiles with no auth user". Run this to see them: select id, email, '
      'username from public.users u where not exists (select 1 from auth.users '
      'a where a.id = u.id);', orphans;
  end if;
end $$;

-- 1. Profiles are owned by auth users -------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'users_id_fkey' and table_name = 'users'
  ) then
    alter table public.users
      add constraint users_id_fkey
      foreign key (id) references auth.users (id) on delete cascade;
  end if;
end $$;

-- Usernames are unique, case-insensitively. Without this, "Tommy" and "tommy"
-- would be two different people.
create unique index if not exists users_username_lower_idx
  on public.users (lower(username));

-- 2. A profile is created automatically for every new auth user ------------
-- Running inside the signup transaction means a duplicate username aborts the
-- whole signup rather than leaving an auth account with no profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_username text;
  desired_display text;
begin
  desired_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  desired_display := coalesce(new.raw_user_meta_data ->> 'display_name', desired_username);

  if desired_username = '' then
    raise exception 'username is required';
  end if;

  if exists (select 1 from public.users where lower(username) = desired_username) then
    raise exception 'username_taken' using errcode = 'unique_violation';
  end if;

  insert into public.users (
    id, email, username, display_name, bio, avatar_url, location,
    interests, role, status, status_reason, trusted, created_at, last_active_at
  )
  values (
    new.id,
    new.email,
    desired_username,
    desired_display,
    coalesce(new.raw_user_meta_data ->> 'bio', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'location', ''),
    coalesce(
      (select array_agg(value::text) from jsonb_array_elements_text(
        coalesce(new.raw_user_meta_data -> 'interests', '[]'::jsonb)) as value),
      '{}'
    ),
    case
      when new.email = any (string_to_array(current_setting('app.admin_emails', true), ','))
      then 'admin' else 'user'
    end,
    'active',
    null,
    true,
    now(),
    now()
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Keep the mirrored email in step with the auth record ------------------
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- 4. Row level security ----------------------------------------------------
-- The application reads and writes with the service role, which bypasses RLS,
-- because rules like blocking and rating integrity are enforced in one place
-- in the service layer. These policies exist so that a leaked anon key cannot
-- be used to read or write anything it should not.
alter table public.users enable row level security;

drop policy if exists "profiles are publicly readable" on public.users;
create policy "profiles are publicly readable"
  on public.users for select
  using (status <> 'banned');

drop policy if exists "people can edit their own profile" on public.users;
create policy "people can edit their own profile"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 5. The only destructive statement in this file, deliberately last --------
-- FayTarra no longer has any password code, so this column can only hold
-- hashes it will never read again. Dropping it is irreversible: anyone who
-- signed up under the old system must create their account again, because a
-- scrypt hash cannot be handed to Supabase Auth.
--
-- Everything above has already succeeded by the time this runs.
alter table public.users drop column if exists password_hash;
