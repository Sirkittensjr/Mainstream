-- Automatic temporary review, proved against the DATABASE rather than the app.
--
-- Run after supabase-shim.sql and schema.sql (or migration 0009) against a
-- throwaway database:
--
--   psql -d faytarra_test -f scripts/e2e/auto-review-checks.sql
--
-- The lines marked "must fail" are EXPECTED to print an error. That is the
-- check passing. Everything here is why a normal account cannot change a report
-- count, clear a threshold, restore hidden content or read the moderation log —
-- not because a button is hidden, but because the database refuses.
-- No transaction, deliberately: the first expected error would abort one and
-- every check after it would report "current transaction is aborted" instead of
-- its own result. rls-checks.sql and admin-checks.sql are written the same way.
-- The fixtures are cleaned up at the end, so this is re-runnable.
\set ON_ERROR_STOP 0

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'author@example.com', '{"username":"archeck"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'rep1@example.com',   '{"username":"arrep1"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'rep2@example.com',   '{"username":"arrep2"}');

insert into public.posts (id, author_id, caption)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', 'under test');

\echo '--- 1. one report per account per thing, enforced by the index ---'
insert into public.reports (reporter_id, target_type, target_id, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000002', 'post',
          'bbbbbbbb-0000-0000-0000-000000000001', 'Spam');
\echo '    must fail: the same account reporting the same post twice'
insert into public.reports (reporter_id, target_type, target_id, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000002', 'post',
          'bbbbbbbb-0000-0000-0000-000000000001', 'Hate speech');
\echo '    must succeed: a DIFFERENT account reporting the same post'
insert into public.reports (reporter_id, target_type, target_id, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000003', 'post',
          'bbbbbbbb-0000-0000-0000-000000000001', 'Spam');
select count(*) as should_be_2 from public.reports
 where target_id = 'bbbbbbbb-0000-0000-0000-000000000001';

\echo ''
\echo '--- 2. review_state cannot be set to anything the app does not mean ---'
\echo '    must fail: an unrecognised review state'
update public.posts set review_state = 'banned_forever'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '    must succeed: the two the app uses'
update public.posts set review_state = 'temporary_review'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
update public.posts set review_state = 'admin_hold'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';

\echo ''
\echo '--- 3. the moderation log is not readable or writable by the API roles ---'
insert into public.moderation_events (target_type, target_id, action, unique_reports, detail)
  values ('post', 'bbbbbbbb-0000-0000-0000-000000000001',
          'auto_review_started', 10, 'reached the threshold');

set role authenticated;
\echo '    must fail: a signed-in account reading the moderation log'
select count(*) from public.moderation_events;
\echo '    must fail: a signed-in account writing a moderation event'
insert into public.moderation_events (target_type, target_id, action)
  values ('post', 'bbbbbbbb-0000-0000-0000-000000000001', 'admin_restored');
reset role;

set role anon;
\echo '    must fail: an anonymous caller reading the moderation log'
select count(*) from public.moderation_events;
reset role;

\echo ''
\echo '--- 4. a signed-in account cannot moderate anything ---'
\echo '    Row level security is what stops these: there is no UPDATE policy on'
\echo '    posts or reports at all, so each one changes 0 rows. A no-op, not an'
\echo '    error — what matters is the 0.'
set role authenticated;
\echo '    restoring a hidden post:'
update public.posts set review_state = null, review_expires_at = null
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '    forging the report count:'
update public.posts set review_reports = 0
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '    clearing the reports that count:'
update public.reports set cleared_at = now()
 where target_id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '    marking a report reviewed:'
update public.reports set status = 'dismissed'
 where target_id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '    deleting a report to get under the threshold:'
delete from public.reports
 where target_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;

\echo ''
\echo '--- 5. nothing above changed anything ---'
select
  (select count(*) from public.reports
    where target_id = 'bbbbbbbb-0000-0000-0000-000000000001') as reports_still_2,
  (select count(*) from public.reports
    where target_id = 'bbbbbbbb-0000-0000-0000-000000000001'
      and cleared_at is not null)                             as cleared_still_0,
  (select review_state from public.posts
    where id = 'bbbbbbbb-0000-0000-0000-000000000001')        as state_still_admin_hold,
  (select count(*) from public.moderation_events
    where target_id = 'bbbbbbbb-0000-0000-0000-000000000001') as log_still_1;


\echo ''
\echo '--- cleanup, so this file can be run again ---'
delete from public.moderation_events
 where target_id = 'bbbbbbbb-0000-0000-0000-000000000001';
delete from auth.users where id in (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000002',
  'aaaaaaaa-0000-0000-0000-000000000003'
);
-- The profile, the post and its reports go with the auth users by cascade.
select count(*) as rows_left from public.reports
 where target_id = 'bbbbbbbb-0000-0000-0000-000000000001';
