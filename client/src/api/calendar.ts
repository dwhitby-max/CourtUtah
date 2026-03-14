import { apiFetch } from "./client";

export async function getCalendarConnections(): Promise<{ connections: unknown[] }> {
  const res = await apiFetch("/calendar/connections");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch connections");
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

export async function removeConnection(id: number): Promise<void> {
  const res = await apiFetch(`/calendar/connections/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to remove connection");
  }
}
