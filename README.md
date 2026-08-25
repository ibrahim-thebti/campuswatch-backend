# CampusWatch Backend

Monitors https://isimsf.rnu.tn/ every 15 minutes for new "À la une"
announcements, stores them in Postgres (Supabase), and sends free push
notifications via Expo when a genuinely new post is detected.

## What's actually implemented (Phases 1–5 of the original plan)

- ✅ **Phase 1 — Site inspection**: confirmed the "À la une" section is
  plain server-rendered HTML (no JS, no API, no RSS). See `src/scraper.js`
  header comment for details.
- ✅ **Phase 2 — Real extraction**: `src/scraper.js`, tested against a real
  saved copy of the site's HTML in `test/fixtures/isims_home.html`.
  Run `npm test` to verify — it asserts exact titles, dates, and URLs
  parsed from real markup, including edge cases (Arabic-titled posts,
  year-rollover date inference, "new" badge stripping).
- ✅ **Phase 3 — DB + duplicate detection**: `supabase/schema.sql` +
  `src/db.js`. Dedup key is the ISIMS URL slug (`external_id`), enforced
  both in application logic and via a DB unique constraint.
- ✅ **Phase 4 — Scheduled monitoring**: `src/scheduler.js`, cron
  `*/15 * * * *`.
- ✅ **Phase 5 — Push notifications**: `src/notifications.js`, using
  Expo's free push service.

Error handling (per spec): if the ISIMS site is down or its structure
changes unexpectedly, the monitor logs the failure, does **not** delete
existing data, does **not** send notifications, and simply retries on the
next scheduled run. See `src/monitor.js`.

## Local setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env with your real Supabase URL + service key
npm test        # runs the scraper test against the real HTML fixture
npm start        # starts the API + scheduler locally
```

## One-time Supabase setup (free tier)

1. Create a free project at https://supabase.com (sign in with GitHub —
   no international card needed).
2. Open the SQL editor and run the contents of `../supabase/schema.sql`.
3. Go to Project Settings → API and copy the "Project URL" and the
   "service_role" key into your `.env` (`SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`).

## Deploying (free tier — Render)

1. Push this `backend/` folder to a GitHub repo.
2. On https://render.com (free tier, GitHub sign-in), create a new
   **Web Service**, point it at the repo/`backend` folder.
3. Build command: `npm install`
   Start command: `npm start`
4. Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` under Render's
   Environment tab — never commit them to the repo.
5. Once deployed, Render gives you a public URL like
   `https://campuswatch-backend.onrender.com`. That's the `API_BASE_URL`
   the Android app needs (see `app/README.md`).

Note: Render's free web services can spin down after inactivity and take
~30–60s to wake on the next request. The cron schedule inside this app
only fires while the process is awake, so on the free tier you may want to
also set up a free external uptime pinger (e.g. UptimeRobot, free tier)
hitting `/health` every 10 minutes to keep it warm — this is optional but
improves the reliability of the 15-minute check cadence.

## API endpoints (consumed by the Android app)

- `GET /api/announcements?limit=30` — latest announcements, newest first
- `GET /api/status` — `{ monitoring: true, last_checked_at }`
- `POST /api/subscribe` — `{ deviceId, expoPushToken, notificationsEnabled }`
- `POST /api/settings/notifications` — `{ deviceId, enabled }`

## ⚠️ Known issue: ISIMS is unreachable from cloud hosts (unresolved)

As of 2026-08-25, `src/scraper.js` cannot actually reach
`https://isimsf.rnu.tn/` when deployed on either Render or GitHub Actions —
every request silently times out (no HTTP error, no TLS error, just a dead
connection). The site loads fine from a normal home/ISP connection in
Tunisia, including in a browser.

**Root cause (likely):** `isimsf.rnu.tn` sits on Tunisia's national academic
network (RNU), operated by CCK, which almost certainly filters traffic from
foreign cloud/datacenter IP ranges (AWS — used by Render; Azure — used by
GitHub Actions runners) at the network level. This is very likely true of
*all* `.rnu.tn` sites, not just ISIMS specifically — see chat history from
2026-08-25 for the full diagnosis (including a temporary `/debug/isims`
route that confirmed a raw 20s timeout with no response at all from
Render's IP).

**What was ruled out:**
- Render (AWS-backed) — confirmed blocked via `/debug/isims` diagnostic route.
- GitHub Actions (`ubuntu-latest` runners, Azure-backed) — confirmed blocked
  too (see `scripts/run-monitor-once.js` log output from run on
  2026-08-25T09:25:07Z: `network timeout at: https://isimsf.rnu.tn/`).

`scripts/run-monitor-once.js` exits non-zero when
`runMonitorOnce()` returns `success: false`, so the GitHub Actions check now
correctly fails on monitor fetch/parse failures.

**Options to actually fix this (not yet done):**
1. Run the monitor job from a machine on a normal Tunisian/residential
   connection (e.g. a scheduled task on a personal PC) — confirmed to work,
   just requires the machine to be on.
2. Route the fetch through a paid scraping proxy with a non-blocked exit IP
   (e.g. ScraperAPI, Bright Data) — costs money, keeps everything cloud-only.
3. Untested: a Cloudflare Worker relay (fetch ISIMS from Cloudflare's edge,
   have this backend call the Worker instead of ISIMS directly) — worth a
   quick test before committing to option 2.

Until one of these is in place, `npm run monitor:once` / the scheduled
job will keep failing silently (or "successfully failing," post-PR #1) —
the API and Android app will keep serving whatever was already saved in
Supabase, but no new announcements will come in.
