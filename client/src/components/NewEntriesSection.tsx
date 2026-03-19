import { CourtEvent } from "@shared/types";

interface NewEntriesSectionProps {
  events: CourtEvent[];
  formatDate: (dateStr: string) => string;
  onAddToCalendar?: (event: CourtEvent) => void;
  calSyncedIds?: Set<number>;
  calSyncingIds?: Set<number>;
  calLabel?: string;
}

export default function NewEntriesSection({
  events,
  formatDate,
  onAddToCalendar,
  calSyncedIds,
  calSyncingIds,
  calLabel = "Calendar",
}: NewEntriesSectionProps) {
  if (events.length === 0) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-blue-200 flex items-center gap-2">
        <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        <h2 className="text-lg font-semibold text-blue-800">
          New Since Last Search ({events.length})
        </h2>
      </div>
      <div className="divide-y divide-blue-100">
        {events.map((event) => (
          <div key={event.id} className="px-6 py-3 flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-900">
                  {event.caseNumber || "Unknown Case"} - {event.defendantName || "Unknown"}
                </span>
                <span className="inline-flex items-center text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  New
                </span>
                {event.isVirtual && (
                  <span className="inline-flex items-center text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    Virtual
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 mt-1">
                <span>{formatDate(event.eventDate)} {event.eventTime || "TBD"}</span>
                <span>{event.courtName}</span>
                {event.hearingType && <span>{event.hearingType}</span>}
                {event.judgeName && <span>Judge: {event.judgeName}</span>}
              </div>
            </div>
            {onAddToCalendar && calSyncedIds && !calSyncedIds.has(event.id) && (
              <button
                onClick={() => onAddToCalendar(event)}
                disabled={calSyncingIds?.has(event.id)}
                className="ml-4 shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {calSyncingIds?.has(event.id) ? "Adding..." : `Add to ${calLabel}`}
              </button>
            )}
            {calSyncedIds?.has(event.id) && (
              <span className="ml-4 shrink-0 inline-flex items-center gap-1 text-sm text-green-700">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Added
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
