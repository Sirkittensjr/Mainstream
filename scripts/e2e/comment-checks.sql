-- Comment deletion and video views, enforced by the DATABASE as well as the app.
--
-- Run after supabase-shim.sql and schema.sql (see README). Lines marked
-- "must fail" are expected to print an error; "must be 0" lines are the
-- check passing when they print 0 — row level security makes a forbidden
-- delete a no-op rather than an error.
\set ON_ERROR_STOP 0

insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000001','owner@example.com','{"username":"cowner","display_name":"Owner"}'),
  ('cccccccc-0000-0000-0000-000000000002','commenter@example.com','{"username":"ccommenter","display_name":"Commenter"}');

insert into public.posts (id, author_id, caption, media) values
  ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','a video',
   '[{"kind":"video","url":"/api/media/v.webm"}]');

insert into public.comments (id, post_id, user_id, body) values
  ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000002','a comment');
insert into public.comments (id, post_id, user_id, parent_id, body) values
  ('eeeeeeee-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','a reply');

\echo '--- 1. nobody deletes a comment straight through the API — not even their own'
\echo '    (the app does it server-side, after checking who is asking)'
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000002';
\echo '(must fail or be 0: the commenter deleting their own comment directly)'
with gone as (delete from public.comments where id = 'eeeeeeee-0000-0000-0000-000000000001' returning 1)
select count(*) as deleted_by_commenter from gone;
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
\echo '(must fail or be 0: the post owner deleting a comment directly)'
with gone as (delete from public.comments where post_id = 'dddddddd-0000-0000-0000-000000000001' returning 1)
select count(*) as deleted_by_owner from gone;
\echo '(must fail or be 0: rewriting a comment directly)'
with changed as (update public.comments set body = 'edited' returning 1)
select count(*) as updated from changed;
\echo '(must fail: writing a comment directly)'
insert into public.comments (post_id, user_id, body)
values ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','direct');
\echo '(must be 0: reading comments directly)'
select count(*) as visible_comments from public.comments;
reset role;

set role anon;
\echo '(must fail or be 0: anon deleting comments)'
with gone as (delete from public.comments returning 1) select count(*) as deleted_by_anon from gone;
reset role;

\echo '(both comments still there: 2)'
select count(*) as comments_left from public.comments
where post_id = 'dddddddd-0000-0000-0000-000000000001';

\echo '--- 2. deleting a comment takes its replies with it, so nothing is left replying to nothing'
delete from public.comments where id = 'eeeeeeee-0000-0000-0000-000000000001';
\echo '(must be 0: the reply went with it)'
select count(*) as orphaned_replies from public.comments
where id = 'eeeeeeee-0000-0000-0000-000000000002';

\echo '--- 3. one playback session is one stored view'
insert into public.video_views (post_id, viewer_id, identity, dedupe_key)
values ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
        'cccccccc-0000-0000-0000-000000000002','check:session-1');
\echo '(must fail: the same session stored twice — duplicate key)'
insert into public.video_views (post_id, viewer_id, identity, dedupe_key)
values ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
        'cccccccc-0000-0000-0000-000000000002','check:session-1');
\echo '(allowed: a new session by the same person — a re-watch)'
insert into public.video_views (post_id, viewer_id, identity, dedupe_key)
values ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
        'cccccccc-0000-0000-0000-000000000002','check:session-2');
select count(*) as stored_views from public.video_views
where post_id = 'dddddddd-0000-0000-0000-000000000001';

\echo '(must fail: a view total below zero)'
update public.posts set video_views = -1 where id = 'dddddddd-0000-0000-0000-000000000001';

\echo '--- 4. no API role can read or write views, or move the total'
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000002';
\echo '(must fail: reading who watched what)'
select count(*) from public.video_views;
\echo '(must fail: writing a view directly)'
insert into public.video_views (post_id, identity, dedupe_key)
values ('dddddddd-0000-0000-0000-000000000001','x','check:forged');
\echo '(must fail or be 0: setting a view total directly)'
with changed as (
  update public.posts set video_views = 1000000
  where id = 'dddddddd-0000-0000-0000-000000000001' returning 1
) select count(*) as totals_changed from changed;
reset role;
select video_views as total_unchanged from public.posts
where id = 'dddddddd-0000-0000-0000-000000000001';
