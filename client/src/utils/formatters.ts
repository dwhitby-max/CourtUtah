export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
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

export function exportCourtEventsCsv(results: Array<{
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
}>): void {
  if (results.length === 0) return;
  const headers = [
    "Date", "Time", "Court", "Court Room", "Location", "Judge",
    "Case Number", "Case Type", "Hearing Type",
    "Defendant", "Defendant Last Name", "Prosecuting Attorney", "Defense Attorney",
  ];
  const rows = results.map((e) => [
    e.eventDate, e.eventTime, e.courtName, e.courtRoom, e.hearingLocation, extractLastName(e.judgeName),
    e.caseNumber, e.caseType, e.hearingType,
    e.defendantName, extractLastName(e.defendantName), extractLastName(e.prosecutingAttorney), extractLastName(e.defenseAttorney),
  ].map(csvCell).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `court-search-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
