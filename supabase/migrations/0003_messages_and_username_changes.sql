-- ---------------------------------------------------------------------------
-- Direct messages, and letting people change their @username.
--
-- Run after 0002. Safe to run twice. NOTHING HERE IS DESTRUCTIVE: no drops, no
-- deletes, no column removed, no existing row rewritten.
-- ---------------------------------------------------------------------------

-- 1. Username changes -------------------------------------------------------
-- Records when the handle last changed, which is all the cooldown needs. Null
-- means "never changed", so every existing account is free to change once
-- immediately. The case-insensitive unique index from 0001 already guarantees
-- two people cannot hold the same handle.
alter table public.users
  add column if not exists username_changed_at timestamptz;

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
