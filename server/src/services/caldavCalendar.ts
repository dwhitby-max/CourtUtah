/**
 * Generic CalDAV calendar service.
 * Implementation consolidated in calendarSync.ts — re-exported here
 * to match the architecture layout in CLAUDE.md.
 */
export { buildVCalendar, syncCalendarEntry, syncAllForUser } from "./calendarSync";
