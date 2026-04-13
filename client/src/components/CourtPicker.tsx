import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/api/client";

interface Court {
  name: string;
  type: "DistrictCourt" | "JusticeCourt";
  locationCode: string;
}

export interface CourtPickerProps {
  selected: string[];
  onChange: (selected: string[]) => void;
  allCourts?: boolean;
  onAllCourtsChange?: (checked: boolean) => void;
}

export default function CourtPicker({ selected, onChange, allCourts = false, onAllCourtsChange }: CourtPickerProps) {
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch("/search/courts")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Court[]) => setCourts(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filterLower = filter.toLowerCase();
  const filtered = (filter
    ? courts.filter((c) => c.name.toLowerCase().includes(filterLower))
    : courts
  ).sort((a, b) => a.name.localeCompare(b.name));

  function toggle(name: string) {
    if (selected.includes(name)) {
      onChange(selected.filter((n) => n !== name));
    } else {
      onChange([...selected, name]);
    }
  }

  function clearAll() {
    onChange([]);
  }

  function handleAllCourtsToggle() {
    const next = !allCourts;
    onAllCourtsChange?.(next);
    if (next) {
      // Clear individual selections when "All Courts" is checked
      onChange([]);
    }
  }

  const buttonLabel = allCourts
    ? "All Courts"
    : selected.length === 0
      ? "Select courts..."
      : selected.length <= 2
        ? selected.join(", ")
        : `${selected.length} courts selected`;

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Court Location
      </label>

      {/* All Courts checkbox */}
      <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allCourts}
          onChange={handleAllCourtsToggle}
          className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
        />
        <span className="text-sm text-gray-700">All Courts</span>
      </label>

      {/* Court picker dropdown — disabled when All Courts is checked */}
      <button
        type="button"
        onClick={() => !allCourts && setOpen(!open)}
        disabled={allCourts}
        className={`w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-left flex items-center justify-between ${
          allCourts
            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
            : "bg-white hover:bg-gray-50 focus:ring-amber-500 focus:border-amber-500"
        }`}
      >
        <span className={allCourts || selected.length === 0 ? "text-gray-400" : "text-gray-900"}>
          {buttonLabel}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!allCourts && selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {selected.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full"
            >
              {name}
              <button
                type="button"
                onClick={() => toggle(name)}
                className="hover:text-amber-600"
              >
                &times;
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-gray-500 hover:text-gray-700 underline ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {open && !allCourts && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-72 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-gray-200">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search courts..."
              autoFocus
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-amber-500 focus:border-amber-500"
            />
          </div>

          <div className="overflow-y-auto flex-1">
            {loading && (
              <p className="p-3 text-sm text-gray-500">Loading courts...</p>
            )}

            {!loading && filtered.length === 0 && (
              <p className="p-3 text-sm text-gray-500">No courts match &quot;{filter}&quot;</p>
            )}

            {filtered.map((court) => (
              <label
                key={court.locationCode}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-amber-50 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(court.name)}
                  onChange={() => toggle(court.name)}
                  className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                />
                {court.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
