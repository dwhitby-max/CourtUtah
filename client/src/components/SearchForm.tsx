import { useState, useEffect } from "react";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/store/authStore";
import CourtPicker from "./CourtPicker";

interface SearchFormProps {
  onSearch: (params: Record<string, string>) => void;
  loading?: boolean;
}

export default function SearchForm({ onSearch, loading }: SearchFormProps) {
  const { user } = useAuth();
  const isPro = user?.subscriptionPlan === "pro" && (user?.subscriptionStatus === "active" || user?.subscriptionStatus === "grandfathered");
  const isIndividualAttorney = user?.accountType === "individual_attorney";
  const isAgency = user?.accountType === "agency";
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

    // Require explicit court selection to prevent accidental all-court searches
    if (!allCourts && selectedCourts.length === 0) {
      setValidationError("Please select one or more courts, or check \"All Courts\" to search everywhere.");
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
    // Individual attorneys: always search all dates
    if (!isIndividualAttorney) {
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
    }
    if (defendantOtn) params.defendant_otn = defendantOtn;
    if (citationNumber) params.citation_number = citationNumber;
    if (charges) params.charges = charges;
    if (judgeName) params.judge_name = judgeName;
    if (attorney) params.attorney = attorney;

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

        {isIndividualAttorney && (
          <div className="flex items-center col-span-2">
            <span className="inline-flex items-center gap-1.5 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-md">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Searching next 30 days of court calendars
            </span>
          </div>
        )}

        {isAgency && (() => {
          // Agency: pick a week (Mon–Fri). We build a list of upcoming Mondays.
          const maxDateLimit = new Date();
          maxDateLimit.setMonth(maxDateLimit.getMonth() + 1);

          // Find the Monday of the current week (noon local to avoid DST edge cases)
          function getMondayOf(d: Date): Date {
            const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
            const day = copy.getDay();
            const diff = day === 0 ? -6 : 1 - day; // Sunday → previous Monday
            copy.setDate(copy.getDate() + diff);
            return copy;
          }

          function formatDate(d: Date): string {
            // Use local date components to avoid UTC timezone shift
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${day}`;
          }

          function formatShort(d: Date): string {
            return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }

          // Build week options: current week + next 4 weeks (up to maxDateLimit)
          const weeks: { monday: Date; friday: Date; label: string; value: string }[] = [];
          const thisMonday = getMondayOf(new Date());
          for (let i = 0; i < 5; i++) {
            const mon = new Date(thisMonday);
            mon.setDate(mon.getDate() + i * 7);
            if (mon > maxDateLimit) break;
            const fri = new Date(mon);
            fri.setDate(fri.getDate() + 4);
            weeks.push({
              monday: mon,
              friday: fri,
              label: `${formatShort(mon)} – ${formatShort(fri)}`,
              value: formatDate(mon),
            });
          }

          // Sync dateFrom/dateTo when a week is selected
          function handleWeekChange(mondayStr: string) {
            if (!mondayStr) {
              setDateFrom("");
              setDateTo("");
              return;
            }
            // Parse as local noon to avoid DST/timezone shifts
            const [y, m, d] = mondayStr.split("-").map(Number);
            const mon = new Date(y, m - 1, d, 12, 0, 0);
            const fri = new Date(y, m - 1, d + 4, 12, 0, 0);
            setDateFrom(formatDate(mon));
            setDateTo(formatDate(fri));
          }

          return (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Week
                <span className="text-xs text-gray-400 ml-1">(Mon–Fri, searched day by day)</span>
              </label>
              <select
                value={dateFrom || ""}
                onChange={(e) => handleWeekChange(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
              >
                <option value="">Select a week...</option>
                {weeks.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })()}

        {!isIndividualAttorney && !isAgency && (() => {
          // Default (legacy/unset account type): original date range picker
          // Use local date components to avoid UTC date shift near midnight (CLAUDE.md)
          const toLocalDateStr = (d: Date) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${day}`;
          };
          const maxDateLimit = new Date();
          maxDateLimit.setMonth(maxDateLimit.getMonth() + 1);
          const maxDateStr = toLocalDateStr(maxDateLimit);

          const dateToMax = (() => {
            if (!isPro && dateFrom) {
              const weekMax = toLocalDateStr(new Date(new Date(dateFrom + "T00:00:00").getTime() + 7 * 24 * 60 * 60 * 1000));
              return weekMax < maxDateStr ? weekMax : maxDateStr;
            }
            return maxDateStr;
          })();

          return (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    if (!isPro && e.target.value) {
                      const capDate = new Date(e.target.value);
                      capDate.setDate(capDate.getDate() + 7);
                      const capStr = toLocalDateStr(capDate);
                      const effectiveCap = capStr < maxDateStr ? capStr : maxDateStr;
                      if (dateTo && dateTo > effectiveCap) setDateTo(effectiveCap);
                    }
                    if (dateTo && dateTo > maxDateStr) setDateTo(maxDateStr);
                  }}
                  max={dateTo && dateTo < maxDateStr ? dateTo : maxDateStr}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date To
                  {!isPro
                    ? <span className="text-xs text-gray-400 ml-1">(max 1 week, courts publish up to 1 month)</span>
                    : <span className="text-xs text-gray-400 ml-1">(courts publish up to 1 month)</span>}
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  min={dateFrom || undefined}
                  max={dateToMax}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
            </>
          );
        })()}

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

        {isIndividualAttorney && (
          <span className="text-xs text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
            Auto-monitored — this search refreshes daily
          </span>
        )}
      </div>
    </form>
  );
}
