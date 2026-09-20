-- ---------------------------------------------------------------------------
-- RISE — Supabase schema
--
-- Run this once in the Supabase SQL editor (or `supabase db execute -f`), then
-- seed the sample community with `npm run seed`.
--
-- The application talks to these tables through the server-side service role
-- and enforces its own rules (blocking, moderation, RISE points) in one place.
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
  goal          text not null default '100 followers',
  role          text not null default 'user'   check (role in ('user', 'admin')),
  status        text not null default 'active' check (status in ('active', 'suspended', 'banned')),
  status_reason text,
  rise_points   integer not null default 0,
  created_at    timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create index if not exists users_username_idx on public.users (username);
create index if not exists users_points_idx on public.users (rise_points desc);

-- Challenges ---------------------------------------------------------------
create table if not exists public.challenges (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  title             text not null,
  description       text not null,
  category          text not null default 'Any',
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  featured_post_ids uuid[] not null default '{}',
  created_at        timestamptz not null default now()
);

create index if not exists challenges_window_idx on public.challenges (starts_at, ends_at);

-- Posts --------------------------------------------------------------------
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references public.users (id) on delete cascade,
  caption        text not null default '',
  media          jsonb not null default '[]',
  category       text not null default 'Other',
  tags           text[] not null default '{}',
  challenge_id   uuid references public.challenges (id) on delete set null,
  shot           boolean not null default false,   -- "GIVE ME A SHOT"
  views          integer not null default 0,
  featured       boolean not null default false,
  featured_at    timestamptz,
  removed        boolean not null default false,
  removed_reason text,
  created_at     timestamptz not null default now()
);

create index if not exists posts_author_idx on public.posts (author_id);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_challenge_idx on public.posts (challenge_id);
create index if not exists posts_category_idx on public.posts (category);
create index if not exists posts_shot_idx on public.posts (shot) where shot;

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

-- Notifications ------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  type         text not null,
  actor_id     uuid references public.users (id) on delete set null,
  post_id      uuid references public.posts (id) on delete cascade,
  challenge_id uuid references public.challenges (id) on delete set null,
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

-- Activity (RISE point ledger) ---------------------------------------------
create table if not exists public.activity (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  type         text not null,
  points       integer not null default 0,
  post_id      uuid references public.posts (id) on delete set null,
  challenge_id uuid references public.challenges (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists activity_user_idx on public.activity (user_id, created_at desc);
create index if not exists activity_created_idx on public.activity (created_at desc);

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
alter table public.challenges    enable row level security;
alter table public.notifications enable row level security;
alter table public.reports       enable row level security;
alter table public.activity      enable row level security;

-- Storage -------------------------------------------------------------------
-- Uploaded images and video go to this bucket. Public read so posts render.
insert into storage.buckets (id, name, public)
values ('rise-media', 'rise-media', true)
on conflict (id) do nothing;
