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

function isKnownIsimsNetworkTimeout(result) {
  if (typeof result?.error !== 'string') return false;

  const error = result.error.toLowerCase();
  const mentionsIsims = error.includes('isimsf.rnu.tn');
  const isNetworkFailure =
    error.includes('timeout') ||
    error.includes('enotfound') ||
    error.includes('eai_again') ||
    error.includes('econnreset') ||
    error.includes('etimedout') ||
    error.includes('fetch failed') ||
    error.includes('failed, reason');

  return mentionsIsims && isNetworkFailure;
}

function isStrictSuccessRequired() {
  return String(process.env.REQUIRE_MONITOR_SUCCESS || '').toLowerCase() === 'true';
}

runMonitorOnce()
  .then((result) => {
    console.log('[run-monitor-once] Result:', JSON.stringify(result));
    if (result.success) {
      process.exit(0);
    }

    if (isStrictSuccessRequired()) {
      console.error(
        '[run-monitor-once] REQUIRE_MONITOR_SUCCESS=true: failing workflow because monitor result was not successful.'
      );
      process.exit(1);
    }

    if (isKnownIsimsNetworkTimeout(result)) {
      console.warn(
        '[run-monitor-once] Known ISIMS network timeout from cloud runner; treating this run as non-fatal for workflow status.'
      );
      console.log('[run-monitor-once] Workflow Result:', JSON.stringify({ success: true, reason: 'known_isims_network_timeout' }));
      process.exit(0);
    }

    process.exit(1);
  })
  .catch((err) => {
    console.error('[run-monitor-once] Unexpected error:', err);
    process.exit(1);
  });