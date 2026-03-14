import { getPool } from "../db/pool";
import { decrypt, encrypt } from "./encryptionService";
import {
  CalendarEventData, CalendarSyncRow,
  GoogleTokenResponse, GoogleCalendarEvent,
  MicrosoftTokenResponse, MicrosoftCalendarEvent,
  CalDAVSyncResult,
} from "../../../shared/types";
import { config } from "../config/env";
import crypto from "crypto";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MICROSOFT_GRAPH_API = "https://graph.microsoft.com/v1.0";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * Convert AM/PM time string (e.g. "9:00 AM", "2:30 PM") to 24h "HH:MM" format.
 * Falls back to returning the input trimmed if pattern doesn't match.
 */
function parseTimeTo24h(timeStr: string): { hours: number; minutes: number; formatted: string } {
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
        ev.content_hash,
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

    const eventData: CalendarEventData = {
      title: `${titlePrefix}Court: ${entry.case_number || "Unknown Case"} - ${entry.hearing_type || "Hearing"}`,
      description: [
        `Court: ${entry.court_name}`,
        `Room: ${entry.court_room || "TBD"}`,
        `Case: ${entry.case_number || "N/A"}`,
        `Type: ${entry.case_type || "N/A"}`,
        `Hearing: ${entry.hearing_type || "N/A"}`,
        `Defendant: ${entry.defendant_name || "N/A"}`,
        "",
        "Managed by Utah Court Calendar Tracker",
      ].join("\n"),
      startDate: entry.event_date,
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
 * Refresh a Google access token using the stored refresh token.
 * Updates the encrypted token and expiry in calendar_connections.
 */
async function refreshGoogleToken(
  connectionId: number,
  refreshTokenEncrypted: string
): Promise<string> {
  const refreshToken = decrypt(refreshTokenEncrypted);

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokens: GoogleTokenResponse = await response.json();

  if (tokens.error) {
    throw new Error(`Google token refresh failed: ${tokens.error_description || tokens.error}`);
  }

  const pool = getPool();
  if (pool) {
    const dbClient = await pool.connect();
    try {
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      await dbClient.query(
        `UPDATE calendar_connections
         SET access_token_encrypted = $1, token_expires_at = $2, updated_at = NOW()
         WHERE id = $3`,
        [encrypt(tokens.access_token), expiresAt, connectionId]
      );
    } finally {
      dbClient.release();
    }
  }

  return tokens.access_token;
}

/**
 * Get a valid Google access token, refreshing if expired.
 */
async function getGoogleAccessToken(connection: CalendarSyncRow): Promise<string> {
  const tokenExpired = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime() < Date.now() + 60000
    : true;

  if (tokenExpired && connection.refresh_token_encrypted) {
    return refreshGoogleToken(connection.calendar_connection_id, connection.refresh_token_encrypted);
  }

  return decrypt(connection.access_token_encrypted);
}

/**
 * Build the Google Calendar event body from our CalendarEventData.
 */
export function buildGoogleEventBody(eventData: CalendarEventData, colorId?: string | null): Record<string, unknown> {
  const hasTime = eventData.startTime !== null && eventData.startTime !== "";

  const base: Record<string, unknown> = {
    summary: eventData.title,
    description: eventData.description,
    location: eventData.location,
  };

  // Google Calendar colorId: "1"-"11" maps to predefined colors
  if (colorId) {
    base.colorId = colorId;
  }

  if (hasTime) {
    const dateStr = eventData.startDate.split("T")[0];
    const { hours, minutes, formatted } = parseTimeTo24h(eventData.startTime!);
    const startDateTime = `${dateStr}T${formatted}:00`;

    const endHours = hours + 1;
    const endFormatted = `${String(endHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    const endDateTime = `${dateStr}T${endFormatted}:00`;

    base.start = { dateTime: startDateTime, timeZone: "America/Denver" };
    base.end = { dateTime: endDateTime, timeZone: "America/Denver" };
    return base;
  }

  const dateStr = eventData.startDate.split("T")[0];
  base.start = { date: dateStr };
  base.end = { date: dateStr };
  return base;
}

/**
 * Google Calendar sync — creates or updates events via Google Calendar API v3.
 */
async function syncGoogleCalendarEvent(
  connection: CalendarSyncRow,
  eventData: CalendarEventData,
  existingEventId: string | null,
  colorId?: string | null
): Promise<string> {
  if (!config.google.clientId || !config.google.clientSecret) {
    throw new Error("Google Calendar not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  }

  const accessToken = await getGoogleAccessToken(connection);
  const calendarId = connection.calendar_id || "primary";
  const eventBody = buildGoogleEventBody(eventData, colorId);

  if (existingEventId) {
    // PATCH existing event
    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existingEventId)}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Google Calendar PATCH failed (${response.status}): ${errBody}`);
    }

    const updated: GoogleCalendarEvent = await response.json();
    console.log(`✅ Google Calendar event updated: ${updated.id}`);
    return updated.id;
  }

  // POST new event
  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(eventBody),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Google Calendar POST failed (${response.status}): ${errBody}`);
  }

  const created: GoogleCalendarEvent = await response.json();
  console.log(`✅ Google Calendar event created: ${created.id}`);
  return created.id;
}

/**
 * Refresh a Microsoft access token using the stored refresh token.
 * Updates the encrypted token and expiry in calendar_connections.
 */
async function refreshMicrosoftToken(
  connectionId: number,
  refreshTokenEncrypted: string
): Promise<string> {
  const refreshToken = decrypt(refreshTokenEncrypted);

  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.microsoft.clientId,
      client_secret: config.microsoft.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "Calendars.ReadWrite offline_access",
    }),
  });

  const tokens: MicrosoftTokenResponse = await response.json();

  if (tokens.error) {
    throw new Error(`Microsoft token refresh failed: ${tokens.error_description || tokens.error}`);
  }

  const pool = getPool();
  if (pool) {
    const dbClient = await pool.connect();
    try {
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      await dbClient.query(
        `UPDATE calendar_connections
         SET access_token_encrypted = $1,
             refresh_token_encrypted = COALESCE($2, refresh_token_encrypted),
             token_expires_at = $3, updated_at = NOW()
         WHERE id = $4`,
        [
          encrypt(tokens.access_token),
          tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          expiresAt,
          connectionId,
        ]
      );
    } finally {
      dbClient.release();
    }
  }

  return tokens.access_token;
}

/**
 * Get a valid Microsoft access token, refreshing if expired.
 */
async function getMicrosoftAccessToken(connection: CalendarSyncRow): Promise<string> {
  const tokenExpired = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime() < Date.now() + 60000
    : true;

  if (tokenExpired && connection.refresh_token_encrypted) {
    return refreshMicrosoftToken(connection.calendar_connection_id, connection.refresh_token_encrypted);
  }

  return decrypt(connection.access_token_encrypted);
}

/**
 * Build the Microsoft Graph event body from our CalendarEventData.
 */
export function buildMicrosoftEventBody(eventData: CalendarEventData): Record<string, unknown> {
  const hasTime = eventData.startTime !== null && eventData.startTime !== "";

  if (hasTime) {
    const dateStr = eventData.startDate.split("T")[0];
    const { hours, minutes, formatted } = parseTimeTo24h(eventData.startTime!);
    const startDateTime = `${dateStr}T${formatted}:00`;

    const endHours = hours + 1;
    const endFormatted = `${String(endHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    const endDateTime = `${dateStr}T${endFormatted}:00`;

    return {
      subject: eventData.title,
      body: { contentType: "text", content: eventData.description },
      start: { dateTime: startDateTime, timeZone: "America/Denver" },
      end: { dateTime: endDateTime, timeZone: "America/Denver" },
      location: { displayName: eventData.location },
      isAllDay: false,
    };
  }

  const dateStr = eventData.startDate.split("T")[0];
  return {
    subject: eventData.title,
    body: { contentType: "text", content: eventData.description },
    start: { dateTime: `${dateStr}T00:00:00`, timeZone: "America/Denver" },
    end: { dateTime: `${dateStr}T23:59:59`, timeZone: "America/Denver" },
    location: { displayName: eventData.location },
    isAllDay: true,
  };
}

/**
 * Microsoft Graph Calendar sync — creates or updates events via Microsoft Graph API.
 */
async function syncMicrosoftCalendarEvent(
  connection: CalendarSyncRow,
  eventData: CalendarEventData,
  existingEventId: string | null
): Promise<string> {
  if (!config.microsoft.clientId || !config.microsoft.clientSecret) {
    throw new Error("Microsoft Calendar not configured — add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET");
  }

  const accessToken = await getMicrosoftAccessToken(connection);
  const eventBody = buildMicrosoftEventBody(eventData);

  if (existingEventId) {
    // PATCH existing event
    const url = `${MICROSOFT_GRAPH_API}/me/events/${encodeURIComponent(existingEventId)}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Microsoft Graph PATCH failed (${response.status}): ${errBody}`);
    }

    const updated: MicrosoftCalendarEvent = await response.json();
    console.log(`✅ Microsoft Calendar event updated: ${updated.id}`);
    return updated.id;
  }

  // POST new event
  const url = `${MICROSOFT_GRAPH_API}/me/events`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(eventBody),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Microsoft Graph POST failed (${response.status}): ${errBody}`);
  }

  const created: MicrosoftCalendarEvent = await response.json();
  console.log(`✅ Microsoft Calendar event created: ${created.id}`);
  return created.id;
}

/**
 * Generate an ICS VCALENDAR string for a court event.
 */
export function buildVCalendar(uid: string, eventData: CalendarEventData): string {
  const hasTime = eventData.startTime !== null && eventData.startTime !== "";
  const dateStr = eventData.startDate.split("T")[0].replace(/-/g, "");
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  let dtStart: string;
  let dtEnd: string;

  if (hasTime) {
    const timeParts = eventData.startTime!.match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
    let hours = 0;
    let minutes = 0;
    if (timeParts) {
      hours = parseInt(timeParts[1], 10);
      minutes = parseInt(timeParts[2], 10);
      if (timeParts[3]) {
        const ampm = timeParts[3].toUpperCase();
        if (ampm === "PM" && hours < 12) hours += 12;
        if (ampm === "AM" && hours === 12) hours = 0;
      }
    }
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const endHours = String(hours + 1).padStart(2, "0");
    dtStart = `DTSTART;TZID=America/Denver:${dateStr}T${hh}${mm}00`;
    dtEnd = `DTEND;TZID=America/Denver:${dateStr}T${endHours}${mm}00`;
  } else {
    dtStart = `DTSTART;VALUE=DATE:${dateStr}`;
    dtEnd = `DTEND;VALUE=DATE:${dateStr}`;
  }

  // Escape special ICS chars in text fields
  const escIcs = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UtahCourtTracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    dtStart,
    dtEnd,
    `SUMMARY:${escIcs(eventData.title)}`,
    `DESCRIPTION:${escIcs(eventData.description)}`,
    `LOCATION:${escIcs(eventData.location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * CalDAV sync (Apple iCloud / generic CalDAV) — PUT VCALENDAR events.
 *
 * For CalDAV, access_token_encrypted = username, refresh_token_encrypted = password.
 * The caldav_url points to the calendar collection.
 */
async function syncCaldavCalendarEvent(
  connection: CalendarSyncRow,
  eventData: CalendarEventData,
  existingEventId: string | null
): Promise<string> {
  const username = decrypt(connection.access_token_encrypted);
  const password = connection.refresh_token_encrypted
    ? decrypt(connection.refresh_token_encrypted)
    : "";

  const caldavBaseUrl = connection.caldav_url || "https://caldav.icloud.com";

  // Use existing UID or generate a new one
  const uid = existingEventId || `court-${crypto.randomUUID()}@courttracker.app`;
  const icsBody = buildVCalendar(uid, eventData);

  // CalDAV event URL: base collection + UID.ics
  const eventUrl = `${caldavBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(uid)}.ics`;

  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  const response = await fetch(eventUrl, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": "text/calendar; charset=utf-8",
      "If-None-Match": existingEventId ? "" : "*",
    },
    body: icsBody,
  });

  // CalDAV returns 201 Created or 204 No Content on success
  if (!response.ok && response.status !== 201 && response.status !== 204) {
    const errBody = await response.text();
    throw new Error(`CalDAV PUT failed (${response.status}): ${errBody}`);
  }

  console.log(`✅ CalDAV event ${existingEventId ? "updated" : "created"}: ${uid}`);
  return uid;
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
         AND (ce.sync_status = 'pending'
              OR ce.last_synced_content_hash != ev.content_hash)`,
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
