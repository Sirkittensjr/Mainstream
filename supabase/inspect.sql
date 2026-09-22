-- ---------------------------------------------------------------------------
-- FayTarra: what state is this database in?
--
-- READ ONLY. Every statement is a SELECT. It creates nothing, alters nothing,
-- deletes nothing, and locks nothing. Safe to run on production at any time.
--
-- Run this in the Supabase SQL editor BEFORE running any migration, and read
-- the VERDICT column of each section. It tells you which of the migrations
-- this database still needs, and what data is at stake.
-- ---------------------------------------------------------------------------

\echo '=== 1. Does FayTarra exist here at all, and how much data is in it? ==='
-- Real counts, not reltuples, which reads -1 until the table has been analysed.
select 'users' as table_name, count(*) as rows from public.users
union all select 'posts', count(*) from public.posts
union all select 'comments', count(*) from public.comments
union all select 'likes', count(*) from public.likes
union all select 'follows', count(*) from public.follows
union all select 'ratings', count(*) from public.ratings
union all select 'notifications', count(*) from public.notifications
union all select 'reports', count(*) from public.reports
union all select 'blocks', count(*) from public.blocks
order by table_name;

\echo '(and is row level security switched on for each?)'
select c.relname as table_name,
       case when c.relrowsecurity then 'on' else 'OFF' end as row_level_security
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

\echo ''
\echo '=== 2. Are passwords stored in OUR database? (want: zero rows) ==='
select table_name, column_name
from information_schema.columns
where table_schema = 'public' and column_name ilike '%password%';

\echo ''
\echo '=== 3. Is the profile table linked to Supabase Auth? ==='
select
  case
    when exists (
      select 1 from pg_constraint
      where conrelid = 'public.users'::regclass and contype = 'f'
        and confrelid = 'auth.users'::regclass
    ) then 'LINKED — public.users.id references auth.users(id)'
    else 'NOT LINKED — migration 0001 is needed'
  end as verdict;

\echo ''
\echo '=== 4. Does a new Supabase Auth user automatically get a profile? ==='
select
  case
    when exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')
    then 'YES — the on_auth_user_created trigger is installed'
    else 'NO — signup will fall back to app code; migration 0001 is needed'
  end as verdict;

\echo ''
\echo '=== 5. Are usernames unique at the database level? ==='
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'users' and indexdef ilike '%username%'
order by indexname;

\echo ''
\echo '=== 6. THE IMPORTANT ONE: what can somebody do with just the anon key? ==='
-- A table-level grant covers every column and outranks any column-level
-- revoke, so a table-wide UPDATE here means a signed-in person can PATCH their
-- own row and set role = 'admin'.
select
  grantee,
  privilege_type,
  case
    when privilege_type = 'UPDATE'
      then 'DANGER — table-wide UPDATE: a signed-in user can set role=admin. Migration 0002 is needed.'
    when privilege_type = 'SELECT'
      then 'DANGER — table-wide SELECT: exposes every email address. Migration 0002 is needed.'
    else 'review'
  end as verdict
from information_schema.table_privileges
where table_schema = 'public' and table_name = 'users'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

\echo ''
\echo '(if section 6 returned no SELECT/UPDATE rows, these are the safe per-column grants:)'
select grantee, privilege_type, string_agg(column_name, ', ' order by column_name) as columns
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'users'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('SELECT', 'UPDATE')
group by grantee, privilege_type
order by grantee, privilege_type;

\echo ''
\echo '=== 7. Which RLS policies exist on the profile table? ==='
select policyname, cmd, qual as using_expression, with_check
from pg_policies
where schemaname = 'public' and tablename = 'users'
order by policyname;

\echo ''
\echo '=== 8. Do comment replies exist yet? ==='
select
  case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'comments' and column_name = 'parent_id'
    ) then 'YES — comments.parent_id is present'
    else 'NO — migration 0002 adds it (additive, nothing is rewritten)'
  end as verdict;

\echo ''
\echo '=== 9. Does the media storage bucket exist? ==='
select id, name, public from storage.buckets order by id;

\echo ''
\echo '=== 10. How many Supabase Auth users already exist? ==='
select count(*) as auth_users, count(email_confirmed_at) as confirmed from auth.users;

\echo ''
\echo '=== 11. Profiles with NO auth account (migration 0001 refuses if any) ==='
-- These are accounts from before Supabase Auth. See migrations/README.md,
-- "Profiles with no auth user", for what to do about them.
select count(*) as orphaned_profiles
from public.users u
where not exists (select 1 from auth.users a where a.id = u.id);
