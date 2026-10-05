-- Two changes to the text posts added in 0011, both small.
--
-- 1. The middle kind is a STORY. It was called `long` for exactly as long as it
--    took to name the feature properly. The constraint accepts both: a row
--    written as `long` still opens, and the app itself writes `long` when it
--    meets a database that has run 0011 but not this file. It reads `long` as
--    `story` either way.
--
-- 2. A big message carries which of four colour treatments it was given.
--    Null means `glow`, the quietest, which is also what every big message
--    written before this column had.
--
-- Safe to re-run.

alter table public.posts
  add column if not exists text_style text;

alter table public.posts
  drop constraint if exists posts_text_kind_check;
alter table public.posts
  add constraint posts_text_kind_check
  check (text_kind is null or text_kind in ('short', 'story', 'long', 'big'));

-- The body limits, restated because the kind names moved. A caption arriving
-- straight from an API call never passes through the composer.
alter table public.posts
  drop constraint if exists posts_text_body_check;
alter table public.posts
  add constraint posts_text_body_check
  check (
    text_kind is null
    or (text_kind = 'short' and char_length(caption) <= 200)
    or (text_kind in ('story', 'long') and char_length(caption) <= 1000)
    or (text_kind = 'big' and char_length(caption) <= 30)
  );

-- A title belongs to a story, and nothing else.
alter table public.posts
  drop constraint if exists posts_text_title_check;
alter table public.posts
  add constraint posts_text_title_check
  check (
    text_title is null
    or (text_kind in ('story', 'long') and char_length(text_title) between 1 and 30)
  );

-- A colour belongs to a big message, and only the four there are.
alter table public.posts
  drop constraint if exists posts_text_style_check;
alter table public.posts
  add constraint posts_text_style_check
  check (
    text_style is null
    or (text_kind = 'big' and text_style in ('glow', 'night', 'violet', 'dusk'))
  );

comment on column public.posts.text_style is
  'glow | night | violet | dusk for a big message; null elsewhere, and null reads as glow.';
