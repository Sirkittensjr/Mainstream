-- 0013 — profile background photo
--
-- One nullable text column on public.users: the address of a picture somebody
-- chose to fill the background of their profile. Null — every existing row —
-- means no photo, and the profile shows its colour or gradient (profile_bg,
-- from 0005) exactly as before.
--
-- What it stores is a URL to an image in FayTarra's own storage bucket, never
-- the image. The app only writes an address it uploaded and checked itself, and
-- only for the signed-in person's own row.
--
-- Safe to run twice. Adds one nullable column and extends two grants. Nothing
-- is dropped, deleted or rewritten, and no other table is touched.
--
-- Not running it is survivable: profiles keep their colours, Edit profile
-- says background photos are not switched on yet, and the server log names
-- this file. Every other part of a profile edit keeps working.

-- 1. The column --------------------------------------------------------------
alter table public.users add column if not exists profile_cover_url text;

-- 2. The grants --------------------------------------------------------------
-- As 0005: migration 0002 replaced the table-wide grant on public.users with a
-- list of named columns, so a new column is invisible to the API roles until it
-- is added. SELECT for everybody — the background is as public as the bio —
-- and UPDATE for signed-in people, limited to their own row by the RLS policy
-- from 0001.
do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('grant select (profile_cover_url) on public.users to %I', api_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant update (profile_cover_url) on public.users to authenticated;
  end if;
end $$;

-- 3. What is there now -------------------------------------------------------
select
  case
    when exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'users'
                   and column_name = 'profile_cover_url')
      then 'APPLIED'
    else 'NOT APPLIED'
  end as verdict;
