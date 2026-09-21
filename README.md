# FayTarra

**Everyone starts at zero.**

FayTarra is a social platform for people who are still becoming somebody — creators,
musicians, gamers, artists, athletes, entrepreneurs, comedians, anyone trying to
get known for something.

Two ideas hold the product together:

1. **Follower count does not decide who gets discovered.** Discovery ranks work
   by how well it performs *relative to the audience the creator already has*.
2. **Everyone has a rating, and it cannot be bought.** Ratings are the answer to
   "how well is this person doing?" and "how good is this piece of content?" —
   separate from likes, separate from followers, and defended against
   manipulation.

The core loop is: **Create → Get rated → Improve → Rise → Get discovered → Gain
followers → Create again.**

This repository is a working mobile-first website, not a mockup. Authentication,
profiles, posts, ratings, rankings, likes, comments, follows, feed, discovery,
challenges, points and levels, notifications, reporting, blocking, rating
integrity and the admin dashboard are all implemented and persisted.

---

## Quick start

```bash
npm install
npm run seed      # creates ./.data/faytarra.json with a sample community
npm run dev       # http://localhost:3000
```

No configuration is required. With no Supabase keys present, FayTarra runs on a
bundled file-backed JSON driver, auto-seeded with ~168 accounts, ~265 posts,
~3,100 ratings, 7 challenges and the months of rank history behind them.

**Sample logins** (local demo data only):

| Account | Email | Password |
| --- | --- | --- |
| Creator | `tommy@faytarra.app` | `faydemo123` |
| Admin | `admin@faytarra.app` | `faydemo123` |

Every seeded creator shares that password — `mirabeats@faytarra.app`,
`novaplays@faytarra.app`, `sunnyclay@faytarra.app` (six days old, two followers).

```bash
npm run reset     # wipe local data and re-seed
npm run build     # production build (emits .next/standalone)
npm start         # run the production server
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

---

## The FayTarra rating system

Anyone can rate a post or a profile **1–10** and optionally add reactions (Fire,
Funny, Creative, Interesting, Love It, Would Collaborate). The maths lives in
[`src/lib/ratings.ts`](src/lib/ratings.ts) and
[`src/lib/services/ratings.ts`](src/lib/services/ratings.ts).

### Post rating

A weighted average, shrunk toward the platform's own live mean so a single 10/10
cannot outrank forty ratings averaging 9.3. Shown next to likes, comments, views
and shares — never instead of them.

### Overall rating — the slow number

Anchored to every rating a creator has ever received, heavily shrunk, then
adjusted by up to ±0.8 for behaviour: consistency, engagement relative to
audience size, follower growth, community participation and account history. One
bad post cannot move it.

### Current rating — the fast number

The same maths over the **last 30 days only**, starting from the creator's
all-time average and moving quickly as new ratings arrive. Go quiet and it
drifts down while the overall rating stays put.

### The trend arrow

Movement is measured **window over window** — the last 30 days against the 30
before it — not current against overall. Comparing against overall would show an
arrow up for every above-average creator forever, which says nothing.

---

## Rating integrity

The system is worthless if a hundred throwaway accounts can hand someone a 10.
Defence is layered, and every layer is explainable
([`rating-integrity.ts`](src/lib/services/rating-integrity.ts)):

- **One rating per person per target.** Rating again updates your rating; it
  never stacks.
- **Weighted raters.** A rating carries 0–1 weight. Accounts under a day old
  count for a quarter, under a week for 60%, accounts with no activity are
  discounted, and an account that rates almost everything 9–10 (or 1–2) is
  heavily discounted.
- **Concentration collapse.** Rating the same creator repeatedly drops your
  weight to 25%. If over half your ratings target one creator, everything you
  cast drops to 35%.
- **Hard rate limits.** 25 an hour, 80 a day.
- **No self-rating, no rating across a block, no rating removed posts.**
- **Detection queue.** `/admin → Integrity` lists accounts whose behaviour looks
  automated, with the same numbers the weighting used, and a moderator can
  revoke an account's rating weight retroactively.
- **Paid exposure can never touch a rating.** The `boosted` flag on a post is
  excluded from every rating and ranking calculation by construction.

The seed deliberately includes a small three-account rating ring so the
integrity queue has something real to catch on first run.

---

## Ranking

Three boards, four time windows (Today / This week / This month / All time) and
every category — see [`rankings.ts`](src/lib/services/rankings.ts).

| Board | Ranked by |
| --- | --- |
| **Overall** | Long-term rating. Slow, hard to fake, impossible to buy. |
| **Current** | Last 30 days of community response. |
| **Rising** | Momentum: improvement against your own baseline, growth relative to the audience you already had, and showing up. |

In the seeded data the Current board is topped by creators with 3, 4 and 26
followers sitting above accounts with 100+ — which is the entire point.

Profiles show **Overall rank**, **Current rank** and **Rising rank**, plus a
month-by-month **rank history** so the platform reads as a climb rather than a
scoreboard. `/admin → Integrity → Capture this month's ranks` freezes a snapshot.

---

## Give me a shot — staged exposure

A "Give me a shot" post is not promised virality. It is promised a *test*
([`src/lib/shot.ts`](src/lib/shot.ts)):

```
100 impressions → 1,000 → 10,000 → 100,000
```

Exposure is metered: impressions are recorded as discovery actually serves the
post. When a post uses up its slice it either graduates — if its rating is 7.4+
or its engagement rate clears the bar — or it rests, freeing rotation slots for
creators who have not had their turn. Progress is visible on the post itself.
Nothing about this ladder can be bought.

---

## Website first, then real apps

Priority order, deliberately:

1. An excellent **mobile-first website** (this repo).
2. Validate with real users.
3. Turn the proven product into **proper iOS and Android apps** — not a WebView
   wrapper.

The architecture is built for step 3 now:

- All product logic lives in `src/lib/services`, above a six-method storage
  interface. Nothing important lives in a React component.
- A versioned **JSON API** under `/api/v1` already exposes the same services:
  `POST /api/v1/auth/login`, `GET /api/v1/me`, `GET /api/v1/feed`,
  `GET /api/v1/discover`, `GET /api/v1/users/[username]`,
  `GET /api/v1/posts/[id]`, `POST /api/v1/ratings`, `GET /api/v1/rankings`.
- **One auth system.** The website sends the signed session token as an
  HTTP-only cookie; a native client sends the identical token as
  `Authorization: Bearer <token>`. Same accounts, same database, same ratings
  and ranks.

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"identifier":"tommy@faytarra.app","password":"faydemo123"}' | jq -r .token)

curl -s localhost:3000/api/v1/me -H "Authorization: Bearer $TOKEN" | jq
```

---

## Deploying

FayTarra is **server-rendered**, not a static site: server actions, dynamic
pages, route handlers, uploads and a database. There is no `out/` or `static/`
folder to hand a CDN — the deployable artefact is a Node server.

`npm run build` produces a self-contained one:

```bash
npm run build     # next build + copies static assets into the bundle
npm start         # node .next/standalone/server.js
```

The build writes `.next/standalone/` (server + traced dependencies) and the
`postbuild` step copies `.next/static` into it. That copy matters: without it
the server answers with HTML whose every stylesheet and script 404s, which
looks like a broken deploy rather than a missing step.

**Containers** — a multi-stage `Dockerfile` is included, so anything that runs
an image works (Cloud Run, Fly, Render, Railway, Kubernetes):

```bash
docker build -t faytarra .
docker run -p 3000:3000 \
  -e AUTH_SECRET=... \
  -e NEXT_PUBLIC_SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  faytarra
```

**Vercel** — connect the repo and it detects Next.js automatically; no
`vercel.json` is needed. Two things matter:

- **Deploy the branch that has the app.** Vercel builds your *production
  branch* (`main` by default). Pointing a domain at a branch that does not
  contain the project produces a "Ready" deployment that 404s on every route,
  including `/`.
- **Set the environment variables below.** Vercel's filesystem is read-only
  apart from `/tmp`, so without Supabase the app runs per-instance and
  ephemerally: it serves fine and says so in the logs, but nothing is saved.

**Netlify, Amplify, Firebase App Hosting** — these also detect Next.js and
build it themselves; set the same variables and ignore the standalone output.

### Before the first production deploy

| Variable | Why it matters |
| --- | --- |
| `AUTH_SECRET` | Signs session cookies and bearer tokens. Without it every restart signs everyone out. |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Without these the app runs on the bundled JSON driver, which writes to `./.data`. On a container or serverless host that is ephemeral or read-only, so **every account, post and rating disappears on restart**. The server logs a warning if you deploy this way. |
| `SUPABASE_STORAGE_BUCKET` | Where uploads go. Local disk uploads do not survive a redeploy either. |
| `ADMIN_EMAILS` | Accounts that get the admin role at signup. |

If a deploy pipeline reports *"no functions, static, or services directory"*,
it is expecting a static export or its own bundle layout. FayTarra cannot be
statically exported — use a Node runtime, the container image, or a host with
first-class Next.js support.

---

## Running on Supabase

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) — tables, indexes, RLS and
   the `faytarra-media` storage bucket.
3. Copy `.env.example` to `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   AUTH_SECRET=<long random string>
   ADMIN_EMAILS=you@example.com
   ```

4. `npm run seed` to load the sample community, or skip it and start empty.

The driver is chosen automatically: Supabase when those keys are set, the local
JSON store otherwise. Uploads follow the same rule — Supabase Storage in
production, local disk served through `/api/media/[file]` in development.

`AUTH_SECRET` signs the session cookie and the bearer token. Any Supabase-backed
deployment must set it. A local demo falls back to a temporary per-process key
and warns.

**A note on authentication:** auth is a self-contained email + username +
password layer (scrypt hashes, signed HTTP-only cookies) so the same code path
works on both drivers with zero setup. Supabase Auth can replace it later by
swapping `src/lib/auth/session.ts` and `src/lib/services/account.ts` — nothing
else needs to change, because everything reads `getViewer()`.

---

## What is in the app

| Route | What it does |
| --- | --- |
| `/` | Landing page — the pitch, ratings, ranking, live creators, challenges |
| `/signup`, `/login` | Fast signup: email, username, password, what you're becoming, profile |
| `/welcome` | Three-step orientation for a new account |
| `/home` | Mixed feed: follows, rising, recommended, live challenge entries |
| `/discover` | Rising · Trending · New · Give me a shot, by category |
| `/create` | Text, images, video, category, challenge, tags, Give me a shot |
| `/challenges`, `/challenges/[slug]` | Weekly challenges, entries, featured entries |
| `/u/[username]` | Profile: both ratings, three ranks, rank history, journey |
| `/post/[id]` | Post detail, community rating, reactions, comments |
| `/rankings` | Overall · Current · Rising, by period and category |
| `/notifications` | Follows, ratings, likes, comments, mentions, features, level ups |
| `/search` | People, posts, categories, challenges |
| `/settings` | Profile, blocked accounts, sign out, delete account |
| `/admin` | Overview · Reports · Integrity · Users |
| `/rules` | Community rules, including rating manipulation |

Alongside ratings, creators earn **FayTarra points** for participation across
seven levels (Rookie → Icon). Points cannot be bought either; they are awarded
in exactly one place, [`points.ts`](src/lib/services/points.ts), and every award
is written to an `activity` ledger.

---

## Project structure

```
src/
  app/
    (app)/            # everything behind the shell (bottom nav / sidebar / right rail)
    (auth)/           # signup + login
    api/v1/           # JSON API for future native clients
    api/              # upload, local media, generated cover art
    actions.ts        # server actions (rate, like, follow, comment, report, admin…)
  components/         # PostCard, RateSheet, RatingPill, Nav, Journey…
  lib/
    ratings.ts        # rating maths (pure, shared client/server)
    shot.ts           # staged exposure ladder
    db/               # driver interface + local JSON driver + Supabase driver
    services/         # ratings, rankings, feed, discover, integrity, moderation…
    seed/             # the sample community
supabase/schema.sql   # tables, indexes, RLS, storage bucket
Dockerfile            # container image for any Node host
scripts/
  seed.ts             # seeds whichever driver is configured
  prepare-standalone.mjs  # completes the standalone build output
```

## Deliberately not built yet

Direct messages, collaborations, live streaming, monetisation and paid boosts,
brand partnerships, a creator marketplace, verified profiles, AI creator tools,
native apps, creator analytics and sponsorships. The seams exist: `activity` is
an append-only event ledger, ratings and ranking are isolated modules, the
`boosted` field is already excluded from every score, and the driver interface
takes new tables without touching feature code.
