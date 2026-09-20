# RISE

**Everyone starts at zero.**

RISE is a social platform for people who are still becoming somebody — creators,
musicians, gamers, artists, athletes, entrepreneurs, comedians, anyone trying to
get known for something. The product bet is simple: **follower count should not
decide who gets discovered.** Discovery here ranks posts by how well they perform
*relative to the audience the creator already has*, so someone with ten followers
has a genuine path onto the Discover page.

This repository is a working MVP, not a mockup. Authentication, profiles, posts,
likes, comments, follows, the feed, discovery, challenges, RISE points and levels,
leaderboards, notifications, reporting, blocking and the admin dashboard are all
implemented and persisted.

---

## Quick start

```bash
npm install
npm run seed      # creates ./.data/rise.json with a sample community
npm run dev       # http://localhost:3000
```

No configuration is required. With no Supabase keys present, RISE runs on a
bundled file-backed JSON driver that is auto-seeded with 165 sample accounts,
~200 posts, 7 challenges and the likes/comments/follows behind them, so the app
looks populated from the first page load.

**Sample logins** (local demo data only):

| Account | Email | Password |
| --- | --- | --- |
| Creator | `tommy@rise.app` | `risedemo123` |
| Admin | `admin@rise.app` | `risedemo123` |

Every seeded creator uses the same password — `mirabeats@rise.app`,
`novaplays@rise.app`, `sunnyclay@rise.app` (a day-six account with two followers)
and so on.

```bash
npm run reset     # wipe local data and re-seed
npm run build     # production build
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

---

## Running on Supabase

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor. It creates
   every table, the indexes, RLS, and the `rise-media` storage bucket.
3. Copy `.env.example` to `.env.local` and fill in:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   AUTH_SECRET=<long random string>       # required once Supabase is configured
   ADMIN_EMAILS=you@example.com           # these emails get the admin role on signup
   ```

4. `npm run seed` to load the same sample community into Supabase, or skip it and
   start empty.

The app picks its driver automatically: Supabase whenever `NEXT_PUBLIC_SUPABASE_URL`
and `SUPABASE_SERVICE_ROLE_KEY` are set, otherwise the local JSON store. Uploaded
images and video follow the same rule — Supabase Storage in production, local disk
served through `/api/media/[file]` in development.

`AUTH_SECRET` signs the session cookie. Any Supabase-backed deployment must set
it — sessions are refused without one. A local demo (`npm run build && npm start`
with no Supabase keys) falls back to a temporary per-process key and warns, so a
restart simply signs everyone out.

### A note on authentication

Auth is a self-contained email + username + password layer (scrypt hashes in the
`users` table, signed HTTP-only session cookies). It was built this way so the
exact same code path works on both drivers and the app can run with zero setup.
Supabase Auth can be swapped in later without touching any feature code: replace
`src/lib/auth/session.ts` and `src/lib/services/account.ts`, and keep `getViewer()`
returning the same `User` row.

---

## How discovery actually works

The rules live in [`src/lib/services/ranking.ts`](src/lib/services/ranking.ts).

- **Rising score** — `(likes·3 + comments·6 + views·0.05) / √(followers + 8)`,
  multiplied by an exponential recency decay (30-hour half-life), a 1.25× lift for
  accounts under 500 followers and 1.35× for "Give me a shot" posts. Dividing by
  the square root of the existing audience is the whole point: 40 likes on a
  20-follower account beats 400 likes on a 200,000-follower account.
- **Trending** — raw engagement with the same recency decay, for the posts the
  whole platform is engaging with.
- **New** — most recent first, so a post is visible the second it exists.
- **Give me a shot rotation** — shot posts are not ranked, they are *rotated*.
  Posts from the last 24 hours go to the front; everything else advances through a
  deterministic queue that moves every six hours. Nobody is promised virality;
  everybody is promised a turn.
- **Home feed** — four streams (people you follow, rising, recommended by your
  interests, live challenge entries) are ranked separately and then interleaved,
  so part of every screen is reserved for creators you have never seen.

Leaderboards deliberately rank on earned momentum — RISE points this week, growth
relative to audience size, challenge entries — never on raw follower count.

---

## The RISE system

Points are only ever awarded through `award()` in
[`src/lib/services/points.ts`](src/lib/services/points.ts), and every award is
written to the `activity` ledger, so progress is always explainable and can never
be bought.

| Action | Points |
| --- | --- |
| Create a post | +10 |
| Receive a like | +2 |
| Receive a comment | +3 |
| Gain a follower | +5 |
| Give a like / comment / follow | +1 |
| Enter a challenge | +25 |
| Have a post featured | +100 |
| Show up (once per day) | +5 |

| Level | Name | Points |
| --- | --- | --- |
| 1 | Rookie | 0 |
| 2 | Rising | 100 |
| 3 | Breakout | 400 |
| 4 | Creator | 1,000 |
| 5 | Featured | 2,500 |
| 6 | Elite | 6,000 |
| 7 | Icon | 15,000 |

Crossing a threshold fires a level-up notification automatically.

---

## What is in the app

| Route | What it does |
| --- | --- |
| `/` | Landing page — the pitch, live creators, the current challenge, the levels |
| `/signup`, `/login` | Fast signup: email, username, password, what you are trying to become, profile |
| `/welcome` | Three-step orientation for a brand new account |
| `/home` | Mixed feed with "For you" and "Following" |
| `/discover` | Rising · Trending · New · Give me a shot, plus categories and creators to watch |
| `/create` | Text, images, video, multiple media, category, challenge, tags, "Give me a shot" |
| `/challenges`, `/challenges/[slug]` | Weekly challenges, entries, featured entries |
| `/u/[username]` | Profile with Posts / Challenges / About, RISE level and the creator journey |
| `/post/[id]` | Post detail, comments, share, delete your own |
| `/leaderboards` | Rising this week · Fastest growing · Top challenge creators, by category |
| `/notifications` | Follows, likes, comments, mentions, features, level ups, challenges ending |
| `/search` | People, posts, categories, challenges |
| `/settings` | Profile, blocked accounts, sign out, delete account |
| `/admin` | Reports queue, moderation actions, platform statistics |
| `/rules` | Community rules and how reporting works |

### Safety and moderation

Report a post, a profile or a comment from the ••• menu; block someone from their
profile (which also removes follows in both directions); delete your own posts or
your whole account from settings. Admins work the queue at `/admin`: remove or
restore posts, remove comments, suspend or ban accounts, feature posts, and
resolve or dismiss reports. Suspended accounts can browse but cannot post; banned
accounts cannot sign in. The rules themselves are at `/rules`.

Privacy choices worth naming: location is a free-text city or country and is
optional, emails are never exposed on a profile or through the API, sample imagery
is generated by the app itself (`/api/cover/[seed]`) rather than fetched from a
third-party image host, and RISE is not marketed to children.

---

## Project structure

```
src/
  app/
    (app)/            # everything behind the shell (bottom nav / sidebar / right rail)
    (auth)/           # signup + login
    api/              # upload, local media, generated cover art
    actions.ts        # every server action (like, follow, comment, report, admin…)
  components/         # Avatar, PostCard, Nav, Journey, LevelBadge, dialogs…
  lib/
    db/               # driver interface + local JSON driver + Supabase driver
    services/         # feed, discover, ranking, points, challenges, moderation, admin…
    seed/             # the sample community
supabase/schema.sql   # tables, indexes, RLS, storage bucket
scripts/seed.ts       # seeds whichever driver is configured
```

Business logic lives in `src/lib/services`; storage is a tiny six-method interface
in `src/lib/db/types.ts`. That is what makes swapping the local driver for Supabase
a configuration change rather than a rewrite.

---

## Built to become apps later

RISE is mobile-first: bottom navigation on phones, a sidebar and right rail on
desktop, safe-area padding, an installable web app manifest, and standalone
display. Nothing in the UI assumes a desktop pointer. Wrapping it in a Capacitor
or React Native WebView shell, or reusing the same services behind a native
client, does not require reworking the feed, the ranking or the data model.

## Deliberately not built yet

Direct messages, creator collaborations, live streaming, monetisation, brand
partnerships, a creator marketplace, verified profiles, advanced recommendations,
AI creator tools, native apps, creator analytics and sponsorships are all out of
scope for this MVP. The seams for them exist: `activity` is already an append-only
event ledger, ranking is isolated in one module, the driver interface can take new
tables without touching feature code, and `PostView` is the single shape every
surface renders.
