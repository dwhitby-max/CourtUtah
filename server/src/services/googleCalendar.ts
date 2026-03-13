/**
 * Google Calendar service.
 * Implementation consolidated in calendarSync.ts — re-exported here
 * to match the architecture layout in CLAUDE.md.
 */
export { buildGoogleEventBody, syncCalendarEntry, syncAllForUser } from "./calendarSync";
