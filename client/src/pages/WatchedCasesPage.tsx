import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";

interface WatchedCaseRow {
  id: number;
  search_type: string;
  search_value: string;
  label: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_refreshed_at: string | null;
  matching_events_count: string;
}

function formatSearchType(type: string): string {
  const labels: Record<string, string> = {
    defendant_name: "Defendant",
    case_number: "Case #",
    court_name: "Court",
    court_date: "Date",
    defendant_otn: "OTN",
    citation_number: "Citation #",
    judge_name: "Judge",
    attorney: "Attorney",
  };
  return labels[type] || type.replace(/_/g, " ");
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" });
}

export default function WatchedCasesPage() {
  const [cases, setCases] = useState<WatchedCaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set());

  async function fetchCases() {
    try {
      const res = await apiFetch("/watched-cases");
      const data = await res.json();
      setCases(data.watchedCases || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchCases(); }, []);

  async function handleDelete(id: number) {
    try {
      const res = await apiFetch(`/watched-cases/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setCases((prev) => prev.filter((c) => c.id !== id));
      setActionMsg("Watched case removed");
      setTimeout(() => setActionMsg(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleSync(id: number) {
    setActionMsg("");
    setSyncingIds((prev) => new Set(prev).add(id));
    try {
      const res = await apiFetch(`/watched-cases/${id}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActionMsg(data.message);
      setTimeout(() => setActionMsg(""), 5000);
      // Refresh the list to get updated last_refreshed_at
      await fetchCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  if (loading) return <div className="text-gray-500">Loading saved searches...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Saved Searches</h1>
          <p className="text-sm text-gray-500 mt-1">
            Each search is automatically refreshed daily to detect schedule changes.
          </p>
        </div>
        <Link to="/search" className="bg-amber-700 text-white px-4 py-2 rounded-md text-sm hover:bg-slate-700">
          New Search
        </Link>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm">{error}</div>}
      {actionMsg && <div className="bg-green-50 text-green-700 p-4 rounded-md text-sm">{actionMsg}</div>}

      {cases.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          <p>No saved searches yet.</p>
          <p className="mt-2"><Link to="/search" className="text-amber-700 hover:underline">Search for court events</Link> to start tracking.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {cases.map((wc) => (
            <div key={wc.id} className="bg-white shadow rounded-lg p-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{wc.label}</h3>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <span className="inline-flex items-center text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                      {formatSearchType(wc.search_type)}: <span className="font-medium ml-1">{wc.search_value}</span>
                    </span>
                    <span className="inline-flex items-center text-xs bg-amber-50 text-amber-800 px-2 py-1 rounded">
                      {wc.matching_events_count} event{wc.matching_events_count !== "1" ? "s" : ""}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                    <span>Created {timeAgo(wc.created_at)}</span>
                    {wc.last_refreshed_at ? (
                      <span>Last updated {timeAgo(wc.last_refreshed_at)}</span>
                    ) : (
                      <span>Not yet refreshed</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => handleSync(wc.id)}
                    disabled={syncingIds.has(wc.id)}
                    className="text-amber-700 hover:text-slate-800 text-sm font-medium disabled:opacity-50"
                  >
                    {syncingIds.has(wc.id) ? "Refreshing..." : "Refresh Now"}
                  </button>
                  <button
                    onClick={() => handleDelete(wc.id)}
                    className="text-red-600 hover:text-red-800 text-sm font-medium"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
