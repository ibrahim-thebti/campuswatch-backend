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

**⚠️ Important — do not trust the GitHub Actions green checkmark as-is:**
PR #1 ("Handle monitor transient failures without failing workflow") changed
`scripts/run-monitor-once.js` to always `exit(0)`, even when the ISIMS fetch
fails. This means the Actions tab will show a permanent green "Success"
regardless of whether any data was actually fetched. **The badge is
currently not a reliable signal.** Before relying on this workflow again,
either revert that behavior (exit non-zero on `result.success === false`)
or add separate, honest monitoring (e.g. alert on `newCount`/`success`
inside the log, not on the job's exit code).
**Fix in progress: self-hosted GitHub Actions runner**

`.github/workflows/monitor.yml` now targets `runs-on: [self-hosted, isims-monitor]`
instead of `ubuntu-latest`. This routes the fetch through a runner registered
on a machine with a normal Tunisian ISP connection — the only option
confirmed to actually reach `isimsf.rnu.tn` (see "What was ruled out" above).

### Self-hosted runner setup

Do this once, on a machine (PC or VPS) that has a normal Tunisian internet
connection and can stay powered on / connected:

1. Go to the repo on GitHub → **Settings → Actions → Runners → New
   self-hosted runner**.
2. Pick the OS matching your machine (Linux/Windows/macOS) and follow the
   generated download + config commands GitHub shows you — they include a
   one-time registration token, so copy them exactly from the GitHub UI
   rather than from here (the token expires quickly).
3. When prompted for labels during `./config.sh` (or `config.cmd`), add the
   extra label `isims-monitor` in addition to the default `self-hosted` —
   this is what the workflow's `runs-on: [self-hosted, isims-monitor]`
   matches on.
4. Run the runner as a persistent service so it survives reboots and stays
   listening for scheduled triggers:
   - Linux: `sudo ./svc.sh install && sudo ./svc.sh start`
   - Windows: run `config.cmd` as Administrator and choose "run as a
     service" when prompted, or use `.\svc.sh` equivalent / register via
     `nssm`/Task Scheduler.
5. Confirm it shows **Idle** (green) under Settings → Actions → Runners.
6. Trigger a manual run from the **Actions** tab (`ISIMS Monitor` →
   `Run workflow`) to confirm `success: true` before relying on the
   15-minute schedule.

**Important:** unlike GitHub-hosted runners, a self-hosted runner only picks
up scheduled runs while the machine is on and the runner service is
running. If the machine sleeps, loses power, or loses network, the
15-minute checks simply won't fire until it's back — no data loss (per the
error-handling rules above), just a gap in checking.

**Not pursued:**
- Paid scraping proxy (ScraperAPI, Bright Data) — would work but costs
  money; self-hosted is free and already confirmed reachable.
- Cloudflare Worker relay — Cloudflare's edge egress is also foreign
  infrastructure, so it's very likely to hit the same RNU network-level
  block as Render/GitHub Actions. Not worth pursuing unless self-hosted
  proves impractical.
