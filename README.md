# UK Grad List

A self-hosted, hourly-refreshing board of UK graduate jobs & internships (0-2 yrs
experience), inspired by intern-list.com but built for the UK market and
weighted toward software/tech roles. Dark black/lilac UI, filterable table,
category pills, live-ish stats strip.

---

## 1. How it works (architecture)

```
uk-intern-list/
├── server/
│   ├── index.js       Express app - serves the frontend + JSON API,
│   │                  plus the secured /api/ingest trigger route
│   ├── db.js           Turso/libSQL schema + query helpers (async)
│   ├── ingest.js        Pulls listings from Adzuna, Reed, Greenhouse, Lever
│   │                    and Ashby; filters for entry-level, categorizes,
│   │                    classifies internship vs. graduate job
│   ├── companies.js     List of company career-board tokens to pull from
│   └── scheduler.js     node-cron job - optional, for local dev
├── public/
│   ├── index.html       Page structure
│   ├── style.css        Dark / lilac theme
│   └── app.js            Talks to the API, renders the table, handles filters
├── .github/workflows/
│   └── hourly-ingest.yml  GitHub Actions cron that triggers /api/ingest
├── .env.example
└── package.json
```

**Flow:** `ingest.js` hits five sources (Adzuna, Reed, and direct pulls from
Greenhouse/Lever/Ashby company boards), keeps only listings that look
genuinely entry-level, tags each one with a category, work-model,
internship-vs-graduate-job type, and (for tech roles) a detected tech stack,
then upserts them into a database. The Express server reads from that same
database to answer `/api/jobs`, `/api/stats`, `/api/categories`. The
frontend is plain HTML/CSS/JS - no build step, no framework.

**Two ways the hourly refresh can be triggered:**
- Locally, `npm start` also starts a `node-cron` job that re-runs the ingest
  every hour on its own, so nothing extra to set up for local dev.
- On a free host, relying on the host's own cron isn't reliable (free
  instances sleep - see section 3), so a **GitHub Actions workflow** hits a
  secured `/api/ingest` endpoint every hour from outside instead. This also
  has the nice side effect of waking a sleeping free instance once an hour
  regardless of whether anyone's visited it.

## 2. Where the data comes from

The original site can pull directly from LinkedIn, Indeed and Handshake
because it's operating at a scale/agreement most solo projects don't have.
**Scraping LinkedIn or Indeed's website directly breaks their Terms of
Service** and is the kind of thing that gets your IP banned or worse - I
didn't build that here, and I wouldn't recommend building it yourself
either.

Instead this uses official, free-tier APIs:

- **[Adzuna](https://developer.adzuna.com/)** - aggregates listings from
  Indeed, Reed, Totaljobs, CV-Library and others for the UK (`country=gb`).
  Free tier gives you an `app_id` and `app_key`.
- **[Reed](https://www.reed.co.uk/developers)** - reed.co.uk's own official
  API, free with an account.
- **Direct company career-board pulls** via `server/companies.js` - loads of
  employers (including ones that also post to LinkedIn) run their actual
  careers page on Greenhouse, Lever or Ashby, all three of which publish
  official, public, unauthenticated JSON APIs:
  - Greenhouse: `https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true`
  - Lever: `https://api.lever.co/v0/postings/<token>?mode=json`
  - Ashby: `https://api.ashbyhq.com/posting-api/job-board/<token>?includeCompensation=true`

**To add a company:** open `server/companies.js`, find the company's careers
page, click into any live job listing, and check the URL for its board
token, then add it to the matching array. A few real, tech-weighted examples
are already seeded: Monzo, Rothesay, Bottomline Technologies and Blenheim
Chalcot (Greenhouse), Palantir (Lever), Deliveroo (Ashby).

### Built for software/tech roles specifically
- Narrower tech categories instead of one catch-all bucket: Software
  Engineering, Frontend, Backend, Mobile, DevOps and Cloud, QA and Test,
  Data Engineering, Data Analysis, Machine Learning and AI, Cybersecurity.
- A **"Tech roles only"** quick filter covers all of those categories at once.
- Detected tech stack tags (`extractTechStack()` in `ingest.js`) - React,
  Python, AWS, Kubernetes, etc. shown as small tags under the job title.
- Extra tech-specific search queries against Adzuna and Reed so roles that
  don't literally say "graduate" or "junior" still surface.

## 3. Hosting it for free so friends can use it too

This is the part that actually needed some real engineering, so here's the
honest picture of what's free and what isn't in 2026:

| Host | Genuinely free? | Catch |
|---|---|---|
| **Render** | Yes, no card needed | Free web services sleep after 15 min idle; ephemeral disk (files wiped on redeploy/restart) |
| Railway | Not really | $5 one-time trial, then $1/mo minimum |
| Fly.io | No | Removed free tier in 2024, card required |
| Vercel/Netlify | Yes, but wrong shape | Serverless functions, not built for an always-on Express + cron process |

**Render is the pick.** The two problems with it - sleeping, and losing
local files - are both solved by two changes already made to this codebase:

1. **The database moved off the local disk.** `server/db.js` now talks to
   [Turso](https://turso.tech) (a free, hosted, SQLite-compatible database)
   instead of a local SQLite file. Local development still works with zero
   setup - if `TURSO_DATABASE_URL` is unset, it just uses a local file
   (`./data.db`) automatically. For a real deployment, your data needs to
   live somewhere that survives Render wiping the container:
   - Sign up free at [turso.tech](https://turso.tech) (no card).
   - Install their CLI and run `turso db create uk-grad-list`, or use their
     web dashboard if you'd rather not install anything.
   - Get the connection URL (`turso db show uk-grad-list --url`) and an auth
     token (`turso db tokens create uk-grad-list`).
   - Put both in Render's environment variables as `TURSO_DATABASE_URL` and
     `TURSO_AUTH_TOKEN`.

2. **The hourly refresh moved off the host's own clock.** Instead of relying
   on Render staying awake to fire `node-cron`, `.github/workflows/hourly-ingest.yml`
   runs on GitHub's infrastructure (which doesn't sleep) and calls your
   deployed `/api/ingest` endpoint once an hour. That endpoint is protected
   by an `INGEST_SECRET` so randoms can't trigger it and burn through your
   Adzuna/Reed quota.

### Deploying, step by step

1. Push this project to a GitHub repo.
2. **Set up Turso** (see above), note the URL + token.
3. **On Render:** New → Web Service → connect your repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Add environment variables: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`,
     `REED_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and a new
     random string for `INGEST_SECRET` (anything long and random - it's just
     a shared password between GitHub and your server).
   - Also set `ENABLE_INTERNAL_CRON=false` here, since GitHub Actions is now
     doing that job - no need for Render to also run its own hourly timer.
   - Deploy. Render gives you a URL like `https://uk-grad-list.onrender.com`.
4. **On GitHub:** repo Settings → Secrets and variables → Actions, add two
   repo secrets:
   - `APP_URL` = your Render URL (no trailing slash)
   - `INGEST_SECRET` = the same string you set on Render
5. The workflow in `.github/workflows/hourly-ingest.yml` is already
   committed and will start running hourly automatically. You can also
   trigger it manually from the repo's Actions tab (`workflow_dispatch`) to
   populate the database immediately instead of waiting up to an hour.
6. Share the Render URL with friends. Everyone hitting the same URL sees the
   same shared, constantly-refreshing dataset - there's no per-user login or
   saved state, it's just a public read-mostly board.

**On cold starts:** the free instance still sleeps after 15 minutes with no
visitors, so the first person to load the site after a quiet spell will see
a 30-60 second delay while it wakes up (the GitHub Actions ping every hour
also wakes it, so it's rarely been idle for *too* long). If that bothers
you, a free [UptimeRobot](https://uptimerobot.com) monitor pinging
`/api/stats` every 5 minutes keeps it always warm - purely a UX nicety at
this point, not a data-safety requirement like it would've been with local
SQLite.

## 4. Local setup

**Requirements:** Node.js 18+, npm.

```bash
cd uk-intern-list
npm install
cp .env.example .env
```

Edit `.env` and fill in at least `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`,
`REED_API_KEY` (free signups, no card, linked above). Leave `TURSO_*` blank
for local dev - it'll use a local file automatically.

```bash
npm start
```

Open **http://localhost:4000**. On first boot it immediately runs an ingest
(10-30 seconds), then repeats every hour via the built-in cron for as long
as the process stays running.

To force a manual re-pull without restarting the server:
```bash
npm run ingest
```

### Running it in VS Code
1. Open the `uk-intern-list` folder in VS Code (`File → Open Folder…`).
2. Open a terminal (`` Ctrl+` ``), run `npm install`, add your `.env`.
3. `npm start`, then `Cmd/Ctrl+Click` the `http://localhost:4000` link in the
   terminal output, or open it in your browser.

## 5. What's real vs. what's a stub

**Working out of the box:**
- Hourly refresh, either via local `node-cron` or the GitHub Actions ->
  `/api/ingest` route on a hosted deployment
- Entry-level filtering, category tagging (incl. tech sub-categories),
  work-model detection, internship-vs-graduate-job classification
- Detected tech stack tags on tech listings
- Filtering by title, company, location, work model, category, salary,
  internship/graduate-job type, and a tech-roles-only quick filter
- Pagination, sorting by newest / highest salary
- Direct-from-employer listings via Greenhouse/Lever/Ashby, a few real
  companies pre-configured
- Stats strip, dark/lilac responsive UI
- Persistent, shared hosting via Render + Turso + GitHub Actions (section 3)

**Stubbed - you'll want to build these out:**
- **Email alerts** - the "Notify me" form just shows an alert() right now.
  Needs a subscribers table, a `/api/subscribe` route, and a transactional
  email provider (Resend, Postmark, SendGrid).
- **Auth / saved searches** - none currently; it's a shared public view,
  filters are client-side query params, not saved server-side.
- **Company logos / richer job detail pages** - currently just a title +
  metadata row and an "Apply" link straight to the source listing.
- **Dedup across sources** - if the same job is posted to both Adzuna and
  Reed, you'll currently get two rows. A fuzzy-match dedupe (by
  title+company+location) is a reasonable next step if it bugs you.
- **Canada/US toggle** like the original - this build is UK-only by design,
  but the `country=gb` param in `ingest.js` is the only thing hard-coding
  that.

## 6. Tuning the entry-level & category filters

Both live in `server/ingest.js` as plain regexes:
- `SENIOR_EXCLUDE` / `ENTRY_INCLUDE` control what counts as "entry level."
- `CATEGORY_RULES` is an ordered list of `[categoryName, regex]` pairs -
  first match wins.
- `TECH_STACK_KEYWORDS` controls which stack tags get detected.

These are heuristics, not perfect - expect to iterate on them once you see
real results for a week or two.
