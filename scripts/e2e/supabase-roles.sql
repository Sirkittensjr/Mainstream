-- The roles and defaults a Supabase project has before anything of FayTarra's
-- exists, for running the app against a REAL PostgREST (see
-- supabase-gateway.mjs). Run it first, then supabase-shim.sql, then
-- supabase/schema.sql.
--
-- What matters about them, because it is what production does:
--
--   service_role   what the app's server key becomes inside Postgres. Bypasses
--                  row level security, and is granted everything in `public`
--                  by default — which is why FayTarra's own grants and revokes
--                  only ever talk about anon and authenticated.
--   authenticator  the login PostgREST connects as, switching to one of the
--                  three above for each request according to its JWT.
--
-- And the event triggers: Supabase tells PostgREST to reload its schema cache
-- whenever DDL runs, so a migration's new tables and functions are callable at
-- once. Without them a newly created function answers "not found" until a
-- restart, which is a different system from the one being tested.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator-local-only';
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists extensions;

create or replace function extensions.pgrst_reload() returns event_trigger
language plpgsql as $$
begin
  notify pgrst, 'reload schema';
end $$;

drop event trigger if exists pgrst_ddl_watch;
create event trigger pgrst_ddl_watch on ddl_command_end execute function extensions.pgrst_reload();
drop event trigger if exists pgrst_drop_watch;
create event trigger pgrst_drop_watch on sql_drop execute function extensions.pgrst_reload();
