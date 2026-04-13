import { getPool } from "../db/pool";
import { decrypt } from "./encryptionService";
import {
  CalendarEventData, CalendarSyncRow,
} from "@shared/types";
import { createNotification } from "./notificationService";

// Import provider-specific sync functions
import { getGoogleAccessToken, syncGoogleCalendarEvent, GOOGLE_CALENDAR_API } from "./googleCalendarSync";
import { getMicrosoftAccessToken, syncMicrosoftCalendarEvent, MICROSOFT_GRAPH_API } from "./microsoftCalendarSync";
import { syncCaldavCalendarEvent } from "./caldavSync";

// Re-export builder functions for backward compatibility
// (tests and provider re-export files import these from calendarSync)
export { buildGoogleEventBody } from "./googleCalendarSync";
export { buildMicrosoftEventBody } from "./microsoftCalendarSync";
export { buildVCalendar } from "./caldavSync";

/**
 * Mark a calendar connection as inactive and notify the user.
 */
export async function markConnectionInactive(connectionId: number, provider: string, reason: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  const dbClient = await pool.connect();
  try {
    // Mark connection inactive
    await dbClient.query(
      `UPDATE calendar_connections SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [connectionId]
    );

    // Find the user for this connection
    const userResult = await dbClient.query<{ user_id: number }>(
      `SELECT user_id FROM calendar_connections WHERE id = $1`,
      [connectionId]
    );

    if (userResult.rows.length > 0) {
      const userId = userResult.rows[0].user_id;
      await createNotification({
        userId,
        type: "calendar_disconnected",
        title: `${provider.charAt(0).toUpperCase() + provider.slice(1)} Calendar Disconnected`,
        message: `Your ${provider} calendar connection was disconnected: ${reason}. Please reconnect in Calendar Settings.`,
        metadata: { connectionId, provider, reason },
      });
    }
  } finally {
    dbClient.release();
  }
}

/**
 * Convert AM/PM time string (e.g. "9:00 AM", "2:30 PM") to 24h "HH:MM" format.
 * Falls back to returning the input trimmed if pattern doesn't match.
 */
export function parseTimeTo24h(timeStr: string): { hours: number; minutes: number; formatted: string } {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
  if (!match) {
    return { hours: 0, minutes: 0, formatted: "00:00" };
  }
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (match[3]) {
    const ampm = match[3].toUpperCase();
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
  }
  const formatted = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return { hours, minutes, formatted };
}

/**
 * Create or update a calendar event for a user's connected calendar.
 * Only touches events that this app created (tracked in calendar_entries table).
 */
export async function syncCalendarEntry(
  calendarEntryId: number
): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;

  const client = await pool.connect();
  try {
    // Get calendar entry with related data + user calendar preferences
    const entryResult = await client.query(
      `SELECT
        ce.id, ce.external_event_id, ce.external_calendar_id,
        ce.last_synced_content_hash, ce.calendar_connection_id,
        cc.provider, cc.access_token_encrypted, cc.refresh_token_encrypted,
        cc.token_expires_at, cc.calendar_id, cc.caldav_url,
        ev.court_name, ev.court_room, ev.event_date, ev.event_time,
        ev.hearing_type, ev.case_number, ev.case_type, ev.defendant_name,
        ev.judge_name, ev.hearing_location, ev.content_hash,
        u.calendar_preferences
      FROM calendar_entries ce
      JOIN calendar_connections cc ON cc.id = ce.calendar_connection_id
      JOIN court_events ev ON ev.id = ce.court_event_id
      JOIN users u ON u.id = ce.user_id
      WHERE ce.id = $1`,
      [calendarEntryId]
    );

    if (entryResult.rows.length === 0) return false;

    const entry: CalendarSyncRow = entryResult.rows[0];

    // Skip if content hasn't changed
    if (entry.last_synced_content_hash === entry.content_hash && entry.external_event_id) {
      return true;
    }

    const calPrefs = (entry as unknown as Record<string, unknown>).calendar_preferences as { eventTag?: string; eventColorId?: string } | null;
    const tag = calPrefs?.eventTag || "";
    const titlePrefix = tag ? `${tag} ` : "";

    const entryAny = entry as unknown as Record<string, string | null>;
    const judgeName = entryAny.judge_name || null;
    const hearingLocation = entryAny.hearing_location || null;

    const rawDate = entry.event_date as unknown;
    let startDateStr: string;
    if (rawDate instanceof Date) {
      // Use local date components to avoid UTC shift (CLAUDE.md requirement)
      const y = rawDate.getFullYear();
      const m = String(rawDate.getMonth() + 1).padStart(2, "0");
      const d = String(rawDate.getDate()).padStart(2, "0");
      startDateStr = `${y}-${m}-${d}`;
    } else {
      startDateStr = typeof rawDate === "string" ? rawDate.split("T")[0] : String(rawDate);
    }

    const defendantLast = entry.defendant_name
      ? entry.defendant_name.split(",")[0].trim()
      : "Unknown";
    const hearingTypeStr = entry.hearing_type || "Hearing";
    const judgeStr = judgeName ? ` - Judge ${judgeName}` : "";

    const eventData: CalendarEventData = {
      title: `${titlePrefix}${defendantLast} - ${hearingTypeStr}${judgeStr}`,
      description: [
        `Court: ${entry.court_name}`,
        `Room: ${entry.court_room || "TBD"}`,
        judgeName ? `Judge: ${judgeName}` : null,
        hearingLocation ? `Location: ${hearingLocation}` : null,
        `Case: ${entry.case_number || "N/A"}`,
        `Type: ${entry.case_type || "N/A"}`,
        `Hearing: ${entry.hearing_type || "N/A"}`,
        `Defendant: ${entry.defendant_name || "N/A"}`,
        "",
        "Managed by Court Utah",
      ].filter(Boolean).join("\n"),
      startDate: startDateStr,
      startTime: entry.event_time,
      location: `${entry.court_name} ${entry.court_room || ""}`.trim(),
      courtName: entry.court_name,
      caseNumber: entry.case_number,
    };

    let externalEventId: string | null = entry.external_event_id;

    try {
      const colorId = calPrefs?.eventColorId || null;

      switch (entry.provider) {
        case "google":
          externalEventId = await syncGoogleCalendarEvent(entry, eventData, externalEventId, colorId);
          break;
        case "microsoft":
          externalEventId = await syncMicrosoftCalendarEvent(entry, eventData, externalEventId);
          break;
        case "apple":
        case "caldav":
          externalEventId = await syncCaldavCalendarEvent(entry, eventData, externalEventId);
          break;
        default:
          console.warn(`⚠️  Unknown calendar provider: ${entry.provider}`);
          return false;
      }

      // Update calendar entry with sync status
      await client.query(
        `UPDATE calendar_entries
         SET external_event_id = $1, last_synced_content_hash = $2,
             sync_status = 'synced', sync_error = NULL, updated_at = NOW()
         WHERE id = $3`,
        [externalEventId, entry.content_hash, calendarEntryId]
      );

      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await client.query(
        `UPDATE calendar_entries
         SET sync_status = 'error', sync_error = $1, updated_at = NOW()
         WHERE id = $2`,
        [errorMsg, calendarEntryId]
      );
      console.error(`❌ Calendar sync failed for entry ${calendarEntryId}:`, errorMsg);
      return false;
    }
  } finally {
    client.release();
  }
}

/**
 * Delete a calendar entry from the provider and remove the DB row.
 * Only deletes events the app created (tracked in calendar_entries).
 */
export async function deleteCalendarEntry(
  calendarEntryId: number,
  userId: number
): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT ce.id, ce.external_event_id, ce.court_event_id,
              cc.id AS calendar_connection_id, cc.provider,
              cc.access_token_encrypted, cc.refresh_token_encrypted,
              cc.token_expires_at, cc.calendar_id, cc.caldav_url
       FROM calendar_entries ce
       JOIN calendar_connections cc ON cc.id = ce.calendar_connection_id
       WHERE ce.id = $1 AND ce.user_id = $2`,
      [calendarEntryId, userId]
    );

    if (result.rows.length === 0) return false;

    const entry = result.rows[0];

    // Delete from provider if we have an external event ID
    if (entry.external_event_id) {
      try {
        switch (entry.provider) {
          case "google": {
            const accessToken = await getGoogleAccessToken(entry as CalendarSyncRow);
            const calendarId = entry.calendar_id || "primary";
            const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(entry.external_event_id)}`;
            console.log(`🗑️ Deleting Google Calendar event: ${entry.external_event_id} from calendar ${calendarId}`);
            const response = await fetch(url, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!response.ok && response.status !== 404 && response.status !== 410) {
              const body = await response.text();
              console.error(`❌ Google Calendar DELETE failed (${response.status}): ${body}`);
              throw new Error(`Google Calendar DELETE failed: ${response.status}`);
            }
            console.log(`✅ Google Calendar event deleted (${response.status})`);
            break;
          }
          case "microsoft": {
            const msToken = await getMicrosoftAccessToken(entry as CalendarSyncRow);
            const url = `${MICROSOFT_GRAPH_API}/me/events/${encodeURIComponent(entry.external_event_id)}`;
            const response = await fetch(url, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${msToken}` },
            });
            if (!response.ok && response.status !== 404 && response.status !== 410) {
              console.error(`❌ Microsoft Calendar DELETE failed (${response.status})`);
            }
            break;
          }
          case "apple":
          case "caldav": {
            const username = decrypt(entry.access_token_encrypted);
            const password = entry.refresh_token_encrypted
              ? decrypt(entry.refresh_token_encrypted)
              : "";
            const baseUrl = entry.caldav_url || "https://caldav.icloud.com";
            const url = `${baseUrl}/${encodeURIComponent(entry.external_event_id)}.ics`;
            const response = await fetch(url, {
              method: "DELETE",
              headers: {
                Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
              },
            });
            if (!response.ok && response.status !== 404 && response.status !== 410) {
              console.error(`❌ CalDAV DELETE failed (${response.status})`);
            }
            break;
          }
        }
      } catch (err) {
        console.error(`⚠️  Failed to delete event from provider:`, err);
        // Mark as error instead of deleting — event still exists on provider
        await client.query(
          `UPDATE calendar_entries SET sync_status = 'error', sync_error = $1, updated_at = NOW()
           WHERE id = $2 AND user_id = $3`,
          [err instanceof Error ? err.message : String(err), calendarEntryId, userId]
        );
        return false;
      }
    }

    // Soft-delete: mark as 'removed' so auto-sync won't re-create the event.
    // The row is kept so the system remembers the user intentionally removed it.
    await client.query(
      `UPDATE calendar_entries SET sync_status = 'removed', external_event_id = NULL, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [calendarEntryId, userId]
    );

    return true;
  } finally {
    client.release();
  }
}

/**
 * Delete all calendar entries associated with a specific connection from providers and DB.
 * Called before removing a calendar connection to clean up provider-side events.
 */
export async function deleteAllEntriesForConnection(
  connectionId: number,
  userId: number
): Promise<{ deleted: number; errors: number }> {
  const pool = getPool();
  if (!pool) return { deleted: 0, errors: 0 };

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT ce.id
       FROM calendar_entries ce
       WHERE ce.calendar_connection_id = $1 AND ce.user_id = $2`,
      [connectionId, userId]
    );

    let deleted = 0;
    let errors = 0;

    for (const row of result.rows) {
      const success = await deleteCalendarEntry(row.id, userId);
      if (success) deleted++;
      else errors++;
    }

    return { deleted, errors };
  } finally {
    client.release();
  }
}

/**
 * Clean up orphaned calendar entries marked 'pending_delete' by migration 037.
 * These are duplicate entries from the old dedup key that were re-parented but
 * still have events on the user's external calendar (Google/Microsoft/CalDAV).
 * This function deletes them from the provider and marks them as 'removed'.
 * Runs once on server startup.
 */
export async function cleanupOrphanedCalendarEntries(): Promise<{ deleted: number; errors: number }> {
  const pool = getPool();
  if (!pool) return { deleted: 0, errors: 0 };

  const client = await pool.connect();
  try {
    const result = await client.query<{ id: number; user_id: number }>(
      `SELECT id, user_id FROM calendar_entries WHERE sync_status = 'pending_delete'`
    );

    if (result.rows.length === 0) return { deleted: 0, errors: 0 };

    console.log(`🧹 Cleaning up ${result.rows.length} orphaned calendar entries from dedup migration...`);

    let deleted = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        const success = await deleteCalendarEntry(row.id, row.user_id);
        if (success) {
          deleted++;
        } else {
          // deleteCalendarEntry returns false if entry not found — just mark removed
          await client.query(
            `UPDATE calendar_entries SET sync_status = 'removed', external_event_id = NULL, updated_at = NOW() WHERE id = $1`,
            [row.id]
          );
          deleted++;
        }
      } catch (err) {
        console.warn(`⚠️ Failed to clean up orphaned entry ${row.id}:`, err instanceof Error ? err.message : err);
        // Mark as removed anyway — don't leave pending_delete entries forever
        await client.query(
          `UPDATE calendar_entries SET sync_status = 'removed', sync_error = $1, updated_at = NOW() WHERE id = $2`,
          [err instanceof Error ? err.message : String(err), row.id]
        );
        errors++;
      }
    }

    console.log(`🧹 Orphan cleanup complete: ${deleted} deleted, ${errors} errors`);
    return { deleted, errors };
  } finally {
    client.release();
  }
}

/**
 * Sync all pending or outdated calendar entries for a user.
 */
export async function syncAllForUser(userId: number): Promise<{ synced: number; errors: number }> {
  const pool = getPool();
  if (!pool) return { synced: 0, errors: 0 };

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT ce.id
       FROM calendar_entries ce
       JOIN court_events ev ON ev.id = ce.court_event_id
       WHERE ce.user_id = $1
         AND ce.sync_status NOT IN ('removed')
         AND (ce.sync_status IN ('pending', 'error')
              OR ce.last_synced_content_hash IS DISTINCT FROM ev.content_hash)`,
      [userId]
    );

    let synced = 0;
    let errors = 0;

    for (const row of result.rows) {
      const success = await syncCalendarEntry(row.id);
      if (success) synced++;
      else errors++;
    }

    return { synced, errors };
  } finally {
    client.release();
  }
}
