-- ---------------------------------------------------------------------------
-- FayTarra: how much data is here, and is any of it un-migratable?
-- (QUERY 2 of 2 — only run this if inspect.sql said the tables exist.)
--
-- READ ONLY. Counts only. Safe on production.
-- ---------------------------------------------------------------------------
select 'users' as table_name, count(*) as rows from public.users
union all select 'posts',         count(*) from public.posts
union all select 'comments',      count(*) from public.comments
union all select 'likes',         count(*) from public.likes
union all select 'follows',       count(*) from public.follows
union all select 'ratings',       count(*) from public.ratings
union all select 'notifications', count(*) from public.notifications
union all select 'reports',       count(*) from public.reports
union all select 'blocks',        count(*) from public.blocks
union all
-- Profiles with no Supabase Auth account. Migration 0001 REFUSES to run if
-- this is above zero, because those rows cannot be linked to auth.users.
-- See supabase/migrations/README.md, "Profiles with no auth user".
select '>> profiles with NO auth account (0001 refuses if not 0)',
       (select count(*) from public.users u
        where not exists (select 1 from auth.users a where a.id = u.id))
union all
-- Usernames that differ only by case. The case-insensitive unique index in
-- 0001 cannot be created while any of these exist.
select '>> username case clashes (0001 fails if not 0)',
       (select coalesce(sum(c - 1), 0) from (
          select count(*) as c from public.users group by lower(username) having count(*) > 1
        ) dupes)
order by table_name;
