import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/api/client";

interface ScrapeJob {
  id: number;
  status: string;
  courts_processed: number;
  events_found: number;
  events_changed: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxConnections: number;
  utilizationPct: number;
  collectedAt: string;
}

interface AdminStats {
  events: { total: number; courts: number };
  users: number;
  watchedCases: number;
  calendarConnections: number;
}

export default function AdminPage() {
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [poolStats, setPoolStats] = useState<PoolStats | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState("");
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [jobsRes, poolRes, statsRes] = await Promise.all([
        apiFetch("/admin/scrape-jobs"),
        apiFetch("/admin/pool-stats"),
        apiFetch("/admin/stats"),
      ]);

      if (jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data.jobs || []);
      }
      if (poolRes.ok) {
        const data = await poolRes.json();
        setPoolStats(data.pool);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Refresh pool stats every 30s
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function handleTriggerScrape() {
    setTriggering(true);
    setTriggerMsg("");
    setError("");

    try {
      const res = await apiFetch("/admin/trigger-scrape", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTriggerMsg("Scrape job triggered — check back in a few minutes for results.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger scrape");
    } finally {
      setTriggering(false);
    }
  }

  function formatDuration(started: string | null, completed: string | null): string {
    if (!started) return "—";
    const start = new Date(started).getTime();
    const end = completed ? new Date(completed).getTime() : Date.now();
    const secs = Math.round((end - start) / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    return `${mins}m ${secs % 60}s`;
  }

  function statusBadge(status: string) {
    const styles: Record<string, string> = {
      completed: "bg-green-100 text-green-700",
      running: "bg-blue-100 text-blue-700",
      failed: "bg-red-100 text-red-700",
      pending: "bg-gray-100 text-gray-700",
    };
    return (
      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] || styles.pending}`}>
        {status}
      </span>
    );
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading admin dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm">{error}</div>}
      {triggerMsg && <div className="bg-green-50 text-green-700 p-4 rounded-md text-sm">{triggerMsg}</div>}

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-sm text-gray-500">Court Events</div>
            <div className="text-2xl font-bold text-gray-900">{stats.events.total.toLocaleString()}</div>
            <div className="text-xs text-gray-400">{stats.events.courts} courts</div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-sm text-gray-500">Users</div>
            <div className="text-2xl font-bold text-gray-900">{stats.users}</div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-sm text-gray-500">Watched Cases</div>
            <div className="text-2xl font-bold text-gray-900">{stats.watchedCases}</div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-sm text-gray-500">Calendar Links</div>
            <div className="text-2xl font-bold text-gray-900">{stats.calendarConnections}</div>
          </div>
        </div>
      )}

      {/* Pool stats */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Connection Pool</h2>
        {poolStats ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <span className="text-gray-500 block">Total</span>
              <span className="font-semibold text-lg">{poolStats.totalCount}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Idle</span>
              <span className="font-semibold text-lg">{poolStats.idleCount}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Waiting</span>
              <span className={`font-semibold text-lg ${poolStats.waitingCount > 0 ? "text-red-600" : ""}`}>
                {poolStats.waitingCount}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block">Max</span>
              <span className="font-semibold text-lg">{poolStats.maxConnections}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Utilization</span>
              <span className={`font-semibold text-lg ${poolStats.utilizationPct >= 80 ? "text-amber-600" : ""}`}>
                {poolStats.utilizationPct}%
              </span>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">Pool not initialized</p>
        )}
      </div>

      {/* Scrape jobs */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Scrape Jobs</h2>
          <button
            onClick={handleTriggerScrape}
            disabled={triggering}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {triggering ? "Triggering..." : "Trigger Scrape"}
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="p-6 text-gray-500 text-center text-sm">
            No scrape jobs recorded yet. Trigger one above or wait for the daily schedule (2 AM UTC).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Courts</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Events</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Changes</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">#{job.id}</td>
                    <td className="px-4 py-3 text-sm">{statusBadge(job.status)}</td>
                    <td className="px-4 py-3 text-sm">{job.courts_processed}</td>
                    <td className="px-4 py-3 text-sm">{job.events_found}</td>
                    <td className="px-4 py-3 text-sm">
                      {job.events_changed > 0 ? (
                        <span className="text-amber-600 font-medium">{job.events_changed}</span>
                      ) : (
                        job.events_changed
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDuration(job.started_at, job.completed_at)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {job.started_at ? new Date(job.started_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
