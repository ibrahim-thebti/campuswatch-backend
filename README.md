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

## ISIMS network reachability and production setup

`https://isimsf.rnu.tn/` is often unreachable from foreign cloud runner IPs
(including standard GitHub-hosted runners). To get **real** monitor success
(`success: true` from actual fetch/parse), this repo now supports two paths:

1. **Recommended: self-hosted GitHub Actions runner**
   - `.github/workflows/monitor.yml` now runs on `self-hosted` Linux x64.
   - Install/register your runner on a machine/network that can reach ISIMS
     (e.g. Tunisia ISP/VPS).
   - The workflow sets `REQUIRE_MONITOR_SUCCESS=true`, so the run is marked
     failed unless monitor returns `success: true`.

2. **Relay/proxy URL override**
   - `src/scraper.js` supports `ISIMS_HOME_URL`.
   - If direct access is blocked, point `ISIMS_HOME_URL` to a relay endpoint
     that returns the ISIMS homepage HTML.
   - Leave `ISIMS_HOME_URL` empty to fetch ISIMS directly.

This keeps workflow status honest: green means the monitor actually succeeded.
