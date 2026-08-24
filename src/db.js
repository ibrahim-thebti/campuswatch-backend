/**
 * db.js
 *
 * All database access lives here. Uses Supabase's Postgres via the JS client.
 * Never hardcode credentials — SUPABASE_URL and SUPABASE_SERVICE_KEY must come
 * from environment variables (see .env.example).
 */

const { createClient } = require('@supabase/supabase-js');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables. ' +
      'Set them in your deployment environment (e.g. Render dashboard), never in code.'
    );
  }

  return createClient(url, key);
}

/**
 * Given a list of freshly-scraped announcements, returns only the ones whose
 * external_id is NOT already in the database — i.e. genuinely new posts.
 * This is the core duplicate-detection logic: a post is "new" iff its unique
 * ISIMS URL slug has never been stored before.
 */
async function filterNewAnnouncements(supabase, scraped) {
  if (scraped.length === 0) return [];

  const ids = scraped.map((a) => a.external_id);

  const { data: existing, error } = await supabase
    .from('announcements')
    .select('external_id')
    .in('external_id', ids);

  if (error) {
    throw new Error(`DB_QUERY_FAILED (checking existing announcements): ${error.message}`);
  }

  const existingIds = new Set((existing || []).map((r) => r.external_id));
  return scraped.filter((a) => !existingIds.has(a.external_id));
}

/**
 * Inserts new announcements into the DB. Assumes caller already filtered out
 * duplicates via filterNewAnnouncements — but relies on the DB unique
 * constraint on external_id as a safety net against race conditions too.
 */
async function insertAnnouncements(supabase, newOnes) {
  if (newOnes.length === 0) return [];

  const rows = newOnes.map((a) => ({
    external_id: a.external_id,
    title: a.title,
    url: a.url,
    publication_date: a.publication_date,
    category: a.category,
    description: a.description,
  }));

  // upsert with ignoreDuplicates guards against a race where two overlapping
  // runs both see the same "new" post before either has inserted it.
  const { data, error } = await supabase
    .from('announcements')
    .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true })
    .select();

  if (error) {
    throw new Error(`DB_INSERT_FAILED: ${error.message}`);
  }

  return data || [];
}

async function getLatestAnnouncements(supabase, limit = 30) {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('first_detected_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`DB_QUERY_FAILED: ${error.message}`);
  return data;
}

async function getAllPushSubscriptions(supabase, { onlyEnabled = true } = {}) {
  let query = supabase.from('push_subscriptions').select('*');
  if (onlyEnabled) query = query.eq('notifications_enabled', true);

  const { data, error } = await query;
  if (error) throw new Error(`DB_QUERY_FAILED: ${error.message}`);
  return data;
}

async function upsertPushSubscription(supabase, { deviceId, expoPushToken, notificationsEnabled = true }) {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        device_id: deviceId,
        expo_push_token: expoPushToken,
        notifications_enabled: notificationsEnabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'device_id' }
    )
    .select();

  if (error) throw new Error(`DB_UPSERT_FAILED: ${error.message}`);
  return data;
}

async function setNotificationsEnabled(supabase, deviceId, enabled) {
  const { error } = await supabase
    .from('push_subscriptions')
    .update({ notifications_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('device_id', deviceId);

  if (error) throw new Error(`DB_UPDATE_FAILED: ${error.message}`);
}

async function recordMonitorRun(supabase, { success, newCount = 0, errorMessage = null }) {
  const { error } = await supabase.from('monitor_runs').insert({
    success,
    new_count: newCount,
    error_message: errorMessage,
  });
  // Logging failure to log shouldn't crash the process — just console.error it.
  if (error) console.error('Failed to record monitor run:', error.message);
}

async function getLastSuccessfulRun(supabase) {
  const { data, error } = await supabase
    .from('monitor_runs')
    .select('*')
    .eq('success', true)
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`DB_QUERY_FAILED: ${error.message}`);
  return data;
}

module.exports = {
  getClient,
  filterNewAnnouncements,
  insertAnnouncements,
  getLatestAnnouncements,
  getAllPushSubscriptions,
  upsertPushSubscription,
  setNotificationsEnabled,
  recordMonitorRun,
  getLastSuccessfulRun,
};
