-- Text posts come in three shapes: a short message, a long one with a title,
-- and a big one meant as a statement. All three are drawn the same way — words
-- in a speech bubble pointing at their author — and differ in how much room the
-- words get.
--
-- Deliberately two columns on `posts` rather than a table of its own. A text
-- post has always been a post with a caption and no media, and the words stay
-- in `caption`: search, mentions, moderation, feeds and every post already
-- written keep working with no backfill and no join. What is added is which of
-- the three it is, and a title for the one kind that has one.
--
-- Both are NULL for everything that already exists, which is exactly right:
-- a post with no kind is drawn as a short message, so old text posts gain the
-- bubble without being touched.
--
-- Safe to re-run.

alter table public.posts
  add column if not exists text_kind text,
  add column if not exists text_title text;

-- Only the three, and only ever on a post that has no media to show.
alter table public.posts
  drop constraint if exists posts_text_kind_check;
alter table public.posts
  add constraint posts_text_kind_check
  check (text_kind is null or text_kind in ('short', 'long', 'big'));

-- The title belongs to long messages, and nothing else.
alter table public.posts
  drop constraint if exists posts_text_title_check;
alter table public.posts
  add constraint posts_text_title_check
  check (
    text_title is null
    or (text_kind = 'long' and char_length(text_title) between 1 and 30)
  );

-- The body limits, enforced by the database as well as by the app: a caption
-- arriving straight from an API call never passes through the composer.
alter table public.posts
  drop constraint if exists posts_text_body_check;
alter table public.posts
  add constraint posts_text_body_check
  check (
    text_kind is null
    or (text_kind = 'short' and char_length(caption) <= 200)
    or (text_kind = 'long' and char_length(caption) <= 1000)
    or (text_kind = 'big' and char_length(caption) <= 30)
  );

comment on column public.posts.text_kind is
  'short | long | big for a text post; null for media posts and for text posts written before 0011 (drawn as short).';
comment on column public.posts.text_title is
  'Title of a long message, 1-30 characters. Null for every other kind.';
