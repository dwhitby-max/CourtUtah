import { useState, useEffect } from "react";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/store/authStore";

type Tab = "overview" | "users" | "courts";

interface CourtInfo {
  name: string;
  type: string;
  locationCode: string;
}

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

interface ScrapeJob {
  id: number;
  status: string;
  courts_processed: number;
  events_found: number;
  events_changed: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
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
          {(["overview", "users", "courts"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2 px-3 text-sm font-medium border-b-2 ${
                tab === t
                  ? "border-amber-700 text-amber-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {t === "overview" ? "Overview" : t === "users" ? "Users" : "Court Whitelist"}
            </button>
          ))}
        </nav>
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "users" && <UsersTab />}
      {tab === "courts" && <CourtsTab />}
    </div>
  );
}

// ─── Overview Tab ───

function OverviewTab() {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [triggerMsg, setTriggerMsg] = useState("");

  useEffect(() => {
    apiFetch("/admin/stats").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setStats(d); });
    apiFetch("/admin/scrape-jobs").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setJobs(d.jobs); });
  }, []);

  async function triggerScrape() {
    const res = await apiFetch("/admin/trigger-scrape", { method: "POST" });
    if (res.ok) {
      setTriggerMsg("Scrape job triggered!");
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Scrape Jobs</h2>
          <div className="flex items-center gap-3">
            {triggerMsg && <span className="text-sm text-green-600">{triggerMsg}</span>}
            <button onClick={triggerScrape} className="bg-amber-700 text-white px-4 py-2 rounded-md text-sm hover:bg-slate-700">
              Trigger Scrape
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Courts</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Events</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Changed</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-3 py-2">{job.id}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      job.status === "completed" ? "bg-green-100 text-green-800" :
                      job.status === "running" ? "bg-blue-100 text-blue-800" :
                      job.status === "failed" ? "bg-red-100 text-red-800" :
                      "bg-gray-100 text-gray-800"
                    }`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">{job.courts_processed}</td>
                  <td className="px-3 py-2">{job.events_found}</td>
                  <td className="px-3 py-2">{job.events_changed}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{job.started_at ? new Date(job.started_at).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{job.completed_at ? new Date(job.completed_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

// ─── Court Whitelist Tab ───

function CourtsTab() {
  const [availableCourts, setAvailableCourts] = useState<CourtInfo[]>([]);
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch("/admin/available-courts").then((r) => r.ok ? r.json() : null),
      apiFetch("/admin/court-whitelist").then((r) => r.ok ? r.json() : null),
    ]).then(([courtsData, wlData]) => {
      if (courtsData) setAvailableCourts(courtsData.courts);
      if (wlData) setWhitelist(wlData.whitelist || []);
      setLoading(false);
    });
  }, []);

  function toggleCourt(locationCode: string) {
    setWhitelist((prev) =>
      prev.includes(locationCode)
        ? prev.filter((c) => c !== locationCode)
        : [...prev, locationCode]
    );
    setSaved(false);
  }

  function selectAll() {
    setWhitelist(availableCourts.map((c) => c.locationCode));
    setSaved(false);
  }

  function selectNone() {
    setWhitelist([]);
    setSaved(false);
  }

  function selectByType(type: string) {
    const codes = availableCourts.filter((c) => c.type === type).map((c) => c.locationCode);
    setWhitelist((prev) => [...new Set([...prev, ...codes])]);
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    const res = await apiFetch("/admin/court-whitelist", {
      method: "PUT",
      body: JSON.stringify({ whitelist }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  }

  const filtered = filter
    ? availableCourts.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()))
    : availableCourts;

  const districtCourts = filtered.filter((c) => c.type === "DistrictCourt");
  const justiceCourts = filtered.filter((c) => c.type === "JusticeCourt");

  if (loading) return <p className="text-gray-500">Loading courts from utcourts.gov...</p>;

  return (
    <div className="space-y-4">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Court Whitelist</h2>
            <p className="text-sm text-gray-500">
              {whitelist.length === 0
                ? "No whitelist set — all courts will be scraped"
                : `${whitelist.length} of ${availableCourts.length} courts selected`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saved && <span className="text-sm text-green-600">Saved!</span>}
            <button onClick={save} disabled={saving}
              className="bg-amber-700 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              {saving ? "Saving..." : "Save Whitelist"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={selectAll} className="text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">Select All</button>
          <button onClick={selectNone} className="text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">Select None</button>
          <button onClick={() => selectByType("DistrictCourt")} className="text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">+ All District</button>
          <button onClick={() => selectByType("JusticeCourt")} className="text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">+ All Justice</button>
        </div>

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter courts..."
          className="w-full max-w-sm border border-gray-300 rounded-md px-3 py-2 text-sm mb-4 focus:ring-amber-500 focus:border-amber-500"
        />

        {districtCourts.length > 0 && (
          <>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">District Courts ({districtCourts.length})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 mb-4">
              {districtCourts.map((court) => (
                <label key={court.locationCode} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={whitelist.includes(court.locationCode)}
                    onChange={() => toggleCourt(court.locationCode)}
                    className="rounded border-gray-300 text-amber-700 focus:ring-amber-500"
                  />
                  <span>{court.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{court.locationCode}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {justiceCourts.length > 0 && (
          <>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Justice Courts ({justiceCourts.length})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
              {justiceCourts.map((court) => (
                <label key={court.locationCode} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={whitelist.includes(court.locationCode)}
                    onChange={() => toggleCourt(court.locationCode)}
                    className="rounded border-gray-300 text-amber-700 focus:ring-amber-500"
                  />
                  <span>{court.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{court.locationCode}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
