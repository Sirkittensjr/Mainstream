-- Stands in for the parts of a Supabase project that exist before any of
-- FayTarra's own SQL runs: the auth schema GoTrue owns, auth.uid(), and the
-- storage.buckets table. Shapes match Supabase's.
create extension if not exists "pgcrypto";
-- The roles Supabase's API layer connects as. Column privileges are granted
-- and revoked against these, so the checks need them to exist.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false
);

-- Supabase grants its API roles access to everything in `public` by default,
-- which is what makes a column-level revoke the thing that actually hides a
-- column. Mirror that here or the checks prove nothing.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
