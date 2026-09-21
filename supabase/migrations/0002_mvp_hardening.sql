-- ---------------------------------------------------------------------------
-- MVP hardening.
--
-- Run this once against an existing FayTarra database, after
-- 0001_supabase_auth.sql. Fresh installs get the same result from
-- supabase/schema.sql.
-- ---------------------------------------------------------------------------

-- 1. The anon key must not be able to read emails or grant admin -----------
-- ---------------------------------------------------------------------------
-- What the API roles may see and change on public.users.
--
-- Supabase grants `anon` and `authenticated` full table access by default and
-- relies on RLS. RLS decides WHICH ROWS — it cannot stop a permitted row from
-- being read or written COLUMN BY COLUMN. Two consequences, both real:
--
--   * "profiles are publicly readable" handed out the mirrored email address
--     to anyone holding the anon key, which ships to every browser.
--   * "people can edit their own profile" let a signed-in person PATCH their
--     own row through the REST API and set role = 'admin', clear a ban, or
--     restore the `trusted` flag a moderator had revoked.
--
-- A column-level REVOKE does not help: a table-level grant covers every
-- column and outranks it. So the table grant goes, and only the safe columns
-- are granted back.
--
-- The app itself is unaffected: it talks to the database with the service
-- role, which bypasses all of this. These grants are the blast radius of a
-- leaked anon key.
--
-- ADDING A COLUMN TO public.users? Add it to the SELECT list below, and to the
-- UPDATE list only if its owner is allowed to set it themselves.
-- ---------------------------------------------------------------------------
do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = api_role) then
      continue;
    end if;

    execute format('revoke all on public.users from %I', api_role);

    execute format(
      'grant select (id, username, display_name, bio, avatar_url, location, '
      'interests, role, status, status_reason, trusted, created_at, last_active_at) '
      'on public.users to %I', api_role);
  end loop;

  -- Only a signed-in person can change anything, and only their own profile
  -- fields. The RLS policy below is what restricts it to their own row.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant update (display_name, bio, avatar_url, location, interests)
      on public.users to authenticated;
  end if;
end $$;

-- 2. Comment replies --------------------------------------------------------
-- One level deep: a reply belongs to a top-level comment, and a reply to a
-- reply attaches to the same parent. Deeper threads are a moderation problem
-- long before they are a product feature.
alter table public.comments
  add column if not exists parent_id uuid references public.comments (id) on delete cascade;
create index if not exists comments_parent_idx on public.comments (parent_id);

-- 3. Indexes the feed, profile and moderation pages actually use ------------
create index if not exists likes_user_idx on public.likes (user_id);
create index if not exists comments_user_idx on public.comments (user_id);
create index if not exists blocks_blocker_idx on public.blocks (blocker_id);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read = false;
create index if not exists posts_visible_idx
  on public.posts (created_at desc) where removed = false;
create index if not exists posts_author_visible_idx
  on public.posts (author_id, created_at desc) where removed = false;
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
