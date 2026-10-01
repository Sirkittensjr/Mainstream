-- 0010 — video view counts
--
-- WHAT THIS IS FOR. Every FayTarra video gets a total number of times it has
-- actually been watched, and that number is the DATABASE's. No request tells
-- the app what a video's count is; a browser's entire say is "this playback
-- session watched post X", and even that is checked here and in
-- src/lib/services/video-views.ts before it moves a counter.
--
-- Deliberately separate from `posts.views`, which has always counted the post
-- PAGE being opened. They answer different questions and both are worth
-- having: one is reach, one is watching. A photo post never gets a watch count
-- at all, because a photo has nothing to play.
--
-- TWO THINGS, both additive. Nothing is dropped, rewritten or deleted.
--
--   1. `posts.video_views` — the authoritative total.
--
--   2. `public.video_views` — one row per counted view, which is what makes
--      deduplication possible. A bare counter cannot answer "has this person
--      already been counted for this playback session?", and without that
--      answer scrolling back up a feed is a dozen more views.
--
-- Safe to run twice.

-- 1. The total on the post ---------------------------------------------------
--
-- Not null with a default, so every existing post starts at zero rather than
-- at "unknown". Existing rows are not rewritten by the app; they simply read
-- as zero until somebody watches them.
alter table public.posts
  add column if not exists video_views integer not null default 0;

-- Never negative, whatever writes it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'posts_video_views_non_negative'
  ) then
    alter table public.posts
      add constraint posts_video_views_non_negative check (video_views >= 0);
  end if;
end $$;

-- Watched-most, for the admin dashboard and for ranking later on.
create index if not exists posts_video_views_idx
  on public.posts (video_views desc);

-- 2. The view events ---------------------------------------------------------
--
--   identity    who watched, as far as that can honestly be known: the account
--               id when somebody is signed in, and `anon:<opaque browser id>`
--               when they are not. It is not a name, an address or an IP, and
--               it is never shown to anybody.
--
--   dedupe_key  identity plus the browser's key for one playback session. The
--               unique index on it is the rule, not a convenience: it is what
--               makes a remount, a re-render, a scroll back or a pause and play
--               cost nothing. Application code checks it first; this is what
--               holds when two requests race.
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

-- The cooldown read: this person's most recent counted view of this video.
-- That query is on the path of every video anybody watches, so it gets its own
-- index rather than a scan.
create index if not exists video_views_identity_idx
  on public.video_views (post_id, identity, created_at desc);

create index if not exists video_views_post_idx
  on public.video_views (post_id, created_at desc);

-- 3. Row level security ------------------------------------------------------
--
-- The app reads and writes this with the service role, which bypasses RLS.
-- These exist so a leaked anon key cannot read who watched what or write a
-- view of its own. Nothing is granted to the API roles at all.
alter table public.video_views enable row level security;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on public.video_views from %I', api_role);
    end if;
  end loop;
end $$;

-- 4. What it looks like afterwards -------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'posts'
      and column_name = 'video_views') as posts_video_views_column,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'video_views') as video_views_table,
  case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'posts' and column_name = 'video_views'
    ) and exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'video_views'
    ) then 'OK — video view counts are on'
    else 'NOT APPLIED'
  end as verdict;
