-- 0007 — resumable video uploads, and the content warning flag
--
-- Two unrelated-looking things that ship together because the video upload
-- needs both: somewhere the browser is allowed to write, and a column for the
-- checkbox on the same form.
--
-- WHY THIS EXISTS. A video off a phone is tens or hundreds of megabytes. It
-- cannot go through the app — a serverless request body is far smaller than
-- that — so the browser uploads it straight to Supabase Storage, in chunks,
-- using Storage's resumable (TUS) endpoint. That endpoint is authorised with
-- the uploader's OWN access token rather than the service role, which means
-- Storage's row level security decides what they may write. Until these
-- policies exist, every chunk is refused.
--
-- It also re-applies the bucket's size limit from 0004, so running this file
-- alone is enough to fix an upload failing with "Payload too large".
--
-- Safe to run twice. Adds one nullable-with-default column, three storage
-- policies and one bucket setting. Nothing is dropped, deleted or rewritten,
-- and no stored object is touched.
--
-- IF YOUR BUCKET IS NOT CALLED `faytarra-media`, change the name in every
-- statement below to match SUPABASE_STORAGE_BUCKET.

-- 1. The bucket's own ceiling ------------------------------------------------
-- A bucket with no file_size_limit inherits the project's global upload
-- limit, which is 50MB on a new project — under a 19-second iPhone clip.
-- Storage refuses anything larger with "Payload too large" before the app
-- sees it.
--
-- THE PROJECT-WIDE LIMIT IS NOT SETTABLE FROM SQL. Raise it first in the
-- dashboard under Settings → Storage → "Upload file size limit" (250MB), or
-- this line raises a ceiling that a lower one still sits under.
update storage.buckets
set file_size_limit = 262144000 -- 250MB, matching MAX_VIDEO_BYTES in the app
where id = 'faytarra-media'
  and coalesce(file_size_limit, 0) < 262144000;

-- 2. Who may write an upload -------------------------------------------------
-- An upload lands in `pending/<the uploader's id>/…` and is nothing but a
-- stored object until the server has read it, checked its type, size and
-- duration, and MOVED it to `media/…`. That move is service-role work and is
-- the only way a file becomes postable, so these policies are about who may
-- put bytes in the waiting room, not about what ends up on the site.
--
-- The second path segment must be the uploader's own id, so no token can
-- write into anybody else's folder. Nothing here grants DELETE: cleaning up
-- is the server's job, with the service role, which bypasses these policies.
drop policy if exists "faytarra: write your own pending uploads" on storage.objects;
create policy "faytarra: write your own pending uploads"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'faytarra-media'
    and (storage.foldername(name))[1] = 'pending'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Resuming an interrupted upload reads and updates the object already there,
-- so the same scope is needed for both.
drop policy if exists "faytarra: read your own pending uploads" on storage.objects;
create policy "faytarra: read your own pending uploads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'faytarra-media'
    and (storage.foldername(name))[1] = 'pending'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "faytarra: finish your own pending uploads" on storage.objects;
create policy "faytarra: finish your own pending uploads"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'faytarra-media'
    and (storage.foldername(name))[1] = 'pending'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'faytarra-media'
    and (storage.foldername(name))[1] = 'pending'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- 3. The content warning -----------------------------------------------------
-- One boolean on a post. False for everything that already exists, which is
-- what those posts have always meant.
alter table public.posts add column if not exists content_warning boolean not null default false;

-- 4. What is there now -------------------------------------------------------
-- Read only.
select
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'faytarra:%') as storage_policies,
  (select coalesce(file_size_limit, 0) / 1024 / 1024 from storage.buckets
    where id = 'faytarra-media') as bucket_limit_mb,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'posts'
      and column_name = 'content_warning') as content_warning_column,
  case
    when (select count(*) from pg_policies
            where schemaname = 'storage' and tablename = 'objects'
              and policyname like 'faytarra:%') = 3
     and (select count(*) from information_schema.columns
            where table_schema = 'public' and table_name = 'posts'
              and column_name = 'content_warning') = 1
      then 'APPLIED'
    else 'NOT APPLIED'
  end as verdict;
