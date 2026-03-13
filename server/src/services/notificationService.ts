import { getPool } from "../db/pool";
import { sendEmail, sendScheduleChangeEmail } from "./emailService";
import { sendScheduleChangeSms } from "./smsService";
import { NotificationType, NotificationPreferences, Notification, ServerToClientEvents, ClientToServerEvents } from "../../../shared/types";
import type { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents> | null = null;

/**
 * Set the Socket.io server instance for real-time push.
 * Called once from index.ts after Socket.io is initialized.
 */
export function setSocketServer(server: SocketIOServer<ClientToServerEvents, ServerToClientEvents>): void {
  io = server;
}

interface NotifyParams {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface UserNotificationInfo {
  email: string;
  phone: string | null;
  notification_preferences: NotificationPreferences;
}

export async function createNotification(params: NotifyParams): Promise<number | null> {
  const pool = getPool();
  if (!pool) return null;

  const client = await pool.connect();
  try {
    // Insert in-app notification
    const result = await client.query(
      `INSERT INTO notifications (user_id, type, title, message, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [params.userId, params.type, params.title, params.message, JSON.stringify(params.metadata || {})]
    );

    const notificationId = result.rows[0].id;

    // Get user preferences
    const userResult = await client.query(
      `SELECT email, phone, notification_preferences FROM users WHERE id = $1`,
      [params.userId]
    );

    if (userResult.rows.length === 0) return notificationId;

    const user: UserNotificationInfo = userResult.rows[0];
    const prefs = user.notification_preferences;
    const frequency = prefs.frequency || "immediate";
    const channelsSent: string[] = ["in_app"];

    // For digest modes, we still create the in-app notification and Socket push,
    // but defer email/SMS delivery to the digest job.
    const shouldSendNow = frequency === "immediate";

    // Send email if enabled and frequency is immediate
    if (prefs.emailEnabled && shouldSendNow) {
      const sent = await sendEmail(user.email, params.title, `<p>${params.message}</p>`);
      if (sent) channelsSent.push("email");
    } else if (prefs.emailEnabled && !shouldSendNow) {
      channelsSent.push("email_deferred");
    }

    // Send SMS if enabled, phone available, and frequency is immediate
    if (prefs.smsEnabled && user.phone && shouldSendNow) {
      const sent = await sendScheduleChangeSms(user.phone, params.title, params.message);
      if (sent) channelsSent.push("sms");
    } else if (prefs.smsEnabled && user.phone && !shouldSendNow) {
      channelsSent.push("sms_deferred");
    }

    // Update channels_sent
    await client.query(
      `UPDATE notifications SET channels_sent = $1 WHERE id = $2`,
      [JSON.stringify(channelsSent), notificationId]
    );

    // Emit real-time notification via Socket.io
    if (io) {
      const unread = await getUnreadCountInternal(client, params.userId);
      io.to(`user:${params.userId}`).emit("new_notification", {
        unreadCount: unread,
        notification: {
          id: notificationId,
          userId: params.userId,
          type: params.type,
          title: params.title,
          message: params.message,
          metadata: params.metadata || {},
          read: false,
          channelsSent,
          createdAt: new Date().toISOString(),
        },
      });
    }

    return notificationId;
  } finally {
    client.release();
  }
}

export async function notifyScheduleChange(
  userId: number,
  caseName: string,
  changes: Array<{ field: string; oldValue: string; newValue: string }>
): Promise<void> {
  const summary = changes.map((c) => `${c.field}: ${c.oldValue} → ${c.newValue}`).join("; ");

  await createNotification({
    userId,
    type: "schedule_change",
    title: `Schedule Change: ${caseName}`,
    message: summary,
    metadata: { changes },
  });
}

/**
 * Internal helper — get unread count using an existing client (no extra pool.connect).
 */
async function getUnreadCountInternal(client: { query: (q: string, p: unknown[]) => Promise<{ rows: Array<{ count: string }> }> }, userId: number): Promise<number> {
  const result = await client.query(
    `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false`,
    [userId]
  );
  return parseInt(result.rows[0].count, 10);
}

export async function getUnreadCount(userId: number): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false`,
      [userId]
    );
    return parseInt(result.rows[0].count, 10);
  } finally {
    client.release();
  }
}
