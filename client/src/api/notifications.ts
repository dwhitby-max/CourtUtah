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
