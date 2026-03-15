import { useState, useEffect } from "react";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/store/authStore";

type Tab = "overview" | "users";

interface UserRow {
  id: number;
  email: string;
  phone: string | null;
  email_verified: boolean;
  is_admin: boolean;
  created_at: string;
  watched_count: string;
  calendar_count: string;
}

export default function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");

  if (!user?.isAdmin) {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
        <p className="text-gray-500 mt-2">You do not have admin privileges.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>

      <div className="border-b border-gray-200">
        <nav className="flex space-x-4">
          {(["overview", "users"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2 px-3 text-sm font-medium border-b-2 ${
                tab === t
                  ? "border-amber-700 text-amber-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {t === "overview" ? "Overview" : "Users"}
            </button>
          ))}
        </nav>
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "users" && <UsersTab />}
    </div>
  );
}

// ─── Overview Tab ───

function OverviewTab() {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [triggerMsg, setTriggerMsg] = useState("");

  useEffect(() => {
    apiFetch("/admin/stats").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setStats(d); });
  }, []);

  async function triggerRefresh() {
    const res = await apiFetch("/admin/trigger-refresh", { method: "POST" });
    if (res.ok) {
      setTriggerMsg("Watched-case refresh triggered!");
      setTimeout(() => setTriggerMsg(""), 5000);
    }
  }

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Events" value={String((stats.events as Record<string, number>)?.total || 0)} />
          <StatCard label="Courts" value={String((stats.events as Record<string, number>)?.courts || 0)} />
          <StatCard label="Users" value={String(stats.users || 0)} />
          <StatCard label="Watched Cases" value={String(stats.watchedCases || 0)} />
        </div>
      )}

      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Refresh All Watched Cases</h2>
            <p className="text-sm text-gray-500 mt-1">
              Re-runs all active watched case searches against utcourts.gov to check for new events or changes.
              This happens automatically daily at ~2 AM UTC.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {triggerMsg && <span className="text-sm text-green-600">{triggerMsg}</span>}
            <button onClick={triggerRefresh} className="bg-amber-700 text-white px-4 py-2 rounded-md text-sm hover:bg-slate-700">
              Refresh Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white shadow rounded-lg p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{parseInt(value, 10).toLocaleString()}</div>
    </div>
  );
}

// ─── Users Tab ───

function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);

  useEffect(() => {
    apiFetch("/admin/users").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setUsers(d.users); });
  }, []);

  async function toggleAdmin(userId: number, currentValue: boolean) {
    const res = await apiFetch(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ isAdmin: !currentValue }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_admin: !currentValue } : u));
    }
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Verified</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Watched</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Calendars</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.email_verified ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                    {u.email_verified ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_admin ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>
                    {u.is_admin ? "Admin" : "User"}
                  </span>
                </td>
                <td className="px-4 py-3">{u.watched_count}</td>
                <td className="px-4 py-3">{u.calendar_count}</td>
                <td className="px-4 py-3 whitespace-nowrap">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleAdmin(u.id, u.is_admin)}
                    className="text-amber-700 hover:text-slate-800 text-sm font-medium"
                  >
                    {u.is_admin ? "Remove Admin" : "Make Admin"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
