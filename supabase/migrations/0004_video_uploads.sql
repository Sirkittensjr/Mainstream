-- 0004 — room for video in the media bucket
--
-- FayTarra videos are up to 250MB and up to two minutes. Nothing in the
-- database itself changes for that: a post's media has always been jsonb, so
-- the poster frame, pixel size and duration a video carries need no new
-- columns and no table is touched by this file.
--
-- What does need changing is the storage bucket, which by default accepts
-- whatever the project's global upload limit is (50MB on a new project) and
-- any file type at all. This sets the bucket's own ceiling to 250MB and lists
-- the types uploads may be, so a file the app would refuse is refused a step
-- earlier as well.
--
-- Safe to run twice. It updates one row in `storage.buckets` and reads
-- nothing else. It does not create, delete or move a single stored object.
--
-- IMPORTANT: a bucket cannot exceed the project's global upload limit, and
-- that one is not settable from SQL. Raise it first in the dashboard under
-- Settings → Storage → "Upload file size limit", or uploads over the global
-- limit are rejected by Storage no matter what this file says.

-- 1. What is there now -------------------------------------------------------
-- Read only. Run this on its own first if you want to see what you are changing.
select
  id,
  public,
  coalesce(file_size_limit, 0) as file_size_limit_bytes,
  round(coalesce(file_size_limit, 0) / 1024.0 / 1024.0, 1) as file_size_limit_mb,
  allowed_mime_types
from storage.buckets
where id = 'faytarra-media';

-- 2. The change --------------------------------------------------------------
update storage.buckets
set
  file_size_limit = 262144000, -- 250MB, matching MAX_VIDEO_BYTES in the app
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]
where id = 'faytarra-media';

-- 3. What it looks like afterwards -------------------------------------------
select
  id,
  round(coalesce(file_size_limit, 0) / 1024.0 / 1024.0, 1) as file_size_limit_mb,
  allowed_mime_types,
  case
    when file_size_limit >= 262144000 then 'OK — 250MB uploads allowed'
    else 'NOT APPLIED — is the bucket named faytarra-media?'
  end as verdict
from storage.buckets
where id = 'faytarra-media';
