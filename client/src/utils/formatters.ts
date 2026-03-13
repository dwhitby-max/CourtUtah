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
