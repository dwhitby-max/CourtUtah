import { useState, useEffect } from "react";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/store/authStore";

type Tab = "overview" | "pending" | "users";

interface UserRow {
  id: number;
  email: string;
  phone: string | null;
  email_verified: boolean;
  is_admin: boolean;
  is_approved: boolean;
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
          {(["overview", "pending", "users"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2 px-3 text-sm font-medium border-b-2 ${
                tab === t
                  ? "border-amber-700 text-amber-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {t === "overview" ? "Overview" : t === "pending" ? "Pending Approval" : "Users"}
            </button>
          ))}
        </nav>
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "pending" && <PendingTab />}
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

// ─── Pending Approval Tab ───

function PendingTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/admin/users")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) setUsers(d.users.filter((u: UserRow) => !u.is_approved));
        setLoading(false);
      });
  }, []);

  async function approveUser(userId: number) {
    const res = await apiFetch(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ isApproved: true }),
    });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    }
  }

  async function rejectUser(userId: number) {
    if (!confirm("Reject this user? They will remain unable to access the app.")) return;
    // Keep is_approved = false — no action needed, just confirmation
  }

  if (loading) {
    return <p className="text-gray-500 text-sm py-4">Loading...</p>;
  }

  if (users.length === 0) {
    return (
      <div className="bg-white shadow rounded-lg p-8 text-center">
        <p className="text-gray-500">No users pending approval.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {users.map((u) => (
        <div key={u.id} className="bg-white shadow rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">{u.email}</p>
            <p className="text-xs text-gray-500">Signed up {new Date(u.created_at).toLocaleString()}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => approveUser(u.id)}
              className="bg-green-600 text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-green-700"
            >
              Approve
            </button>
            <button
              onClick={() => rejectUser(u.id)}
              className="bg-red-50 text-red-700 border border-red-200 px-4 py-1.5 rounded-md text-sm font-medium hover:bg-red-100"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
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

  async function toggleApproval(userId: number, currentValue: boolean) {
    const res = await apiFetch(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ isApproved: !currentValue }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_approved: !currentValue } : u));
    }
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Watched</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Calendars</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map((u) => (
              <tr key={u.id} className={!u.is_approved ? "bg-amber-50" : ""}>
                <td className="px-4 py-3 font-medium">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_approved ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                    {u.is_approved ? "Approved" : "Pending"}
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
                <td className="px-4 py-3 space-x-2">
                  <button
                    onClick={() => toggleApproval(u.id, u.is_approved)}
                    className={`text-sm font-medium ${u.is_approved ? "text-red-600 hover:text-red-800" : "text-green-600 hover:text-green-800"}`}
                  >
                    {u.is_approved ? "Revoke" : "Approve"}
                  </button>
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
