-- 0005 — profile colours
--
-- Two nullable text columns on public.users: the colour behind somebody's
-- profile, and the colour of the boxes on it. Null in both means the profile
-- looks the way FayTarra looks everywhere else, which is what every existing
-- row gets.
--
-- What it stores is a KEY from src/lib/profile-theme.ts ('purple',
-- 'yellow-bright', …), never a colour value. Anything the app does not
-- recognise resolves to the default when the page renders, so a value written
-- straight through the REST API can change how that person's own profile looks
-- and cannot put anything into a stylesheet.
--
-- Safe to run twice. Adds two nullable columns and extends two grants.
-- Nothing is dropped, deleted or rewritten, and no other table is touched.
--
-- Not running it is survivable: the app catches the missing column, says so
-- once in the logs, and tells anybody who tries to pick a colour that it is
-- not switched on. Every other part of a profile edit keeps working.

-- 1. The columns -------------------------------------------------------------
alter table public.users add column if not exists profile_bg  text;
alter table public.users add column if not exists profile_box text;

-- 2. The grants --------------------------------------------------------------
-- Migration 0002 replaced the table-wide grant on public.users with a list of
-- named columns, so a new column is invisible to the API roles until it is
-- added to that list. SELECT for everybody (a profile's colours are as public
-- as its bio), UPDATE for signed-in people — the RLS policy from 0001 is what
-- keeps that to their own row.
do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'grant select (profile_bg, profile_box) on public.users to %I', api_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant update (profile_bg, profile_box) on public.users to authenticated;
  end if;
end $$;

-- 3. What is there now -------------------------------------------------------
-- Read only. Both columns present and granted means the feature is on.
select
  count(*) filter (where column_name in ('profile_bg', 'profile_box')) as columns_present,
  case
    when count(*) filter (where column_name in ('profile_bg', 'profile_box')) = 2
      then 'APPLIED'
    else 'NOT APPLIED'
  end as verdict
from information_schema.columns
where table_schema = 'public' and table_name = 'users';
