import { useState, useEffect, useMemo } from "react";
import SearchForm from "@/components/SearchForm";
import { searchCourtEvents } from "@/api/search";
import { removeCalendarEntriesForCase } from "@/api/calendar";
import { apiFetch } from "@/api/client";
import EventDetailRow from "@/components/EventDetailRow";
import NewEntriesSection from "@/components/NewEntriesSection";
import Pagination from "@/components/Pagination";
import { exportCourtEventsCsv, extractLastName, ExportTemplate } from "@/utils/formatters";
import ExportTemplateModal from "@/components/ExportTemplateModal";
import { useCalendarActions } from "@/hooks/useCalendarActions";
import { useAuth } from "@/store/authStore";
import { formatDate, hasDetails, timeAgo } from "@/utils/courtEventUtils";
import { CourtEvent, DetectedChange } from "@shared/types";

interface SavedSearchRow {
  id: number;
  search_params: Record<string, string>;
  label: string;
  results_count: number;
  last_refreshed_at: string | null;
  created_at: string;
  source: string;
}

/** Convert camelCase search params to snake_case query params */
function toQueryParams(params: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {
    defendantName: "defendant_name",
    caseNumber: "case_number",
    courtName: "court_name",
    courtNames: "court_names",
    courtDate: "court_date",
    dateFrom: "date_from",
    dateTo: "date_to",
    defendantOtn: "defendant_otn",
    citationNumber: "citation_number",
    charges: "charges",
    judgeName: "judge_name",
    attorney: "attorney",
    allCourts: "all_courts",
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

/** Build a params key matching the server's searchParamsKey format (camelCase, sorted, uppercased values) */
function buildParamsKey(snakeCaseParams: Record<string, string>): string {
  const snakeToCamel: Record<string, string> = {
    defendant_name: "defendantName",
    case_number: "caseNumber",
    court_name: "courtName",
    court_names: "courtNames",
    court_date: "courtDate",
    date_from: "dateFrom",
    date_to: "dateTo",
    defendant_otn: "defendantOtn",
    citation_number: "citationNumber",
    charges: "charges",
    judge_name: "judgeName",
    attorney: "attorney",
    all_courts: "allCourts",
  };
  const entries = Object.entries(snakeCaseParams)
    .map(([k, v]) => [snakeToCamel[k] || k, v] as [string, string])
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v).toUpperCase().trim()}`);
  return entries.join("&");
}

const RESULTS_PER_PAGE = 50;

export default function SearchPage() {
  const [results, setResults] = useState<CourtEvent[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showExportModal, setShowExportModal] = useState(false);
  const [cachedToday, setCachedToday] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearchRow[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [lastSearchParams, setLastSearchParams] = useState<Record<string, string> | null>(null);
  const [lastSearchSavedId, setLastSearchSavedId] = useState<number | null>(null);
  const [removingAll, setRemovingAll] = useState(false);
  const [batchAdding, setBatchAdding] = useState(false);
  const [previousRunAt, setPreviousRunAt] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; label: string } | null>(null);
  const [detectedChanges, setDetectedChanges] = useState<DetectedChange[]>([]);
  const [upgradeMessage, setUpgradeMessage] = useState("");
  const [searchWarnings, setSearchWarnings] = useState<string[]>([]);

  const { user } = useAuth();
  const isIndividualAttorney = user?.accountType === "individual_attorney";
  const cal = useCalendarActions();

  // Load saved searches on mount
  useEffect(() => {
    fetchSavedSearches();
  }, []);

  function connectGoogleCalendar() {
    window.location.href = "/api/auth/google";
  }

  async function fetchSavedSearches() {
    setLoadingSaved(true);
    try {
      const res = await apiFetch("/watched-cases");
      if (res.ok) {
        const data = await res.json();
        const allWatched = data.watchedCases || [];
        const autoSearches = allWatched.filter(
          (wc: SavedSearchRow) => wc.source === "auto_search" && wc.search_params
        );
        setSavedSearches(autoSearches);
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingSaved(false);
    }
  }

  async function handleForceRefresh() {
    if (!lastSearchParams) return;
    await handleSearch(lastSearchParams, { isRerun: true, forceRefresh: true });
  }

  async function handleSearch(params: Record<string, string>, opts?: { isRerun?: boolean; forceRefresh?: boolean }) {
    const searchParams = { ...params };
    delete searchParams._watchedCase;

    // Block duplicate searches unless this is a "Run Again" from a saved search.
    // Individual attorneys always auto-save, so skip the blocker for them —
    // their searches should re-run seamlessly each time.
    if (!isIndividualAttorney && !opts?.isRerun && savedSearches.length > 0) {
      const key = buildParamsKey(searchParams);
      const match = savedSearches.find(s => s.search_params._key === key);
      if (match) {
        setError(`This search already exists in your saved searches ("${match.label}"). Use "Run Again" on the saved search or change your search parameters.`);
        return;
      }
    }

    setError("");
    setUpgradeMessage("");
    setLoading(true);
    setSearched(true);
    setSuccessMsg("");
    setExpandedId(null);
    setCurrentPage(1);
    setSearchWarnings([]);

    try {
      const data = await searchCourtEvents(searchParams, { forceRefresh: opts?.forceRefresh });
      setResults(data.results);
      setLastSearchParams(searchParams);
      setLastSearchSavedId(data.savedSearchId ?? null);
      setPreviousRunAt(data.previousRunAt ?? null);
      setDetectedChanges(data.detectedChanges ?? []);
      setCachedToday(data.cachedToday ?? false);
      setSearchWarnings(data.searchWarnings ?? []);
      fetchSavedSearches();

      // Show upgrade prompt if saved search limit was reached
      if (data.savedSearchLimitReached) {
        setUpgradeMessage("You've reached the 3 saved search limit on the free plan. Upgrade to Pro for unlimited saved searches.");
      } else {
        setUpgradeMessage("");
      }

      const currentSynced = await cal.refreshSyncedEvents();

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Search failed";
      // Check if it's an upgrade-required error
      if (msg.includes("Upgrade to Pro") || msg.includes("upgrade")) {
        setUpgradeMessage(msg);
      } else {
        setError(msg);
      }
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRunSavedSearch(saved: SavedSearchRow) {
    const queryParams = toQueryParams(saved.search_params);
    // Ensure court selection is present — saved searches from before court
    // selection was required may lack both courtNames and allCourts
    if (!queryParams.court_names && !queryParams.all_courts) {
      queryParams.all_courts = "true";
    }
    await handleSearch(queryParams, { isRerun: true });
  }

  async function handleToggleSavedAutoAdd(saved: SavedSearchRow) {
    const newValue = !saved.search_params._autoAddToCalendar;
    try {
      const res = await apiFetch(`/watched-cases/${saved.id}`, {
        method: "PATCH",
        body: JSON.stringify({ autoAddToCalendar: newValue }),
      });
      if (res.ok) {
        setSavedSearches(prev => prev.map(s =>
          s.id === saved.id
            ? { ...s, search_params: { ...s.search_params, _autoAddToCalendar: newValue ? "true" : "" } }
            : s
        ));
      }
    } catch {
      // non-fatal
    }
  }

  function handleDeleteSavedSearch(id: number) {
    const saved = savedSearches.find(s => s.id === id);
    if (saved && saved.results_count > 0) {
      setDeleteConfirm({ id, label: saved.label });
    } else {
      executeDeleteSearch(id, false);
    }
  }

  async function executeDeleteSearch(id: number, removeFromCalendar: boolean) {
    setDeleteConfirm(null);
    try {
      if (removeFromCalendar) {
        await removeCalendarEntriesForCase(id);
      }
      const res = await apiFetch(`/watched-cases/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSavedSearches(prev => prev.filter(s => s.id !== id));
        // If this was the currently displayed search, clear results from UI
        if (lastSearchSavedId === id) {
          setResults([]);
          setSearched(false);
          setLastSearchParams(null);
          setLastSearchSavedId(null);
          setDetectedChanges([]);
          setSuccessMsg("");
        }
        // Refresh synced event state so calendar icons update
        cal.refreshSyncedEvents();
      }
    } catch {
      // non-fatal
    }
  }

  async function onAddToCalendar(event: CourtEvent) {
    try {
      const data = await cal.handleAddToCalendar(event.id);
      setSuccessMsg(data.message);
      setError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add to calendar";
      setError(msg);
    }
  }

  async function onRemoveFromCalendar(event: CourtEvent) {
    try {
      await cal.handleRemoveFromCalendar(event.id);
      setSuccessMsg("Event removed from calendar");
      setError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove from calendar";
      setError(msg);
    }
  }

  async function handleAddAllToCalendar() {
    const unsyncedIds = results
      .filter(e => e.id > 0 && !cal.calSyncedIds.has(e.id))
      .map(e => e.id);

    if (unsyncedIds.length === 0) {
      setSuccessMsg("All events are already on your calendar.");
      return;
    }

    setBatchAdding(true);
    setError("");
    setSuccessMsg("");

    try {
      const data = await cal.handleBatchAdd(unsyncedIds);
      setSuccessMsg(data.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add events to calendar";
      if (msg.includes("No calendar connected")) {
        window.location.href = "/api/auth/google";
        return;
      }
      setError(msg);
    } finally {
      setBatchAdding(false);
    }
  }

  async function handleRemoveAllFromCalendar() {
    const syncedInResults = results.filter(e => cal.calSyncedIds.has(e.id) && cal.calEntryMap[e.id]);
    if (syncedInResults.length === 0) return;

    setRemovingAll(true);
    setError("");
    setSuccessMsg("");
    let removed = 0;
    let failed = 0;

    for (const event of syncedInResults) {
      try {
        await cal.handleRemoveFromCalendar(event.id);
        removed++;
      } catch {
        failed++;
      }
    }

    setRemovingAll(false);
    if (failed > 0) {
      setSuccessMsg(`Removed ${removed} event${removed !== 1 ? "s" : ""} from ${cal.calLabel}. ${failed} failed.`);
    } else {
      setSuccessMsg(`Removed all ${removed} event${removed !== 1 ? "s" : ""} from ${cal.calLabel}`);
    }
  }

  function toggleExpand(id: number) {
    setExpandedId(expandedId === id ? null : id);
  }

  function handleExportWithTemplate(template: ExportTemplate) {
    exportCourtEventsCsv(results, template);
    setShowExportModal(false);
  }

  const anySynced = results.some(e => cal.calSyncedIds.has(e.id));
  const allSynced = results.length > 0 && results.every(e => cal.calSyncedIds.has(e.id));

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
            {savedSearches.map((saved) => {
              const ranToday = saved.last_refreshed_at && (() => {
                const lastRun = new Date(saved.last_refreshed_at!);
                const now = new Date();
                return lastRun.getUTCFullYear() === now.getUTCFullYear() &&
                  lastRun.getUTCMonth() === now.getUTCMonth() &&
                  lastRun.getUTCDate() === now.getUTCDate();
              })();
              return (
              <div key={saved.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gray-50 rounded-md">
                <button
                  className="flex-1 min-w-0 text-left hover:bg-gray-100 rounded p-1 -m-1 transition-colors"
                  onClick={() => handleRunSavedSearch(saved)}
                  disabled={loading}
                >
                  <div className="font-medium text-gray-900 truncate">{saved.label}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mt-1">
                    <span>{saved.results_count} result{saved.results_count !== 1 ? "s" : ""}</span>
                    {saved.last_refreshed_at && <span>Last run {timeAgo(saved.last_refreshed_at)}</span>}
                    {ranToday && <span className="text-green-600">Up to date</span>}
                  </div>
                </button>
                <div className="flex items-center gap-3 shrink-0">
                  {cal.hasCalendarConnection && (
                    <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Auto-add results to calendar when this search runs">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={!!saved.search_params._autoAddToCalendar}
                          onChange={() => handleToggleSavedAutoAdd(saved)}
                          className="sr-only peer"
                        />
                        <div className="w-7 h-4 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors"></div>
                        <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full shadow peer-checked:translate-x-3 transition-transform"></div>
                      </div>
                      <span className="text-xs text-gray-500">Auto-sync</span>
                    </label>
                  )}
                  <button
                    onClick={() => handleRunSavedSearch(saved)}
                    disabled={loading}
                    className="text-amber-700 hover:text-slate-800 text-sm font-medium disabled:opacity-50"
                  >
                    {ranToday ? "View Results" : "Run Again"}
                  </button>
                  <button
                    onClick={() => handleDeleteSavedSearch(saved.id)}
                    className="text-red-600 hover:text-red-800 text-sm font-medium"
                  >
                    Remove
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Search</h3>
            <p className="text-sm text-gray-600 mb-5">
              You are deleting <span className="font-medium">"{deleteConfirm.label}"</span>. Do you want to remove the synced events from your calendar as well?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => executeDeleteSearch(deleteConfirm.id, true)}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md"
              >
                Delete search and remove from calendar
              </button>
              <button
                onClick={() => executeDeleteSearch(deleteConfirm.id, false)}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                Delete search but keep calendar events
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="w-full px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm">{error}</div>}
      {successMsg && <div className="bg-green-50 text-green-700 p-4 rounded-md text-sm">{successMsg}</div>}

      {searchWarnings.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-orange-800">Some results may be incomplete</p>
              {searchWarnings.map((w, i) => (
                <p key={i} className="text-sm text-orange-700 mt-1">{w}</p>
              ))}
              <button
                onClick={handleForceRefresh}
                disabled={loading}
                className="mt-2 text-sm font-medium text-orange-700 hover:text-orange-900 underline disabled:opacity-50"
              >
                Retry search
              </button>
            </div>
          </div>
        </div>
      )}

      {upgradeMessage && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm text-amber-800">{upgradeMessage}</p>
            <a
              href="/billing"
              className="inline-block mt-2 px-4 py-1.5 text-sm font-medium text-white bg-amber-700 hover:bg-amber-800 rounded-md transition-colors"
            >
              Upgrade to Pro
            </a>
          </div>
          <button
            onClick={() => setUpgradeMessage("")}
            className="shrink-0 p-1 text-amber-400 hover:text-amber-600"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Schedule Changes Detected */}
      {detectedChanges.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-2">
            Schedule Changes Detected ({detectedChanges.length} event{detectedChanges.length !== 1 ? "s" : ""} updated)
          </h3>
          <p className="text-xs text-amber-600 mb-3">
            These changes were found since your last search. Your calendar and notifications have been updated automatically.
          </p>
          <div className="space-y-2">
            {detectedChanges.slice(0, 10).map((dc) => (
              <div key={dc.courtEventId} className="bg-white rounded p-3 border border-amber-100">
                <div className="font-medium text-sm text-gray-900">
                  {dc.defendantName || "Unknown"} &mdash; Case {dc.caseNumber || "N/A"}
                </div>
                <div className="mt-1 space-y-0.5">
                  {dc.changes.map((c, i) => (
                    <div key={i} className="text-xs text-gray-600">
                      <span className="font-medium text-gray-700">{c.field.replace(/_/g, " ")}:</span>{" "}
                      <span className="line-through text-red-500">{c.oldValue || "(empty)"}</span>{" "}
                      <span className="text-green-700">{c.newValue || "(empty)"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {detectedChanges.length > 10 && (
              <p className="text-xs text-amber-600">...and {detectedChanges.length - 10} more changes</p>
            )}
          </div>
        </div>
      )}

      {searched && !loading && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-gray-900">
                {results.length} Result{results.length !== 1 ? "s" : ""} Found
              </h2>
              {cachedToday && (
                <span className="inline-flex items-center gap-2 text-sm text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                  Showing cached results from earlier today.
                  <button
                    onClick={handleForceRefresh}
                    disabled={loading}
                    className="font-medium underline hover:text-amber-800 disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </span>
              )}
              <div className="flex items-center gap-2">
                {results.length > 0 && (
                  <button
                    onClick={() => setShowExportModal(true)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-gray-600 text-white hover:bg-gray-700 transition-colors"
                    title="Export results to CSV"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export CSV
                  </button>
                )}
                {lastSearchSavedId && (
                  <span className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 rounded-md">
                    Search saved
                  </span>
                )}
              </div>
            </div>
            {results.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mt-3">
                {cal.calendarProvider ? (
                  <>
                    {!allSynced && (
                      <button
                        onClick={handleAddAllToCalendar}
                        disabled={batchAdding || removingAll}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {batchAdding ? "Adding..." : `Add All to ${cal.calLabel}`}
                      </button>
                    )}
                    {anySynced && (
                      <button
                        onClick={handleRemoveAllFromCalendar}
                        disabled={removingAll || batchAdding}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed bg-red-600 text-white hover:bg-red-700 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        {removingAll ? "Removing..." : "Remove All"}
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    onClick={connectGoogleCalendar}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Add All to Calendar
                  </button>
                )}
              </div>
            )}
          </div>

          {results.length === 0 ? (
            <div className="p-6 text-gray-500 text-center">
              No court events match your search criteria. Try broadening your search.
            </div>
          ) : (
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Attorneys</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(results)
                    .slice((currentPage - 1) * RESULTS_PER_PAGE, currentPage * RESULTS_PER_PAGE)
                    .map((event) => (
                    <>
                      <tr key={event.id} className={`hover:bg-gray-50 ${event.isNew ? "bg-blue-50" : ""}`}>
                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                          <div>{formatDate(event.eventDate)}</div>
                          {event.isNew && (
                            <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              New
                            </span>
                          )}
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
                        <td className="px-4 py-3 text-sm">
                          {(() => {
                            const pros = extractLastName(event.prosecutingAttorney);
                            const def = extractLastName(event.defenseAttorney);
                            const cleanDef = (def && pros && def.toUpperCase() === pros.toUpperCase()) ? "" : def;
                            return pros || cleanDef ? (
                              <>
                                <div><span className="text-gray-500 text-xs">P:</span> {pros || "-"}</div>
                                <div><span className="text-gray-500 text-xs">D:</span> {cleanDef || "-"}</div>
                              </>
                            ) : (
                              <span className="text-gray-400">-</span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-sm space-y-1">
                          {cal.hasCalendarConnection ? (
                            cal.calSyncedIds.has(event.id) ? (
                              <button
                                onClick={() => onRemoveFromCalendar(event)}
                                disabled={cal.calRemovingIds.has(event.id)}
                                className="text-green-700 hover:text-red-600 text-sm font-medium block disabled:opacity-50 group"
                                title="Click to remove from calendar"
                              >
                                {cal.calRemovingIds.has(event.id) ? (
                                  "Removing..."
                                ) : (
                                  <>
                                    <span className="group-hover:hidden">
                                      &#10003; Added to {cal.calLabel}
                                    </span>
                                    <span className="hidden group-hover:inline">
                                      Remove from {cal.calLabel}
                                    </span>
                                  </>
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={() => onAddToCalendar(event)}
                                disabled={cal.calSyncingIds.has(event.id)}
                                className="text-amber-700 hover:text-slate-800 text-sm font-medium block disabled:opacity-50"
                              >
                                {cal.calSyncingIds.has(event.id) ? "Adding..." : `Add to ${cal.calLabel}`}
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
                          <EventDetailRow event={event} />
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil((results).length / RESULTS_PER_PAGE)}
                onPageChange={(p) => { setCurrentPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                totalItems={(results).length}
                pageSize={RESULTS_PER_PAGE}
              />
            </div>
          )}
        </div>
      )}
      {showExportModal && (
        <ExportTemplateModal
          onExport={handleExportWithTemplate}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}
