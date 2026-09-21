# FayTarra

**Where the community decides what they like.**

Post the music, art, gaming, food, jokes and random moments you are into, and
everyone else weighs in with likes, comments and a rating out of 10. You follow
people, post the things you like, and the community says what it thinks.

The thing that makes it FayTarra is the rating: every post and every profile can
be rated 1–10, and those ratings drive discovery instead of follower count.

This repository is a working mobile-first website, not a mockup. Accounts,
profiles, posts, the two feeds, following, likes, comments, ratings, rankings,
notifications, search, reporting, blocking and moderation are all implemented
and persisted.

---

## Quick start

```bash
npm install
npm run seed      # creates ./.data/faytarra.json with a sample community
npm run dev       # http://localhost:3000
```

Browsing needs no configuration: with no Supabase keys set, FayTarra runs on a
bundled file-backed JSON driver, auto-seeded with ~168 accounts, ~280 posts and
~3,500 ratings.

**Accounts need Supabase.** Signing up and signing in are handled by
**Supabase Auth** — FayTarra never hashes, stores or checks a password. Without
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` the sign-in and
sign-up screens say accounts are switched off, rather than falling back to some
imitation of a login. See [Running on Supabase](#running-on-supabase).

**Sample logins** (after `npm run seed` against a Supabase project — the seed
creates these as real Supabase Auth users):

| Account | Email | Password |
| --- | --- | --- |
| Person | `tommy@faytarra.app` | `faydemo123` |
| Admin | `admin@faytarra.app` | `faydemo123` |

```bash
npm run reset     # wipe local data and re-seed
npm run build     # production build (emits .next/standalone)
npm start         # run the production server
npm test          # unit tests for the rating rules
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

---

## What is in the MVP

| Route | What it does |
| --- | --- |
| `/` | Landing page |
| `/signup`, `/login` | Supabase Auth: email, username, password, what you are into, profile |
| `/verify-email` | After signup — confirm the address, or send the mail again |
| `/forgot-password`, `/reset-password` | Password reset, by email link |
| `/auth/callback` | Where Supabase's email links land; exchanges the code for a session |
| `/home` | **Following** and **Recommended** feeds |
| `/discover` | Rankings: Overall, Last 30 days, and by category |
| `/create` | Post photos, video or text |
| `/u/[username]` | Profile: posts, both ratings, rank, followers |
| `/post/[id]` | Post detail, community rating, comments |
| `/notifications` | Follows, likes, comments, ratings |
| `/search` | People, posts, categories |
| `/settings` | Profile, blocked accounts, sign out, delete account |
| `/admin` | Reports, rating integrity, users, platform stats |
| `/rules` | Community rules |

Deliberately **not** in the MVP: challenges, "give me a shot", levels, points
and anything else that made the product feel like a competition. The rating
system is a feature of a social network here, not the point of it.

---

## The rating system

Anyone can rate a post or a profile **1–10** and optionally add reactions (Fire,
Funny, Creative, Interesting, Love It, Would Collaborate).

Profiles carry two numbers:

- **Overall** — built from every rating the person has ever received. Heavily
  smoothed, so it moves slowly and one bad post cannot sink it.
- **Last 30 days** — the same maths over the last month only, starting from
  their overall rating and moving quickly as new ratings arrive. The arrow next
  to it compares the last 30 days against the 30 before, so it means "getting
  better" rather than "is above average".

Posts carry a rating and a vote count.

### Votes count, not just the average

This is the part that matters, and it is documented in full in
[`src/lib/ratings.ts`](src/lib/ratings.ts). A raw average is a bad ranking key:
a 10.0 from three friends is not better than a 9.2 from eight hundred people.
So FayTarra computes two different numbers from the same votes:

1. **The rating people see** — a weighted average pulled toward the platform
   mean by a prior worth a handful of imaginary average votes. This is what
   stops a single 10/10 from displaying as a perfect 10.0.
2. **The ranking score** — that rating minus a confidence penalty,
   `z · σ / √n`, the lower bound of a confidence interval. More votes shrink
   the penalty toward zero; few votes pay a large one. Two things with the same
   average always order by how much evidence stands behind them.

On top of that, **nothing enters a ranking until it has at least 10 ratings**.
That floor is the blunt guarantee that a new account cannot land at #1 off six
votes, and it holds no matter where the ratings sit on the scale.

You can see this on the live Discover page: an 8.5 from 24 ratings ranks above
an 8.6 from 13. The vote count is shown on every row so the order is
explicable.

The rules are covered by unit tests in
[`src/lib/ratings.test.ts`](src/lib/ratings.test.ts), including the case from
the product brief directly.

---

## Rating integrity

The system is worthless if throwaway accounts can hand someone a 10
([`rating-weight.ts`](src/lib/rating-weight.ts),
[`rating-integrity.ts`](src/lib/services/rating-integrity.ts)):

- **One rating per person per target.** Rating again updates it; it never stacks.
- **Weighted raters.** Each rating carries 0–1 weight. Accounts under a day old
  count for a quarter, accounts that have barely posted are discounted, and an
  account that rates almost everything 9–10 (or 1–2) is heavily discounted.
- **Concentration collapse.** Rating the same person repeatedly drops your
  weight to 25%. If over half your ratings target one person, everything you
  cast drops to 35%.
- **Hard rate limits.** 25 an hour, 80 a day.
- **No self-rating, no rating across a block, no rating removed posts.**
- **Detection queue.** `/admin → Integrity` lists accounts whose behaviour looks
  automated, with the same numbers the weighting used, and a moderator can
  revoke an account's rating weight retroactively.

The seed includes a three-account rating ring so the queue has a real catch on
first run.

---

## Feeds and ranking

**Following** is exactly what it says: posts from people you follow, newest
first. No ranking, no surprises.

**Recommended** ranks on engagement relative to the audience the author already
has, the post's community rating, freshness, and whether it matches what you
are into. Follower count only ever appears as a denominator, so a large account
gets no free ride, and a slice of genuinely new posts is reserved so people are
seen on their first day.

**Discover** ranks people by rating confidence — Overall, Last 30 days, and
within each category.

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
  `POST /api/v1/auth/login`, `GET /api/v1/me`, `GET /api/v1/feed?tab=`,
  `GET /api/v1/discover`, `GET /api/v1/users/[username]`,
  `GET /api/v1/posts/[id]`, `POST /api/v1/ratings`.
- **One auth system: Supabase Auth.** The website holds the Supabase session in
  HTTP-only cookies; a native client signs in with the Supabase SDK (or
  `POST /api/v1/auth/login`) and sends the same access token as
  `Authorization: Bearer <token>`. Both are verified by asking Supabase, so it
  is the same accounts, the same database, the same ratings and ranks.

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"tommy@faytarra.app","password":"faydemo123"}' | jq -r .accessToken)

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
  -e NEXT_PUBLIC_SUPABASE_URL=... \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e NEXT_PUBLIC_SITE_URL=https://your-domain \
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
- **Do not set `NODE_ENV=production` as a Vercel environment variable.** It
  makes the install skip devDependencies. `vercel.json` pins the Next.js
  framework preset and everything `next build` needs is a real dependency, so
  the build survives it either way — but it is still not a setting you want.

**Netlify, Amplify, Firebase App Hosting** — these also detect Next.js and
build it themselves; set the same variables and ignore the standalone output.

### Before the first production deploy

| Variable | Why it matters |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Auth. Without them **nobody can sign up or sign in** — the auth screens say so. |
| `NEXT_PUBLIC_SITE_URL` | The absolute URL Supabase puts in confirmation and reset emails. On Vercel it falls back to the deployment URL, which is fine for previews and wrong for a custom domain. |
| `SUPABASE_SERVICE_ROLE_KEY` | The database driver, and deleting an account's Supabase Auth user. Without it the app runs on the bundled JSON driver, which writes to `./.data`. On a container or serverless host that is ephemeral or read-only, so **every post and rating disappears on restart**. The server logs a warning if you deploy this way. |
| `SUPABASE_STORAGE_BUCKET` | Where uploads go. Local disk uploads do not survive a redeploy either. |
| `ADMIN_EMAILS` | Accounts that get the admin role at signup. |

If a deploy pipeline reports *"no functions, static, or services directory"*,
it is expecting a static export or its own bundle layout. FayTarra cannot be
statically exported — use a Node runtime, the container image, or a host with
first-class Next.js support.

---

## Running on Supabase

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) — tables, indexes, RLS, the
   `faytarra-media` storage bucket, and the `on_auth_user_created` trigger that
   gives every new Supabase Auth user a FayTarra profile.
   *Upgrading a database created before Supabase Auth?* Run
   [`supabase/migrations/0001_supabase_auth.sql`](supabase/migrations/0001_supabase_auth.sql)
   instead — it drops `password_hash`, points `public.users.id` at
   `auth.users`, and installs the same trigger.
3. In **Authentication → URL configuration**, set the site URL to your domain
   and add `https://your-domain/auth/callback` to the redirect allow-list.
   Confirmation and reset links land there.
4. Copy `.env.example` to `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   NEXT_PUBLIC_SITE_URL=https://your-domain
   ADMIN_EMAILS=you@example.com
   ```

5. `npm run seed` to load the sample community, or skip it and start empty.

The driver is chosen automatically: Supabase when those keys are set, the local
JSON store otherwise. Uploads follow the same rule — Supabase Storage in
production, local disk served through `/api/media/[file]` in development.

### Authentication

Identity is **Supabase Auth**, end to end:

- `auth.users` holds the email and the password. FayTarra has no password
  hashing code and no `password_hash` column — `public.users` is a profile
  keyed by the auth user's id.
- The profile is created by the `on_auth_user_created` trigger **inside the
  signup transaction**, so a duplicate username aborts the whole signup instead
  of leaving an auth account with no profile. A case-insensitive unique index on
  `username` is what actually guarantees uniqueness; the form's check is only
  there to fail politely.
- Email addresses are confirmed before the first sign-in (Supabase's default).
  The link goes to `/auth/callback`, which exchanges the code for a session.
- `src/middleware.ts` refreshes the access token on every navigation and gates
  `/create`, `/settings`, `/notifications` and `/admin`. The pages check again
  on the server — middleware is the fast path, never the only lock.
- `getViewer()` (`src/lib/session.ts`) calls `supabase.auth.getUser()`, which
  verifies the token with Supabase rather than trusting the cookie's contents.
  It accepts a bearer token too, for native clients.
- Password reset is Supabase's, via `/forgot-password` → email →
  `/auth/callback?next=/reset-password`.

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
    ratings.ts        # rating maths, fully documented (pure, shared)
    rating-weight.ts  # how much a rater counts (pure, unit tested)
    db/               # driver interface + local JSON driver + Supabase driver
    services/         # ratings, rankings, feed, posts, integrity, moderation…
    seed/             # the sample community
supabase/schema.sql   # tables, indexes, RLS, storage bucket
Dockerfile            # container image for any Node host
scripts/
  seed.ts             # seeds whichever driver is configured
  prepare-standalone.mjs  # completes the standalone build output
```

## Deliberately not built yet

Challenges, "give me a shot", levels and points were all removed to get the
core social experience right first; they may come back. Direct messages,
collaborations, live streaming, monetisation, verified profiles and native apps
have not been started. The seams exist: ratings and ranking are isolated,
documented modules, and the driver interface takes new tables without touching
feature code.
