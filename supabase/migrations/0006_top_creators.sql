-- 0006 — Top 3 favourite creators
--
-- One nullable text[] column on public.users: the three accounts somebody
-- picked as their favourites, in the order they picked them. Null or empty —
-- which is what every existing row gets — means the default, and the default
-- needs no storage at all: it is the first three accounts that person
-- followed, read from `follows` when the profile renders. A fourth follow
-- therefore cannot displace anybody, and nothing has to be written at the
-- moment somebody follows their third person.
--
-- What it holds is account ids, and the names and pictures are looked up in
-- `users` when the page renders. There is no second copy of anybody here.
--
-- Safe to run twice. Adds one nullable column and extends two grants. Nothing
-- is dropped, deleted or rewritten, and no other table is touched.
--
-- Not running it is survivable: every profile still shows its default Top 3,
-- and the only thing that does not work is changing it — the app says so, once
-- in the log and again to anybody who tries.

-- 1. The column -------------------------------------------------------------
alter table public.users add column if not exists top_creators text[];

-- 2. The grants --------------------------------------------------------------
-- Migration 0002 replaced the table-wide grant on public.users with a list of
-- named columns, so a new column is invisible to the API roles until it is
-- added to that list. SELECT for everybody — a Top 3 is as public as the
-- profile it is on — and UPDATE for signed-in people, which the RLS policy
-- from 0001 keeps to their own row.
--
-- The rule that only people you follow may be in it is NOT enforced here: it
-- is checked in the service layer on every save. A row written directly
-- through the API can therefore name somebody this person does not follow, and
-- that name is filtered out when the profile renders rather than displayed —
-- the read is what decides, so the worst case is an empty slot on your own
-- profile.
do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('grant select (top_creators) on public.users to %I', api_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant update (top_creators) on public.users to authenticated;
  end if;
end $$;

-- 3. What is there now -------------------------------------------------------
-- Read only.
select
  case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'users' and column_name = 'top_creators'
    ) then 'APPLIED'
    else 'NOT APPLIED'
  end as verdict;
