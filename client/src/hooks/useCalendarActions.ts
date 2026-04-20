import { useState, useEffect } from "react";
import { addEventToCalendar, addAllEventsToCalendar, getCalendarConnections, getSyncedEvents, removeEventFromCalendar } from "@/api/calendar";
import { providerLabels } from "@/utils/courtEventUtils";

export function useCalendarActions() {
  const [calSyncingIds, setCalSyncingIds] = useState<Set<number>>(new Set());
  const [calSyncedIds, setCalSyncedIds] = useState<Set<number>>(new Set());
  const [calEntryMap, setCalEntryMap] = useState<Record<number, number>>({});
  const [calRemovingIds, setCalRemovingIds] = useState<Set<number>>(new Set());
  const [calendarProvider, setCalendarProvider] = useState<string | null>(null);
  const [hasCalendarConnection, setHasCalendarConnection] = useState(true);

  useEffect(() => {
    getCalendarConnections()
      .then(data => {
        const active = (data.connections as Array<{ provider: string; is_active: boolean }>)
          .find(c => c.is_active);
        setCalendarProvider(active?.provider ?? null);
        setHasCalendarConnection(!!active);
      })
      .catch(() => setHasCalendarConnection(false));

    getSyncedEvents()
      .then(synced => {
        setCalEntryMap(synced);
        setCalSyncedIds(new Set(Object.keys(synced).map(Number)));
      })
      .catch(() => {});
  }, []);

  const calLabel = calendarProvider ? providerLabels[calendarProvider] || "Calendar" : "Calendar";

  async function handleAddToCalendar(eventId: number, savedSearchId?: number | null): Promise<{ message: string; calendarEntryId: number }> {
    setCalSyncingIds(prev => new Set(prev).add(eventId));
    try {
      const data = await addEventToCalendar(eventId, savedSearchId);
      setCalSyncedIds(prev => new Set(prev).add(eventId));
      setCalEntryMap(prev => ({ ...prev, [eventId]: data.calendarEntryId }));
      return data;
    } finally {
      setCalSyncingIds(prev => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
    }
  }

  async function handleRemoveFromCalendar(eventId: number): Promise<void> {
    const entryId = calEntryMap[eventId];
    if (!entryId) return;

    setCalRemovingIds(prev => new Set(prev).add(eventId));
    try {
      await removeEventFromCalendar(entryId);
      setCalSyncedIds(prev => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
      setCalEntryMap(prev => {
        const next = { ...prev };
        delete next[eventId];
        return next;
      });
    } finally {
      setCalRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
    }
  }

  async function handleBatchAdd(eventIds: number[], savedSearchId?: number | null): Promise<{ results: Array<{ courtEventId: number; calendarEntryId: number; synced: boolean }>; message: string }> {
    const data = await addAllEventsToCalendar(eventIds, savedSearchId);
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
    return data;
  }

  async function refreshSyncedEvents(): Promise<Set<number>> {
    try {
      const synced = await getSyncedEvents();
      setCalEntryMap(synced);
      const ids = new Set(Object.keys(synced).map(Number));
      setCalSyncedIds(ids);
      return ids;
    } catch {
      setCalSyncedIds(new Set());
      return new Set();
    }
  }

  return {
    calSyncingIds, calSyncedIds, calEntryMap, calRemovingIds,
    calendarProvider, hasCalendarConnection, calLabel,
    handleAddToCalendar, handleRemoveFromCalendar,
    handleBatchAdd, refreshSyncedEvents,
  };
}
