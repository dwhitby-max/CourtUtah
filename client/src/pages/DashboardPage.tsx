import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";
import ChangesFeedSection from "@/components/ChangesFeedSection";

interface PendingUpdate {
  id: number;
  case_number: string;
  defendant_name: string;
  event_date: string;
  court_name: string;
  field_changed: string;
  old_value: string;
  new_value: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ watchedCases: 0, calendarConnections: 0, unreadNotifications: 0 });
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdate[]>([]);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [wcRes, calRes, notRes, pendRes] = await Promise.all([
          apiFetch("/watched-cases"),
          apiFetch("/calendar/connections"),
          apiFetch("/notifications?limit=1"),
          apiFetch("/watched-cases/pending-updates"),
        ]);
        const wcData = await wcRes.json();
        const calData = await calRes.json();
        const notData = await notRes.json();
        const pendData = pendRes.ok ? await pendRes.json() : { pendingUpdates: [] };

        setStats({
          watchedCases: wcData.watchedCases?.length || 0,
          calendarConnections: calData.connections?.length || 0,
          unreadNotifications: notData.unreadCount || 0,
        });
        setPendingUpdates(pendData.pendingUpdates || []);
      } catch {
        // silently fail on dashboard load
      }
    }
    fetchStats();
  }, []);

  async function handleConfirmUpdate(entryId: number) {
    setConfirmingId(entryId);
    try {
      const res = await apiFetch(`/watched-cases/confirm-update/${entryId}`, { method: "POST" });
      if (res.ok) {
        setPendingUpdates(prev => prev.filter(u => u.id !== entryId));
      }
    } catch { /* non-fatal */ }
    setConfirmingId(null);
  }

  async function handleDismissUpdate(entryId: number) {
    try {
      const res = await apiFetch(`/watched-cases/dismiss-update/${entryId}`, { method: "POST" });
      if (res.ok) {
        setPendingUpdates(prev => prev.filter(u => u.id !== entryId));
      }
    } catch { /* non-fatal */ }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Welcome back, {user?.email}</p>
      </div>

      <ChangesFeedSection refreshKey={0} />

      {pendingUpdates.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-yellow-800 mb-3">
            Schedule Changes — Review Required ({pendingUpdates.length})
          </h2>
          <div className="space-y-3">
            {pendingUpdates.map((update) => (
              <div key={update.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-white rounded-md border border-yellow-100">
                <div className="text-sm">
                  <div className="font-medium text-gray-900">
                    {update.case_number || "Unknown"} — {update.defendant_name || "Unknown"}
                  </div>
                  <div className="text-gray-500 text-xs">{update.court_name} · {update.event_date}</div>
                  {update.field_changed && (
                    <div className="text-yellow-700 text-xs mt-1">
                      Changed: <span className="font-medium">{update.field_changed}</span> from "{update.old_value}" to "{update.new_value}"
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleConfirmUpdate(update.id)}
                    disabled={confirmingId === update.id}
                    className="px-3 py-1 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 rounded disabled:opacity-50"
                  >
                    {confirmingId === update.id ? "Updating..." : "Update Calendar"}
                  </button>
                  <button
                    onClick={() => handleDismissUpdate(update.id)}
                    className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link to="/search"
          className="bg-white shadow rounded-lg p-6 hover:shadow-md transition-shadow">
          <div className="text-3xl font-bold text-amber-700">{stats.watchedCases}</div>
          <div className="text-gray-600 mt-1">Saved Searches</div>
        </Link>

        <Link to="/calendar-settings"
          className="bg-white shadow rounded-lg p-6 hover:shadow-md transition-shadow">
          <div className="text-3xl font-bold text-green-600">{stats.calendarConnections}</div>
          <div className="text-gray-600 mt-1">Calendar Connections</div>
        </Link>

        <Link to="/notifications"
          className="bg-white shadow rounded-lg p-6 hover:shadow-md transition-shadow">
          <div className="text-3xl font-bold text-orange-600">{stats.unreadNotifications}</div>
          <div className="text-gray-600 mt-1">Unread Notifications</div>
        </Link>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Getting Started</h2>
        <div className="space-y-3 text-sm text-gray-600">
          <div className="flex items-start space-x-3">
            <span className={`font-bold ${stats.calendarConnections > 0 ? "text-green-600" : "text-gray-400"}`}>1.</span>
            <span><Link to="/calendar-settings" className="text-amber-700 hover:underline">Connect a calendar</Link> (Google, Microsoft, Apple, or CalDAV)</span>
          </div>
          <div className="flex items-start space-x-3">
            <span className="font-bold text-gray-400">2.</span>
            <span><Link to="/search" className="text-amber-700 hover:underline">Search</Link> for a court case by name, case number, OTN, or citation</span>
          </div>
          <div className="flex items-start space-x-3">
            <span className="font-bold text-gray-400">3.</span>
            <span>Enable auto-sync on your <Link to="/search" className="text-amber-700 hover:underline">saved searches</Link> to keep your calendar updated</span>
          </div>
          <div className="flex items-start space-x-3">
            <span className="font-bold text-gray-400">4.</span>
            <span>Get notified automatically when schedules change</span>
          </div>
        </div>
      </div>
    </div>
  );
}
