/**
 * monitor.js
 *
 * The core monitoring job, run every ~15 minutes by the scheduler.
 *
 * Flow (per the required architecture):
 *   fetch ISIMS -> parse "À la une" -> compare with stored announcements
 *   -> new ones? -> save + notify
 *
 * Error handling rules (per spec, do not weaken these):
 *   - If the site is unreachable: do NOT delete existing announcements,
 *     do NOT send notifications, KEEP the last successful check timestamp
 *     as-is, log the error, and simply try again next scheduled run.
 *   - If scraping "succeeds" (200 OK) but the structure looks wrong
 *     (scraper.js throws SCRAPER_STRUCTURE_CHANGED), treat it the same way:
 *     log it, do not fabricate announcements, do not touch existing data.
 */

const { fetchAnnouncements } = require('./scraper');
const {
  getClient,
  filterNewAnnouncements,
  insertAnnouncements,
  getAllPushSubscriptions,
  recordMonitorRun,
} = require('./db');
const { sendNewAnnouncementNotifications } = require('./notifications');

async function runMonitorOnce() {
  const supabase = getClient();
  const startedAt = new Date();

  let scraped;
  try {
    scraped = await fetchAnnouncements();
  } catch (err) {
    // Covers both network failure and SCRAPER_STRUCTURE_CHANGED errors.
    console.error(`[monitor] Fetch/parse failed at ${startedAt.toISOString()}:`, err.message);
    await recordMonitorRun(supabase, {
      success: false,
      newCount: 0,
      errorMessage: err.message,
    });
    // Explicitly: do nothing else. No deletes, no notifications, no fake data.
    return { success: false, newCount: 0, error: err.message };
  }

  let newOnes;
  try {
    newOnes = await filterNewAnnouncements(supabase, scraped);
  } catch (err) {
    console.error('[monitor] DB comparison failed:', err.message);
    await recordMonitorRun(supabase, {
      success: false,
      newCount: 0,
      errorMessage: err.message,
    });
    return { success: false, newCount: 0, error: err.message };
  }

  if (newOnes.length === 0) {
    console.log(`[monitor] Checked at ${startedAt.toISOString()} — no new announcements.`);
    await recordMonitorRun(supabase, { success: true, newCount: 0 });
    return { success: true, newCount: 0 };
  }

  let inserted;
  try {
    inserted = await insertAnnouncements(supabase, newOnes);
  } catch (err) {
    console.error('[monitor] Insert failed, aborting notifications to avoid notifying for unsaved posts:', err.message);
    await recordMonitorRun(supabase, {
      success: false,
      newCount: 0,
      errorMessage: err.message,
    });
    return { success: false, newCount: 0, error: err.message };
  }

  console.log(`[monitor] ${inserted.length} new announcement(s) detected and saved.`);

  let subscriptions = [];
  try {
    subscriptions = await getAllPushSubscriptions(supabase, { onlyEnabled: true });
  } catch (err) {
    console.error('[monitor] Failed to load push subscriptions — announcements saved but no notifications sent:', err.message);
  }

  const notifyResults = [];
  for (const announcement of inserted) {
    const result = await sendNewAnnouncementNotifications(subscriptions, announcement);
    notifyResults.push({ announcement: announcement.external_id, ...result });
    if (result.errors.length > 0) {
      console.error(`[monitor] Notification errors for "${announcement.title}":`, result.errors);
    }
  }

  await recordMonitorRun(supabase, { success: true, newCount: inserted.length });

  return { success: true, newCount: inserted.length, notifyResults };
}

module.exports = { runMonitorOnce };
