import { useEffect, useState, useCallback, useRef } from "react";
import { getChangesFeed, markChangesSeen, ChangeFeedItem } from "@/api/notifications";

interface ChangesFeedSectionProps {
  /** Trigger re-fetch when results change */
  refreshKey: number;
}

export default function ChangesFeedSection({ refreshKey }: ChangesFeedSectionProps) {
  const [changes, setChanges] = useState<ChangeFeedItem[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const seenRef = useRef(false);

  const fetchChanges = useCallback(async () => {
    try {
      const items = await getChangesFeed();
      setChanges(items);
      seenRef.current = false;
      setDismissed(false);
    } catch (err) {
      console.error("Failed to fetch changes feed:", err);
    }
  }, []);

  useEffect(() => {
    fetchChanges();
  }, [fetchChanges, refreshKey]);

  // Mark as seen when user has viewed them (after 3 seconds of visibility)
  useEffect(() => {
    if (changes.length === 0 || seenRef.current || dismissed) return;
    const timer = setTimeout(() => {
      const ids = changes.map(c => c.id);
      markChangesSeen(ids).catch(console.error);
      seenRef.current = true;
    }, 3000);
    return () => clearTimeout(timer);
  }, [changes, dismissed]);

  function handleDismissAll() {
    const ids = changes.map(c => c.id);
    markChangesSeen(ids).catch(console.error);
    setDismissed(true);
  }

  function handleDismissOne(id: number) {
    markChangesSeen([id]).catch(console.error);
    setChanges(prev => prev.filter(c => c.id !== id));
  }

  if (dismissed || changes.length === 0) return null;

  const cancelled = changes.filter(c => c.type === "event_cancelled");
  const modified = changes.filter(c => c.type === "schedule_change");
  const newMatches = changes.filter(c => c.type === "new_match");

  return (
    <div className="space-y-3">
      {/* Cancellations — red */}
      {cancelled.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg overflow-hidden">
          <div className="px-6 py-3 border-b border-red-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              <h3 className="text-base font-semibold text-red-800">
                Possibly Cancelled ({cancelled.length})
              </h3>
            </div>
          </div>
          <div className="divide-y divide-red-100">
            {cancelled.map(item => (
              <ChangeItem key={item.id} item={item} onDismiss={handleDismissOne} />
            ))}
          </div>
        </div>
      )}

      {/* Modifications — amber */}
      {modified.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
          <div className="px-6 py-3 border-b border-amber-200 flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-base font-semibold text-amber-800">
              Schedule Changes ({modified.length})
            </h3>
          </div>
          <div className="divide-y divide-amber-100">
            {modified.map(item => (
              <ChangeItem key={item.id} item={item} onDismiss={handleDismissOne} />
            ))}
          </div>
        </div>
      )}

      {/* New matches — blue */}
      {newMatches.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg overflow-hidden">
          <div className="px-6 py-3 border-b border-blue-200 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <h3 className="text-base font-semibold text-blue-800">
              New Hearings Added ({newMatches.length})
            </h3>
          </div>
          <div className="divide-y divide-blue-100">
            {newMatches.map(item => (
              <ChangeItem key={item.id} item={item} onDismiss={handleDismissOne} />
            ))}
          </div>
        </div>
      )}

      {changes.length > 1 && (
        <div className="flex justify-end">
          <button
            onClick={handleDismissAll}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Dismiss all
          </button>
        </div>
      )}
    </div>
  );
}

function ChangeItem({ item, onDismiss }: { item: ChangeFeedItem; onDismiss: (id: number) => void }) {
  const meta = item.metadata;

  return (
    <div className="px-6 py-3 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-gray-900 text-sm">{item.title}</div>
        <div className="text-sm text-gray-600 mt-0.5">{item.message}</div>
        {item.type === "schedule_change" && meta.changes && (
          <div className="mt-1 space-y-0.5">
            {(meta.changes as Array<{ field: string; oldValue: string; newValue: string }>).map((c, i) => (
              <div key={i} className="text-xs text-amber-700">
                <span className="font-medium">{c.field.replace(/_/g, " ")}:</span>{" "}
                <span className="line-through text-gray-400">{c.oldValue}</span>
                {" → "}
                <span className="font-medium">{c.newValue}</span>
              </div>
            ))}
          </div>
        )}
        {item.type === "event_cancelled" && (
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-red-600">
            {meta.eventDate && <span>{meta.eventDate as string}</span>}
            {meta.eventTime && <span>{meta.eventTime as string}</span>}
            {meta.courtName && <span>{meta.courtName as string}</span>}
          </div>
        )}
        <div className="text-xs text-gray-400 mt-1">
          {new Date(item.created_at).toLocaleString()}
        </div>
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        className="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        title="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
