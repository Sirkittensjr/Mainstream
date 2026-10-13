-- ---------------------------------------------------------------------------
-- FayTarra: why is a video's view count not moving?
--
-- READ ONLY. One SELECT over the catalogues and the view tables. It creates
-- nothing, changes nothing, locks nothing, and cannot fail even if the view
-- tables were never installed. Safe on production at any time.
--
-- Paste the whole file into the Supabase SQL editor and press Run. Read the
-- "verdict" column from the top: the first line that is not "Good." is the
-- problem.
-- ---------------------------------------------------------------------------
with facts as (
  select
    to_regclass('public.video_views') is not null as has_table,
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'posts'
              and column_name = 'video_views') as has_column,
    to_regprocedure('public.increment_counter(text, uuid, text, integer)') as counter_fn,
    to_regprocedure('public.record_video_view(uuid, uuid, uuid, text, text, timestamptz)') as record_fn
),
-- Counts that need the table, run only when it exists (query_to_xml runs its
-- query by name at run time, so a missing table is never even parsed).
counts as (
  select
    case when (select has_table from facts) then (xpath('/row/n/text()', query_to_xml(
      'select count(*) as n from public.video_views where created_at > now() - interval ''1 day''',
      false, true, '')))[1]::text::bigint end as views_last_day,
    case when (select has_table from facts) then (xpath('/row/n/text()', query_to_xml(
      'select max(created_at) as n from public.video_views', false, true, '')))[1]::text end as last_view_at,
    case when (select has_table and has_column from facts) then (xpath('/row/n/text()', query_to_xml(
      'select count(*) as n from public.posts p
        where p.video_views < (select count(*) from public.video_views v where v.post_id = p.id)',
      false, true, '')))[1]::text::bigint end as posts_missing_views,
    case when (select has_table and has_column from facts) then (xpath('/row/n/text()', query_to_xml(
      'select coalesce(sum(c.n - p.video_views), 0) as n
         from public.posts p
         join (select post_id, count(*) as n from public.video_views group by post_id) c on c.post_id = p.id
        where p.video_views < c.n',
      false, true, '')))[1]::text::bigint end as views_missing
),
checks as (
  select 1 as ord,
         'View storage (migration 0010)' as check_name,
         case when has_table and has_column then 'installed'
              when has_table then 'table only' when has_column then 'column only'
              else 'not installed' end as result,
         case when has_table and has_column then 'Good.'
              else 'NOT COUNTING: run migrations/0010_video_views.sql. Until then every report is answered "not counted" and the eye stays where it is.' end as verdict
    from facts

  union all
  select 2, 'Counter function (migration 0015)',
         case when counter_fn is null then 'missing'
              when has_function_privilege('service_role', counter_fn, 'execute') then 'installed, app may call it'
              else 'installed, but the app''s role may NOT call it' end,
         case when counter_fn is null then 'Run migrations/0015_hashtags_and_counters.sql.'
              when has_function_privilege('service_role', counter_fn, 'execute') then 'Good.'
              else 'LOSING VIEWS: the total cannot be raised. Migration 0016 grants it.' end
    from facts

  union all
  select 3, 'View + total in one step (migration 0016)',
         case when record_fn is null then 'missing'
              when has_function_privilege('service_role', record_fn, 'execute') then 'installed, app may call it'
              else 'installed, but the app''s role may NOT call it' end,
         case when record_fn is null then 'Run migrations/0016_record_video_view.sql (the app works without it, in two steps).'
              when has_function_privilege('service_role', record_fn, 'execute') then 'Good.'
              else 'Grant it: re-run migrations/0016_record_video_view.sql.' end
    from facts

  union all
  select 4, 'Views recorded in the last 24 hours',
         coalesce(views_last_day::text, 'n/a') || coalesce(' (latest ' || last_view_at || ')', ''),
         case when views_last_day is null then 'No view storage: see row 1.'
              when views_last_day = 0 then 'Nothing has reached the database in a day. If videos were watched, the reports are not arriving: check /api/health and the server log for [faytarra:views].'
              else 'Reports are arriving.' end
    from counts

  union all
  select 5, 'Views stored but never added to their total',
         coalesce(views_missing::text || ' views on ' || posts_missing_views::text || ' posts', 'n/a'),
         case when views_missing is null then 'n/a'
              when views_missing = 0 then 'Good.'
              else 'This is the lost-view bug: the view was stored, raising the total failed, and every retry was then "already counted". Migration 0016 adds these back and stops it happening.' end
    from counts
)
select check_name, result, verdict from checks order by ord;
