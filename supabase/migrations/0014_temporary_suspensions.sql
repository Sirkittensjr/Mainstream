-- 0014 — temporary suspensions
--
-- One nullable timestamp column on public.users: when a temporary suspension
-- ends. Null — every existing row — means no end date, which is exactly how
-- every suspension has worked until now: it lasts until a moderator reinstates
-- the account.
--
-- The app treats a suspension whose end has passed as over the moment it
-- passes (no scheduler), and writes `status = 'active'` the next time the
-- person signs in.
--
-- NOT granted to the API roles, on purpose. Migration 0002 lists the columns
-- `anon` and `authenticated` may read and the few a person may update on their
-- own row; a new column is in neither list until it is added. This one stays
-- out of both: nobody reads somebody else's suspension date through the API,
-- and nobody can shorten their own. The app writes it with the service role.
--
-- Safe to run twice. Adds one nullable column. Nothing is dropped, deleted or
-- rewritten, no grant is changed, and no other table is touched.
--
-- Not running it is survivable: suspensions still work, but every suspension
-- lasts until a moderator reinstates the account, and the moderation log says
-- so when a moderator picks a number of days.

-- 1. The column --------------------------------------------------------------
alter table public.users add column if not exists suspended_until timestamptz;

-- 2. What is there now -------------------------------------------------------
select
  case
    when exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'users'
                   and column_name = 'suspended_until')
      then 'APPLIED'
    else 'NOT APPLIED'
  end as verdict;
