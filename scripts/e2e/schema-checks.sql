\set ON_ERROR_STOP 0
\echo '--- 1. a new auth user gets a FayTarra profile, in the same transaction'
insert into auth.users (id, email, raw_user_meta_data) values (
  '11111111-1111-1111-1111-111111111111', 'ada@example.com',
  '{"username":"ada","display_name":"Ada","bio":"hi","location":"Leeds","interests":["Music","Art"]}'
);
select id, email, username, display_name, bio, location, interests, role, status, trusted
from public.users where id = '11111111-1111-1111-1111-111111111111';

\echo '--- 2. no password is stored anywhere in public.users'
select count(*) as password_columns from information_schema.columns
where table_schema='public' and table_name='users' and column_name like '%password%';

\echo '--- 3. a duplicate username aborts the whole signup (expect an error, then 0 rows)'
begin;
insert into auth.users (email, raw_user_meta_data)
values ('ada2@example.com', '{"username":"ada","display_name":"Ada Two"}');
rollback;
select count(*) as leftover_auth_users from auth.users where email = 'ada2@example.com';

\echo '--- 4. usernames are unique case-insensitively (expect an error)'
begin;
insert into auth.users (email, raw_user_meta_data)
values ('ada3@example.com', '{"username":"ADA","display_name":"Shouty Ada"}');
rollback;

\echo '--- 5. a missing username is refused (expect an error)'
begin;
insert into auth.users (email, raw_user_meta_data) values ('nobody@example.com', '{}');
rollback;

\echo '--- 6. changing the auth email updates the mirrored profile email'
update auth.users set email = 'ada@newmail.com' where id = '11111111-1111-1111-1111-111111111111';
select email from public.users where id = '11111111-1111-1111-1111-111111111111';

\echo '--- 7. a profile cannot exist without an auth user (expect a foreign key error)'
begin;
insert into public.users (id, email, username, display_name)
values (gen_random_uuid(), 'ghost@example.com', 'ghost', 'Ghost');
rollback;

\echo '--- 8. deleting the auth user cascades the profile and its content away'
insert into public.posts (id, author_id, caption) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'hello');
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select
  (select count(*) from public.users where id = '11111111-1111-1111-1111-111111111111') as profiles_left,
  (select count(*) from public.posts where id = '22222222-2222-2222-2222-222222222222') as posts_left;

\echo '--- 9. RLS is on for every table'
select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename;
