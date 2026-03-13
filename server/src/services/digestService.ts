import { getPool } from "../db/pool";
import { sendEmail } from "./emailService";
import { sendSms } from "./smsService";
import { NotificationFrequency, NotificationPreferences } from "../../../shared/types";

interface DigestUserRow {
  id: number;
  email: string;
  phone: string | null;
  notification_preferences: NotificationPreferences;
}

interface DigestNotificationRow {
  id: number;
  title: string;
  message: string;
  created_at: string;
}

/**
 * Send digest emails/SMS for users with daily_digest or weekly_digest frequency.
 * Called by the scheduler:
 *   - Daily digest: runs every day at 6 AM UTC
 *   - Weekly digest: runs every Monday at 6 AM UTC
 *
 * For each user with deferred notifications:
 * 1. Collect all undelivered notifications since last digest
 * 2. Build a summary email/SMS
 * 3. Send and mark as delivered
 */
export async function sendDigestNotifications(frequency: NotificationFrequency): Promise<{ usersSent: number; notificationsIncluded: number }> {
  if (frequency === "immediate") return { usersSent: 0, notificationsIncluded: 0 };

  const pool = getPool();
  if (!pool) return { usersSent: 0, notificationsIncluded: 0 };

  let usersSent = 0;
  let notificationsIncluded = 0;

  const client = await pool.connect();
  try {
    // Find users with this digest frequency who have deferred notifications
    const usersResult = await client.query<DigestUserRow>(
      `SELECT DISTINCT u.id, u.email, u.phone, u.notification_preferences
       FROM users u
       JOIN notifications n ON n.user_id = u.id
       WHERE (u.notification_preferences->>'frequency')::text = $1
         AND (n.channels_sent::text LIKE '%email_deferred%' OR n.channels_sent::text LIKE '%sms_deferred%')`,
      [frequency]
    );

    for (const user of usersResult.rows) {
      try {
        // Get all deferred notifications for this user
        const notifResult = await client.query<DigestNotificationRow>(
          `SELECT id, title, message, created_at
           FROM notifications
           WHERE user_id = $1
             AND (channels_sent::text LIKE '%email_deferred%' OR channels_sent::text LIKE '%sms_deferred%')
           ORDER BY created_at ASC`,
          [user.id]
        );

        if (notifResult.rows.length === 0) continue;

        const notifications = notifResult.rows;
        notificationsIncluded += notifications.length;
        const prefs = user.notification_preferences;

        // Build digest email
        if (prefs.emailEnabled) {
          const subject = `Court Calendar Digest — ${notifications.length} update${notifications.length !== 1 ? "s" : ""}`;
          const itemsHtml = notifications.map(n =>
            `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${n.created_at.slice(0, 10)}</td><td style="padding:8px;border-bottom:1px solid #eee;"><strong>${n.title}</strong><br/>${n.message}</td></tr>`
          ).join("");
          const html = `
            <h2>Court Calendar Update${notifications.length !== 1 ? "s" : ""}</h2>
            <p>You have ${notifications.length} new notification${notifications.length !== 1 ? "s" : ""} since your last digest.</p>
            <table style="width:100%;border-collapse:collapse;">
              <tr><th style="padding:8px;text-align:left;border-bottom:2px solid #4f46e5;">Date</th><th style="padding:8px;text-align:left;border-bottom:2px solid #4f46e5;">Details</th></tr>
              ${itemsHtml}
            </table>
            <p style="margin-top:16px;color:#666;">You're receiving this ${frequency === "daily_digest" ? "daily" : "weekly"} digest. Change this in your profile settings.</p>
          `;
          await sendEmail(user.email, subject, html);
        }

        // Build digest SMS
        if (prefs.smsEnabled && user.phone) {
          const smsBody = `Court Calendar: ${notifications.length} update${notifications.length !== 1 ? "s" : ""}. ` +
            notifications.slice(0, 3).map(n => n.title).join("; ") +
            (notifications.length > 3 ? ` +${notifications.length - 3} more` : "") +
            ". Check your app for details.";
          await sendSms(user.phone, smsBody);
        }

        // Mark notifications as delivered (replace deferred with sent)
        for (const n of notifications) {
          await client.query(
            `UPDATE notifications
             SET channels_sent = (
               SELECT jsonb_agg(
                 CASE
                   WHEN elem::text = '"email_deferred"' THEN '"email"'::jsonb
                   WHEN elem::text = '"sms_deferred"' THEN '"sms"'::jsonb
                   ELSE elem
                 END
               )
               FROM jsonb_array_elements(channels_sent::jsonb) AS elem
             )
             WHERE id = $1`,
            [n.id]
          );
        }

        usersSent++;
      } catch (err) {
        console.error(`❌ Digest send failed for user ${user.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    client.release();
  }

  if (usersSent > 0) {
    console.log(`📬 ${frequency} digest: sent to ${usersSent} users, ${notificationsIncluded} notifications`);
  }

  return { usersSent, notificationsIncluded };
}
