export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "America/Denver",
    });
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Denver",
    });
  } catch {
    return dateStr;
  }
}

export function formatSearchType(type: string): string {
  const map: Record<string, string> = {
    defendant_name: "Defendant Name",
    case_number: "Case Number",
    court_name: "Court Name",
    court_date: "Court Date",
    defendant_otn: "Offender Tracking #",
    citation_number: "Citation Number",
  };
  return map[type] || type;
}

export function formatProvider(provider: string): string {
  const map: Record<string, string> = {
    google: "Google Calendar",
    microsoft: "Microsoft Outlook",
    apple: "Apple iCloud",
    caldav: "CalDAV",
  };
  return map[provider] || provider;
}

/**
 * Extract the last name from a defendant name string.
 * Court names are typically "LAST, FIRST MIDDLE" or "FIRST MIDDLE LAST".
 */
export function extractLastName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  // "LAST, FIRST MIDDLE" format
  if (trimmed.includes(",")) {
    return trimmed.split(",")[0].trim();
  }
  // "FIRST MIDDLE LAST" format — last word is last name
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1];
}

/**
 * Sanitize a value for CSV: strip control characters, quote if needed.
 */
function csvCell(val: string | null | undefined): string {
  if (val == null) return "";
  // Remove carriage returns, replace newlines with spaces
  const s = String(val).replace(/\r/g, "").replace(/\n/g, " ").trim();
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// --- CSV Export Fields & Templates ---

export type CourtEventRow = {
  eventDate: string;
  eventTime: string | null;
  courtName: string;
  courtRoom: string | null;
  hearingLocation: string | null;
  judgeName: string | null;
  caseNumber: string | null;
  caseType: string | null;
  hearingType: string | null;
  defendantName: string | null;
  defenseAttorney: string | null;
  prosecutingAttorney: string | null;
};

export interface ExportField {
  key: string;
  label: string;
  accessor: (e: CourtEventRow) => string;
}

export const EXPORT_FIELDS: ExportField[] = [
  { key: "date", label: "Date", accessor: (e) => e.eventDate || "" },
  { key: "time", label: "Time", accessor: (e) => e.eventTime || "" },
  { key: "court", label: "Court", accessor: (e) => e.courtName || "" },
  { key: "courtRoom", label: "Court Room", accessor: (e) => e.courtRoom || "" },
  { key: "location", label: "Location", accessor: (e) => e.hearingLocation || "" },
  { key: "judge", label: "Judge", accessor: (e) => extractLastName(e.judgeName) },
  { key: "caseNumber", label: "Case Number", accessor: (e) => e.caseNumber || "" },
  { key: "caseType", label: "Case Type", accessor: (e) => e.caseType || "" },
  { key: "hearingType", label: "Hearing Type", accessor: (e) => e.hearingType || "" },
  { key: "defendant", label: "Defendant", accessor: (e) => e.defendantName || "" },
  { key: "defendantLastName", label: "Defendant Last Name", accessor: (e) => extractLastName(e.defendantName) },
  { key: "prosecutingAttorney", label: "Prosecuting Attorney", accessor: (e) => extractLastName(e.prosecutingAttorney) || "-" },
  { key: "defenseAttorney", label: "Defense Attorney", accessor: (e) => {
    // Guard: if defense is the same as prosecution, it's corrupt data — show blank
    const def = extractLastName(e.defenseAttorney);
    const pros = extractLastName(e.prosecutingAttorney);
    if (def && pros && def.toUpperCase() === pros.toUpperCase()) return "-";
    return def || "-";
  }},
];

export interface SortLevel {
  key: string;
  dir: "asc" | "desc";
}

export interface ExportTemplate {
  id: string;
  name: string;
  fieldKeys: string[];   // ordered list of field keys to include
  sortLevels: SortLevel[]; // multi-level sort: first by [0], then [1], etc.
  // Legacy compat (ignored if sortLevels is present)
  sortByKey?: string | null;
  sortDir?: "asc" | "desc";
}

export function getDefaultTemplate(): ExportTemplate {
  return {
    id: "default",
    name: "All Fields",
    fieldKeys: EXPORT_FIELDS.map((f) => f.key),
    sortLevels: [],
  };
}

/** Migrate old single-sort templates to multi-level format */
function migrateSortLevels(tmpl: ExportTemplate): SortLevel[] {
  if (tmpl.sortLevels && tmpl.sortLevels.length > 0) return tmpl.sortLevels;
  if (tmpl.sortByKey) return [{ key: tmpl.sortByKey, dir: tmpl.sortDir || "asc" }];
  return [];
}

/** Parse a time string like "9:00 AM" or "14:30" to minutes since midnight for chronological sorting. */
function parseTimeMinutes(time: string): number {
  const s = (time || "").trim().toUpperCase();
  if (!s) return 9999; // empty times sort to end

  // Try 12-hour format: "9:00 AM", "12:30 PM"
  const match12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = parseInt(match12[2], 10);
    if (match12[3] === "AM" && h === 12) h = 0;
    if (match12[3] === "PM" && h !== 12) h += 12;
    return h * 60 + m;
  }

  // Try 24-hour format: "14:30"
  const match24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
  }

  return 9999; // unparseable times sort to end
}

export function exportCourtEventsCsv(
  results: CourtEventRow[],
  template?: ExportTemplate,
): void {
  if (results.length === 0) return;

  const tmpl = template || getDefaultTemplate();
  const fields = tmpl.fieldKeys
    .map((key) => EXPORT_FIELDS.find((f) => f.key === key))
    .filter((f): f is ExportField => f != null);

  if (fields.length === 0) return;

  // Multi-level sort
  let sorted = [...results];
  const levels = migrateSortLevels(tmpl);
  if (levels.length > 0) {
    const resolvedLevels = levels
      .map((l) => ({ field: EXPORT_FIELDS.find((f) => f.key === l.key), dir: l.dir }))
      .filter((l): l is { field: ExportField; dir: "asc" | "desc" } => l.field != null);

    if (resolvedLevels.length > 0) {
      sorted.sort((a, b) => {
        for (const { field, dir } of resolvedLevels) {
          let cmp: number;
          if (field.key === "date") {
            // Compare dates chronologically (YYYY-MM-DD sorts correctly as strings)
            const va = field.accessor(a) || "";
            const vb = field.accessor(b) || "";
            cmp = va < vb ? -1 : va > vb ? 1 : 0;
          } else if (field.key === "time") {
            // Compare times chronologically by parsing to minutes since midnight
            cmp = parseTimeMinutes(field.accessor(a)) - parseTimeMinutes(field.accessor(b));
          } else {
            const va = field.accessor(a).toLowerCase();
            const vb = field.accessor(b).toLowerCase();
            cmp = va < vb ? -1 : va > vb ? 1 : 0;
          }
          if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
  }

  const headers = fields.map((f) => f.label);
  const rows = sorted.map((e) =>
    fields.map((f) => csvCell(f.accessor(e))).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `court-search-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
