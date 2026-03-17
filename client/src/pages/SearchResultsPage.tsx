import { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSearch } from "@/hooks/useSearch";
import { apiFetch } from "@/api/client";
import { addEventToCalendar, addAllEventsToCalendar, getCalendarConnections, getSyncedEvents, removeEventFromCalendar } from "@/api/calendar";
import UpdatesSection from "@/components/UpdatesSection";
import MonitorModal from "@/components/MonitorModal";
import { CourtEvent } from "@shared/types";
import { ChangeRecord } from "@/components/UpdatesSection";

const providerLabels: Record<string, string> = {
  google: "Google Calendar",
  microsoft: "Outlook",
  apple: "iCloud",
  caldav: "CalDAV",
};

export default function SearchResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { results, searched, loading, error, search } = useSearch();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [watchSuccess, setWatchSuccess] = useState("");
  const [watchError, setWatchError] = useState("");
  const [calSyncingIds, setCalSyncingIds] = useState<Set<number>>(new Set());
  const [calSyncedIds, setCalSyncedIds] = useState<Set<number>>(new Set());
  const [calEntryMap, setCalEntryMap] = useState<Record<number, number>>({});
  const [calRemovingIds, setCalRemovingIds] = useState<Set<number>>(new Set());
  const [calendarProvider, setCalendarProvider] = useState<string | null>(null);

  // Batch add state
  const [batchAdding, setBatchAdding] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");

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

  async function handleMonitorConfirm() {
    setMonitoringInProgress(true);

    // Create watched cases for unique defendants and case numbers in results
    const seen = new Set<string>();
    const watchRequests: Array<{ searchType: string; searchValue: string; label: string }> = [];

    for (const event of results) {
      if (event.caseNumber) {
        const key = `case_number:${event.caseNumber}`;
        if (!seen.has(key)) {
          seen.add(key);
          watchRequests.push({
            searchType: "case_number",
            searchValue: event.caseNumber,
            label: `${event.caseNumber} - ${event.defendantName || "Unknown"} (${event.courtName})`,
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
      setWatchSuccess(`Monitoring ${successCount} case${successCount !== 1 ? "s" : ""} for updates. You'll be notified by email of any changes.`);
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

      {searched && !loading && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {results.length} Result{results.length !== 1 ? "s" : ""} Found
            </h2>
            {results.length > 0 && calendarProvider && (
              <button
                onClick={handleAddAllToCalendar}
                disabled={batchAdding || allSynced}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                title={allSynced ? "All events already added" : `Add all ${results.length} events to ${providerLabels[calendarProvider] || "Calendar"}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {batchAdding
                  ? batchProgress
                  : allSynced
                    ? "All Added"
                    : `Add All to ${providerLabels[calendarProvider] || "Calendar"}`}
              </button>
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
                  {results.map((event) => (
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
                        <td className="px-4 py-3 text-sm">
                          <div className="flex items-center gap-2">
                            {calendarProvider ? (
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
