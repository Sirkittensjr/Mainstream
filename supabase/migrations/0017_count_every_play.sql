-- 0017 — every play counts, decided and stored in one step
--
-- WHY THE EYE SHOWED 0. Video views are stored in `posts.video_views` and
-- `public.video_views`, which migration 0010 creates. A project that never ran
-- 0010 has neither — and FayTarra's code was written so that missing storage
-- switches view counting OFF rather than failing: every report was answered
-- "not counted (unavailable)", and the eye stayed at 0 however often anything
-- was played. 0015 (counters) does not create that storage, and 0016 refuses to
-- run without it. This migration does not depend on either: it installs
-- everything view counting needs, whatever this database already has.
--
-- WHAT A VIEW IS NOW. Every playback start, by anybody, as often as it
-- happens: the creator's own plays, repeat plays, a replay a second later.
-- The one thing never counted twice is ONE playback session — the key the
-- player sends with its report — so a retried or duplicated report adds
-- nothing. See src/lib/video/views.ts.
--
-- FIVE THINGS. All additive: nothing is dropped, no count is lowered or reset,
-- no row is deleted. Every statement is safe to run twice.
--
--   1. The storage (what 0010 adds, if it is not already here).
--   2. `increment_counter` (what 0015 adds, if it is not already here).
--   3. `record_video_play(…)` — checks a reported play and counts it, in one
--      transaction: see below.
--   4. Permissions: the app's service role may call the functions; the public
--      API roles may call none of them and may not read or write the storage.
--   5. A repair: views stored but never added to their post's total are added
--      now. It only ever RAISES a total.
--
-- Needs only `public.posts` and `public.users`, which every FayTarra database has.

do $$
begin
  if to_regclass('public.posts') is null or to_regclass('public.users') is null then
    raise exception 'Migration 0017 needs the FayTarra schema (public.posts and public.users). Nothing has been changed.';
  end if;
end $$;

-- 1. The storage --------------------------------------------------------------
--
-- Exactly what 0010 creates. Already there: nothing happens.
--
--   posts.video_views  the total the eye shows. Every existing post starts at
--                      zero; a post that already has a total keeps it.
--   video_views        one row per counted play. The unique index on
--                      `dedupe_key` (viewer + playback session) is what makes a
--                      retried report count once.
alter table public.posts
  add column if not exists video_views integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'posts_video_views_non_negative'
  ) then
    alter table public.posts
      add constraint posts_video_views_non_negative check (video_views >= 0);
  end if;
end $$;

create index if not exists posts_video_views_idx
  on public.posts (video_views desc);

create table if not exists public.video_views (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  viewer_id   uuid references public.users (id) on delete set null,
  identity    text not null,
  dedupe_key  text not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists video_views_dedupe_idx
  on public.video_views (dedupe_key);

-- One viewer's latest plays of one video: the burst ceiling's read.
create index if not exists video_views_identity_idx
  on public.video_views (post_id, identity, created_at desc);

create index if not exists video_views_post_idx
  on public.video_views (post_id, created_at desc);

alter table public.video_views enable row level security;

-- 2. The atomic counter -------------------------------------------------------
--
-- The same function as 0015, so a database that never ran 0015 has it too.
-- `update … set n = n + amount`, in the database, under the row's lock: two
-- plays at the same moment are two views. Only the counters named here can
-- move, and only upwards.
create or replace function public.increment_counter(
  target_table  text,
  target_id     uuid,
  target_column text,
  amount        integer default 1
)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  result integer;
begin
  if not (target_table = 'posts' and target_column in ('video_views', 'views')) then
    raise exception 'increment_counter: %.% is not a counter', target_table, target_column
      using errcode = '22023';
  end if;
  if amount is null or amount < 1 then
    raise exception 'increment_counter: counters only go up (amount %)', amount
      using errcode = '22023';
  end if;
  execute format(
    'update public.%I set %I = %I + $1 where id = $2 returning %I',
    target_table, target_column, target_column, target_column
  )
  into result
  using amount, target_id;
  return result;
end $$;

-- 3. One play, checked and counted --------------------------------------------
--
-- The app calls this once per reported play (src/lib/db/supabase.ts,
-- recordPlay) with the service role. The SAME rules as decideView in
-- src/lib/video/views.ts, in the same order:
--
--   no-post            no such post, removed, or hidden while it is reviewed
--   not-a-video        a photo or text post: nothing to play
--   duplicate-session  this playback session is already counted (a retry)
--   too-fast           this viewer has started this video 50 times in the
--                      last 10 seconds, which no person can do
--   (counted)          the play is stored and the total goes up by exactly one
--
-- It can move one number only — `posts.video_views` of the post it was given,
-- by one — and takes no table, column or amount from its caller.
--
-- The post-level advisory lock serialises one viewer's plays of one video
-- across every app server, so two copies of one report cannot both pass the
-- duplicate check; the unique index stays as the last word. Everything happens
-- in one transaction: the row and the +1 both land, or neither does and the
-- player's retry counts it.
--
-- `review_state` is read through to_jsonb so this works on a project that
-- never ran 0009 (no review columns — and so nothing under review).
create or replace function public.record_video_play(
  play_id          uuid,
  target_post      uuid,
  viewer           uuid,
  viewer_identity  text,
  play_key         text
)
returns table (counted boolean, total integer, reason text)
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  post_row  record;
  is_video  boolean;
  recent    integer;
  stored    uuid;
  new_total integer;
begin
  if target_post is null
     or coalesce(length(viewer_identity), 0) not between 1 and 200
     or coalesce(length(play_key), 0) not between 1 and 400 then
    raise exception 'record_video_play: malformed play' using errcode = '22023';
  end if;

  select p.video_views, p.removed, p.media, to_jsonb(p) ->> 'review_state' as review_state
    into post_row
    from public.posts p
   where p.id = target_post;

  if not found or post_row.removed
     or post_row.review_state in ('temporary_review', 'admin_hold') then
    return query select false, null::integer, 'no-post'::text;
    return;
  end if;

  -- A CASE, not an AND: jsonb_array_elements must never see anything but an array.
  is_video := case
    when jsonb_typeof(post_row.media) = 'array' then exists (
      select 1 from jsonb_array_elements(post_row.media) m where m ->> 'kind' = 'video'
    )
    else false
  end;
  if not is_video then
    return query select false, 0, 'not-a-video'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('video-play:' || target_post::text || ':' || viewer_identity, 0)
  );

  if exists (select 1 from public.video_views v where v.dedupe_key = play_key) then
    return query select false, p.video_views, 'duplicate-session'::text
      from public.posts p where p.id = target_post;
    return;
  end if;

  select count(*) into recent
    from (
      select 1 from public.video_views v
       where v.post_id = target_post
         and v.identity = viewer_identity
         and v.created_at > now() - interval '10 seconds'
       limit 50
    ) burst;
  if recent >= 50 then
    return query select false, p.video_views, 'too-fast'::text
      from public.posts p where p.id = target_post;
    return;
  end if;

  insert into public.video_views (id, post_id, viewer_id, identity, dedupe_key, created_at)
  values (coalesce(play_id, gen_random_uuid()), target_post, viewer, viewer_identity, play_key, now())
  on conflict (dedupe_key) do nothing
  returning id into stored;

  if stored is null then
    return query select false, p.video_views, 'duplicate-session'::text
      from public.posts p where p.id = target_post;
    return;
  end if;

  -- The existing atomic counter, by exactly one. Same transaction as the
  -- insert above: if this fails, so does that.
  new_total := public.increment_counter('posts', target_post, 'video_views', 1);
  return query select true, new_total, null::text;
end $$;

-- 4. Who may call them, and who may touch the storage -------------------------
--
-- PUBLIC loses EXECUTE; the service role is granted it by name, so counting
-- never depends on what a project's default privileges happen to grant. The
-- API roles get nothing: a leaked anon key can neither count a view nor read
-- who watched what.
revoke all on function public.record_video_play(uuid, uuid, uuid, text, text) from public;
revoke all on function public.increment_counter(text, uuid, text, integer) from public;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on function public.record_video_play(uuid, uuid, uuid, text, text) from %I', api_role);
      execute format('revoke all on function public.increment_counter(text, uuid, text, integer) from %I', api_role);
      execute format('revoke all on public.video_views from %I', api_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_video_play(uuid, uuid, uuid, text, text) to service_role;
    grant execute on function public.increment_counter(text, uuid, text, integer) to service_role;
    grant select, insert, update, delete on public.video_views to service_role;
    grant select, update on public.posts to service_role;
  end if;
end $$;

-- 5. Views stored but never added up ------------------------------------------
--
-- Each one is a row in `video_views` whose +1 on the post failed under an
-- older version of the app. Adds them to the total. Never lowers a total — one
-- that is already higher is left alone — and running it again changes nothing.
update public.posts p
   set video_views = c.views
  from (select post_id, count(*)::integer as views
          from public.video_views
         group by post_id) c
 where c.post_id = p.id
   and p.video_views < c.views;

-- PostgREST picks up the new function without a restart.
notify pgrst, 'reload schema';

-- 6. What it looks like afterwards --------------------------------------------
select
  to_regclass('public.video_views') is not null as view_storage,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'posts'
             and column_name = 'video_views') as posts_video_views,
  to_regprocedure('public.record_video_play(uuid, uuid, uuid, text, text)') is not null as record_video_play,
  (select count(*) from public.posts where video_views > 0) as posts_with_views,
  case
    when to_regprocedure('public.record_video_play(uuid, uuid, uuid, text, text)') is not null
     and to_regclass('public.video_views') is not null
    then 'OK — every play is counted'
    else 'NOT APPLIED'
  end as verdict;
