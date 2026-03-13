import { useState, useEffect } from "react";
import { getNotifications, markAsRead, markAllAsRead } from "@/api/notifications";
import { Notification } from "@shared/types";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  async function fetchNotifications() {
    try {
      const data = await getNotifications(50);
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchNotifications(); }, []);

  async function handleMarkRead(id: number) {
    try {
      await markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // silently fail
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // silently fail
    }
  }

  const typeColors: Record<string, string> = {
    schedule_change: "bg-orange-100 text-orange-800",
    new_event: "bg-blue-100 text-blue-800",
    sync_error: "bg-red-100 text-red-800",
    system: "bg-gray-100 text-gray-800",
  };

  if (loading) return <div className="text-gray-500">Loading notifications...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">
          Notifications
          {unreadCount > 0 && <span className="ml-2 text-sm font-normal text-gray-500">({unreadCount} unread)</span>}
        </h1>
        {unreadCount > 0 && (
          <button onClick={handleMarkAllRead}
            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          No notifications yet. You'll be notified when court schedules change.
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`bg-white shadow rounded-lg p-4 ${!n.read ? "border-l-4 border-indigo-500" : ""}`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColors[n.type] || typeColors.system}`}>
                      {n.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="font-medium text-gray-900">{n.title}</div>
                  <div className="text-sm text-gray-600 mt-1">{n.message}</div>
                </div>
                {!n.read && (
                  <button onClick={() => handleMarkRead(n.id)}
                    className="text-indigo-600 hover:text-indigo-800 text-xs font-medium ml-4 whitespace-nowrap">
                    Mark read
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
