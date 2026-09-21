\set ON_ERROR_STOP 0
insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000000001','esc@example.com','{"username":"esc","display_name":"Esc"}'),
  ('ffffffff-0000-0000-0000-000000000002','vic@example.com','{"username":"vic","display_name":"Vic"}');

\echo '--- 1. anon reads a profile without the email'
set role anon;
select username, display_name, role from public.users where username = 'esc';
\echo '(must fail: permission denied for column email)'
select email from public.users where username = 'esc';
\echo '(must fail: select * expands to include email)'
select * from public.users where username = 'esc';
reset role;

\echo '--- 2. a signed-in person cannot make themselves an admin (must fail)'
set role authenticated;
set request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000000001';
update public.users set role = 'admin' where id = 'ffffffff-0000-0000-0000-000000000001';
\echo '(must fail: cannot lift their own ban)'
update public.users set status = 'active' where id = 'ffffffff-0000-0000-0000-000000000001';
\echo '(must fail: cannot restore their own revoked rating weight)'
update public.users set trusted = true where id = 'ffffffff-0000-0000-0000-000000000001';
\echo '(must fail: cannot take another persons username)'
update public.users set username = 'taken' where id = 'ffffffff-0000-0000-0000-000000000001';
\echo '(allowed: their own bio)'
update public.users set bio = 'my own bio' where id = 'ffffffff-0000-0000-0000-000000000001';
\echo '(must change nothing: someone elses bio, blocked by the RLS policy)'
update public.users set bio = 'hacked' where id = 'ffffffff-0000-0000-0000-000000000002';
reset role;
select username, role, status, trusted, bio from public.users where username in ('esc','vic') order by username;

\echo '--- 3. the other tables are closed to the API roles (RLS on, no policies)'
set role authenticated;
set request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000000001';
\echo '(must fail or affect 0 rows: writing a post directly)'
insert into public.posts (author_id, caption) values ('ffffffff-0000-0000-0000-000000000001','direct');
\echo '(must return 0 rows: reading ratings directly)'
select count(*) as visible_ratings from public.ratings;
\echo '(must return 0 rows: reading other peoples notifications)'
select count(*) as visible_notifications from public.notifications;
reset role;
