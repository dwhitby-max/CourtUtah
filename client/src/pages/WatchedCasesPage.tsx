import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import {
  removeCalendarEntriesForCase,
  removeAllCalendarEntries,
  removeEventFromCalendar,
  getCalendarEntriesForCase,
  WatchedCaseCalendarEntry,
} from "@/api/calendar";

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

function formatDate(dateStr: string): string {
  if (!dateStr) return "N/A";
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${parseInt(m)}/${parseInt(d)}/${y}`;
  }
  return dateStr;
}

const syncStatusLabels: Record<string, { text: string; className: string }> = {
  synced: { text: "Synced", className: "bg-green-100 text-green-800" },
  pending: { text: "Pending", className: "bg-yellow-100 text-yellow-800" },
  pending_update: { text: "Update Pending", className: "bg-blue-100 text-blue-800" },
  error: { text: "Error", className: "bg-red-100 text-red-800" },
};

export default function WatchedCasesPage() {
  const [cases, setCases] = useState<WatchedCaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<number>>(new Set());
  const [removingAll, setRemovingAll] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [entriesMap, setEntriesMap] = useState<Record<number, WatchedCaseCalendarEntry[]>>({});
  const [loadingEntries, setLoadingEntries] = useState<Set<number>>(new Set());
  const [removingEntryIds, setRemovingEntryIds] = useState<Set<number>>(new Set());

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

  async function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    // Fetch entries if not already loaded
    if (!entriesMap[id]) {
      setLoadingEntries((prev) => new Set(prev).add(id));
      try {
        const data = await getCalendarEntriesForCase(id);
        setEntriesMap((prev) => ({ ...prev, [id]: data.calendarEntries }));
      } catch (err) {
        console.error("Failed to fetch entries:", err);
      } finally {
        setLoadingEntries((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await apiFetch(`/watched-cases/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setCases((prev) => prev.filter((c) => c.id !== id));
      setEntriesMap((prev) => { const next = { ...prev }; delete next[id]; return next; });
      if (expandedId === id) setExpandedId(null);
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
      await fetchCases();
      // Refresh expanded entries if this case is expanded
      if (expandedId === id) {
        const entryData = await getCalendarEntriesForCase(id);
        setEntriesMap((prev) => ({ ...prev, [id]: entryData.calendarEntries }));
      }
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

  async function handleRemoveEntries(id: number) {
    if (!confirm("Remove all synced calendar events for this search? This will delete them from your calendar.")) return;
    setActionMsg("");
    setRemovingIds((prev) => new Set(prev).add(id));
    try {
      const result = await removeCalendarEntriesForCase(id);
      setActionMsg(result.message);
      setTimeout(() => setActionMsg(""), 5000);
      setEntriesMap((prev) => ({ ...prev, [id]: [] }));
      await fetchCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove calendar entries");
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleRemoveSingleEntry(watchedCaseId: number, calendarEntryId: number) {
    setRemovingEntryIds((prev) => new Set(prev).add(calendarEntryId));
    try {
      await removeEventFromCalendar(calendarEntryId);
      // Update local state
      setEntriesMap((prev) => ({
        ...prev,
        [watchedCaseId]: (prev[watchedCaseId] || []).filter((e) => e.calendar_entry_id !== calendarEntryId),
      }));
      await fetchCases();
      setActionMsg("Event removed from calendar");
      setTimeout(() => setActionMsg(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove event");
    } finally {
      setRemovingEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(calendarEntryId);
        return next;
      });
    }
  }

  async function handleRemoveAll() {
    if (!confirm("Remove ALL synced calendar events across all searches? This will delete them from your calendar and cannot be undone.")) return;
    setActionMsg("");
    setRemovingAll(true);
    try {
      const result = await removeAllCalendarEntries();
      setActionMsg(result.message);
      setTimeout(() => setActionMsg(""), 5000);
      setEntriesMap({});
      await fetchCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove calendar entries");
    } finally {
      setRemovingAll(false);
    }
  }

  const totalSynced = cases.reduce((sum, c) => sum + parseInt(c.matching_events_count || "0", 10), 0);

  if (loading) return <div className="text-gray-500">Loading saved searches...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Saved Searches</h1>
          <p className="text-sm text-gray-500 mt-1">
            Each search is automatically refreshed daily to detect schedule changes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalSynced > 0 && (
            <button
              onClick={handleRemoveAll}
              disabled={removingAll}
              className="bg-red-600 text-white px-4 py-2 rounded-md text-sm hover:bg-red-700 disabled:opacity-50"
            >
              {removingAll ? "Removing..." : `Remove All (${totalSynced})`}
            </button>
          )}
          <Link to="/search" className="bg-amber-700 text-white px-4 py-2 rounded-md text-sm hover:bg-slate-700">
            New Search
          </Link>
        </div>
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
          {cases.map((wc) => {
            const eventCount = parseInt(wc.matching_events_count || "0", 10);
            const isExpanded = expandedId === wc.id;
            const entries = entriesMap[wc.id] || [];
            const isLoadingEntries = loadingEntries.has(wc.id);

            return (
              <div key={wc.id} className="bg-white shadow rounded-lg overflow-hidden">
                <div className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{wc.label}</h3>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <span className="inline-flex items-center text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                          {formatSearchType(wc.search_type)}: <span className="font-medium ml-1">{wc.search_value}</span>
                        </span>
                        <button
                          onClick={() => toggleExpand(wc.id)}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                            eventCount > 0
                              ? "bg-green-50 text-green-800 hover:bg-green-100"
                              : "bg-gray-50 text-gray-500"
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {eventCount} synced
                          {eventCount > 0 && (
                            <svg
                              className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </button>
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
                      {eventCount > 0 && (
                        <button
                          onClick={() => handleRemoveEntries(wc.id)}
                          disabled={removingIds.has(wc.id)}
                          className="text-orange-600 hover:text-orange-800 text-sm font-medium disabled:opacity-50"
                        >
                          {removingIds.has(wc.id) ? "Removing..." : "Unsync All"}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(wc.id)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded synced events list */}
                {isExpanded && eventCount > 0 && (
                  <div className="border-t border-gray-100">
                    {isLoadingEntries ? (
                      <div className="px-5 py-4 text-sm text-gray-400">Loading synced events...</div>
                    ) : entries.length === 0 ? (
                      <div className="px-5 py-4 text-sm text-gray-400">No synced events found.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Case</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Defendant</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Court</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Hearing</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {entries.map((entry) => {
                              const status = syncStatusLabels[entry.sync_status] || { text: entry.sync_status, className: "bg-gray-100 text-gray-700" };
                              return (
                                <tr key={entry.calendar_entry_id} className="hover:bg-gray-50">
                                  <td className="px-4 py-2.5 text-sm whitespace-nowrap">
                                    {formatDate(entry.event_date)}
                                    {entry.is_virtual && (
                                      <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Virtual</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5 text-sm whitespace-nowrap font-medium">{entry.event_time || "TBD"}</td>
                                  <td className="px-4 py-2.5 text-sm font-medium">{entry.case_number || "N/A"}</td>
                                  <td className="px-4 py-2.5 text-sm">{entry.defendant_name || "N/A"}</td>
                                  <td className="px-4 py-2.5 text-sm">
                                    <div>{entry.court_name}</div>
                                    {entry.court_room && <div className="text-gray-400 text-xs">{entry.court_room}</div>}
                                    {entry.judge_name && <div className="text-gray-400 text-xs">Judge: {entry.judge_name}</div>}
                                  </td>
                                  <td className="px-4 py-2.5 text-sm">{entry.hearing_type || "N/A"}</td>
                                  <td className="px-4 py-2.5 text-sm">
                                    <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${status.className}`}>
                                      {status.text}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-sm">
                                    <button
                                      onClick={() => handleRemoveSingleEntry(wc.id, entry.calendar_entry_id)}
                                      disabled={removingEntryIds.has(entry.calendar_entry_id)}
                                      className="text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                                      title="Remove from calendar"
                                    >
                                      {removingEntryIds.has(entry.calendar_entry_id) ? (
                                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                        </svg>
                                      ) : (
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      )}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
