-- ---------------------------------------------------------------------------
-- FayTarra: what state is this database in?  (QUERY 1 of 2)
--
-- READ ONLY. One SELECT over the system catalogues. It creates nothing,
-- changes nothing, deletes nothing, locks nothing, and cannot fail even if
-- FayTarra has never been installed here. Safe on production at any time.
--
-- Paste this whole file into the Supabase SQL editor and press Run. Read the
-- "verdict" column. Then run inspect-rows.sql if this says the tables exist.
-- ---------------------------------------------------------------------------
with users_auth_fk as (
  -- Resolved by name rather than ::regclass, which raises if the table is
  -- absent — and an empty project is exactly the case this must survive.
  select 1
  from pg_constraint con
  join pg_class child  on child.oid = con.conrelid
  join pg_namespace cn on cn.oid = child.relnamespace
  join pg_class parent on parent.oid = con.confrelid
  join pg_namespace pn on pn.oid = parent.relnamespace
  where con.contype = 'f'
    and cn.nspname = 'public' and child.relname  = 'users'
    and pn.nspname = 'auth'   and parent.relname = 'users'
),
faytarra_tables as (
  select count(*) as n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('users','posts','comments','likes','follows','ratings',
                      'notifications','reports','blocks')
),
checks as (
  select 1 as ord,
         'FayTarra tables installed' as check_name,
         (select n from faytarra_tables) || ' of 9' as result,
         case
           when (select n from faytarra_tables) = 0
             then 'EMPTY PROJECT -> run schema.sql only. Do not run the migrations.'
           when (select n from faytarra_tables) = 9
             then 'ALL PRESENT -> run migrations 0001 then 0002. Do NOT run schema.sql.'
           else 'PARTIAL -> stop and ask before running anything.'
         end as verdict

  union all
  select 2,
         'Passwords stored in this database',
         coalesce((select string_agg(table_name || '.' || column_name, ', ')
                   from information_schema.columns
                   where table_schema = 'public' and column_name ilike '%password%'), 'none'),
         case when exists (select 1 from information_schema.columns
                           where table_schema = 'public' and column_name ilike '%password%')
              then 'Old password column present. Migration 0001 drops it (irreversible).'
              else 'Good: FayTarra stores no passwords.' end

  union all
  select 3,
         'Profile table linked to Supabase Auth',
         case when exists (select 1 from users_auth_fk) then 'yes' else 'no' end,
         case when exists (select 1 from users_auth_fk)
              then 'Good.' else 'Migration 0001 adds it.' end

  union all
  select 4,
         'New auth user automatically gets a profile',
         case when exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')
              then 'yes' else 'no' end,
         case when exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')
              then 'Good.' else 'Migration 0001 installs the trigger.' end

  union all
  select 5,
         'Usernames unique at database level',
         coalesce((select string_agg(indexname, ', ' order by indexname)
                   from pg_indexes
                   where schemaname = 'public' and tablename = 'users'
                     and indexdef ilike '%unique%' and indexdef ilike '%username%'), 'none'),
         case when exists (select 1 from pg_indexes
                           where schemaname = 'public' and tablename = 'users'
                             and indexdef ilike '%unique%' and indexdef ilike '%lower(username)%')
              then 'Good: unique and case-insensitive.'
              else 'Migration 0001 adds the case-insensitive unique index.' end

  union all
  -- The one that matters most. A table-level grant covers every column and
  -- outranks any column-level revoke, so a table-wide UPDATE here means a
  -- signed-in person can PATCH their own row and set role = 'admin'.
  select 6,
         'What the anon key can do to public.users',
         coalesce((select string_agg(distinct grantee || ':' || privilege_type, ', ')
                   from information_schema.table_privileges
                   where table_schema = 'public' and table_name = 'users'
                     and grantee in ('anon','authenticated')
                     and privilege_type in ('SELECT','UPDATE','INSERT','DELETE')), 'no table-wide grants'),
         case when exists (
                select 1 from information_schema.table_privileges
                where table_schema = 'public' and table_name = 'users'
                  and grantee in ('anon','authenticated')
                  and privilege_type in ('SELECT','UPDATE'))
              then 'DANGER: table-wide access. Anyone signed in can set role=admin, and every '
                   || 'email address is readable. Migration 0002 fixes this.'
              else 'Good: no table-wide grants (see query 2 for the safe per-column grants).' end

  union all
  select 7,
         'RLS policies on public.users',
         coalesce((select string_agg(policyname || ' (' || cmd || ')', ', ' order by policyname)
                   from pg_policies where schemaname = 'public' and tablename = 'users'), 'none'),
         'Informational.'

  union all
  select 8,
         'Row level security enabled everywhere',
         coalesce((select string_agg(c.relname, ', ' order by c.relname)
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'all on'),
         case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)
              then 'Tables listed have RLS OFF.' else 'Good.' end

  union all
  select 9,
         'Comment replies supported',
         case when exists (select 1 from information_schema.columns
                           where table_schema='public' and table_name='comments' and column_name='parent_id')
              then 'yes' else 'no' end,
         case when exists (select 1 from information_schema.columns
                           where table_schema='public' and table_name='comments' and column_name='parent_id')
              then 'Good.' else 'Migration 0002 adds it (additive, nothing rewritten).' end

  union all
  select 10,
         'Media storage bucket',
         coalesce((select string_agg(id, ', ') from storage.buckets), 'none'),
         case when exists (select 1 from storage.buckets where id = 'faytarra-media')
              then 'Good.'
              else 'Create it in Storage -> New bucket, name faytarra-media, Public.' end

  union all
  select 11,
         'Supabase Auth users',
         (select count(*) || ' total, ' || count(email_confirmed_at) || ' confirmed' from auth.users),
         'Informational.'
)
select check_name, result, verdict from checks order by ord;
