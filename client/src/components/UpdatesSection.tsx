interface ChangeRecord {
  courtEventId: number;
  caseNumber: string | null;
  defendantName: string | null;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

interface UpdatesSectionProps {
  updates: ChangeRecord[];
  onDismissUpdate: (courtEventId: number) => void;
}

function formatFieldName(field: string): string {
  return field.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function UpdatesSection({ updates, onDismissUpdate }: UpdatesSectionProps) {
  if (updates.length === 0) return null;

  return (
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
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">
                  {update.caseNumber || "Unknown Case"} - {update.defendantName || "Unknown"}
                </span>
                <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Calendar updated
                </span>
              </div>
              <div className="text-sm text-amber-700 mt-1">
                <span className="font-medium">{formatFieldName(update.fieldChanged)}:</span>{" "}
                <span className="line-through text-gray-400">{update.oldValue || "N/A"}</span>
                {" → "}
                <span className="font-medium text-amber-900">{update.newValue || "N/A"}</span>
              </div>
            </div>
            <button
              onClick={() => onDismissUpdate(update.courtEventId)}
              className="ml-4 shrink-0 p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export type { ChangeRecord };
