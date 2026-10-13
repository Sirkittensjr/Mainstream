/**
 * A small-but-real FayTarra in the Supabase stand-in, for measuring pages and
 * video startup against a real PostgREST (see supabase-gateway.mjs).
 *
 * 60 people and 300 posts — a third of them phone-sized videos (1080×1920, a
 * few megabytes each), a third photos, a third text — with the likes,
 * comments, follows and ratings that make the feeds rank anything. Every video
 * post has its own address, as uploads do, so the browser downloads each one
 * rather than reusing the last; behind them are the files in MEDIA_DIR, put in
 * Storage once.
 *
 *   ffmpeg -f lavfi -i testsrc2=size=1080x1920:rate=30 -f lavfi -i sine \
 *     -t 12 -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 4M \
 *     -c:a libopus /tmp/fay-perf-media/clip-a.webm          (and clip-b)
 *   ffmpeg -i /tmp/fay-perf-media/clip-a.webm -frames:v 1 /tmp/fay-perf-media/poster-a.jpg
 *
 *   DATABASE_URL=postgres://postgres:…@127.0.0.1/faytarra_sb \
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=$(node scripts/e2e/supabase-gateway.mjs --service-key) \
 *   MEDIA_DIR=/tmp/fay-perf-media node scripts/e2e/supabase-perf-seed.mjs
 *
 * Adds to whatever is there; the accounts are perf000…perf059.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MEDIA_DIR = process.env.MEDIA_DIR || '/tmp/fay-perf-media';
if (!DATABASE_URL || !KEY) throw new Error('DATABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: DATABASE_URL });

let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (list) => list[Math.floor(random() * list.length)];
const CATEGORIES = ['Gaming', 'Music', 'Art', 'Comedy', 'Sports', 'Food', 'Life'];
const TAGS = ['Gaming', 'clips', 'art', 'music', 'funny', 'fyp', 'setup', 'food'];

/** Puts one file in the bucket the way the app's uploads do, and returns its public address. */
async function upload(name) {
  const key = `media/perf/${name}`;
  const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/faytarra-media/${key}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, apikey: KEY },
  });
  const { url } = await sign.json();
  const put = await fetch(`${SUPABASE_URL}/storage/v1${url}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${KEY}`, apikey: KEY },
    body: readFileSync(path.join(MEDIA_DIR, name)),
  });
  if (!put.ok) throw new Error(`upload of ${name} failed: ${put.status}`);
  return `${SUPABASE_URL}/storage/v1/object/public/faytarra-media/${key}`;
}

const clips = [
  { url: await upload('clip-a.webm'), poster: await upload('poster-a.jpg') },
  { url: await upload('clip-b.webm'), poster: await upload('poster-b.jpg') },
];

const client = await pool.connect();
try {
  await client.query('begin');
  const users = [];
  for (let i = 0; i < 60; i += 1) {
    const handle = `perf${String(i).padStart(3, '0')}`;
    const { rows } = await client.query(
      `insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, now(), now()) returning id`,
      [`${handle}@example.com`, JSON.stringify({ username: handle, display_name: `Perf ${i}`, interests: [pick(CATEGORIES)] })],
    );
    users.push(rows[0].id);
  }

  const posts = [];
  for (let i = 0; i < 300; i += 1) {
    const kind = i % 3;
    const clip = clips[i % 2];
    const media =
      kind === 0
        ? [{ kind: 'video', url: `${clip.url}?n=${i}`, poster: `${clip.poster}?n=${i}`, width: 1080, height: 1920, duration: 12 }]
        : kind === 1
          ? [{ kind: 'image', url: `${clip.poster}?n=${i}`, width: 1080, height: 1920 }]
          : [];
    const { rows } = await client.query(
      `insert into public.posts (author_id, caption, media, category, tags, views, video_views, text_kind, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now() - make_interval(hours => $9)) returning id`,
      [
        pick(users),
        `perf post ${i} #${pick(TAGS)} and some words about it`,
        JSON.stringify(media),
        pick(CATEGORIES),
        [pick(TAGS)],
        Math.floor(random() * 900),
        kind === 0 ? Math.floor(random() * 400) : 0,
        kind === 2 ? 'short' : null,
        i * 3,
      ],
    );
    posts.push(rows[0].id);
  }

  await client.query(
    `insert into public.likes (post_id, user_id)
     select p, u from unnest($1::uuid[]) p cross join unnest($2::uuid[]) u
     where random() < 0.17 on conflict do nothing`,
    [posts, users],
  );
  await client.query(
    `insert into public.comments (post_id, user_id, body)
     select p, u, 'nice one #fyp' from unnest($1::uuid[]) p cross join unnest($2::uuid[]) u
     where random() < 0.05`,
    [posts, users],
  );
  await client.query(
    `insert into public.follows (follower_id, following_id)
     select a, b from unnest($1::uuid[]) a cross join unnest($1::uuid[]) b
     where a <> b and random() < 0.3 on conflict do nothing`,
    [users],
  );
  await client.query(
    `insert into public.ratings (rater_id, target_type, target_id, owner_id, score)
     select u, 'post', p.id, p.author_id, 4 + floor(random() * 7)::int
       from public.posts p cross join unnest($1::uuid[]) u
      where p.id = any($2::uuid[]) and p.author_id <> u and random() < 0.08
     on conflict do nothing`,
    [users, posts],
  );
  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
}

const { rows } = await pool.query(
  `select (select count(*) from public.users) as users, (select count(*) from public.posts) as posts,
          (select count(*) from public.likes) as likes, (select count(*) from public.comments) as comments,
          (select count(*) from public.follows) as follows, (select count(*) from public.ratings) as ratings`,
);
console.log('seeded:', rows[0]);
await pool.end();
