import { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSearch } from "@/hooks/useSearch";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";
import { addEventToCalendar, addAllEventsToCalendar, getCalendarConnections, getSyncedEvents, removeEventFromCalendar } from "@/api/calendar";
import { CourtEvent } from "@shared/types";

const providerLabels: Record<string, string> = {
  google: "Google Calendar",
  microsoft: "Outlook",
  apple: "iCloud",
  caldav: "CalDAV",
};

interface ChangeRecord {
  courtEventId: number;
  caseNumber: string | null;
  defendantName: string | null;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

export default function SearchResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const { results, searched, loading, error, search } = useSearch();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [watchSuccess, setWatchSuccess] = useState("");
  const [watchError, setWatchError] = useState("");
  const [watchingIds, setWatchingIds] = useState<Set<number>>(new Set());
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
  const [updatesLoading, setUpdatesLoading] = useState(false);

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
    if (isLoggedIn) {
      getCalendarConnections()
        .then(data => {
          const active = (data.connections as Array<{ provider: string; is_active: boolean }>)
            .find(c => c.is_active);
          setCalendarProvider(active?.provider ?? null);
        })
        .catch(() => {});
      getSyncedEvents()
        .then(synced => {
          setCalEntryMap(synced);
          setCalSyncedIds(new Set(Object.keys(synced).map(Number)));
        })
        .catch(() => {});
    }
  }, [isLoggedIn]);

  // Fetch updates (changes detected for events in current results)
  const fetchUpdates = useCallback(async () => {
    if (!isLoggedIn || results.length === 0) return;
    setUpdatesLoading(true);
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
    } catch {
      // Non-critical - silently ignore
    } finally {
      setUpdatesLoading(false);
    }
  }, [isLoggedIn, results]);

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
      } catch {
        // Continue with remaining watches
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

  async function handleConfirmUpdate(courtEventId: number) {
    const entryId = calEntryMap[courtEventId];
    if (!entryId) return;

    try {
      const res = await apiFetch(`/watched-cases/confirm-update/${entryId}`, { method: "POST" });
      if (res.ok) {
        setUpdates(prev => prev.filter(u => u.courtEventId !== courtEventId));
        setWatchSuccess("Calendar updated with latest changes.");
      }
    } catch {
      setWatchError("Failed to confirm update.");
    }
  }

  async function handleDismissUpdate(courtEventId: number) {
    const entryId = calEntryMap[courtEventId];
    if (!entryId) return;

    try {
      const res = await apiFetch(`/watched-cases/dismiss-update/${entryId}`, { method: "POST" });
      if (res.ok) {
        setUpdates(prev => prev.filter(u => u.courtEventId !== courtEventId));
      }
    } catch {
      setWatchError("Failed to dismiss update.");
    }
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

  function formatFieldName(field: string): string {
    return field.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
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

      {/* Updates Section */}
      {updates.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-amber-200 flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-lg font-semibold text-amber-800">
              Updated ({updates.length})
            </h2>
          </div>
          <div className="divide-y divide-amber-100">
            {updates.map((update, idx) => (
              <div key={idx} className="px-6 py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900">
                    {update.caseNumber || "Unknown Case"} - {update.defendantName || "Unknown"}
                  </div>
                  <div className="text-sm text-amber-700 mt-1">
                    <span className="font-medium">{formatFieldName(update.fieldChanged)}:</span>{" "}
                    <span className="line-through text-gray-400">{update.oldValue || "N/A"}</span>
                    {" → "}
                    <span className="font-medium text-amber-900">{update.newValue || "N/A"}</span>
                  </div>
                </div>
                <div className="flex gap-2 ml-4 shrink-0">
                  <button
                    onClick={() => handleConfirmUpdate(update.courtEventId)}
                    className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700"
                  >
                    Update Calendar
                  </button>
                  <button
                    onClick={() => handleDismissUpdate(update.courtEventId)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {searched && !loading && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {results.length} Result{results.length !== 1 ? "s" : ""} Found
            </h2>
            {isLoggedIn && results.length > 0 && calendarProvider && (
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
                            {isLoggedIn && calendarProvider && (
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
                            )}
                            {isLoggedIn && !calendarProvider && (
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
                            {!isLoggedIn && (
                              <button
                                onClick={() => navigate("/login")}
                                className="text-amber-700 hover:text-slate-800 text-xs font-medium"
                              >
                                Log in to track
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

      {/* Monitor Hearings Modal */}
      {showMonitorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowMonitorModal(false)} />
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Monitor These Hearings?</h3>
            </div>
            <p className="text-gray-600 text-sm mb-6">
              Would you like to automatically monitor these hearings for schedule changes?
              If anything changes (date, time, courtroom, judge, etc.), we'll update your calendar
              and notify you by email.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowMonitorModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                No Thanks
              </button>
              <button
                onClick={handleMonitorConfirm}
                disabled={monitoringInProgress}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50"
              >
                {monitoringInProgress ? "Setting Up..." : "Yes, Monitor"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
