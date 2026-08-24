/**
 * scheduler.js
 *
 * Runs the monitor job on a fixed schedule (~every 15 minutes), independent
 * of whether the Android app is open. This process must stay running on the
 * backend host (e.g. Render background worker or web service) for monitoring
 * to continue when the phone app is closed.
 */

const cron = require('node-cron');
const { runMonitorOnce } = require('./monitor');

// Every 15 minutes.
const CRON_EXPRESSION = '*/15 * * * *';

function startScheduler() {
  console.log(`[scheduler] Starting — will check ISIMS every 15 minutes (cron: "${CRON_EXPRESSION}")`);

  // Run once immediately on boot so the first check isn't delayed up to 15 min.
  runMonitorOnce().catch((err) => {
    console.error('[scheduler] Initial run threw unexpectedly:', err);
  });

  cron.schedule(CRON_EXPRESSION, () => {
    runMonitorOnce().catch((err) => {
      // runMonitorOnce already catches its own internal errors and returns
      // a result object rather than throwing, so reaching here means
      // something truly unexpected happened. Log and continue — the next
      // scheduled tick will still fire.
      console.error('[scheduler] Unexpected error in scheduled run:', err);
    });
  });
}

module.exports = { startScheduler, CRON_EXPRESSION };
