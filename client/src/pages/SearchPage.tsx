import { useState, useEffect, useMemo } from "react";
import SearchForm from "@/components/SearchForm";
import { searchCourtEvents } from "@/api/search";
import { addEventToCalendar, getCalendarConnections, getSyncedEvents, removeEventFromCalendar } from "@/api/calendar";
import { apiFetch } from "@/api/client";
import NewEntriesSection from "@/components/NewEntriesSection";
import { CourtEvent } from "@shared/types";

interface SavedSearchRow {
  id: number;
  search_params: Record<string, string>;
  label: string;
  results_count: number;
  last_run_at: string;
  created_at: string;
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

const providerLabels: Record<string, string> = {
  google: "Google Calendar",
  microsoft: "Outlook",
  apple: "iCloud",
  caldav: "CalDAV",
};

/** Convert camelCase search params to snake_case query params */
function toQueryParams(params: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {
    defendantName: "defendant_name",
    caseNumber: "case_number",
    courtName: "court_name",
    courtDate: "court_date",
    dateFrom: "date_from",
    dateTo: "date_to",
    defendantOtn: "defendant_otn",
    citationNumber: "citation_number",
    charges: "charges",
    judgeName: "judge_name",
    attorney: "attorney",
  };
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(params)) {
    if (val && key !== "_key") {
      const snakeKey = map[key] || key;
      result[snakeKey] = val;
    }
  }
  return result;
}

export default function SearchPage() {
  const [results, setResults] = useState<CourtEvent[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [watchSuccess, setWatchSuccess] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearchRow[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [calSyncingIds, setCalSyncingIds] = useState<Set<number>>(new Set());
  const [calSyncedIds, setCalSyncedIds] = useState<Set<number>>(new Set());
  const [calEntryMap, setCalEntryMap] = useState<Record<number, number>>({});
  const [calRemovingIds, setCalRemovingIds] = useState<Set<number>>(new Set());
  const [lastSearchParams, setLastSearchParams] = useState<Record<string, string> | null>(null);
  const [lastSearchSavedId, setLastSearchSavedId] = useState<number | null>(null);
  const [calendarProvider, setCalendarProvider] = useState<string | null>(null);
  const [hasCalendarConnection, setHasCalendarConnection] = useState(true);
  const [addingAll, setAddingAll] = useState(false);
  const [addedAll, setAddedAll] = useState(false);
  const [previousRunAt, setPreviousRunAt] = useState<string | null>(null);

  // Load saved searches and calendar provider on mount
  useEffect(() => {
    fetchSavedSearches();
    fetchCalendarProvider();
  }, []);

  async function fetchCalendarProvider() {
    try {
      const data = await getCalendarConnections();
      const active = (data.connections as Array<{ provider: string; is_active: boolean }>)
        .find(c => c.is_active);
      setCalendarProvider(active?.provider ?? null);
      setHasCalendarConnection(!!active);
    } catch {
      setHasCalendarConnection(false);
    }
    try {
      const synced = await getSyncedEvents();
      setCalEntryMap(synced);
      setCalSyncedIds(new Set(Object.keys(synced).map(Number)));
    } catch {
      // non-fatal
    }
  }

  function connectGoogleCalendar() {
    // Redirect through Google auth flow which creates both account link + calendar connection
    window.location.href = "/api/auth/google";
  }

  async function fetchSavedSearches() {
    setLoadingSaved(true);
    try {
      const res = await apiFetch("/saved-searches");
      if (res.ok) {
        const data = await res.json();
        setSavedSearches(data.savedSearches || []);
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingSaved(false);
    }
  }

  async function handleSearch(params: Record<string, string>) {
    setError("");
    setLoading(true);
    setSearched(true);
    setWatchSuccess("");
    setExpandedId(null);

    try {
      const data = await searchCourtEvents(params);
      setResults(data.results);
      setLastSearchParams(params);
      setLastSearchSavedId(data.savedSearchId ?? null);
      setPreviousRunAt(data.previousRunAt ?? null);
      setCalSyncingIds(new Set());
      setAddedAll(false);
      // Refresh saved searches list after search (it may have been auto-saved)
      fetchSavedSearches();
      // Re-fetch synced events so previously-synced results show the remove button
      try {
        const synced = await getSyncedEvents();
        setCalEntryMap(synced);
        setCalSyncedIds(new Set(Object.keys(synced).map(Number)));
      } catch {
        setCalSyncedIds(new Set());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Search failed";
      setError(msg);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRunSavedSearch(saved: SavedSearchRow) {
    const queryParams = toQueryParams(saved.search_params);
    await handleSearch(queryParams);
  }

  async function handleDeleteSavedSearch(id: number) {
    try {
      const res = await apiFetch(`/saved-searches/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSavedSearches(prev => prev.filter(s => s.id !== id));
      }
    } catch {
      // non-fatal
    }
  }

  async function handleWatch(event: CourtEvent) {
    const searchType = event.caseNumber ? "case_number" : "defendant_name";
    const searchValue = event.caseNumber || event.defendantName || "Unknown";
    const label = `${event.caseNumber || "Unknown Case"} - ${event.defendantName || "Unknown"} (${event.courtName})`;

    try {
      const res = await apiFetch("/watched-cases", {
        method: "POST",
        body: JSON.stringify({ searchType, searchValue, label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWatchSuccess(`Added "${label}" to watched cases`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add watched case");
    }
  }

  async function handleAddToCalendar(event: CourtEvent) {
    setCalSyncingIds((prev) => new Set(prev).add(event.id));
    try {
      const data = await addEventToCalendar(event.id);
      setCalSyncedIds((prev) => new Set(prev).add(event.id));
      setCalEntryMap((prev) => ({ ...prev, [event.id]: data.calendarEntryId }));
      setWatchSuccess(data.message);
      setError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add to calendar";
      setError(msg);
    } finally {
      setCalSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
    }
  }

  async function handleRemoveFromCalendar(event: CourtEvent) {
    const entryId = calEntryMap[event.id];
    if (!entryId) return;

    setCalRemovingIds((prev) => new Set(prev).add(event.id));
    try {
      await removeEventFromCalendar(entryId);
      setCalSyncedIds((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
      setCalEntryMap((prev) => {
        const next = { ...prev };
        delete next[event.id];
        return next;
      });
      setWatchSuccess("Event removed from calendar");
      setError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove from calendar";
      setError(msg);
    } finally {
      setCalRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
    }
  }

  async function handleAddAllToCalendar() {
    if (results.length === 0) return;
    setAddingAll(true);
    setError("");
    let added = 0;
    let failed = 0;
    for (const event of results) {
      if (calSyncedIds.has(event.id)) continue;
      try {
        await addEventToCalendar(event.id);
        setCalSyncedIds((prev) => new Set(prev).add(event.id));
        added++;
      } catch {
        failed++;
      }
    }
    setAddingAll(false);
    setAddedAll(true);
    if (failed > 0) {
      setWatchSuccess(`Added ${added} event${added !== 1 ? "s" : ""} to ${calLabel}. ${failed} failed.`);
    } else {
      setWatchSuccess(`Added all ${added} event${added !== 1 ? "s" : ""} to ${calLabel}`);
    }
  }

  function toggleExpand(id: number) {
    setExpandedId(expandedId === id ? null : id);
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

  function hasDetails(event: CourtEvent): boolean {
    return !!(
      event.prosecutingAttorney ||
      event.defenseAttorney ||
      event.defendantOtn ||
      event.defendantDob ||
      event.citationNumber ||
      event.sheriffNumber ||
      event.leaNumber ||
      (event.charges && event.charges.length > 0)
    );
  }

  const calLabel = calendarProvider ? providerLabels[calendarProvider] || "Calendar" : "Calendar";

  const { newResults, existingResults } = useMemo(() => {
    if (!previousRunAt) return { newResults: [], existingResults: results };
    const newOnes = results.filter(e => e.isNew);
    const existing = results.filter(e => !e.isNew);
    return { newResults: newOnes, existingResults: existing };
  }, [results, previousRunAt]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Search Court Calendars</h1>

      <SearchForm onSearch={handleSearch} loading={loading} />

      {/* Saved Searches */}
      {savedSearches.length > 0 && (
        <div className="bg-white shadow rounded-lg p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Your Saved Searches</h2>
          <div className="space-y-3">
            {savedSearches.map((saved) => (
              <div key={saved.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gray-50 rounded-md">
                <button
                  className="flex-1 min-w-0 text-left hover:bg-gray-100 rounded p-1 -m-1 transition-colors"
                  onClick={() => handleRunSavedSearch(saved)}
                  disabled={loading}
                >
                  <div className="font-medium text-gray-900 truncate">{saved.label}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mt-1">
                    <span>{saved.results_count} result{saved.results_count !== 1 ? "s" : ""}</span>
                    <span>Last run {timeAgo(saved.last_run_at)}</span>
                  </div>
                </button>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => handleRunSavedSearch(saved)}
                    disabled={loading}
                    className="text-amber-700 hover:text-slate-800 text-sm font-medium disabled:opacity-50"
                  >
                    Run Again
                  </button>
                  <button
                    onClick={() => handleDeleteSavedSearch(saved.id)}
                    className="text-red-600 hover:text-red-800 text-sm font-medium"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm">{error}</div>}
      {watchSuccess && <div className="bg-green-50 text-green-700 p-4 rounded-md text-sm">{watchSuccess}</div>}

      {searched && !loading && newResults.length > 0 && (
        <NewEntriesSection
          events={newResults}
          formatDate={formatDate}
          onAddToCalendar={hasCalendarConnection ? handleAddToCalendar : undefined}
          calSyncedIds={calSyncedIds}
          calSyncingIds={calSyncingIds}
          calLabel={calLabel}
        />
      )}

      {searched && !loading && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {existingResults.length > 0 && newResults.length > 0
                ? `${existingResults.length} Previous Result${existingResults.length !== 1 ? "s" : ""}`
                : `${results.length} Result${results.length !== 1 ? "s" : ""} Found`}
            </h2>
            <div className="flex items-center gap-3">
              {results.length > 0 && !hasCalendarConnection && (
                <button
                  onClick={connectGoogleCalendar}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                >
                  Connect Google Calendar
                </button>
              )}
              {results.length > 0 && hasCalendarConnection && (
                <button
                  onClick={handleAddAllToCalendar}
                  disabled={addingAll || addedAll}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-amber-700 hover:bg-amber-800 rounded-md disabled:opacity-50"
                >
                  {addingAll
                    ? `Adding ${results.length} to ${calLabel}...`
                    : addedAll
                      ? `All added to ${calLabel}`
                      : `Add all ${results.length} to ${calLabel}`}
                </button>
              )}
              {lastSearchSavedId && (
                <span className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 rounded-md">
                  Search saved
                </span>
              )}
            </div>
          </div>

          {results.length === 0 ? (
            <div className="p-6 text-gray-500 text-center">
              No court events match your search criteria. Try broadening your search.
            </div>
          ) : (existingResults.length > 0 || newResults.length === 0) && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Case</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Defendant</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Court</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hearing</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(newResults.length > 0 ? existingResults : results).map((event) => (
                    <>
                      <tr key={event.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                          <div>{formatDate(event.eventDate)}</div>
                          {event.isVirtual && (
                            <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              Virtual
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap font-medium">
                          {event.eventTime || "TBD"}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="font-medium">{event.caseNumber || "N/A"}</div>
                          <div className="text-gray-500 text-xs">{event.caseType || ""}</div>
                          {event.charges && event.charges.length > 0 && (
                            <div className="mt-1">
                              <span className="inline-block text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                                {event.charges.length} charge{event.charges.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{event.defendantName || "N/A"}</td>
                        <td className="px-4 py-3 text-sm">
                          <div>{event.courtName}</div>
                          <div className="text-gray-500 text-xs">{event.courtRoom || ""}</div>
                          {event.judgeName && (
                            <div className="text-gray-500 text-xs">Judge: {event.judgeName}</div>
                          )}
                          {event.hearingLocation && (
                            <div className="text-gray-400 text-xs">{event.hearingLocation}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{event.hearingType || "N/A"}</td>
                        <td className="px-4 py-3 text-sm space-y-1">
                          {hasCalendarConnection ? (
                            calSyncedIds.has(event.id) ? (
                              <button
                                onClick={() => handleRemoveFromCalendar(event)}
                                disabled={calRemovingIds.has(event.id)}
                                className="text-green-700 hover:text-red-600 text-sm font-medium block disabled:opacity-50 group"
                                title="Click to remove from calendar"
                              >
                                {calRemovingIds.has(event.id) ? (
                                  "Removing..."
                                ) : (
                                  <>
                                    <span className="group-hover:hidden">
                                      &#10003; Added to {calLabel}
                                    </span>
                                    <span className="hidden group-hover:inline">
                                      Remove from {calLabel}
                                    </span>
                                  </>
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAddToCalendar(event)}
                                disabled={calSyncingIds.has(event.id)}
                                className="text-amber-700 hover:text-slate-800 text-sm font-medium block disabled:opacity-50"
                              >
                                {calSyncingIds.has(event.id) ? "Adding..." : `Add to ${calLabel}`}
                              </button>
                            )
                          ) : (
                            <button
                              onClick={connectGoogleCalendar}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium block"
                            >
                              Connect Calendar
                            </button>
                          )}
                          <button
                            onClick={() => handleWatch(event)}
                            className="text-gray-500 hover:text-gray-700 text-xs block"
                          >
                            Watch & Auto-Sync
                          </button>
                          {hasDetails(event) && (
                            <button
                              onClick={() => toggleExpand(event.id)}
                              className="text-gray-500 hover:text-gray-700 text-xs block"
                            >
                              {expandedId === event.id ? "Hide details" : "Details"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedId === event.id && (
                        <tr key={`${event.id}-detail`} className="bg-gray-50">
                          <td colSpan={7} className="px-6 py-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                              {event.prosecutingAttorney && (
                                <div>
                                  <span className="text-gray-500 text-xs block">Prosecuting Attorney</span>
                                  <span className="font-medium">{event.prosecutingAttorney}</span>
                                </div>
                              )}
                              {event.defenseAttorney && (
                                <div>
                                  <span className="text-gray-500 text-xs block">Defense Attorney</span>
                                  <span className="font-medium">{event.defenseAttorney}</span>
                                </div>
                              )}
                              {event.defendantOtn && (
                                <div>
                                  <span className="text-gray-500 text-xs block">OTN</span>
                                  <span className="font-medium">{event.defendantOtn}</span>
                                </div>
                              )}
                              {event.defendantDob && (
                                <div>
                                  <span className="text-gray-500 text-xs block">DOB</span>
                                  <span className="font-medium">{event.defendantDob}</span>
                                </div>
                              )}
                              {event.citationNumber && (
                                <div>
                                  <span className="text-gray-500 text-xs block">Citation #</span>
                                  <span className="font-medium">{event.citationNumber}</span>
                                </div>
                              )}
                              {event.sheriffNumber && (
                                <div>
                                  <span className="text-gray-500 text-xs block">Sheriff #</span>
                                  <span className="font-medium">{event.sheriffNumber}</span>
                                </div>
                              )}
                              {event.leaNumber && (
                                <div>
                                  <span className="text-gray-500 text-xs block">LEA #</span>
                                  <span className="font-medium">{event.leaNumber}</span>
                                </div>
                              )}
                              {event.charges && event.charges.length > 0 && (
                                <div className="col-span-2 md:col-span-3">
                                  <span className="text-gray-500 text-xs block">Charges</span>
                                  <ul className="list-disc list-inside text-sm space-y-0.5 mt-0.5">
                                    {event.charges.map((charge, i) => (
                                      <li key={i} className="text-gray-800">{charge}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
