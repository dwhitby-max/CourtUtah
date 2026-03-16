import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSearch } from "@/hooks/useSearch";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";
import { addEventToCalendar, getCalendarConnections, getSyncedEvents, removeEventFromCalendar } from "@/api/calendar";
import { CourtEvent } from "@shared/types";

const providerLabels: Record<string, string> = {
  google: "Google Calendar",
  microsoft: "Outlook",
  apple: "iCloud",
  caldav: "CalDAV",
};

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

  async function handleWatchAndSync(event: CourtEvent) {
    const searchType = event.caseNumber ? "case_number" : "defendant_name";
    const searchValue = event.caseNumber || event.defendantName || "Unknown";
    const label = `${event.caseNumber || "Unknown Case"} - ${event.defendantName || "Unknown"} (${event.courtName})`;

    setWatchingIds((prev) => new Set(prev).add(event.id));

    try {
      const res = await apiFetch("/watched-cases", {
        method: "POST",
        body: JSON.stringify({ searchType, searchValue, label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const { initialSearch } = data;
      if (initialSearch && initialSearch.newEntries > 0) {
        setWatchSuccess(`Added "${label}" to watched cases and synced ${initialSearch.newEntries} event(s) to your calendar.`);
      } else if (initialSearch && initialSearch.eventsFound > 0) {
        setWatchSuccess(`Added "${label}" to watched cases. ${initialSearch.eventsFound} event(s) found — connect a calendar in Calendar Settings to sync.`);
      } else {
        setWatchSuccess(`Added "${label}" to watched cases. Future events will be tracked automatically.`);
      }
      setWatchError("");
    } catch (err) {
      setWatchError(err instanceof Error ? err.message : "Failed to add watched case");
      setWatchSuccess("");
    } finally {
      setWatchingIds((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
    }
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
    // Already YYYY-MM-DD from parser or DB
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, m, d] = match;
      return `${parseInt(m)}/${parseInt(d)}/${y}`;
    }
    return dateStr;
  }

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

      {searched && !loading && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              {results.length} Result{results.length !== 1 ? "s" : ""} Found
            </h2>
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
                        <td className="px-4 py-3 text-sm space-y-1">
                          {isLoggedIn && (
                            <>
                              {calSyncedIds.has(event.id) ? (
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
                                        &#10003; Added to {calendarProvider ? providerLabels[calendarProvider] || "Calendar" : "Calendar"}
                                      </span>
                                      <span className="hidden group-hover:inline">
                                        Remove from {calendarProvider ? providerLabels[calendarProvider] || "Calendar" : "Calendar"}
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
                                  {calSyncingIds.has(event.id)
                                    ? "Adding..."
                                    : `Add to ${calendarProvider ? providerLabels[calendarProvider] || "Calendar" : "Calendar"}`}
                                </button>
                              )}
                              <button
                                onClick={() => handleWatchAndSync(event)}
                                disabled={watchingIds.has(event.id)}
                                className="text-gray-500 hover:text-gray-700 text-xs block disabled:opacity-50"
                              >
                                {watchingIds.has(event.id) ? "Syncing..." : "Watch & Auto-Sync"}
                              </button>
                            </>
                          )}
                          {!isLoggedIn && (
                            <button
                              onClick={() => navigate("/login")}
                              className="text-amber-700 hover:text-slate-800 text-sm font-medium block"
                            >
                              Log in to track
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
