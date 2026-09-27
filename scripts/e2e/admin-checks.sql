-- The admin role, proved against a real Postgres.
--
--   createdb faytarra_admin
--   psql -v ON_ERROR_STOP=1 -d faytarra_admin -f scripts/e2e/supabase-shim.sql
--   psql -v ON_ERROR_STOP=1 -d faytarra_admin -f supabase/schema.sql
--   psql -d faytarra_admin -f scripts/e2e/admin-checks.sql
--
-- The lines marked "must fail" are EXPECTED to print an error. That is the
-- check passing: it is the database refusing, not the application.
--
-- What this is really testing is that admin is not an application convention.
-- `role` is simply not granted to the API roles, so a signed-in person holding
-- the anon key cannot write it through PostgREST however they ask.

\echo '--- setup: one ordinary account, and the address that becomes admin ---'
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'admin@faytarra.com',
   '{"username":"fayadmin","display_name":"FayTarra Admin"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'normal@example.com',
   '{"username":"normalperson","display_name":"Normal"}'::jsonb)
on conflict (id) do nothing;

\echo ''
\echo '--- 1. everybody starts as a normal user ---'
select email, role from public.users order by email;

\echo ''
\echo '--- 2. migration 0008 promotes exactly one account ---'
\i supabase/migrations/0008_first_admin.sql

\echo ''
\echo '--- 3. and running it again changes nothing (idempotent) ---'
\i supabase/migrations/0008_first_admin.sql

\echo ''
\echo '--- 4. there is exactly ONE admin, and it is the right address ---'
select count(*) = 1 as exactly_one_admin from public.users where role = 'admin';
select email = 'admin@faytarra.com' as correct_account from public.users where role = 'admin';

\echo ''
\echo '--- 5. must fail: a signed-in person makes THEMSELVES an admin ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
rollback;

\echo ''
\echo '--- 6. must fail: a signed-in person DEMOTES the admin ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'user' where email = 'admin@faytarra.com';
rollback;

\echo ''
\echo '--- 7. must fail: a signed-in person promotes SOMEBODY ELSE ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'admin' where email = 'normal@example.com';
rollback;

\echo ''
\echo '--- 8. must fail: anon reads the admin''s email address ---'
begin;
set local role anon;
select email from public.users where role = 'admin';
rollback;

\echo ''
\echo '--- 9. normal profile editing is UNAFFECTED: same person, same session ---'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.users set bio = 'an ordinary edit' where id = '22222222-2222-2222-2222-222222222222';
select bio from public.users where id = '22222222-2222-2222-2222-222222222222';
commit;

\echo ''
\echo '--- 10. nothing above changed who is an admin ---'
select email, role from public.users order by email;
