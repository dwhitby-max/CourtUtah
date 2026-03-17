interface MonitorModalProps {
  monitoringInProgress: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function MonitorModal({ monitoringInProgress, onConfirm, onCancel }: MonitorModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
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
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            No Thanks
          </button>
          <button
            onClick={onConfirm}
            disabled={monitoringInProgress}
            className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50"
          >
            {monitoringInProgress ? "Setting Up..." : "Yes, Monitor"}
          </button>
        </div>
      </div>
    </div>
  );
}
