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
  matching_events_count: string;
}

export default function WatchedCasesPage() {
  const [cases, setCases] = useState<WatchedCaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMsg, setActionMsg] = useState("");

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleSync(id: number) {
    setActionMsg("");
    try {
      const res = await apiFetch(`/watched-cases/${id}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActionMsg(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    }
  }

  if (loading) return <div className="text-gray-500">Loading watched cases...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Watched Cases</h1>
        <Link to="/search" className="bg-amber-700 text-white px-4 py-2 rounded-md text-sm hover:bg-slate-700">
          Search & Add
        </Link>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm">{error}</div>}
      {actionMsg && <div className="bg-green-50 text-green-700 p-4 rounded-md text-sm">{actionMsg}</div>}

      {cases.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          <p>No watched cases yet.</p>
          <p className="mt-2"><Link to="/search" className="text-amber-700 hover:underline">Search for court events</Link> to start watching.</p>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Label</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Search Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Search Value</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Events</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {cases.map((wc) => (
                  <tr key={wc.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{wc.label}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{wc.search_type.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-sm">{wc.search_value}</td>
                    <td className="px-4 py-3 text-sm">{wc.matching_events_count}</td>
                    <td className="px-4 py-3 text-sm space-x-3">
                      <button onClick={() => handleSync(wc.id)} className="text-amber-700 hover:text-slate-800 font-medium">
                        Sync to Calendar
                      </button>
                      <button onClick={() => handleDelete(wc.id)} className="text-red-600 hover:text-red-800 font-medium">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile card layout */}
          <div className="md:hidden divide-y divide-gray-200">
            {cases.map((wc) => (
              <div key={wc.id} className="p-4 space-y-2">
                <div className="font-medium text-gray-900">{wc.label}</div>
                <div className="text-sm text-gray-500">
                  {wc.search_type.replace(/_/g, " ")}: <span className="text-gray-900">{wc.search_value}</span>
                </div>
                <div className="text-sm text-gray-500">{wc.matching_events_count} matching event{wc.matching_events_count !== "1" ? "s" : ""}</div>
                <div className="flex space-x-4 pt-1">
                  <button onClick={() => handleSync(wc.id)} className="text-amber-700 hover:text-slate-800 text-sm font-medium">
                    Sync to Calendar
                  </button>
                  <button onClick={() => handleDelete(wc.id)} className="text-red-600 hover:text-red-800 text-sm font-medium">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
