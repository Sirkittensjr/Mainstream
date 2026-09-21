-- ---------------------------------------------------------------------------
-- FayTarra — Supabase schema
--
-- Run this once in the Supabase SQL editor (or `supabase db execute -f`), then
-- seed the sample community with `npm run seed`.
--
-- The application talks to these tables through the server-side service role
-- and enforces its own rules (blocking, moderation, rating integrity) in one place.
-- RLS is still enabled on every table so that nothing is readable or writable
-- with the anon key by accident.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- Users --------------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  username      text not null unique,
  display_name  text not null,
  password_hash text not null,
  bio           text not null default '',
  avatar_url    text,
  location      text,
  interests     text[] not null default '{}',
  role          text not null default 'user'   check (role in ('user', 'admin')),
  status        text not null default 'active' check (status in ('active', 'suspended', 'banned')),
  status_reason text,
  -- Rating integrity: a moderator can revoke the weight an account's ratings carry.
  trusted       boolean not null default true,
  created_at    timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create index if not exists users_username_idx on public.users (username);


-- Posts --------------------------------------------------------------------
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references public.users (id) on delete cascade,
  caption        text not null default '',
  media          jsonb not null default '[]',
  category       text not null default 'Other',
  tags           text[] not null default '{}',
  views          integer not null default 0,
  removed        boolean not null default false,
  removed_reason text,
  created_at     timestamptz not null default now()
);

create index if not exists posts_author_idx on public.posts (author_id);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_category_idx on public.posts (category);

-- Likes --------------------------------------------------------------------
create table if not exists public.likes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index if not exists likes_post_idx on public.likes (post_id);

-- Comments -----------------------------------------------------------------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  body       text not null,
  removed    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists comments_post_idx on public.comments (post_id);

-- Follows ------------------------------------------------------------------
create table if not exists public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references public.users (id) on delete cascade,
  following_id uuid not null references public.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists follows_follower_idx on public.follows (follower_id);

-- Blocks -------------------------------------------------------------------
create table if not exists public.blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

-- Ratings ------------------------------------------------------------------
-- One row per (rater, target): rating again updates this row rather than
-- stacking, which is the first line of manipulation defence.
create table if not exists public.ratings (
  id          uuid primary key default gen_random_uuid(),
  rater_id    uuid not null references public.users (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'user')),
  target_id   uuid not null,
  -- The creator being rated, denormalised so per-creator scans are one pass.
  owner_id    uuid not null references public.users (id) on delete cascade,
  score       integer not null check (score between 1 and 10),
  reactions   text[] not null default '{}',
  -- Integrity weight, 0-1, computed when the rating was cast.
  weight      real not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (rater_id, target_type, target_id),
  check (rater_id <> owner_id)
);

create index if not exists ratings_target_idx on public.ratings (target_type, target_id);
create index if not exists ratings_owner_idx on public.ratings (owner_id);
create index if not exists ratings_rater_idx on public.ratings (rater_id, updated_at desc);

-- Notifications ------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  type         text not null,
  actor_id     uuid references public.users (id) on delete set null,
  post_id      uuid references public.posts (id) on delete cascade,
  body         text not null,
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- Reports ------------------------------------------------------------------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'user', 'comment')),
  target_id   uuid not null,
  reason      text not null,
  details     text not null default '',
  status      text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution  text,
  created_at  timestamptz not null default now()
);

create index if not exists reports_status_idx on public.reports (status, created_at desc);

-- Row level security --------------------------------------------------------
-- Every table is locked down: the app server uses the service role key, which
-- bypasses RLS. Add explicit policies here if you later let browsers talk to
-- Supabase directly.
alter table public.users         enable row level security;
alter table public.posts         enable row level security;
alter table public.likes         enable row level security;
alter table public.comments      enable row level security;
alter table public.follows       enable row level security;
alter table public.blocks        enable row level security;
alter table public.ratings       enable row level security;
alter table public.notifications enable row level security;
alter table public.reports       enable row level security;

-- Storage -------------------------------------------------------------------
-- Uploaded images and video go to this bucket. Public read so posts render.
insert into storage.buckets (id, name, public)
values ('faytarra-media', 'faytarra-media', true)
on conflict (id) do nothing;
