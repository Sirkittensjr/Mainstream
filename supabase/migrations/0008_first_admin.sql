-- 0008 — the first administrator
--
-- WHAT THIS DOES. Promotes exactly one existing account, admin@faytarra.com,
-- to `role = 'admin'`. Nothing else.
--
-- WHY A MIGRATION AND NOT A SETTING. FayTarra already has an admin role: the
-- column exists in `public.users`, `requireAdmin()` gates /admin and every
-- admin action against it, and the API roles are not granted UPDATE on it (see
-- the grant block in schema.sql), so a signed-in person cannot promote
-- themselves through PostgREST. What did not exist was a first admin. Someone
-- has to be made one from outside the app, because the app only lets an admin
-- create an admin — which is the correct shape for it, and the reason this is
-- a deliberate, auditable SQL step rather than a button.
--
-- WHAT IT DOES NOT DO:
--   * It does not create an account. The address must already have a verified
--     FayTarra account; if it does not, this raises a notice and changes
--     nothing, rather than inventing a user with no auth record behind it.
--   * It does not touch authentication. The password, the session, the email
--     confirmation — all of it stays exactly as it was.
--   * It does not demote anybody or grant anybody else anything.
--
-- Safe to run twice: promoting an account that is already an admin is a no-op.

do $$
declare
  admin_email constant text := 'admin@faytarra.com';
  promoted    public.users%rowtype;
begin
  -- Matched case-insensitively, because an address is not case sensitive and
  -- somebody signing up as Admin@FayTarra.com is the same person.
  update public.users
     set role = 'admin'
   where lower(email) = lower(admin_email)
     and role <> 'admin'
  returning * into promoted;

  if found then
    raise notice 'Promoted % (@%) to admin.', promoted.email, promoted.username;
    return;
  end if;

  -- Either already an admin, or not there at all. Say which — a migration that
  -- quietly does nothing is how somebody ends up locked out wondering why.
  if exists (select 1 from public.users where lower(email) = lower(admin_email)) then
    raise notice '% is already an admin. Nothing to do.', admin_email;
  else
    raise warning
      'No FayTarra account for %. Create and verify it, then run this file again.',
      admin_email;
  end if;
end $$;

-- A read-back, so running this prints the result rather than asking you to
-- trust it. Expect exactly one row, with role = admin.
select id, email, username, role, status
  from public.users
 where role = 'admin'
 order by created_at;
