-- Video views (migration 0016), enforced by the DATABASE.
--
--   psql -d faytarra_test -f scripts/e2e/views-checks.sql
--
-- Each check raises an exception when it fails. A clean run prints the section
-- headers and an error under each line marked "must fail" — those errors are
-- the check passing — and no other error. Cleans up after itself.

\set ON_ERROR_STOP 0

insert into auth.users (id, email, raw_user_meta_data) values
  ('7a9a0000-0000-0000-0000-000000000001', 'views1@example.com', '{"username":"viewcheckone"}'),
  ('7a9a0000-0000-0000-0000-000000000002', 'views2@example.com', '{"username":"viewchecktwo"}');

insert into public.posts (id, author_id, caption, media, tags, video_views) values
  ('7a9ab000-0000-0000-0000-000000000001', '7a9a0000-0000-0000-0000-000000000001', 'a clip',
   '[{"kind":"video","url":"/v.webm"}]', '{}', 5),
  -- At the very top of what the column can hold: one more view cannot be added.
  ('7a9ab000-0000-0000-0000-000000000002', '7a9a0000-0000-0000-0000-000000000001', 'a full clip',
   '[{"kind":"video","url":"/v.webm"}]', '{}', 2147483647);

\echo '--- 1. one call stores the view and adds it to the total ---'
do $$
declare
  answer record;
begin
  select * into answer from public.record_video_view(
    '7a9ac000-0000-0000-0000-000000000001', '7a9ab000-0000-0000-0000-000000000001',
    '7a9a0000-0000-0000-0000-000000000002', '7a9a0000-0000-0000-0000-000000000002',
    'check:session-one', now());
  if not answer.counted or answer.total <> 6 then
    raise exception 'first report: got counted=%, total=%', answer.counted, answer.total;
  end if;
  if (select video_views from public.posts where id = '7a9ab000-0000-0000-0000-000000000001') <> 6 then
    raise exception 'the total did not move';
  end if;
  if (select count(*) from public.video_views where dedupe_key = 'check:session-one') <> 1 then
    raise exception 'the view row was not stored';
  end if;
end $$;

\echo '--- 2. the same playback session again counts nothing, and says what is stored ---'
do $$
declare
  answer record;
begin
  select * into answer from public.record_video_view(
    '7a9ac000-0000-0000-0000-000000000002', '7a9ab000-0000-0000-0000-000000000001',
    '7a9a0000-0000-0000-0000-000000000002', '7a9a0000-0000-0000-0000-000000000002',
    'check:session-one', now());
  if answer.counted or answer.total <> 6 then
    raise exception 'duplicate: got counted=%, total=%', answer.counted, answer.total;
  end if;
  if (select count(*) from public.video_views where post_id = '7a9ab000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'a duplicate was stored';
  end if;

  -- A new playback session by the same person is a new view.
  select * into answer from public.record_video_view(
    '7a9ac000-0000-0000-0000-000000000003', '7a9ab000-0000-0000-0000-000000000001',
    '7a9a0000-0000-0000-0000-000000000002', '7a9a0000-0000-0000-0000-000000000002',
    'check:session-two', now());
  if not answer.counted or answer.total <> 7 then
    raise exception 'second session: got counted=%, total=%', answer.counted, answer.total;
  end if;
end $$;

\echo '--- 3. no such post: nothing stored ---'
do $$
declare
  answer record;
begin
  select * into answer from public.record_video_view(
    '7a9ac000-0000-0000-0000-000000000004', '7a9ab000-0000-0000-0000-0000000000ff',
    null, 'anon:check-browser', 'check:no-post', now());
  if answer.counted or answer.total is not null then
    raise exception 'missing post: got counted=%, total=%', answer.counted, answer.total;
  end if;
  if exists (select 1 from public.video_views where dedupe_key = 'check:no-post') then
    raise exception 'a view was stored for a post that does not exist';
  end if;
end $$;

\echo '--- 4. when the total cannot be raised, the view is not stored either ---'
\echo 'must fail: integer out of range'
select * from public.record_video_view(
  '7a9ac000-0000-0000-0000-000000000005', '7a9ab000-0000-0000-0000-000000000002',
  null, 'anon:check-browser', 'check:overflow', now());
do $$
begin
  if exists (select 1 from public.video_views where dedupe_key = 'check:overflow') then
    raise exception 'the view row survived its total failing: this is the lost-view bug';
  end if;
end $$;

\echo '--- 5. the API roles cannot count views ---'
set role anon;
\echo 'must fail (x2)'
select * from public.record_video_view(
  '7a9ac000-0000-0000-0000-000000000006', '7a9ab000-0000-0000-0000-000000000001',
  null, 'anon:forged', 'check:forged-anon', now());
select public.increment_counter('posts', '7a9ab000-0000-0000-0000-000000000001', 'video_views', 100);
reset role;
set role authenticated;
\echo 'must fail (x2)'
select * from public.record_video_view(
  '7a9ac000-0000-0000-0000-000000000007', '7a9ab000-0000-0000-0000-000000000001',
  null, 'anon:forged', 'check:forged-auth', now());
select public.increment_counter('posts', '7a9ab000-0000-0000-0000-000000000001', 'video_views', 100);
reset role;
set role service_role;
do $$
declare
  answer record;
begin
  select * into answer from public.record_video_view(
    '7a9ac000-0000-0000-0000-000000000008', '7a9ab000-0000-0000-0000-000000000001',
    null, 'anon:check-browser', 'check:service-role', now());
  if not answer.counted then raise exception 'the service role could not count a view'; end if;
end $$;
reset role;
do $$
begin
  if (select video_views from public.posts where id = '7a9ab000-0000-0000-0000-000000000001') <> 8 then
    raise exception 'an API role moved the count';
  end if;
end $$;

\echo '--- 6. the repair adds stored-but-uncounted views, never lowers a total, and is idempotent ---'
-- A view stored the old way, whose +1 never landed.
insert into public.video_views (post_id, viewer_id, identity, dedupe_key)
  values ('7a9ab000-0000-0000-0000-000000000001', null, 'anon:check-browser', 'check:stranded');
update public.posts set video_views = 3 where id = '7a9ab000-0000-0000-0000-000000000001';
\ir ../../supabase/migrations/0016_record_video_view.sql
do $$
begin
  -- Four rows: session-one, session-two, service-role, stranded.
  if (select video_views from public.posts where id = '7a9ab000-0000-0000-0000-000000000001') <> 4 then
    raise exception 'repair: got %', (select video_views from public.posts where id = '7a9ab000-0000-0000-0000-000000000001');
  end if;
  if (select video_views from public.posts where id = '7a9ab000-0000-0000-0000-000000000002') <> 2147483647 then
    raise exception 'repair lowered a total that was already higher than its rows';
  end if;
end $$;
\ir ../../supabase/migrations/0016_record_video_view.sql
do $$
begin
  if (select video_views from public.posts where id = '7a9ab000-0000-0000-0000-000000000001') <> 4 then
    raise exception 'running 0016 again changed the total';
  end if;
end $$;

-- Clean up.
delete from public.posts where author_id in (
  '7a9a0000-0000-0000-0000-000000000001', '7a9a0000-0000-0000-0000-000000000002');
delete from auth.users where id in (
  '7a9a0000-0000-0000-0000-000000000001', '7a9a0000-0000-0000-0000-000000000002');

\echo 'Done. Any ERROR above that is not under a "must fail" line is a failed check.'
