/**
 * server.js
 *
 * Minimal API the Android app talks to. The app never talks to ISIMS or the
 * database directly — only to this backend, which owns all secrets.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getClient, getLatestAnnouncements, upsertPushSubscription, setNotificationsEnabled, getLastSuccessfulRun } = require('./db');
const { startScheduler } = require('./scheduler');

const app = express();
app.use(cors());
app.use(express.json());

// --- Health check (also used by uptime monitors / Render) -----------------
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'campuswatch-backend', time: new Date().toISOString() });
});

// --- Announcements ----------------------------------------------------------
app.get('/api/announcements', async (req, res) => {
  try {
    const supabase = getClient();
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const data = await getLatestAnnouncements(supabase, limit);
    res.json({ announcements: data });
  } catch (err) {
    console.error('[server] GET /api/announcements failed:', err.message);
    res.status(500).json({ error: 'Failed to load announcements' });
  }
});

// --- Monitoring status (for the Home screen "🟢 Monitoring / Last checked") -
app.get('/api/status', async (req, res) => {
  try {
    const supabase = getClient();
    const lastRun = await getLastSuccessfulRun(supabase);
    res.json({
      monitoring: true,
      last_checked_at: lastRun ? lastRun.ran_at : null,
    });
  } catch (err) {
    console.error('[server] GET /api/status failed:', err.message);
    res.status(500).json({ error: 'Failed to load status' });
  }
});

// --- Push subscription registration (called once by the app on install/launch)
app.post('/api/subscribe', async (req, res) => {
  try {
    const { deviceId, expoPushToken, notificationsEnabled } = req.body;
    if (!deviceId || !expoPushToken) {
      return res.status(400).json({ error: 'deviceId and expoPushToken are required' });
    }
    const supabase = getClient();
    await upsertPushSubscription(supabase, {
      deviceId,
      expoPushToken,
      notificationsEnabled: notificationsEnabled !== false,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[server] POST /api/subscribe failed:', err.message);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// --- Settings toggle (Notifications ON/OFF) ---------------------------------
app.post('/api/settings/notifications', async (req, res) => {
  try {
    const { deviceId, enabled } = req.body;
    if (!deviceId || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'deviceId and boolean enabled are required' });
    }
    const supabase = getClient();
    await setNotificationsEnabled(supabase, deviceId, enabled);
    res.json({ ok: true });
  } catch (err) {
    console.error('[server] POST /api/settings/notifications failed:', err.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] CampusWatch backend listening on port ${PORT}`);
  startScheduler();
});
