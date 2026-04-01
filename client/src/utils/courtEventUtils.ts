import { CourtEvent } from "@shared/types";

export function formatDate(dateStr: string): string {
  if (!dateStr) return "N/A";
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${parseInt(m)}/${parseInt(d)}/${y}`;
  }
  return dateStr;
}

export function hasDetails(event: CourtEvent): boolean {
  return !!(
    event.prosecutingAttorney ||
    event.defenseAttorney ||
    event.defendantOtn ||
    event.defendantDob ||
    event.citationNumber ||
    event.sheriffNumber ||
    event.leaNumber ||
    (event.charges && event.charges.length > 0)
  );
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" });
}

export const providerLabels: Record<string, string> = {
  google: "Google Calendar",
  microsoft: "Outlook",
  apple: "iCloud",
  caldav: "CalDAV",
};
