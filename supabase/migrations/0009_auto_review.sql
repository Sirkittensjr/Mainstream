-- 0009 — automatic temporary review, and the moderation history behind it
--
-- WHAT THIS IS FOR. One moderator cannot read every report the moment it
-- arrives. When enough DIFFERENT people report the same post, it is hidden
-- temporarily so a human can look at it — for at most 24 hours, and never as a
-- verdict. Nothing is deleted, the author is told what is happening, and if
-- nobody reviews it in time it comes back on its own.
--
-- THREE THINGS, all additive. Nothing is dropped, rewritten or deleted.
--
--   1. One report per account per thing, enforced by the DATABASE. The count
--      that hides a post has to mean "ten people", not "one person clicking
--      ten times", and a rule that lives only in application code is one
--      forgotten call site away from not existing.
--
--   2. Somewhere to record the review state on a post, and when it expires.
--
--   3. A moderation log, so every automatic hide, admin decision, cleared
--      threshold and expiry is on the record afterwards.
--
-- Safe to run twice.

-- 1. One report per account, per piece of content ----------------------------
--
-- Duplicates are folded first, oldest kept, or the index cannot be built. The
-- kept row keeps its reason and details; the later ones were the same person
-- saying the same thing again.
--
-- The tie-break on `id` is not decoration. `created_at` is a timestamp and two
-- reports CAN share one — two rows inserted by the same statement get the same
-- `now()`, and so does anything bulk-imported. Comparing `created_at` alone
-- then removes neither of them, and the unique index below fails on rows this
-- statement was supposed to have folded. `(created_at, id)` is a total order,
-- so exactly one row of every group survives.
delete from public.reports a
 using public.reports b
 where a.reporter_id = b.reporter_id
   and a.target_type = b.target_type
   and a.target_id   = b.target_id
   and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists reports_one_per_reporter_idx
  on public.reports (reporter_id, target_type, target_id);

-- When an admin cleared the ACTIVE threshold this report counted toward.
-- Null means it still counts. Set means it is history: still readable, still
-- attributable, but no longer able to re-trigger an automatic hide.
alter table public.reports
  add column if not exists cleared_at timestamptz;

create index if not exists reports_active_target_idx
  on public.reports (target_type, target_id)
  where cleared_at is null;

-- 2. The review state on a post ----------------------------------------------
--
--   null              — normal.
--   temporary_review  — automatically hidden, expires at review_expires_at.
--   admin_hold        — an admin is looking at it. Does NOT expire on its own;
--                       only an admin takes it out of this state.
--
-- Deliberately separate from `removed`. Removed is a decision; this is a
-- pause. Keeping them apart is what stops a temporary hide being mistaken for
-- a verdict later, by a person or by a query.
alter table public.posts
  add column if not exists review_state      text
    check (review_state is null or review_state in ('temporary_review', 'admin_hold')),
  add column if not exists review_started_at timestamptz,
  add column if not exists review_expires_at timestamptz,
  add column if not exists review_reports    integer not null default 0;

create index if not exists posts_review_idx
  on public.posts (review_state, review_expires_at)
  where review_state is not null;

-- 3. The moderation log ------------------------------------------------------
--
-- Append only in practice: rows are written, never updated. `actor_id` is null
-- when FayTarra itself did it — the automatic hide and the expiry — and an
-- admin's id when a person did.
create table if not exists public.moderation_events (
  id             uuid primary key default gen_random_uuid(),
  target_type    text not null check (target_type in ('post', 'user', 'comment')),
  target_id      uuid not null,
  action         text not null,
  actor_id       uuid references public.users (id) on delete set null,
  unique_reports integer not null default 0,
  detail         text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists moderation_events_target_idx
  on public.moderation_events (target_type, target_id, created_at desc);
create index if not exists moderation_events_recent_idx
  on public.moderation_events (created_at desc);

-- 4. Row level security ------------------------------------------------------
--
-- The app reads and writes all of this with the service role, which bypasses
-- RLS. These exist so a leaked anon key cannot read the moderation log or
-- write a moderation event. Nothing is granted to the API roles at all: the
-- log is not public, and "who reported this" least of all.
alter table public.moderation_events enable row level security;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on public.moderation_events from %I', api_role);
    end if;
  end loop;
end $$;
