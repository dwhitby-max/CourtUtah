import { useEffect, useState, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSearch } from "@/hooks/useSearch";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";
import { useCalendarActions } from "@/hooks/useCalendarActions";
import EventDetailRow from "@/components/EventDetailRow";
import UpdatesSection from "@/components/UpdatesSection";
import NewEntriesSection from "@/components/NewEntriesSection";
import ChangesFeedSection from "@/components/ChangesFeedSection";
import UpgradeBanner from "@/components/UpgradeBanner";
import Pagination from "@/components/Pagination";
import { exportCourtEventsCsv, extractLastName, ExportTemplate } from "@/utils/formatters";
import ExportTemplateModal from "@/components/ExportTemplateModal";
import { formatDate, hasDetails, providerLabels } from "@/utils/courtEventUtils";
import { CourtEvent } from "@shared/types";
import { ChangeRecord } from "@/components/UpdatesSection";

const FREE_RESULT_LIMIT = 5;
const RESULTS_PER_PAGE = 50;

export default function SearchResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { results, searched, loading, error, previousRunAt, cachedToday, search } = useSearch();
  const isPro = user?.subscriptionPlan === "pro" && (user?.subscriptionStatus === "active" || user?.subscriptionStatus === "grandfathered");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [watchSuccess, setWatchSuccess] = useState("");
  const [watchError, setWatchError] = useState("");

  const cal = useCalendarActions();

  // Batch add/remove state
  const [batchAdding, setBatchAdding] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [batchRemoving, setBatchRemoving] = useState(false);

  // Export template modal state
  const [showExportModal, setShowExportModal] = useState(false);

  // Auto-sync toggle state
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [autoSyncLoading, setAutoSyncLoading] = useState(false);

  // Updates section state
  const [updates, setUpdates] = useState<ChangeRecord[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const searchParams: Record<string, string> = {};
    params.forEach((value, key) => {
      if (value) searchParams[key] = value;
    });
    if (Object.keys(searchParams).length > 0) {
      search(searchParams);
      setCurrentPage(1);
    }
  }, [location.search]);

  // Fetch updates (changes detected for events in current results)
  const fetchUpdates = useCallback(async () => {
    if (results.length === 0) return;
    try {
      const res = await apiFetch("/watched-cases/pending-updates");
      const data = await res.json();
      if (res.ok && data.pendingUpdates) {
        const resultEventIds = new Set(results.map(r => r.id));
        const relevant = data.pendingUpdates
          .filter((u: { court_event_id: number }) => resultEventIds.has(u.court_event_id))
          .map((u: { court_event_id: number; case_number: string | null; defendant_name: string | null; field_changed: string; old_value: string | null; new_value: string | null; detected_at: string }) => ({
            courtEventId: u.court_event_id,
            caseNumber: u.case_number,
            defendantName: u.defendant_name,
            fieldChanged: u.field_changed,
            oldValue: u.old_value,
            newValue: u.new_value,
            detectedAt: u.detected_at,
          }));
        setUpdates(relevant);
      }
    } catch (err) {
      console.error("Failed to fetch updates:", err);
    }
  }, [results]);

  useEffect(() => {
    if (searched && !loading && results.length > 0) {
      fetchUpdates();
    }
  }, [searched, loading, results, fetchUpdates]);

  function handleExportWithTemplate(template: ExportTemplate) {
    exportCourtEventsCsv(results, template);
    setShowExportModal(false);
  }

  async function handleAddToCalendar(event: CourtEvent) {
    try {
      const data = await cal.handleAddToCalendar(event.id);
      setWatchSuccess(data.message);
      setWatchError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add to calendar";
      if (msg.includes("No calendar connected")) {
        window.location.href = "/api/auth/google";
        return;
      }
      setWatchError(msg);
      setWatchSuccess("");
    }
  }

  async function handleRemoveFromCalendar(event: CourtEvent) {
    try {
      await cal.handleRemoveFromCalendar(event.id);
      setWatchSuccess("Event removed from calendar");
      setWatchError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove from calendar";
      setWatchError(msg);
      setWatchSuccess("");
    }
  }

  async function handleAddAllToCalendar() {
    const unsyncedIds = results
      .filter(e => e.id > 0 && !cal.calSyncedIds.has(e.id))
      .map(e => e.id);

    if (unsyncedIds.length === 0) {
      setWatchSuccess("All events are already on your calendar.");
      return;
    }

    setBatchAdding(true);
    setBatchProgress(`Adding ${unsyncedIds.length} events...`);
    setWatchError("");
    setWatchSuccess("");

    try {
      const data = await cal.handleBatchAdd(unsyncedIds);
      setWatchSuccess(data.message);
      setBatchProgress("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add events to calendar";
      if (msg.includes("No calendar connected")) {
        window.location.href = "/api/auth/google";
        return;
      }
      setWatchError(msg);
      setBatchProgress("");
    } finally {
      setBatchAdding(false);
    }
  }

  async function handleRemoveAllFromCalendar() {
    const syncedInResults = results.filter(e => cal.calSyncedIds.has(e.id) && cal.calEntryMap[e.id]);

    if (syncedInResults.length === 0) {
      setWatchSuccess("No events to remove from your calendar.");
      return;
    }

    setBatchRemoving(true);
    setBatchProgress(`Removing ${syncedInResults.length} events...`);
    setWatchError("");
    setWatchSuccess("");

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

    setBatchRemoving(false);
    setBatchProgress("");

    if (failed > 0) {
      setWatchSuccess(`Removed ${removed} event${removed !== 1 ? "s" : ""} from ${cal.calLabel}. ${failed} failed.`);
    } else {
      setWatchSuccess(`Removed all ${removed} event${removed !== 1 ? "s" : ""} from ${cal.calLabel}`);
    }
  }

  async function handleToggleAutoSync(enabled: boolean) {
    const syncedEventIds = results
      .filter(e => cal.calSyncedIds.has(e.id) && e.id > 0)
      .map(e => e.id);

    if (syncedEventIds.length === 0) {
      setWatchError("No calendar events to auto-sync. Add events to your calendar first.");
      return;
    }

    setAutoSyncLoading(true);
    setWatchError("");
    setWatchSuccess("");

    try {
      const res = await apiFetch("/watched-cases/auto-sync", {
        method: "POST",
        body: JSON.stringify({ courtEventIds: syncedEventIds, enable: enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update auto-sync");

      setAutoSyncEnabled(enabled);
      setWatchSuccess(data.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update auto-sync";
      setWatchError(msg);
    } finally {
      setAutoSyncLoading(false);
    }
  }

  function handleDismissUpdate(courtEventId: number) {
    setUpdates(prev => prev.filter(u => u.courtEventId !== courtEventId));
  }

  function toggleExpand(id: number) {
    setExpandedId(expandedId === id ? null : id);
  }

  const allSynced = results.length > 0 && results.every(e => cal.calSyncedIds.has(e.id));
  const anySynced = results.some(e => cal.calSyncedIds.has(e.id));

  const { newResults, existingResults } = useMemo(() => {
    if (!previousRunAt) return { newResults: [], existingResults: results };
    const newOnes = results.filter(e => e.isNew);
    const existing = results.filter(e => !e.isNew);
    return { newResults: newOnes, existingResults: existing };
  }, [results, previousRunAt]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Search Results</h1>
        <button
          onClick={() => navigate("/search")}
          className="text-amber-700 hover:text-slate-800 text-sm font-medium"
        >
          New Search
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm">{error}</div>}
      {watchSuccess && <div className="bg-green-50 text-green-700 p-4 rounded-md text-sm">{watchSuccess}</div>}
      {watchError && <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm">{watchError}</div>}

      {loading && <div className="text-gray-500">Searching...</div>}

      <ChangesFeedSection refreshKey={results.length} />

      <UpdatesSection
        updates={updates}
        onDismissUpdate={handleDismissUpdate}
      />

      {searched && !loading && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-gray-900">
                {results.length} Result{results.length !== 1 ? "s" : ""} Found
                {newResults.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-blue-600">({newResults.length} new)</span>
                )}
              </h2>
              {cachedToday && (
                <span className="text-sm text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                  Search already run today. New results will post tomorrow.
                </span>
              )}
              {results.length > 0 && (
                <button
                  onClick={() => setShowExportModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-gray-600 text-white hover:bg-gray-700 transition-colors"
                  title="Export results to CSV"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export CSV
                </button>
              )}
            </div>
            {results.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mt-3">
                {cal.calendarProvider ? (
                  <>
                    {!allSynced && (
                      <button
                        onClick={handleAddAllToCalendar}
                        disabled={batchAdding || batchRemoving}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                        title={`Add all ${results.length} events to ${providerLabels[cal.calendarProvider] || "Calendar"}`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {batchAdding ? batchProgress : `Add All to ${providerLabels[cal.calendarProvider] || "Calendar"}`}
                      </button>
                    )}
                    {anySynced && (
                      <button
                        onClick={handleRemoveAllFromCalendar}
                        disabled={batchRemoving || batchAdding}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed bg-red-600 text-white hover:bg-red-700 transition-colors"
                        title={`Remove all synced events from ${providerLabels[cal.calendarProvider] || "Calendar"}`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        {batchRemoving ? batchProgress : "Remove All"}
                      </button>
                    )}
                    {anySynced && (
                      <label className="flex items-center gap-2 cursor-pointer select-none ml-2 group relative">
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={autoSyncEnabled}
                            onChange={(e) => handleToggleAutoSync(e.target.checked)}
                            disabled={autoSyncLoading || batchAdding || batchRemoving}
                            className="sr-only peer"
                          />
                          <div className={`w-9 h-5 rounded-full transition-colors ${autoSyncLoading ? "bg-gray-200" : "bg-gray-300"} peer-checked:bg-green-500`}></div>
                          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform"></div>
                        </div>
                        <span className="text-sm text-gray-700 font-medium">
                          {autoSyncLoading ? "Updating..." : "Auto-sync"}
                        </span>
                        <span className="relative">
                          <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 px-3 py-2 text-xs text-white bg-gray-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                            Monitors your calendar events for schedule changes and automatically updates them. New hearings found for these cases will also be added to your calendar.
                          </span>
                        </span>
                      </label>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => navigate("/calendar-settings")}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                    title="Connect a calendar to add events"
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
                  {(() => {
                    const allEvents = results;
                    const totalPages = Math.ceil(allEvents.length / RESULTS_PER_PAGE);
                    const pageEvents = allEvents.slice((currentPage - 1) * RESULTS_PER_PAGE, currentPage * RESULTS_PER_PAGE);
                    const globalOffset = (currentPage - 1) * RESULTS_PER_PAGE;
                    return pageEvents.map((event, index) => {
                    const globalIndex = globalOffset + index;
                    const isLocked = !isPro && globalIndex >= FREE_RESULT_LIMIT;
                    return (
                    <>
                      <tr key={event.id} className={`hover:bg-gray-50 ${event.isNew ? "bg-blue-50" : ""}`}>
                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                          <div className={isLocked ? "blur-sm select-none" : ""}>{formatDate(event.eventDate)}</div>
                          {event.isNew && (
                            <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              New
                            </span>
                          )}
                          {event.isVirtual && (
                            <span className={`inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ${isLocked ? "blur-sm select-none" : ""}`}>
                              Virtual
                            </span>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-sm whitespace-nowrap font-medium ${isLocked ? "blur-sm select-none" : ""}`}>
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
                        <td className={`px-4 py-3 text-sm ${isLocked ? "blur-sm select-none" : ""}`}>
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
                        <td className="px-4 py-3 text-sm">
                          <div className="flex items-center gap-2">
                            {isLocked ? (
                              <button
                                onClick={() => navigate("/billing")}
                                className="p-1.5 rounded-md text-amber-500 hover:text-amber-700 hover:bg-amber-50 transition-colors"
                                title="Upgrade to add to calendar"
                              >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                              </button>
                            ) : cal.calendarProvider ? (
                              <>
                                {cal.calSyncedIds.has(event.id) ? (
                                  <button
                                    onClick={() => handleRemoveFromCalendar(event)}
                                    disabled={cal.calRemovingIds.has(event.id)}
                                    className="p-1.5 rounded-md text-green-600 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors group"
                                    title={cal.calRemovingIds.has(event.id) ? "Removing..." : `Remove from ${providerLabels[cal.calendarProvider!] || "Calendar"}`}
                                  >
                                    {cal.calRemovingIds.has(event.id) ? (
                                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                      </svg>
                                    ) : (
                                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                    )}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleAddToCalendar(event)}
                                    disabled={cal.calSyncingIds.has(event.id)}
                                    className="p-1.5 rounded-md text-gray-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-50 transition-colors"
                                    title={cal.calSyncingIds.has(event.id) ? "Adding..." : `Add to ${providerLabels[cal.calendarProvider!] || "Calendar"}`}
                                  >
                                    {cal.calSyncingIds.has(event.id) ? (
                                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                      </svg>
                                    ) : (
                                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                    )}
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                onClick={() => navigate("/calendar-settings")}
                                className="p-1.5 rounded-md text-gray-300 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                                title="Connect a calendar first"
                              >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </button>
                            )}
                            {hasDetails(event) && (
                              <button
                                onClick={() => toggleExpand(event.id)}
                                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                title={expandedId === event.id ? "Hide details" : "Show details"}
                              >
                                <svg
                                  className={`w-4 h-4 transition-transform ${expandedId === event.id ? "rotate-180" : ""}`}
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedId === event.id && (
                        <tr key={`${event.id}-detail`} className="bg-gray-50">
                          <EventDetailRow event={event} />
                        </tr>
                      )}
                    </>
                  ); });
                  })()}
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

      {searched && !loading && !isPro && results.length > FREE_RESULT_LIMIT && (
        <UpgradeBanner totalResults={results.length} freeLimit={FREE_RESULT_LIMIT} />
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
