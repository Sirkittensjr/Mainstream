-- Every play counts (migration 0017), enforced by the DATABASE.
--
--   psql -d faytarra_test -f scripts/e2e/play-count-checks.sql
--
-- Run against a database built from supabase/schema.sql, or any FayTarra
-- database after 0017 (scripts/e2e/supabase-roles.sql first, for the roles).
-- Each check raises an exception when it fails. A clean run prints the section
-- headers and an error under each line marked "must fail" — those errors are
-- the check passing — and no other error. Cleans up after itself.

\set ON_ERROR_STOP 0

insert into auth.users (id, email, raw_user_meta_data) values
  ('7b9a0000-0000-0000-0000-000000000001', 'plays1@example.com', '{"username":"playcheckone"}'),
  ('7b9a0000-0000-0000-0000-000000000002', 'plays2@example.com', '{"username":"playchecktwo"}');

insert into public.posts (id, author_id, caption, media, tags, video_views) values
  -- A video that already has views: they are kept.
  ('7b9ab000-0000-0000-0000-000000000001', '7b9a0000-0000-0000-0000-000000000001', 'a clip',
   '[{"kind":"video","url":"/v.webm"}]', '{}', 5),
  -- A photo: nothing to play.
  ('7b9ab000-0000-0000-0000-000000000002', '7b9a0000-0000-0000-0000-000000000001', 'a photo',
   '[{"kind":"image","url":"/p.jpg"}]', '{}', 0),
  -- At the very top of what the column can hold: one more view cannot be added.
  ('7b9ab000-0000-0000-0000-000000000003', '7b9a0000-0000-0000-0000-000000000001', 'a full clip',
   '[{"kind":"video","url":"/v.webm"}]', '{}', 2147483647),
  -- For the ten thousand plays.
  ('7b9ab000-0000-0000-0000-000000000004', '7b9a0000-0000-0000-0000-000000000001', 'a loop',
   '[{"kind":"video","url":"/v.webm"}]', '{}', 0);

\echo '--- 1. a play counts once, and the views a video already had are kept ---'
do $$
declare
  answer record;
begin
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001',
    '7b9a0000-0000-0000-0000-000000000002', '7b9a0000-0000-0000-0000-000000000002', 'check:one');
  if not answer.counted or answer.total <> 6 or answer.reason is not null then
    raise exception 'first play: got counted=%, total=%, reason=%', answer.counted, answer.total, answer.reason;
  end if;
  if (select count(*) from public.video_views where dedupe_key = 'check:one') <> 1 then
    raise exception 'the play was not stored';
  end if;
end $$;

\echo '--- 2. the same playback session again — a retry, a duplicate event — counts nothing ---'
do $$
declare
  answer record;
begin
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001',
    '7b9a0000-0000-0000-0000-000000000002', '7b9a0000-0000-0000-0000-000000000002', 'check:one');
  if answer.counted or answer.total <> 6 or answer.reason <> 'duplicate-session' then
    raise exception 'duplicate: got counted=%, total=%, reason=%', answer.counted, answer.total, answer.reason;
  end if;
  if (select count(*) from public.video_views where post_id = '7b9ab000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'a duplicate was stored';
  end if;
end $$;

\echo '--- 3. repeat plays by the same viewer all count: the creator, a visitor, anybody ---'
do $$
declare
  answer record;
begin
  -- The same viewer again, a moment later: a new play.
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001',
    '7b9a0000-0000-0000-0000-000000000002', '7b9a0000-0000-0000-0000-000000000002', 'check:two');
  if not answer.counted or answer.total <> 7 then
    raise exception 'repeat play: got counted=%, total=%', answer.counted, answer.total;
  end if;
  -- The creator, watching their own.
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001',
    '7b9a0000-0000-0000-0000-000000000001', '7b9a0000-0000-0000-0000-000000000001', 'check:own');
  if not answer.counted or answer.total <> 8 then
    raise exception 'creator: got counted=%, total=%', answer.counted, answer.total;
  end if;
  -- A visitor nobody signed in as, by their browser.
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001',
    null, 'anon:check-browser', 'check:visitor');
  if not answer.counted or answer.total <> 9 then
    raise exception 'visitor: got counted=%, total=%', answer.counted, answer.total;
  end if;
end $$;

\echo '--- 4. ten thousand plays by one viewer are ten thousand views ---'
-- Played as fast as a 0.25-second clip loops — forty in each ten seconds —
-- with the clock moved on between batches (the batch's plays are moved back
-- ten seconds, which is the same thing as far as the ceiling is concerned).
-- Each play is its own call, as each report is; a batch is one transaction.
create procedure pg_temp.play_ten_thousand() language plpgsql as $$
declare
  answer record;
  i integer;
  counted integer := 0;
begin
  for i in 1..10000 loop
    select * into answer from public.record_video_play(
      gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000004',
      '7b9a0000-0000-0000-0000-000000000002', '7b9a0000-0000-0000-0000-000000000002',
      'check:loop-' || i);
    if answer.counted then counted := counted + 1; end if;
    if i % 40 = 0 then
      update public.video_views set created_at = created_at - interval '10 seconds'
       where post_id = '7b9ab000-0000-0000-0000-000000000004'
         and created_at > now() - interval '10 seconds';
      commit;
    end if;
  end loop;
  if counted <> 10000 then
    raise exception 'ten thousand plays: % counted', counted;
  end if;
end $$;
call pg_temp.play_ten_thousand();
do $$
begin
  if (select video_views from public.posts where id = '7b9ab000-0000-0000-0000-000000000004') <> 10000 then
    raise exception 'ten thousand plays: total %',
      (select video_views from public.posts where id = '7b9ab000-0000-0000-0000-000000000004');
  end if;
  if (select count(*) from public.video_views where post_id = '7b9ab000-0000-0000-0000-000000000004') <> 10000 then
    raise exception 'ten thousand plays: rows do not match the total';
  end if;
end $$;

\echo '--- 5. faster than anybody can start a video: the 51st play inside ten seconds is refused ---'
do $$
declare
  answer record;
  i integer;
  before integer := (select video_views from public.posts where id = '7b9ab000-0000-0000-0000-000000000004');
begin
  update public.video_views set created_at = created_at - interval '1 hour'
   where post_id = '7b9ab000-0000-0000-0000-000000000004';
  for i in 1..50 loop
    select * into answer from public.record_video_play(
      gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000004',
      null, 'anon:script', 'check:burst-' || i);
    if not answer.counted then raise exception 'burst play % was refused', i; end if;
  end loop;
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000004',
    null, 'anon:script', 'check:burst-51');
  if answer.counted or answer.reason <> 'too-fast' or answer.total <> before + 50 then
    raise exception '51st: got counted=%, total=%, reason=%', answer.counted, answer.total, answer.reason;
  end if;
  -- Another viewer is not affected.
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000004',
    null, 'anon:somebody-else', 'check:burst-other');
  if not answer.counted then raise exception 'the ceiling is not per viewer'; end if;
  -- Ten seconds on, the same viewer counts again.
  update public.video_views set created_at = created_at - interval '11 seconds'
   where post_id = '7b9ab000-0000-0000-0000-000000000004';
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000004',
    null, 'anon:script', 'check:burst-later');
  if not answer.counted then raise exception 'the ceiling did not lift'; end if;
end $$;

\echo '--- 6. nothing that is not a visible video can be counted ---'
do $$
declare
  answer record;
begin
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000002', null, 'anon:check-browser', 'check:photo');
  if answer.counted or answer.reason <> 'not-a-video' then
    raise exception 'photo: got counted=%, reason=%', answer.counted, answer.reason;
  end if;
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-0000000000ff', null, 'anon:check-browser', 'check:missing');
  if answer.counted or answer.total is not null or answer.reason <> 'no-post' then
    raise exception 'missing post: got counted=%, total=%, reason=%', answer.counted, answer.total, answer.reason;
  end if;

  update public.posts set review_state = 'temporary_review' where id = '7b9ab000-0000-0000-0000-000000000001';
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001', null, 'anon:check-browser', 'check:review');
  if answer.counted or answer.reason <> 'no-post' then
    raise exception 'under review: got counted=%, reason=%', answer.counted, answer.reason;
  end if;
  update public.posts set review_state = null, removed = true where id = '7b9ab000-0000-0000-0000-000000000001';
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001', null, 'anon:check-browser', 'check:removed');
  if answer.counted or answer.reason <> 'no-post' then
    raise exception 'removed: got counted=%, reason=%', answer.counted, answer.reason;
  end if;
  update public.posts set removed = false where id = '7b9ab000-0000-0000-0000-000000000001';

  if exists (select 1 from public.video_views
              where dedupe_key in ('check:photo', 'check:missing', 'check:review', 'check:removed')) then
    raise exception 'a refused play was stored';
  end if;
  if (select video_views from public.posts where id = '7b9ab000-0000-0000-0000-000000000002') <> 0 then
    raise exception 'a photo has video views';
  end if;
  if (select video_views from public.posts where id = '7b9ab000-0000-0000-0000-000000000001') <> 9 then
    raise exception 'a refused play moved a total';
  end if;
end $$;

\echo '--- 7. a malformed play is refused outright ---'
\echo 'must fail (x3): malformed play'
select * from public.record_video_play(gen_random_uuid(), null, null, 'anon:x', 'check:null-post');
select * from public.record_video_play(gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001', null, '', 'check:no-identity');
select * from public.record_video_play(gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001', null, 'anon:x', repeat('k', 401));

\echo '--- 8. when the total cannot be raised, the play is not stored either ---'
\echo 'must fail: integer out of range'
select * from public.record_video_play(
  gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000003', null, 'anon:check-browser', 'check:overflow');
do $$
begin
  if exists (select 1 from public.video_views where dedupe_key = 'check:overflow') then
    raise exception 'the play row survived its total failing: this is the lost-view bug';
  end if;
end $$;

\echo '--- 9. the counter cannot be turned on anything else, or moved down ---'
\echo 'must fail (x4): not a counter / counters only go up'
select public.increment_counter('users', '7b9a0000-0000-0000-0000-000000000001', 'points', 1);
select public.increment_counter('posts', '7b9ab000-0000-0000-0000-000000000001', 'review_reports', 1);
select public.increment_counter('posts', '7b9ab000-0000-0000-0000-000000000001', 'video_views', 0);
select public.increment_counter('posts', '7b9ab000-0000-0000-0000-000000000001', 'video_views', -100);

\echo '--- 10. the API roles can neither count a play nor read or write who watched ---'
set role anon;
\echo 'must fail (x4): permission denied'
select * from public.record_video_play(
  gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001', null, 'anon:forged', 'check:forged-anon');
select public.increment_counter('posts', '7b9ab000-0000-0000-0000-000000000001', 'video_views', 100);
select count(*) from public.video_views;
insert into public.video_views (post_id, identity, dedupe_key)
  values ('7b9ab000-0000-0000-0000-000000000001', 'anon:forged', 'check:forged-row');
reset role;
set role authenticated;
\echo 'must fail (x4): permission denied'
select * from public.record_video_play(
  gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001', null, 'anon:forged', 'check:forged-auth');
select public.increment_counter('posts', '7b9ab000-0000-0000-0000-000000000001', 'video_views', 100);
select count(*) from public.video_views;
insert into public.video_views (post_id, identity, dedupe_key)
  values ('7b9ab000-0000-0000-0000-000000000001', 'anon:forged', 'check:forged-row');
reset role;
set role service_role;
do $$
declare
  answer record;
begin
  select * into answer from public.record_video_play(
    gen_random_uuid(), '7b9ab000-0000-0000-0000-000000000001', null, 'anon:check-browser', 'check:service-role');
  if not answer.counted or answer.total <> 10 then
    raise exception 'the service role could not count a play: counted=%, total=%', answer.counted, answer.total;
  end if;
end $$;
reset role;
do $$
begin
  if (select video_views from public.posts where id = '7b9ab000-0000-0000-0000-000000000001') <> 10 then
    raise exception 'an API role moved the count';
  end if;
  if exists (select 1 from public.video_views where dedupe_key like 'check:forged%') then
    raise exception 'an API role stored a play';
  end if;
end $$;

\echo '--- 11. running 0017 again keeps every total ---'
\ir ../../supabase/migrations/0017_count_every_play.sql
do $$
begin
  if (select video_views from public.posts where id = '7b9ab000-0000-0000-0000-000000000001') <> 10
     or (select video_views from public.posts where id = '7b9ab000-0000-0000-0000-000000000004') < 10000
     or (select video_views from public.posts where id = '7b9ab000-0000-0000-0000-000000000003') <> 2147483647 then
    raise exception 'running 0017 again changed a total';
  end if;
end $$;

\echo '--- cleanup ---'
delete from public.posts where id::text like '7b9ab000-%';
delete from auth.users where id::text like '7b9a0000-%';
