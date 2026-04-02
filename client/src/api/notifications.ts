import { apiFetch } from "./client";
import { NotificationListResponse } from "@shared/types";

export async function getNotifications(limit = 50, offset = 0): Promise<NotificationListResponse> {
  const res = await apiFetch(`/notifications?limit=${limit}&offset=${offset}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch notifications");
  return data;
}

export async function markAsRead(id: number): Promise<void> {
  const res = await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to mark notification");
  }
}

export async function markAllAsRead(): Promise<void> {
  const res = await apiFetch("/notifications/read-all", { method: "PATCH" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to mark all notifications");
  }
}

export interface ChangeFeedItem {
  id: number;
  type: "schedule_change" | "new_match" | "event_cancelled";
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function getChangesFeed(): Promise<ChangeFeedItem[]> {
  const res = await apiFetch("/notifications/changes-feed");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch changes");
  return data.changes;
}

export async function markChangesSeen(ids: number[]): Promise<void> {
  const res = await apiFetch("/notifications/mark-seen", {
    method: "PATCH",
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to mark changes as seen");
  }
}
