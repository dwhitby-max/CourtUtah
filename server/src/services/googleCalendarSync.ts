import { decrypt, encrypt } from "./encryptionService";
import {
  CalendarEventData, CalendarSyncRow,
  GoogleTokenResponse, GoogleCalendarEvent,
} from "@shared/types";
import { getPool } from "../db/pool";
import { config } from "../config/env";
import { markConnectionInactive, parseTimeTo24h } from "./calendarSync";

export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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
    const errorDesc = tokens.error_description || tokens.error;
    // On invalid_grant, the refresh token has been revoked — mark connection inactive
    if (tokens.error === "invalid_grant") {
      await markConnectionInactive(connectionId, "google", `Token revoked: ${errorDesc}`);
    }
    throw new Error(`Google token refresh failed: ${errorDesc}`);
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
 * Get a valid Google access token, refreshing if expired.
 */
export async function getGoogleAccessToken(connection: CalendarSyncRow): Promise<string> {
  const tokenExpired = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime() < Date.now() + 60000
    : true;

  if (tokenExpired && connection.refresh_token_encrypted) {
    return refreshGoogleToken(connection.calendar_connection_id, connection.refresh_token_encrypted);
  }

  if (tokenExpired && !connection.refresh_token_encrypted) {
    // No refresh token available — cannot renew. Mark connection inactive.
    await markConnectionInactive(
      connection.calendar_connection_id,
      "google",
      "Token expired and no refresh token available"
    );
    throw new Error("Google token expired and no refresh token available — connection marked inactive");
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
  // Google Calendar end.date is exclusive — must be day after for a 1-day all-day event
  const nextDay = new Date(dateStr + "T00:00:00");
  nextDay.setDate(nextDay.getDate() + 1);
  const endDateStr = nextDay.toISOString().split("T")[0];
  base.start = { date: dateStr };
  base.end = { date: endDateStr };
  return base;
}

/**
 * Google Calendar sync — creates or updates events via Google Calendar API v3.
 */
export async function syncGoogleCalendarEvent(
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
      if (response.status === 401) {
        await markConnectionInactive(connection.calendar_connection_id, "google", "API returned 401 Unauthorized");
      }
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
    if (response.status === 401) {
      await markConnectionInactive(connection.calendar_connection_id, "google", "API returned 401 Unauthorized");
    }
    throw new Error(`Google Calendar POST failed (${response.status}): ${errBody}`);
  }

  const created: GoogleCalendarEvent = await response.json();
  console.log(`✅ Google Calendar event created: ${created.id}`);
  return created.id;
}
