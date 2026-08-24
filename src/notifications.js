/**
 * notifications.js
 *
 * Sends push notifications via Expo's push notification service.
 * This is completely free with no API key required for sending
 * (Expo push tokens themselves are what authorize delivery to a specific device).
 *
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Sends one push notification per subscribed device for a single new
 * announcement. Expo's API accepts batches of up to 100 messages per request,
 * so we chunk if there are many subscribers.
 */
async function sendNewAnnouncementNotifications(
  subscriptions,
  announcement,
  fetchImpl = require('node-fetch')
) {
  if (subscriptions.length === 0) return { sent: 0, errors: [] };

  const messages = subscriptions.map((sub) => ({
    to: sub.expo_push_token,
    sound: 'default',
    title: '🔔 CampusWatch',
    body: `New ISIMS announcement\n"${announcement.title}"`,
    data: {
      url: announcement.url,
      external_id: announcement.external_id,
    },
  }));

  const chunkSize = 100;
  const errors = [];
  let sent = 0;

  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);

    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(chunk),
      });

      const json = await res.json();

      if (!res.ok) {
        errors.push(`Expo push HTTP ${res.status}: ${JSON.stringify(json)}`);
        continue;
      }

      // Each ticket corresponds to one message in the chunk, in order.
      (json.data || []).forEach((ticket, idx) => {
        if (ticket.status === 'error') {
          errors.push(
            `Push failed for token ${chunk[idx].to}: ${ticket.message} (${ticket.details?.error || 'unknown'})`
          );
        } else {
          sent += 1;
        }
      });
    } catch (err) {
      errors.push(`Expo push request failed: ${err.message}`);
    }
  }

  return { sent, errors };
}

module.exports = { sendNewAnnouncementNotifications, EXPO_PUSH_URL };
