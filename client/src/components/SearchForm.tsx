import { useState } from "react";

interface SearchFormProps {
  onSearch: (params: Record<string, string>) => void;
  loading?: boolean;
}

export default function SearchForm({ onSearch, loading }: SearchFormProps) {
  const [defendantName, setDefendantName] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [courtName, setCourtName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [defendantOtn, setDefendantOtn] = useState("");
  const [citationNumber, setCitationNumber] = useState("");
  const [charges, setCharges] = useState("");
  const [judgeName, setJudgeName] = useState("");
  const [attorney, setAttorney] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params: Record<string, string> = {};
    if (defendantName) params.defendant_name = defendantName;
    if (caseNumber) params.case_number = caseNumber;
    if (courtName) params.court_name = courtName;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (defendantOtn) params.defendant_otn = defendantOtn;
    if (citationNumber) params.citation_number = citationNumber;
    if (charges) params.charges = charges;
    if (judgeName) params.judge_name = judgeName;
    if (attorney) params.attorney = attorney;

    if (Object.keys(params).length === 0) return;
    onSearch(params);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Search Court Calendars</h2>

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
          <label className="block text-sm font-medium text-gray-700 mb-1">Court Name</label>
          <input
            type="text"
            value={courtName}
            onChange={(e) => setCourtName(e.target.value)}
            placeholder="e.g. Salt Lake"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            max={dateTo || undefined}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            min={dateFrom || undefined}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

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

      <div className="mt-4">
        <button
          type="submit"
          disabled={loading}
          className="bg-amber-700 text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>
    </form>
  );
}
