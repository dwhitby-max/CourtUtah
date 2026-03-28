import { useEffect, useState, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSearch } from "@/hooks/useSearch";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";
import { addEventToCalendar, addAllEventsToCalendar, getCalendarConnections, getSyncedEvents, removeEventFromCalendar } from "@/api/calendar";
import UpdatesSection from "@/components/UpdatesSection";
import NewEntriesSection from "@/components/NewEntriesSection";
import MonitorModal from "@/components/MonitorModal";
import UpgradeBanner from "@/components/UpgradeBanner";
import Pagination from "@/components/Pagination";
import { CourtEvent } from "@shared/types";
import { ChangeRecord } from "@/components/UpdatesSection";

const providerLabels: Record<string, string> = {
  google: "Google Calendar",
  microsoft: "Outlook",
  apple: "iCloud",
  caldav: "CalDAV",
};

const FREE_RESULT_LIMIT = 5;
const RESULTS_PER_PAGE = 50;

export default function SearchResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { results, searched, loading, error, previousRunAt, search } = useSearch();
  const isPro = user?.subscriptionPlan === "pro" && (user?.subscriptionStatus === "active" || user?.subscriptionStatus === "grandfathered");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [watchSuccess, setWatchSuccess] = useState("");
  const [watchError, setWatchError] = useState("");
  const [calSyncingIds, setCalSyncingIds] = useState<Set<number>>(new Set());
  const [calSyncedIds, setCalSyncedIds] = useState<Set<number>>(new Set());
  const [calEntryMap, setCalEntryMap] = useState<Record<number, number>>({});
  const [calRemovingIds, setCalRemovingIds] = useState<Set<number>>(new Set());
  const [calendarProvider, setCalendarProvider] = useState<string | null>(null);

  // Batch add/remove state
  const [batchAdding, setBatchAdding] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [batchRemoving, setBatchRemoving] = useState(false);

  // Monitor modal state
  const [showMonitorModal, setShowMonitorModal] = useState(false);
  const [monitoringInProgress, setMonitoringInProgress] = useState(false);

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

  useEffect(() => {
    getCalendarConnections()
      .then(data => {
        const active = data.connections.find(c => c.is_active);
        setCalendarProvider(active?.provider ?? null);
      })
      .catch((err) => console.error("Failed to fetch calendar connections:", err));
    getSyncedEvents()
      .then(synced => {
        setCalEntryMap(synced);
        setCalSyncedIds(new Set(Object.keys(synced).map(Number)));
      })
      .catch((err) => console.error("Failed to fetch synced events:", err));
  }, []);

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

  function exportResultsCsv() {
    if (results.length === 0) return;
    const headers = [
      "Date", "Time", "Court", "Court Room", "Location", "Judge",
      "Case Number", "Case Type", "Hearing Type", "Defendant",
      "OTN", "DOB", "Citation Number", "Sheriff Number", "LEA Number",
      "Prosecuting Attorney", "Defense Attorney", "Charges", "Virtual",
    ];
    const escCsv = (val: string | null | undefined): string => {
      if (val == null) return "";
      const s = String(val);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const rows = results.map((e) => [
      e.eventDate, e.eventTime, e.courtName, e.courtRoom, e.hearingLocation, e.judgeName,
      e.caseNumber, e.caseType, e.hearingType, e.defendantName,
      e.defendantOtn, e.defendantDob, e.citationNumber, e.sheriffNumber, e.leaNumber,
      e.prosecutingAttorney, e.defenseAttorney,
      e.charges?.join("; "),
      e.isVirtual ? "Yes" : "No",
    ].map(escCsv).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `court-search-results-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleAddToCalendar(event: CourtEvent) {
    setCalSyncingIds((prev) => new Set(prev).add(event.id));
    try {
      const data = await addEventToCalendar(event.id);
      setCalSyncedIds((prev) => new Set(prev).add(event.id));
      setCalEntryMap((prev) => ({ ...prev, [event.id]: data.calendarEntryId }));
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
      setWatchError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove from calendar";
      setWatchError(msg);
      setWatchSuccess("");
    } finally {
      setCalRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
    }
  }

  async function handleAddAllToCalendar() {
    const unsyncedIds = results
      .filter(e => !calSyncedIds.has(e.id))
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
      const data = await addAllEventsToCalendar(unsyncedIds);
      const newSyncedIds = new Set(calSyncedIds);
      const newEntryMap = { ...calEntryMap };

      for (const r of data.results) {
        if (r.synced) {
          newSyncedIds.add(r.courtEventId);
          newEntryMap[r.courtEventId] = r.calendarEntryId;
        }
      }

      setCalSyncedIds(newSyncedIds);
      setCalEntryMap(newEntryMap);
      setWatchSuccess(data.message);
      setBatchProgress("");

      // Show monitor modal after successful batch add
      setShowMonitorModal(true);
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

  async function handleAddAllAndAutoUpdate() {
    const unsyncedIds = results
      .filter(e => !calSyncedIds.has(e.id))
      .map(e => e.id);

    setBatchAdding(true);
    setBatchProgress("Adding events & setting up auto-updates...");
    setWatchError("");
    setWatchSuccess("");

    try {
      // Step 1: Batch add all unsynced events to calendar
      if (unsyncedIds.length > 0) {
        const data = await addAllEventsToCalendar(unsyncedIds);
        const newSyncedIds = new Set(calSyncedIds);
        const newEntryMap = { ...calEntryMap };

        for (const r of data.results) {
          if (r.synced) {
            newSyncedIds.add(r.courtEventId);
            newEntryMap[r.courtEventId] = r.calendarEntryId;
          }
        }

        setCalSyncedIds(newSyncedIds);
        setCalEntryMap(newEntryMap);
      }

      // Step 2: Create watched cases with both monitorChanges AND autoAddNew
      setBatchProgress("Setting up auto-monitoring...");
      const seen = new Set<string>();
      let successCount = 0;

      for (const event of results) {
        if (event.caseNumber) {
          const key = `case_number:${event.caseNumber}`;
          if (!seen.has(key)) {
            seen.add(key);
            try {
              const res = await apiFetch("/watched-cases", {
                method: "POST",
                body: JSON.stringify({
                  searchType: "case_number",
                  searchValue: event.caseNumber,
                  label: `${event.caseNumber} - ${event.defendantName || "Unknown"} (${event.courtName})`,
                  monitorChanges: true,
                  autoAddNew: true,
                }),
              });
              if (res.ok) successCount++;
            } catch (err) {
              console.error("Failed to create watched case:", err);
            }
          }
        } else if (event.defendantName) {
          const key = `defendant_name:${event.defendantName}`;
          if (!seen.has(key)) {
            seen.add(key);
            try {
              const res = await apiFetch("/watched-cases", {
                method: "POST",
                body: JSON.stringify({
                  searchType: "defendant_name",
                  searchValue: event.defendantName,
                  label: `${event.defendantName} (${event.courtName})`,
                  monitorChanges: true,
                  autoAddNew: true,
                }),
              });
              if (res.ok) successCount++;
            } catch (err) {
              console.error("Failed to create watched case:", err);
            }
          }
        }
      }

      setBatchProgress("");
      const parts: string[] = [];
      if (unsyncedIds.length > 0) parts.push(`Added ${unsyncedIds.length} events to ${calLabel}`);
      if (successCount > 0) parts.push(`monitoring ${successCount} case${successCount !== 1 ? "s" : ""} for changes and new hearings`);
      setWatchSuccess(parts.join(". ") + ". Your calendar will stay up to date automatically.");

      fetchUpdates();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set up auto-updates";
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
    const syncedInResults = results.filter(e => calSyncedIds.has(e.id) && calEntryMap[e.id]);

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
        await removeEventFromCalendar(calEntryMap[event.id]);
        removed++;
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
      } catch {
        failed++;
      }
    }

    setBatchRemoving(false);
    setBatchProgress("");

    if (failed > 0) {
      setWatchSuccess(`Removed ${removed} event${removed !== 1 ? "s" : ""} from ${calLabel}. ${failed} failed.`);
    } else {
      setWatchSuccess(`Removed all ${removed} event${removed !== 1 ? "s" : ""} from ${calLabel}`);
    }
  }

  async function handleMonitorConfirm(options: { monitorChanges: boolean; autoAddNew: boolean }) {
    setMonitoringInProgress(true);

    // Create watched cases for unique defendants and case numbers in results
    const seen = new Set<string>();
    const watchRequests: Array<{ searchType: string; searchValue: string; label: string; monitorChanges: boolean; autoAddNew: boolean }> = [];

    for (const event of results) {
      if (event.caseNumber) {
        const key = `case_number:${event.caseNumber}`;
        if (!seen.has(key)) {
          seen.add(key);
          watchRequests.push({
            searchType: "case_number",
            searchValue: event.caseNumber,
            label: `${event.caseNumber} - ${event.defendantName || "Unknown"} (${event.courtName})`,
            monitorChanges: options.monitorChanges,
            autoAddNew: options.autoAddNew,
          });
        }
      } else if (event.defendantName) {
        const key = `defendant_name:${event.defendantName}`;
        if (!seen.has(key)) {
          seen.add(key);
          watchRequests.push({
            searchType: "defendant_name",
            searchValue: event.defendantName,
            label: `${event.defendantName} (${event.courtName})`,
            monitorChanges: options.monitorChanges,
            autoAddNew: options.autoAddNew,
          });
        }
      }
    }

    let successCount = 0;
    for (const req of watchRequests) {
      try {
        const res = await apiFetch("/watched-cases", {
          method: "POST",
          body: JSON.stringify(req),
        });
        if (res.ok) successCount++;
      } catch (err) {
        console.error("Failed to create watched case:", err);
      }
    }

    setMonitoringInProgress(false);
    setShowMonitorModal(false);

    if (successCount > 0) {
      const features: string[] = [];
      if (options.monitorChanges) features.push("monitoring for changes");
      if (options.autoAddNew) features.push("auto-adding new hearings");
      setWatchSuccess(`Set up ${successCount} case${successCount !== 1 ? "s" : ""} with ${features.join(" and ")}. You'll be notified by email of any updates.`);
    } else if (watchRequests.length === 0) {
      setWatchSuccess("No cases to monitor from these results.");
    } else {
      setWatchError("Failed to set up monitoring. Please try again.");
    }

    // Re-fetch updates now that we have watched cases
    fetchUpdates();
  }

  function handleDismissUpdate(courtEventId: number) {
    setUpdates(prev => prev.filter(u => u.courtEventId !== courtEventId));
  }

  function toggleExpand(id: number) {
    setExpandedId(expandedId === id ? null : id);
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

  function formatDate(dateStr: string): string {
    if (!dateStr) return "N/A";
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, m, d] = match;
      return `${parseInt(m)}/${parseInt(d)}/${y}`;
    }
    return dateStr;
  }

  const allSynced = results.length > 0 && results.every(e => calSyncedIds.has(e.id));
  const anySynced = results.some(e => calSyncedIds.has(e.id));

  const { newResults, existingResults } = useMemo(() => {
    if (!previousRunAt) return { newResults: [], existingResults: results };
    const newOnes = results.filter(e => e.isNew);
    const existing = results.filter(e => !e.isNew);
    return { newResults: newOnes, existingResults: existing };
  }, [results, previousRunAt]);

  const calLabel = calendarProvider ? providerLabels[calendarProvider] || "Calendar" : "Calendar";

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

      <UpdatesSection
        updates={updates}
        onDismissUpdate={handleDismissUpdate}
      />

      {searched && !loading && newResults.length > 0 && (
        <NewEntriesSection
          events={newResults}
          formatDate={formatDate}
          onAddToCalendar={calendarProvider ? handleAddToCalendar : undefined}
          onAddAllNewToCalendar={calendarProvider ? async () => {
            const newUnsyncedIds = newResults.filter(e => !calSyncedIds.has(e.id)).map(e => e.id);
            if (newUnsyncedIds.length === 0) return;
            setBatchAdding(true);
            setBatchProgress(`Adding ${newUnsyncedIds.length} new events...`);
            try {
              const data = await addAllEventsToCalendar(newUnsyncedIds);
              const ns = new Set(calSyncedIds);
              const nm = { ...calEntryMap };
              for (const r of data.results) { if (r.synced) { ns.add(r.courtEventId); nm[r.courtEventId] = r.calendarEntryId; } }
              setCalSyncedIds(ns);
              setCalEntryMap(nm);
              setWatchSuccess(`Added ${data.results.filter((r: { synced: boolean }) => r.synced).length} new events to ${calLabel}`);
            } catch (err) {
              setWatchError(err instanceof Error ? err.message : "Failed to add new events");
            } finally {
              setBatchAdding(false);
              setBatchProgress("");
            }
          } : undefined}
          calSyncedIds={calSyncedIds}
          calSyncingIds={calSyncingIds}
          calLabel={calLabel}
          batchAdding={batchAdding}
        />
      )}

      {searched && !loading && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-gray-900">
                {existingResults.length > 0 && newResults.length > 0
                  ? `${existingResults.length} Previous Result${existingResults.length !== 1 ? "s" : ""}`
                  : `${results.length} Result${results.length !== 1 ? "s" : ""} Found`}
              </h2>
              {results.length > 0 && (
                <button
                  onClick={exportResultsCsv}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-gray-600 text-white hover:bg-gray-700 transition-colors"
                  title="Export all results to CSV"
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
                {anySynced && calendarProvider && (
                  <button
                    onClick={handleRemoveAllFromCalendar}
                    disabled={batchRemoving || batchAdding}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed bg-red-600 text-white hover:bg-red-700 transition-colors"
                    title={`Remove all synced events from ${providerLabels[calendarProvider] || "Calendar"}`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    {batchRemoving ? batchProgress : `Remove All from ${providerLabels[calendarProvider] || "Calendar"}`}
                  </button>
                )}
                <button
                  onClick={calendarProvider ? handleAddAllAndAutoUpdate : () => navigate("/calendar-settings")}
                  disabled={batchAdding || batchRemoving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 text-white hover:bg-green-700 transition-colors"
                  title={calendarProvider ? `Add all events to ${providerLabels[calendarProvider] || "Calendar"} and auto-update when changes are found` : "Connect a calendar first"}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {batchAdding
                    ? batchProgress
                    : `Add All & Auto-Update ${calendarProvider ? providerLabels[calendarProvider] || "Calendar" : "Calendar"}`}
                </button>
                <button
                  onClick={calendarProvider ? handleAddAllToCalendar : () => navigate("/calendar-settings")}
                  disabled={batchAdding || allSynced || batchRemoving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                  title={allSynced ? "All events already added" : calendarProvider ? `Add all ${results.length} events to ${providerLabels[calendarProvider] || "Calendar"} (no auto-updates)` : "Connect a calendar to add events"}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {batchAdding
                    ? batchProgress
                    : allSynced
                      ? "All Added"
                      : "Add All Only"}
                </button>
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
                      <tr key={event.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                          <div className={isLocked ? "blur-sm select-none" : ""}>{formatDate(event.eventDate)}</div>
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
                            ) : calendarProvider ? (
                              <>
                                {calSyncedIds.has(event.id) ? (
                                  <button
                                    onClick={() => handleRemoveFromCalendar(event)}
                                    disabled={calRemovingIds.has(event.id)}
                                    className="p-1.5 rounded-md text-green-600 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors group"
                                    title={calRemovingIds.has(event.id) ? "Removing..." : `Remove from ${providerLabels[calendarProvider] || "Calendar"}`}
                                  >
                                    {calRemovingIds.has(event.id) ? (
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
                                    disabled={calSyncingIds.has(event.id)}
                                    className="p-1.5 rounded-md text-gray-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-50 transition-colors"
                                    title={calSyncingIds.has(event.id) ? "Adding..." : `Add to ${providerLabels[calendarProvider] || "Calendar"}`}
                                  >
                                    {calSyncingIds.has(event.id) ? (
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

      {showMonitorModal && (
        <MonitorModal
          monitoringInProgress={monitoringInProgress}
          onConfirm={handleMonitorConfirm}
          onCancel={() => setShowMonitorModal(false)}
        />
      )}
    </div>
  );
}
