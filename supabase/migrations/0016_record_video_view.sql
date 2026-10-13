-- 0016 — a counted view and its total, in one step
--
-- WHAT THIS IS FOR. A video view is two writes: a row in `video_views` (the
-- record that this playback session has been counted, which is what stops a
-- remount or a retry counting twice) and one more on `posts.video_views` (the
-- total the eye shows). The app made them as two separate requests. When the
-- second one failed — a permission, a timeout, a moment of contention — the
-- first had already happened, so the player's retry of the same report found
-- the row, was told "already counted", and that view was never added to the
-- total. Nothing could ever repair it: every later report of that playback
-- session was a duplicate. A video could be watched and stay at 0.
--
-- `record_video_view` makes both writes in ONE transaction: both happen, or
-- neither does and the report can simply be sent again.
--
-- THREE THINGS, all additive, every statement safe to run twice:
--
--   1. `record_video_view(…)` — the two writes, together.
--   2. Permissions: the app's service role may call it and `increment_counter`
--      (granted explicitly, rather than relying on the project's default
--      privileges); the public API roles may call neither.
--   3. A repair: views that were stored but never added to their post's total
--      are added now. It only ever RAISES a total, to the number of view rows
--      that post actually has, and running it again changes nothing.
--
-- Needs 0010 (the `video_views` table and `posts.video_views`) and 0015
-- (`increment_counter`). Stops before changing anything if either is missing.

do $$
begin
  if to_regclass('public.video_views') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'posts'
                      and column_name = 'video_views') then
    raise exception 'Migration 0016 needs 0010 (video_views). Run 0010_video_views.sql first. Nothing has been changed.';
  end if;
  if to_regprocedure('public.increment_counter(text, uuid, text, integer)') is null then
    raise exception 'Migration 0016 needs 0015 (increment_counter). Run 0015_hashtags_and_counters.sql first. Nothing has been changed.';
  end if;
end $$;

-- 1. The view and the total, together ----------------------------------------
--
-- The app decides whether a report is a view (src/lib/video/views.ts) and then
-- calls this once. It answers:
--
--   counted  true when this call stored the view and added it to the total;
--            false when a view with this key was already stored (a copy of
--            the same report got there first), or there is no such post
--   total    what posts.video_views holds now; null when there is no post
--
-- `viewed_at` comes from the app, so the cooldown and the hourly ceiling are
-- measured on one clock.
create or replace function public.record_video_view(
  view_id          uuid,
  target_post      uuid,
  viewer           uuid,
  viewer_identity  text,
  view_key         text,
  viewed_at        timestamptz
)
returns table (counted boolean, total integer)
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  stored uuid;
begin
  if not exists (select 1 from public.posts p where p.id = target_post) then
    return query select false, null::integer;
    return;
  end if;

  insert into public.video_views (id, post_id, viewer_id, identity, dedupe_key, created_at)
  values (view_id, target_post, viewer, viewer_identity, view_key, viewed_at)
  on conflict (dedupe_key) do nothing
  returning id into stored;

  if stored is null then
    return query select false, p.video_views from public.posts p where p.id = target_post;
    return;
  end if;

  -- Same transaction as the insert above: if this fails, so does that.
  return query
    update public.posts p
       set video_views = p.video_views + 1
     where p.id = target_post
    returning true, p.video_views;
end $$;

-- 2. Who may call them -------------------------------------------------------
--
-- PUBLIC loses EXECUTE; the service role is granted it by name, so the app's
-- counting never depends on what a project's default privileges happen to
-- grant. The API roles get nothing: a leaked anon key cannot count views.
revoke all on function public.record_video_view(uuid, uuid, uuid, text, text, timestamptz) from public;
revoke all on function public.increment_counter(text, uuid, text, integer) from public;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on function public.record_video_view(uuid, uuid, uuid, text, text, timestamptz) from %I', api_role);
      execute format('revoke all on function public.increment_counter(text, uuid, text, integer) from %I', api_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_video_view(uuid, uuid, uuid, text, text, timestamptz) to service_role;
    grant execute on function public.increment_counter(text, uuid, text, integer) to service_role;
  end if;
end $$;

-- 3. Views stored but never added up -----------------------------------------
--
-- Each one is a row in `video_views`: a playback session the app decided was a
-- view and stored, whose +1 on the post then failed. Adds them to the total.
-- Never lowers a total — one that is already higher (a seeded post, say) is
-- left alone.
update public.posts p
   set video_views = c.views
  from (select post_id, count(*)::integer as views
          from public.video_views
         group by post_id) c
 where c.post_id = p.id
   and p.video_views < c.views;

-- 4. What it looks like afterwards -------------------------------------------
select
  to_regprocedure('public.record_video_view(uuid, uuid, uuid, text, text, timestamptz)') is not null
    as record_video_view_installed,
  (select count(*) from public.posts p
    where p.video_views < (select count(*) from public.video_views v where v.post_id = p.id))
    as posts_still_missing_views,
  case
    when to_regprocedure('public.record_video_view(uuid, uuid, uuid, text, text, timestamptz)') is not null
      then 'OK — a view and its total are now stored together'
    else 'NOT APPLIED'
  end as verdict;
