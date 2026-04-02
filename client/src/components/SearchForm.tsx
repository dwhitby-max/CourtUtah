import { useState, useEffect } from "react";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/store/authStore";
import CourtPicker from "./CourtPicker";

interface SearchFormProps {
  onSearch: (params: Record<string, string>) => void;
  loading?: boolean;
  hasCalendarConnection?: boolean;
  initialAutoAdd?: boolean;
}

export default function SearchForm({ onSearch, loading, hasCalendarConnection, initialAutoAdd }: SearchFormProps) {
  const { user } = useAuth();
  const isPro = user?.subscriptionPlan === "pro" && (user?.subscriptionStatus === "active" || user?.subscriptionStatus === "grandfathered");
  const [defendantName, setDefendantName] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [selectedCourts, setSelectedCourts] = useState<string[]>(
    () => user?.searchPreferences?.defaultCourts ?? []
  );
  const [allCourts, setAllCourts] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [defendantOtn, setDefendantOtn] = useState("");
  const [citationNumber, setCitationNumber] = useState("");
  const [charges, setCharges] = useState("");
  const [judgeName, setJudgeName] = useState("");
  const [attorney, setAttorney] = useState("");
  const [autoAddToCalendar, setAutoAddToCalendar] = useState(initialAutoAdd ?? false);
  const [watchedCase, setWatchedCase] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [coverage, setCoverage] = useState<{
    totalEvents: number;
    totalCourts: number;
    earliestDate: string | null;
    latestDate: string | null;
  } | null>(null);

  useEffect(() => {
    apiFetch("/search/coverage")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setCoverage(data); })
      .catch(() => {});
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError("");

    // At least one search field is required (courts and dates alone are not enough)
    const hasSearchField = !!(
      defendantName || caseNumber || defendantOtn ||
      citationNumber || charges || judgeName || attorney
    );
    if (!hasSearchField) {
      setValidationError("Please enter at least one search field (defendant name, case number, OTN, citation, charges, judge, or attorney).");
      return;
    }

    const params: Record<string, string> = {};
    if (defendantName) params.defendant_name = defendantName;
    if (caseNumber) params.case_number = caseNumber;
    if (allCourts) {
      params.all_courts = "true";
    } else if (selectedCourts.length > 0) {
      params.court_names = selectedCourts.join(",");
    }
    // Watched case searches ignore dates — they search all available dates (up to 4 weeks)
    if (!watchedCase) {
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
    }
    if (defendantOtn) params.defendant_otn = defendantOtn;
    if (citationNumber) params.citation_number = citationNumber;
    if (charges) params.charges = charges;
    if (judgeName) params.judge_name = judgeName;
    if (attorney) params.attorney = attorney;

    if (autoAddToCalendar) params._autoAddToCalendar = "true";
    if (watchedCase) params._watchedCase = "true";
    onSearch(params);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Search Court Calendars</h2>

      {coverage && coverage.totalEvents > 0 && (
        <p className="text-sm text-gray-500 mb-4">
          {coverage.totalEvents.toLocaleString()} events across {coverage.totalCourts} courts
          {coverage.earliestDate && coverage.latestDate && (
            <> &middot; {coverage.earliestDate} to {coverage.latestDate}</>
          )}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Defendant Name</label>
          <input
            type="text"
            value={defendantName}
            onChange={(e) => setDefendantName(e.target.value)}
            placeholder="e.g. MARTINEZ"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Case Number</label>
          <input
            type="text"
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
            placeholder="e.g. SLC 161901292"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <div>
          <CourtPicker
            selected={selectedCourts}
            onChange={setSelectedCourts}
            allCourts={allCourts}
            onAllCourtsChange={setAllCourts}
          />
        </div>

        {!watchedCase && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  // Free plan: auto-cap dateTo to 7 days from dateFrom
                  if (!isPro && e.target.value) {
                    const maxDate = new Date(e.target.value);
                    maxDate.setDate(maxDate.getDate() + 7);
                    const maxStr = maxDate.toISOString().split("T")[0];
                    if (dateTo && dateTo > maxStr) setDateTo(maxStr);
                  }
                }}
                max={dateTo || undefined}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date To
                {!isPro && <span className="text-xs text-gray-400 ml-1">(max 1 week)</span>}
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                min={dateFrom || undefined}
                max={!isPro && dateFrom
                  ? new Date(new Date(dateFrom).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
                  : undefined}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
              />
            </div>
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Offender Tracking # (OTN)</label>
          <input
            type="text"
            value={defendantOtn}
            onChange={(e) => setDefendantOtn(e.target.value)}
            placeholder="e.g. 43333145"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Citation Number</label>
          <input
            type="text"
            value={citationNumber}
            onChange={(e) => setCitationNumber(e.target.value)}
            placeholder="e.g. 49090509"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Charges</label>
          <input
            type="text"
            value={charges}
            onChange={(e) => setCharges(e.target.value)}
            placeholder="e.g. assault, 76-5-103"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Judge Name</label>
          <input
            type="text"
            value={judgeName}
            onChange={(e) => setJudgeName(e.target.value)}
            placeholder="e.g. MCCULLAGH"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Attorney</label>
          <input
            type="text"
            value={attorney}
            onChange={(e) => setAttorney(e.target.value)}
            placeholder="e.g. FOWLER or bar number"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>
      </div>

      {validationError && (
        <p className="mt-3 text-sm text-red-600">{validationError}</p>
      )}

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <button
          type="submit"
          disabled={loading}
          className="bg-amber-700 text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Searching..." : "Search"}
        </button>

        <label className="flex items-center gap-2 cursor-pointer select-none group relative">
          <input
            type="checkbox"
            checked={watchedCase}
            onChange={(e) => {
              if (!isPro && e.target.checked) {
                setValidationError("Watched Case is a Pro feature. Upgrade to continuously monitor searches and get notified of new hearings.");
                return;
              }
              setWatchedCase(e.target.checked);
            }}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-700 font-medium">Watched Case</span>
          <span className="relative">
            <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 px-3 py-2 text-xs text-white bg-gray-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              Continuously monitors this search daily for up to 4 weeks out. You'll be notified by email of new hearings, schedule changes, and cancellations. Pro plan allows up to 5 watched cases.
              {!isPro && <span className="block mt-1 text-amber-300 font-medium">Pro plan only</span>}
            </span>
          </span>
          {watchedCase && (
            <span className="text-xs text-indigo-600">(searches all dates up to 4 weeks, refreshes daily)</span>
          )}
        </label>

        {hasCalendarConnection && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div className="relative">
              <input
                type="checkbox"
                checked={autoAddToCalendar}
                onChange={(e) => setAutoAddToCalendar(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors"></div>
              <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform"></div>
            </div>
            <span className="text-sm text-gray-700 font-medium">Auto-add results to calendar</span>
          </label>
        )}
      </div>
    </form>
  );
}
