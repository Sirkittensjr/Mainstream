-- Stands in for the parts of a Supabase project that exist before any of
-- FayTarra's own SQL runs: the auth schema GoTrue owns, auth.uid(), and the
-- storage.buckets table. Shapes match Supabase's.
create extension if not exists "pgcrypto";
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
