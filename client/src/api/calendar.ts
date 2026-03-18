import { apiFetch } from "./client";

interface CalendarConnectionRow {
  id: number;
  user_id: number;
  provider: string;
  calendar_id: string | null;
  caldav_url: string | null;
  is_active: boolean;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getCalendarConnections(): Promise<{ connections: CalendarConnectionRow[] }> {
  const res = await apiFetch("/calendar/connections");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch connections");
  return data;
}

export async function startGoogleAuth(): Promise<{ authUrl: string }> {
  const res = await apiFetch("/calendar/google/auth");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to start Google auth");
  return data;
}

export async function startMicrosoftAuth(): Promise<{ authUrl: string }> {
  const res = await apiFetch("/calendar/microsoft/auth");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to start Microsoft auth");
  return data;
}

export async function connectApple(username: string, password: string): Promise<{ message: string }> {
  const res = await apiFetch("/calendar/apple", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to connect Apple");
  return data;
}

export async function connectCaldav(caldavUrl: string, username: string, password: string): Promise<{ message: string }> {
  const res = await apiFetch("/calendar/caldav", {
    method: "POST",
    body: JSON.stringify({ caldavUrl, username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to connect CalDAV");
  return data;
}

export async function addEventToCalendar(courtEventId: number): Promise<{ message: string; calendarEntryId: number; synced: boolean }> {
  const res = await apiFetch("/calendar/events", {
    method: "POST",
    body: JSON.stringify({ courtEventId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to add event to calendar");
  return data;
}

export async function getSyncedEvents(): Promise<Record<number, number>> {
  const res = await apiFetch("/calendar/events/synced");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch synced events");
  return data.synced;
}

export async function addAllEventsToCalendar(courtEventIds: number[]): Promise<{ message: string; results: Array<{ courtEventId: number; calendarEntryId: number; synced: boolean; error?: string }> }> {
  const res = await apiFetch("/calendar/events/batch", {
    method: "POST",
    body: JSON.stringify({ courtEventIds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to add events to calendar");
  return data;
}

export async function removeEventFromCalendar(calendarEntryId: number): Promise<{ message: string }> {
  const res = await apiFetch(`/calendar/events/${calendarEntryId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to remove calendar event");
  return data;
}

export interface WatchedCaseCalendarEntry {
  calendar_entry_id: number;
  sync_status: string;
  synced_at: string;
  court_event_id: number;
  case_number: string | null;
  defendant_name: string | null;
  event_date: string;
  event_time: string | null;
  court_name: string;
  court_room: string | null;
  hearing_type: string | null;
  judge_name: string | null;
  is_virtual: boolean;
}

export async function getCalendarEntriesForCase(watchedCaseId: number): Promise<{ calendarEntries: WatchedCaseCalendarEntry[] }> {
  const res = await apiFetch(`/watched-cases/${watchedCaseId}/calendar-entries`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch calendar entries");
  return data;
}

export async function removeCalendarEntriesForCase(watchedCaseId: number): Promise<{ message: string; removed: number; errors: number }> {
  const res = await apiFetch(`/watched-cases/${watchedCaseId}/calendar-entries`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to remove calendar entries");
  return data;
}

export async function removeAllCalendarEntries(): Promise<{ message: string; removed: number; errors: number }> {
  const res = await apiFetch("/watched-cases/calendar-entries/all", { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to remove calendar entries");
  return data;
}

export async function removeConnection(id: number): Promise<{ message: string; eventsRemoved: number; eventErrors: number }> {
  const res = await apiFetch(`/calendar/connections/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to remove connection");
  return data;
}

export async function removeAllConnections(): Promise<{ message: string; connectionsRemoved: number; eventsRemoved: number; eventErrors: number }> {
  const res = await apiFetch("/calendar/connections", { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to remove connections");
  return data;
}
