import { decrypt } from "./encryptionService";
import { CalendarEventData, CalendarSyncRow } from "@shared/types";
import crypto from "crypto";

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
    const endHours = String((hours + 1) % 24).padStart(2, "0");
    dtStart = `DTSTART;TZID=America/Denver:${dateStr}T${hh}${mm}00`;
    dtEnd = `DTEND;TZID=America/Denver:${dateStr}T${endHours}${mm}00`;
  } else {
    // RFC 5545: all-day DTEND must be the day AFTER the event
    const nextDay = new Date(eventData.startDate.split("T")[0] + "T12:00:00Z"); // noon UTC avoids boundary issues
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const endDateStr = nextDay.toISOString().split("T")[0].replace(/-/g, "");
    dtStart = `DTSTART;VALUE=DATE:${dateStr}`;
    dtEnd = `DTEND;VALUE=DATE:${endDateStr}`;
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
export async function syncCaldavCalendarEvent(
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
