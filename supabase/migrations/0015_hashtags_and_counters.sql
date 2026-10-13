-- 0015 — hashtag pages, and counters that cannot lose a count
--
-- WHAT THIS IS FOR. Two things, both additive. Nothing is dropped, rewritten
-- or deleted; every statement is safe to run twice.
--
--   1. `increment_counter` — adds one to a post's counter INSIDE the database.
--      Video views used to be counted by reading the post, adding one in the
--      app and writing the total back, so two people starting the same video
--      at the same moment could be one view. `update … set n = n + 1` cannot.
--
--   2. Hashtags as places. Until now a hashtag was only text: `#Gaming` in a
--      caption, or a word in a post's `tags` list. Now every hashtag has one
--      row in `public.hashtags`, keyed on its lowercased form so `#Gaming`,
--      `#gaming` and `#GAMING` are one hashtag and one page, and every post is
--      filed under its hashtags in `public.post_hashtags` — which is what a
--      hashtag page and search read, instead of every post on FayTarra.
--
-- WHERE A POST'S HASHTAGS COME FROM. Its caption (a photo's, a video's, or a
-- text post's words), a story's title, and its `tags`. The same rules as
-- src/lib/hashtags.ts: `#` then letters, digits or `_`, at least one letter,
-- at most 50 characters, not straight after a letter, digit, `/`, `&` or `#`
-- (so `C#`, `page#section` and `&#39;` are not hashtags), each once, at most
-- 30 per post.
--
-- KEPT IN STEP BY THE DATABASE. A trigger on `posts` re-files a post whenever
-- it is inserted or its caption, title or tags change, and the foreign keys
-- take it off every hashtag page when it is deleted. The app files new posts
-- itself as well (it has to, for the local store); the two agree, and the
-- unique indexes make doing it twice harmless.
--
-- VISIBILITY IS NOT STORED HERE. A removed post, one hidden for review, or one
-- by a suspended account stays filed under its hashtags — it simply never
-- appears, because the app puts every post a hashtag page reads through the
-- same visibility rules as the feeds. Restoring the post puts it back.
--
-- NEEDS ICU. Recognising letters beyond English (`#Café`, `#ÜBER`) uses the
-- ICU collation `und-x-icu`, which every Supabase project has. The check below
-- stops with a clear message, before changing anything, on a database without.

do $$
begin
  if not exists (select 1 from pg_collation where collname = 'und-x-icu') then
    raise exception 'Migration 0015 needs the ICU collation "und-x-icu", and this database has none. Nothing has been changed.';
  end if;
end $$;

-- 1. Counters ----------------------------------------------------------------
--
-- Only the counters named here can be moved, so the function cannot be turned
-- into a way to edit anything else. Nothing is granted to the API roles: the
-- app calls it with the service role.
create or replace function public.increment_counter(
  target_table  text,
  target_id     uuid,
  target_column text,
  amount        integer default 1
)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  result integer;
begin
  if not (target_table = 'posts' and target_column in ('video_views', 'views')) then
    raise exception 'increment_counter: %.% is not a counter', target_table, target_column
      using errcode = '22023';
  end if;
  execute format(
    'update public.%I set %I = %I + $1 where id = $2 returning %I',
    target_table, target_column, target_column, target_column
  )
  into result
  using amount, target_id;
  return result;
end $$;

revoke all on function public.increment_counter(text, uuid, text, integer) from public;

-- 2. Hashtags ----------------------------------------------------------------
--
--   tag      the hashtag's one form: lowercased, without the `#`. Unique — the
--            rule that one word is one hashtag, whatever its capitalisation.
--   display  how it was written the first time somebody published it, which
--            is how its page is titled.
create table if not exists public.hashtags (
  id          uuid primary key default gen_random_uuid(),
  tag         text not null unique,
  display     text not null,
  created_at  timestamptz not null default now(),
  constraint hashtags_tag_shape check (char_length(tag) between 1 and 50 and tag !~ '[#[:space:]]')
);

-- Search: hashtags starting with what was typed (`gam` → #gaming). The unique
-- index above answers exact lookups; LIKE 'gam%' needs pattern ordering.
create index if not exists hashtags_tag_prefix_idx
  on public.hashtags (tag text_pattern_ops);

--   post_created_at  the post's own time, so a hashtag page reads newest first
--                    straight off this index.
create table if not exists public.post_hashtags (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references public.posts (id) on delete cascade,
  tag              text not null references public.hashtags (tag) on delete cascade,
  post_created_at  timestamptz not null,
  unique (post_id, tag)
);

-- A hashtag page: this tag, newest first.
create index if not exists post_hashtags_tag_idx
  on public.post_hashtags (tag, post_created_at desc);

-- 3. Finding a post's hashtags -----------------------------------------------
--
-- The SQL twin of postHashtags() in src/lib/hashtags.ts, so posts written
-- before this migration — and anything that writes a post without going
-- through the app — are filed exactly as the app would file them. Title,
-- then caption, then tags; each hashtag once, first spelling kept; 30 at most.
create or replace function public.hashtags_in(caption text, title text, tags text[])
returns table (tag text, display text)
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  with found as (
    select t.match[1] as word, 1 as part, t.n
      from regexp_matches(
             normalize(coalesce(title, ''), nfkc) collate "und-x-icu",
             '(?<![[:alnum:]_/&#])#([[:alnum:]_]+)', 'g'
           ) with ordinality as t(match, n)
    union all
    select t.match[1], 2, t.n
      from regexp_matches(
             normalize(coalesce(caption, ''), nfkc) collate "und-x-icu",
             '(?<![[:alnum:]_/&#])#([[:alnum:]_]+)', 'g'
           ) with ordinality as t(match, n)
    union all
    select ltrim(btrim(normalize(t.raw, nfkc)), '#'), 3, t.n
      from unnest(coalesce(tags, '{}'::text[])) with ordinality as t(raw, n)
  ),
  valid as (
    select word, lower(word collate "und-x-icu") as tag, part, n
      from found
     where char_length(word) between 1 and 50
       and (word collate "und-x-icu") ~ '^[[:alnum:]_]+$'
       and (word collate "und-x-icu") ~ '[[:alpha:]]'
  ),
  first_spelling as (
    select distinct on (tag) tag, word as display, part, n
      from valid
     order by tag, part, n
  )
  select tag, display
    from first_spelling
   order by part, n
   limit 30
$$;

create or replace function public.sync_post_hashtags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.hashtags (tag, display, created_at)
  select h.tag, h.display, new.created_at
    from public.hashtags_in(new.caption, new.text_title, new.tags) h
  on conflict (tag) do nothing;

  -- Taken out of the post: off that hashtag's page.
  delete from public.post_hashtags p
   where p.post_id = new.id
     and p.tag not in (
       select h.tag from public.hashtags_in(new.caption, new.text_title, new.tags) h
     );

  insert into public.post_hashtags (post_id, tag, post_created_at)
  select new.id, h.tag, new.created_at
    from public.hashtags_in(new.caption, new.text_title, new.tags) h
  on conflict (post_id, tag) do nothing;

  return null;
end $$;

revoke all on function public.sync_post_hashtags() from public;

drop trigger if exists posts_sync_hashtags on public.posts;
create trigger posts_sync_hashtags
  after insert or update of caption, text_title, tags on public.posts
  for each row execute function public.sync_post_hashtags();

-- 4. Every post already published --------------------------------------------
--
-- Filed once, now. Oldest first, so a hashtag's display is how it was first
-- written. Re-running files nothing twice.
insert into public.hashtags (tag, display, created_at)
select distinct on (h.tag) h.tag, h.display, p.created_at
  from public.posts p
 cross join lateral public.hashtags_in(p.caption, p.text_title, p.tags) h
 order by h.tag, p.created_at
on conflict (tag) do nothing;

insert into public.post_hashtags (post_id, tag, post_created_at)
select p.id, h.tag, p.created_at
  from public.posts p
 cross join lateral public.hashtags_in(p.caption, p.text_title, p.tags) h
on conflict (post_id, tag) do nothing;

-- 5. Row level security ------------------------------------------------------
--
-- The app reads and writes these with the service role, which bypasses RLS.
-- Nothing is granted to the API roles: a leaked anon key reads no index and
-- moves no counter.
alter table public.hashtags      enable row level security;
alter table public.post_hashtags enable row level security;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on public.hashtags from %I', api_role);
      execute format('revoke all on public.post_hashtags from %I', api_role);
      execute format(
        'revoke all on function public.increment_counter(text, uuid, text, integer) from %I',
        api_role);
      execute format('revoke all on function public.sync_post_hashtags() from %I', api_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.increment_counter(text, uuid, text, integer) to service_role;
  end if;
end $$;

-- 6. What it looks like afterwards -------------------------------------------
select
  (select count(*) from public.hashtags) as hashtags,
  (select count(*) from public.post_hashtags) as posts_filed,
  (select count(*) from pg_proc where proname = 'increment_counter') as counter_function,
  (select count(*) from pg_trigger where tgname = 'posts_sync_hashtags') as sync_trigger,
  case
    when exists (select 1 from pg_trigger where tgname = 'posts_sync_hashtags')
     and exists (select 1 from pg_proc where proname = 'increment_counter')
    then 'OK — hashtag pages and atomic counters are on'
    else 'NOT APPLIED'
  end as verdict;
