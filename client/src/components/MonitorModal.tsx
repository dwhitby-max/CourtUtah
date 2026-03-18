import { useState } from "react";

interface MonitorModalProps {
  monitoringInProgress: boolean;
  onConfirm: (options: { monitorChanges: boolean; autoAddNew: boolean }) => void;
  onCancel: () => void;
}

export default function MonitorModal({ monitoringInProgress, onConfirm, onCancel }: MonitorModalProps) {
  const [monitorChanges, setMonitorChanges] = useState(true);
  const [autoAddNew, setAutoAddNew] = useState(false);

  const neitherSelected = !monitorChanges && !autoAddNew;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Keep Track of These Hearings?</h3>
        </div>

        <div className="space-y-4 mb-6">
          <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50/50 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={monitorChanges}
              onChange={(e) => setMonitorChanges(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-900">
                Do you want to sync any changes from the courts that we find?
              </span>
              <p className="text-xs text-gray-500 mt-1">
                We'll monitor these hearings for schedule changes (date, time, courtroom, judge, etc.),
                automatically update your calendar, and notify you by email.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50/50 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={autoAddNew}
              onChange={(e) => setAutoAddNew(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-900">
                Do you want to auto update new hearings to your calendar when we find them?
              </span>
              <p className="text-xs text-gray-500 mt-1">
                When new hearings are found for these cases, we'll automatically add them to your calendar,
                keep monitoring for changes, and notify you of any updates.
              </p>
            </div>
          </label>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            No Thanks
          </button>
          <button
            onClick={() => onConfirm({ monitorChanges, autoAddNew })}
            disabled={monitoringInProgress || neitherSelected}
            className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50"
            title={neitherSelected ? "Select at least one option" : ""}
          >
            {monitoringInProgress ? "Setting Up..." : "Save Preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}
