/**
 * run-monitor-once.js
 *
 * Entry point for running a single monitor check, then exiting.
 * Used by the GitHub Actions workflow (.github/workflows/monitor.yml),
 * which triggers this on a schedule instead of relying on Render's
 * always-on node-cron scheduler (which requires the Render process to
 * never spin down, AND requires Render's outbound IP to be reachable
 * by isimsf.rnu.tn — neither of which holds on the free tier).
 *
 * Reuses the exact same runMonitorOnce() logic from src/monitor.js —
 * nothing about the scraping/dedup/insert/notify flow is duplicated here.
 */
require('dotenv').config();
const { runMonitorOnce } = require('../src/monitor');

runMonitorOnce()
  .then((result) => {
    console.log('[run-monitor-once] Result:', JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  })
  .catch((err) => {
    console.error('[run-monitor-once] Unexpected error:', err);
    process.exit(1);
  });