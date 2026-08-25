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

async function main({ run = runMonitorOnce, exit = process.exit } = {}) {
  try {
    const result = await run();
    console.log('[run-monitor-once] Result:', JSON.stringify(result));

    // A failed monitor run (site down/timeout/structure change) is expected
    // to be retried on the next schedule and should not fail the whole
    // GitHub Actions workflow.
    exit(0);
  } catch (err) {
    console.error('[run-monitor-once] Unexpected error:', err);
    exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };