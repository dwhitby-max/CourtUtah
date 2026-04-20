import { getPool } from "../db/pool";
import { sendEmail, sendScheduleChangeEmail, sendNewMatchEmail, sendCancellationEmail } from "./emailService";
import { sendScheduleChangeSms } from "./smsService";
import { NotificationType, NotificationPreferences, Notification, ServerToClientEvents, ClientToServerEvents } from "@shared/types";
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
  savedSearchId?: number;
}

interface UserNotificationInfo {
  email: string;
  phone: string | null;
  notification_preferences: NotificationPreferences;
}

/**
 * Send a formatted email based on notification type.
 * Falls back to a generic email if the type doesn't have a dedicated template.
 */
async function sendTypedEmail(to: string, params: NotifyParams): Promise<boolean> {
  const meta = params.metadata || {};

  switch (params.type) {
    case "schedule_change": {
      const changes = meta.changes as Array<{ field: string; oldValue: string; newValue: string }> | undefined;
      if (changes && changes.length > 0) {
        const caseName = (meta.caseNumber as string) || (meta.defendantName as string) || params.title.replace("Schedule Change: ", "");
        return sendScheduleChangeEmail(to, caseName, changes);
      }
      break;
    }
    case "new_match": {
      const events = meta.matchedEvents as Array<{ date: string; time: string; court: string; hearingType: string }> | undefined;
      const caseName = (meta.searchValue as string) || params.title.replace("New matches for ", "").replace(/"/g, "");
      if (events && events.length > 0) {
        return sendNewMatchEmail(to, caseName, events);
      }
      // Fallback: send generic email with the message
      return sendEmail(to, params.title, `<p>${params.message}</p>`);
    }
    case "event_cancelled": {
      const caseName = (meta.caseNumber as string) || "Unknown Case";
      return sendCancellationEmail(to, caseName, {
        date: (meta.eventDate as string) || "Unknown",
        time: (meta.eventTime as string) || "TBD",
        court: (meta.courtName as string) || "Unknown",
        defendant: (meta.defendantName as string) || "Unknown",
      });
    }
  }

  // Default: generic email
  return sendEmail(to, params.title, `<p>${params.message}</p>`);
}

export async function createNotification(params: NotifyParams): Promise<number | null> {
  const pool = getPool();
  if (!pool) return null;

  const client = await pool.connect();
  try {
    // Insert in-app notification
    const result = await client.query(
      `INSERT INTO notifications (user_id, type, title, message, metadata, saved_search_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [params.userId, params.type, params.title, params.message, JSON.stringify(params.metadata || {}), params.savedSearchId || null]
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

    // _skipEmail: scheduler batches emails into one daily summary — skip individual sends
    const skipEmail = !!(params.metadata && params.metadata._skipEmail);

    // Send email if enabled and frequency is immediate (unless batched by scheduler)
    if (prefs.emailEnabled && shouldSendNow && !skipEmail) {
      const sent = await sendTypedEmail(user.email, params);
      if (sent) channelsSent.push("email");
    } else if (prefs.emailEnabled && skipEmail) {
      channelsSent.push("email_batched");
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
  changes: Array<{ field: string; oldValue: string; newValue: string }>,
  savedSearchId?: number,
  extraMetadata?: Record<string, unknown>,
): Promise<void> {
  const summary = changes.map((c) => `${c.field}: ${c.oldValue} → ${c.newValue}`).join("; ");

  await createNotification({
    userId,
    type: "schedule_change",
    title: `Schedule Change: ${caseName}`,
    message: summary,
    metadata: { changes, caseNumber: caseName, ...(extraMetadata || {}) },
    savedSearchId,
  });
}

export async function notifyNewMatch(
  userId: number,
  savedSearchLabel: string,
  events: Array<{ date: string; time: string; court: string; hearingType: string }>,
  savedSearchId?: number,
  searchValue?: string,
): Promise<void> {
  if (events.length === 0) return;
  const count = events.length;
  await createNotification({
    userId,
    type: "new_match",
    title: count === 1
      ? `New match for "${savedSearchLabel}"`
      : `${count} new matches for "${savedSearchLabel}"`,
    message: count === 1
      ? `A new hearing was found matching your saved search.`
      : `${count} new hearings were found matching your saved search.`,
    metadata: { searchValue: searchValue || savedSearchLabel, matchedEvents: events },
    savedSearchId,
  });
}

export async function notifyEventCancelled(
  userId: number,
  courtEventId: number,
  caseNumber: string,
  defendantName: string | null,
  eventDate: string,
  eventTime: string | null,
  courtName: string | null,
  savedSearchId?: number,
): Promise<void> {
  const who = defendantName ? ` (${defendantName})` : "";
  await createNotification({
    userId,
    type: "event_cancelled",
    title: `Hearing removed: ${caseNumber}`,
    message: `The ${eventDate}${eventTime ? " " + eventTime : ""} hearing for ${caseNumber}${who} is no longer on the court calendar.`,
    metadata: {
      courtEventId,
      caseNumber,
      defendantName,
      eventDate,
      eventTime,
      courtName,
    },
    savedSearchId,
  });
}

/**
 * Internal helper — get unread count using an existing client (no extra pool.connect).
 */
async function getUnreadCountInternal(client: { query: (q: string, p: unknown[]) => Promise<{ rows: Array<{ count: string }> }> }, userId: number): Promise<number> {
  const result = await client.query(
    `SELECT COUNT(*) as count FROM notifications n
     WHERE n.user_id = $1 AND n.read = false
       AND (n.saved_search_id IS NULL
            OR EXISTS (SELECT 1 FROM saved_searches ss WHERE ss.id = n.saved_search_id AND ss.is_active = true))`,
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
      `SELECT COUNT(*) as count FROM notifications n
       WHERE n.user_id = $1 AND n.read = false
         AND (n.saved_search_id IS NULL
              OR EXISTS (SELECT 1 FROM saved_searches ss WHERE ss.id = n.saved_search_id AND ss.is_active = true))`,
      [userId]
    );
    return parseInt(result.rows[0].count, 10);
  } finally {
    client.release();
  }
}
