-- ---------------------------------------------------------------------------
-- FayTarra — Supabase schema
--
-- Run this once in the Supabase SQL editor (or `supabase db execute -f`), then
-- seed the sample community with `npm run seed`.
--
-- Authentication is Supabase Auth. `auth.users` holds identity and passwords;
-- `public.users` below is only the profile that hangs off it.
--
-- The application talks to these tables through the server-side service role
-- and enforces its own rules (blocking, moderation, rating integrity) in one place.
-- RLS is still enabled on every table so that nothing is readable or writable
-- with the anon key by accident.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- Users --------------------------------------------------------------------
-- This is a PROFILE table. Identity and passwords live in `auth.users`, which
-- Supabase Auth owns — FayTarra never sees or stores a password. The id here
-- is the auth user's id, and the profile row is created by the
-- `on_auth_user_created` trigger at the bottom of this file.
create table if not exists public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null unique,
  username      text not null unique,
  display_name  text not null,
  bio           text not null default '',
  avatar_url    text,
  location      text,
  interests     text[] not null default '{}',
  role          text not null default 'user'   check (role in ('user', 'admin')),
  status        text not null default 'active' check (status in ('active', 'suspended', 'banned')),
  status_reason text,
  -- Rating integrity: a moderator can revoke the weight an account's ratings carry.
  trusted       boolean not null default true,
  -- When the @username last changed, for the change cooldown. Null = never.
  username_changed_at timestamptz,
  -- What this person painted their profile in: a key from
  -- src/lib/profile-theme.ts, or null for the default look. Never a colour
  -- value — an unrecognised key renders as the default.
  profile_bg    text,
  profile_box   text,
  -- The three accounts this person picked as their favourites, in order.
  -- Null or empty means the default: the first three accounts they followed.
  top_creators  text[],
  created_at    timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

-- Present for databases created before username changes existed.
alter table public.users add column if not exists username_changed_at timestamptz;
-- Present for databases created before profile colours existed.
alter table public.users add column if not exists profile_bg text;
alter table public.users add column if not exists profile_box text;
-- Present for databases created before the Top 3 existed.
alter table public.users add column if not exists top_creators text[];

create index if not exists users_username_idx on public.users (username);
-- Usernames are unique case-insensitively: "Tommy" must not be a second "tommy".
create unique index if not exists users_username_lower_idx on public.users (lower(username));


-- Posts --------------------------------------------------------------------
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references public.users (id) on delete cascade,
  caption        text not null default '',
  media          jsonb not null default '[]',
  category       text not null default 'Other',
  tags           text[] not null default '{}',
  views          integer not null default 0,
  -- How many times the video on this post has actually been watched. A
  -- different number from `views` above, which counts the post page being
  -- opened: this one counts playback, once per playback session, and only a
  -- video post ever has one. Written server-side only; never from a client.
  video_views    integer not null default 0 check (video_views >= 0),
  -- Set by the author when they post. The media stays behind a cover until
  -- the viewer asks for it.
  content_warning boolean not null default false,
  removed        boolean not null default false,
  removed_reason text,
  -- Automatic temporary review. Deliberately separate from `removed`: removed
  -- is a decision, this is a pause. `temporary_review` expires by itself at
  -- review_expires_at; `admin_hold` has no expiry, because an administrator
  -- holding something is not undone by a clock.
  review_state      text
    check (review_state is null or review_state in ('temporary_review', 'admin_hold')),
  review_started_at timestamptz,
  review_expires_at timestamptz,
  -- How many DISTINCT accounts had reported it when the review started.
  review_reports    integer not null default 0,
  created_at     timestamptz not null default now()
);

-- Present for databases created before content warnings existed.
alter table public.posts add column if not exists content_warning boolean not null default false;

-- Present for databases created before video view counts existed (0010).
alter table public.posts add column if not exists video_views integer not null default 0;

-- Present for databases created before automatic review existed (0009).
alter table public.posts
  add column if not exists review_state      text
    check (review_state is null or review_state in ('temporary_review', 'admin_hold')),
  add column if not exists review_started_at timestamptz,
  add column if not exists review_expires_at timestamptz,
  add column if not exists review_reports    integer not null default 0;

-- Text posts (0011, 0012). Which of the three a text post is — short, story or
-- big — a story's title, and a big message's colour. Null on everything that is
-- not a text post, and on text posts written before kinds existed, which are
-- drawn as short messages. `long` is the first name of `story` and still reads
-- as one. The limits are restated here because a caption arriving straight from
-- an API call never passes through the composer.
alter table public.posts
  add column if not exists text_kind  text,
  add column if not exists text_title text,
  add column if not exists text_style text;

alter table public.posts drop constraint if exists posts_text_kind_check;
alter table public.posts add constraint posts_text_kind_check
  check (text_kind is null or text_kind in ('short', 'story', 'long', 'big'));

alter table public.posts drop constraint if exists posts_text_body_check;
alter table public.posts add constraint posts_text_body_check
  check (
    text_kind is null
    or (text_kind = 'short' and char_length(caption) <= 200)
    or (text_kind in ('story', 'long') and char_length(caption) <= 1000)
    or (text_kind = 'big' and char_length(caption) <= 30)
  );

alter table public.posts drop constraint if exists posts_text_title_check;
alter table public.posts add constraint posts_text_title_check
  check (
    text_title is null
    or (text_kind in ('story', 'long') and char_length(text_title) between 1 and 30)
  );

alter table public.posts drop constraint if exists posts_text_style_check;
alter table public.posts add constraint posts_text_style_check
  check (
    text_style is null
    or (text_kind = 'big' and text_style in ('glow', 'night', 'violet', 'dusk'))
  );

create index if not exists posts_author_idx on public.posts (author_id);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_category_idx on public.posts (category);
create index if not exists posts_visible_idx
  on public.posts (created_at desc) where removed = false;
create index if not exists posts_author_visible_idx
  on public.posts (author_id, created_at desc) where removed = false;
create index if not exists posts_review_idx
  on public.posts (review_state, review_expires_at) where review_state is not null;
create index if not exists posts_video_views_idx on public.posts (video_views desc);

-- Likes --------------------------------------------------------------------
create table if not exists public.likes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index if not exists likes_post_idx on public.likes (post_id);
create index if not exists likes_user_idx on public.likes (user_id);

-- Comments -----------------------------------------------------------------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  -- Replies are one level deep: a reply points at a top-level comment, and a
  -- reply to a reply attaches to the same parent.
  parent_id  uuid references public.comments (id) on delete cascade,
  body       text not null,
  removed    boolean not null default false,
  created_at timestamptz not null default now()
);

-- On a database created before replies existed, `create table if not exists`
-- above is skipped and the column is absent, so indexing it would fail. This
-- makes the file safe to run over an existing database as well as a new one.
alter table public.comments
  add column if not exists parent_id uuid references public.comments (id) on delete cascade;

create index if not exists comments_post_idx on public.comments (post_id);
create index if not exists comments_user_idx on public.comments (user_id);
create index if not exists comments_parent_idx on public.comments (parent_id);

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
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read = false;

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
  -- Set when an administrator cleared the threshold this report counted
  -- toward. Null means it still counts. Set means it is history: still
  -- readable, still attributable, but no longer able to re-trigger a hide.
  cleared_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Present for databases created before automatic review existed (0009).
alter table public.reports add column if not exists cleared_at timestamptz;

create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);

-- ONE report per account per thing, enforced here rather than only in the
-- application. The count that hides a post has to mean "ten people", not "one
-- person pressing a button ten times", and a rule that lives only in code is
-- one forgotten call site away from not existing. A repeat report updates the
-- existing row.
--
-- This file is for an EMPTY project, where there is nothing to conflict. Run
-- over a database that already has duplicate reports the index cannot be built,
-- so rather than aborting the rest of this file it says what to do: migration
-- 0009 folds the duplicates first, keeping the oldest of each, and then builds
-- it. Deliberately not deduplicating here — deleting rows is not something
-- schema.sql should do as a side effect.
do $$
begin
  create unique index if not exists reports_one_per_reporter_idx
    on public.reports (reporter_id, target_type, target_id);
exception when unique_violation then
  raise warning
    'reports_one_per_reporter_idx not created: this database already has more '
    'than one report from the same account on the same target. Run '
    'supabase/migrations/0009_auto_review.sql, which folds those first.';
end $$;
create index if not exists reports_active_target_idx
  on public.reports (target_type, target_id) where cleared_at is null;

-- The moderation log ---------------------------------------------------------
-- Append only in practice: rows are written, never updated. `actor_id` is null
-- when FayTarra itself did it — the automatic hide and the expiry — and an
-- administrator's id when a person did. Clearing a threshold clears what
-- COUNTS; this is what keeps what HAPPENED.
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

-- Video views ---------------------------------------------------------------
-- One row per COUNTED view, which is what makes deduplication possible: a bare
-- counter cannot answer "has this person already been counted for this playback
-- session?", and without that answer a scroll back up a feed is a dozen more
-- views. `posts.video_views` is the total these keep.
--
--   identity    who watched, as far as that can honestly be known: the account
--               id when somebody is signed in, `anon:<opaque browser id>` when
--               they are not. Not a name, an address or an IP, and never shown.
--   dedupe_key  identity plus the browser's key for one playback session. The
--               unique index on it is the rule rather than a convenience: it is
--               what holds when two requests race.
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
-- The cooldown read, on the path of every video anybody watches.
create index if not exists video_views_identity_idx
  on public.video_views (post_id, identity, created_at desc);
create index if not exists video_views_post_idx
  on public.video_views (post_id, created_at desc);

-- 2. Direct messages --------------------------------------------------------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.users (id) on delete cascade,
  recipient_id uuid not null references public.users (id) on delete cascade,
  body         text not null,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint messages_not_self check (sender_id <> recipient_id),
  constraint messages_body_length check (char_length(body) between 1 and 2000)
);

-- A conversation is every row between two people in either direction, so both
-- directions need to be cheap to scan.
create index if not exists messages_sender_idx
  on public.messages (sender_id, recipient_id, created_at desc);
create index if not exists messages_recipient_idx
  on public.messages (recipient_id, sender_id, created_at desc);
create index if not exists messages_inbox_idx
  on public.messages (recipient_id, created_at desc);
create index if not exists messages_unread_idx
  on public.messages (recipient_id) where read_at is null;

-- RLS on, no policies: same as every other table here. The app reads and
-- writes with the service role; the API roles get nothing at all, so a leaked
-- anon key cannot read anybody's messages.
alter table public.messages enable row level security;

-- 3. Messaging requires a MUTUAL follow, enforced in the database -----------
-- The application checks this too, but a check that only lives in application
-- code is one forgotten call site away from not existing. This runs inside the
-- insert, so no request of any kind — not the app, not a leaked key, not a
-- direct SQL session using the service role — can write a message between two
-- people who do not both follow each other.
--
-- Blocks are checked here as well, for the same reason.
create or replace function public.enforce_message_permitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.follows
    where follower_id = new.sender_id and following_id = new.recipient_id
  ) or not exists (
    select 1 from public.follows
    where follower_id = new.recipient_id and following_id = new.sender_id
  ) then
    raise exception 'not_mutual_follow'
      using errcode = 'check_violation',
            hint = 'Both people must follow each other before they can message.';
  end if;

  if exists (
    select 1 from public.blocks
    where (blocker_id = new.sender_id    and blocked_id = new.recipient_id)
       or (blocker_id = new.recipient_id and blocked_id = new.sender_id)
  ) then
    raise exception 'blocked'
      using errcode = 'check_violation',
            hint = 'One of these accounts has blocked the other.';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_require_mutual_follow on public.messages;
create trigger messages_require_mutual_follow
  before insert on public.messages
  for each row execute function public.enforce_message_permitted();

-- Note on unfollowing: existing history is deliberately NOT deleted when a
-- follow ends. It stops being reachable — the app will not open a thread that
-- is no longer mutual — but silently destroying what two people said to each
-- other because one of them unfollowed would be its own kind of wrong.


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
alter table public.messages      enable row level security;
-- The moderation log is not public, and "who reported this" least of all.
alter table public.moderation_events enable row level security;
-- Who watched what is not public either.
alter table public.video_views   enable row level security;

-- Storage -------------------------------------------------------------------
-- Uploaded images and video go to this bucket. Public read so posts render.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'faytarra-media',
  'faytarra-media',
  true,
  262144000, -- 250MB, matching MAX_VIDEO_BYTES in src/lib/video/limits.ts
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do nothing;

-- Present for buckets created before video existed. A bucket still cannot
-- exceed the project's global upload limit, which is a dashboard setting:
-- Settings -> Storage -> "Upload file size limit".
update storage.buckets
set file_size_limit = greatest(coalesce(file_size_limit, 0), 262144000),
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/quicktime', 'video/webm'
    ]
where id = 'faytarra-media';


-- Supabase Auth ------------------------------------------------------------
-- 2. A profile is created automatically for every new auth user ------------
-- Running inside the signup transaction means a duplicate username aborts the
-- whole signup rather than leaving an auth account with no profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_username text;
  desired_display text;
begin
  desired_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  desired_display := coalesce(new.raw_user_meta_data ->> 'display_name', desired_username);

  if desired_username = '' then
    raise exception 'username is required';
  end if;

  if exists (select 1 from public.users where lower(username) = desired_username) then
    raise exception 'username_taken' using errcode = 'unique_violation';
  end if;

  insert into public.users (
    id, email, username, display_name, bio, avatar_url, location,
    interests, role, status, status_reason, trusted, created_at, last_active_at
  )
  values (
    new.id,
    new.email,
    desired_username,
    desired_display,
    coalesce(new.raw_user_meta_data ->> 'bio', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'location', ''),
    coalesce(
      (select array_agg(value::text) from jsonb_array_elements_text(
        coalesce(new.raw_user_meta_data -> 'interests', '[]'::jsonb)) as value),
      '{}'
    ),
    case
      when new.email = any (string_to_array(current_setting('app.admin_emails', true), ','))
      then 'admin' else 'user'
    end,
    'active',
    null,
    true,
    now(),
    now()
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Keep the mirrored email in step with the auth record ------------------
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- 4. Row level security ----------------------------------------------------
-- The application reads and writes with the service role, which bypasses RLS,
-- because rules like blocking and rating integrity are enforced in one place
-- in the service layer. These policies exist so that a leaked anon key cannot
-- be used to read or write anything it should not.
alter table public.users enable row level security;

drop policy if exists "profiles are publicly readable" on public.users;
create policy "profiles are publicly readable"
  on public.users for select
  using (status <> 'banned');

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
      'interests, role, status, status_reason, trusted, profile_bg, profile_box, '
      'top_creators, created_at, last_active_at) '
      'on public.users to %I', api_role);
  end loop;

  -- Only a signed-in person can change anything, and only their own profile
  -- fields. The RLS policy below is what restricts it to their own row.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant update (
      display_name, bio, avatar_url, location, interests,
      profile_bg, profile_box, top_creators
    ) on public.users to authenticated;
  end if;

  -- The moderation log: nothing granted to either API role at all. Not
  -- readable, not writable. There is no version of a browser needing to see
  -- who reported a post or which administrator decided what.
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on public.moderation_events from %I', api_role);
      execute format('revoke all on public.video_views from %I', api_role);
    end if;
  end loop;
end $$;

drop policy if exists "people can edit their own profile" on public.users;
create policy "people can edit their own profile"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
