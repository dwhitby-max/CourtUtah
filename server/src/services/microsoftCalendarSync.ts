import { decrypt, encrypt } from "./encryptionService";
import {
  CalendarEventData, CalendarSyncRow,
  MicrosoftTokenResponse, MicrosoftCalendarEvent,
} from "@shared/types";
import { getPool } from "../db/pool";
import { config } from "../config/env";
import { markConnectionInactive, parseTimeTo24h } from "./calendarSync";

export const MICROSOFT_GRAPH_API = "https://graph.microsoft.com/v1.0";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

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
    const errorDesc = tokens.error_description || tokens.error;
    if (tokens.error === "invalid_grant") {
      await markConnectionInactive(connectionId, "microsoft", `Token revoked: ${errorDesc}`);
    }
    throw new Error(`Microsoft token refresh failed: ${errorDesc}`);
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
export async function getMicrosoftAccessToken(connection: CalendarSyncRow): Promise<string> {
  const tokenExpired = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime() < Date.now() + 60000
    : true;

  if (tokenExpired && connection.refresh_token_encrypted) {
    return refreshMicrosoftToken(connection.calendar_connection_id, connection.refresh_token_encrypted);
  }

  if (tokenExpired && !connection.refresh_token_encrypted) {
    await markConnectionInactive(
      connection.calendar_connection_id,
      "microsoft",
      "Token expired and no refresh token available"
    );
    throw new Error("Microsoft token expired and no refresh token available — connection marked inactive");
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
  // Microsoft Graph requires all-day events to use "date" (YYYY-MM-DD), not "dateTime"
  const nextDay = new Date(dateStr + "T00:00:00");
  nextDay.setDate(nextDay.getDate() + 1);
  const endDateStr = nextDay.toISOString().split("T")[0];
  return {
    subject: eventData.title,
    body: { contentType: "text", content: eventData.description },
    start: { dateTime: dateStr, timeZone: "America/Denver" },
    end: { dateTime: endDateStr, timeZone: "America/Denver" },
    location: { displayName: eventData.location },
    isAllDay: true,
  };
}

/**
 * Microsoft Graph Calendar sync — creates or updates events via Microsoft Graph API.
 */
export async function syncMicrosoftCalendarEvent(
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
      if (response.status === 401) {
        await markConnectionInactive(connection.calendar_connection_id, "microsoft", "API returned 401 Unauthorized");
      }
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
    if (response.status === 401) {
      await markConnectionInactive(connection.calendar_connection_id, "microsoft", "API returned 401 Unauthorized");
    }
    throw new Error(`Microsoft Graph POST failed (${response.status}): ${errBody}`);
  }

  const created: MicrosoftCalendarEvent = await response.json();
  console.log(`✅ Microsoft Calendar event created: ${created.id}`);
  return created.id;
}
