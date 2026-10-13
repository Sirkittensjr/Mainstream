-- Hashtag pages and atomic counters (migration 0015), enforced by the DATABASE.
--
--   psql -d faytarra_test -f scripts/e2e/hashtag-checks.sql
--
-- Each check raises an exception when it fails. A clean run prints the section
-- headers and an error under each line marked "must fail" — those errors are
-- the check passing — and no other error. Cleans up after itself.

\set ON_ERROR_STOP 0

insert into auth.users (id, email, raw_user_meta_data) values
  ('7a990000-0000-0000-0000-000000000001', 'tags1@example.com', '{"username":"tagcheckone"}'),
  ('7a990000-0000-0000-0000-000000000002', 'tags2@example.com', '{"username":"tagchecktwo"}');

\echo '--- 1. what a hashtag is: the same rules as src/lib/hashtags.ts ---'
do $$
declare
  got text;
begin
  select string_agg(tag || '=' || display, ' ' order by ord) into got
    from (select tag, display, row_number() over () as ord
            from public.hashtags_in('Clutch #Gaming #fps and again #gaming', null, '{}')) t;
  if got is distinct from 'gaming=Gaming fps=fps' then
    raise exception 'capitalisation: got %', got;
  end if;

  select string_agg(tag, ' ') into got
    from public.hashtags_in('open mic #31, C# and example.com/page#x and it&#39;s', null, '{}');
  if got is not null then raise exception 'not hashtags, but found %', got; end if;

  select string_agg(tag, ' ') into got
    from public.hashtags_in('#Café #ÜBER', null, '{}');
  if got is distinct from 'café über' then raise exception 'unicode: got %', got; end if;

  select string_agg(tag, ' ') into got
    from public.hashtags_in('and then #weather', 'A #Rainy day', array['GAMING', 'weather', '2024']);
  if got is distinct from 'rainy weather gaming' then raise exception 'title, caption, tags: got %', got; end if;
end $$;

\echo '--- 2. publishing files a post; editing re-files it; deleting unfiles it ---'
insert into public.posts (id, author_id, caption, tags) values
  ('7a99b000-0000-0000-0000-000000000001', '7a990000-0000-0000-0000-000000000001', 'first #Gaming #Art', '{}'),
  ('7a99b000-0000-0000-0000-000000000002', '7a990000-0000-0000-0000-000000000002', 'second', '{GAMING}');

do $$
declare
  got text;
begin
  select string_agg(post_id::text, ' ' order by post_id) into got
    from public.post_hashtags
   where tag = 'gaming' and post_id::text like '7a99b000-%';
  if got is distinct from '7a99b000-0000-0000-0000-000000000001 7a99b000-0000-0000-0000-000000000002' then
    raise exception 'two people, one hashtag page: got %', got;
  end if;
  if (select count(*) from public.hashtags where tag = 'gaming') <> 1 then
    raise exception '#Gaming and #GAMING became two hashtags';
  end if;

  update public.posts set caption = 'first #gaming #Music'
   where id = '7a99b000-0000-0000-0000-000000000001';
  select string_agg(tag, ' ' order by tag) into got
    from public.post_hashtags where post_id = '7a99b000-0000-0000-0000-000000000001';
  if got is distinct from 'gaming music' then raise exception 'edit: got %', got; end if;

  delete from public.posts where id = '7a99b000-0000-0000-0000-000000000002';
  if exists (select 1 from public.post_hashtags where post_id = '7a99b000-0000-0000-0000-000000000002') then
    raise exception 'a deleted post is still filed under a hashtag';
  end if;
end $$;

\echo '--- 3. counters move in the database, and only counters ---'
do $$
begin
  perform public.increment_counter('posts', '7a99b000-0000-0000-0000-000000000001', 'video_views', 1);
  perform public.increment_counter('posts', '7a99b000-0000-0000-0000-000000000001', 'video_views', 1);
  if (select video_views from public.posts where id = '7a99b000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'increment_counter did not add up';
  end if;
end $$;
\echo 'must fail: not a counter'
select public.increment_counter('users', '7a990000-0000-0000-0000-000000000001', 'role', 1);
\echo 'must fail: a second row for the same hashtag'
insert into public.hashtags (tag, display) values ('gaming', 'GAMING');

\echo '--- 4. the API roles get nothing ---'
set role anon;
\echo 'must fail (x3)'
select count(*) from public.hashtags;
select count(*) from public.post_hashtags;
select public.increment_counter('posts', '7a99b000-0000-0000-0000-000000000001', 'video_views', 100);
reset role;
set role authenticated;
\echo 'must fail (x3)'
select count(*) from public.hashtags;
insert into public.post_hashtags (post_id, tag, post_created_at)
  values ('7a99b000-0000-0000-0000-000000000001', 'gaming', now());
select public.increment_counter('posts', '7a99b000-0000-0000-0000-000000000001', 'video_views', 100);
reset role;

do $$
begin
  if (select video_views from public.posts where id = '7a99b000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'an API role moved a counter';
  end if;
end $$;

-- Clean up.
delete from public.posts where author_id in (
  '7a990000-0000-0000-0000-000000000001', '7a990000-0000-0000-0000-000000000002');
delete from auth.users where id in (
  '7a990000-0000-0000-0000-000000000001', '7a990000-0000-0000-0000-000000000002');
delete from public.hashtags h
 where not exists (select 1 from public.post_hashtags p where p.tag = h.tag)
   and h.tag in ('gaming', 'art', 'music');

\echo 'Done. Any ERROR above that is not under a "must fail" line is a failed check.'
