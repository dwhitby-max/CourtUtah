import crypto from "crypto";
import { ParsedCourtEvent } from "./courtEventParser";

// ============================================================
// REPORTS.PHP PARSER — Full Court Calendar (secondary data source)
//
// The Full Court Calendars at legacy.utcourts.gov/cal/reports.php
// replaced the old PDF calendars. They display all cases including
// associated attorneys and charges in HTML table format.
//
// This parser extracts enriched data (attorneys, charges, OTN, DOB,
// citation #, sheriff #, LEA #) that the primary search.php HTML
// parser doesn't provide. Results are used to enrich existing
// court_events records by matching on case_number + event_date.
//
// URL format: reports.php?loc=XXXXD (e.g., reports.php?loc=0211D)
// ============================================================

const REPORTS_BASE = "https://legacy.utcourts.gov/cal/reports.php";

/** Extended event data from reports.php — includes attorneys + charges */
export interface ReportEvent {
  caseNumber: string | null;
  eventDate: string | null;
  eventTime: string | null;
  courtRoom: string | null;
  judgeName: string | null;
  hearingType: string | null;
  defendantName: string | null;
  defendantOtn: string | null;
  defendantDob: string | null;
  prosecutingAttorney: string | null;
  defenseAttorney: string | null;
  citationNumber: string | null;
  sheriffNumber: string | null;
  leaNumber: string | null;
  charges: string[];
  contentHash: string;
}

/**
 * Build a reports.php URL for a given court location.
 */
export function buildReportUrl(locationCode: string): string {
  return `${REPORTS_BASE}?loc=${encodeURIComponent(locationCode)}`;
}

/**
 * Strip HTML tags and decode common entities.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Generate SHA-256 hash for report event change detection.
 */
function hashReportEvent(event: Omit<ReportEvent, "contentHash">): string {
  const data = JSON.stringify({
    caseNumber: event.caseNumber,
    eventDate: event.eventDate,
    eventTime: event.eventTime,
    courtRoom: event.courtRoom,
    judgeName: event.judgeName,
    defendantName: event.defendantName,
    prosecutingAttorney: event.prosecutingAttorney,
    defenseAttorney: event.defenseAttorney,
    charges: event.charges,
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Parse the Full Court Calendar HTML from reports.php.
 *
 * The reports page renders cases in HTML table rows, organized by
 * judge/courtroom, with each case containing:
 * - Time, date, case number, case type
 * - Defendant name (and sometimes plaintiff)
 * - OTN, DOB, citation #, sheriff #, LEA #
 * - Prosecuting attorney and defense attorney
 * - Charge descriptions
 * - Hearing type
 *
 * The HTML structure uses <table> with <tr>/<td> rows.
 * Courtroom/judge headers appear as spanning rows.
 * Individual cases appear as data rows with multiple cells.
 */
export function parseReportHtml(html: string): ReportEvent[] {
  const events: ReportEvent[] = [];

  if (!html || html.trim().length === 0) return events;

  // Check for no-data indicators
  if (html.includes("No cases") || html.includes("no cases")) return events;
  if (html.includes("currently being updated")) return events;

  // Strategy: extract table rows and parse each case block.
  // The reports.php output uses <table> elements with case data in rows.

  // Extract all table rows
  const rows = extractTableRows(html);
  if (rows.length === 0) {
    // Fallback: try parsing as text blocks (some courts may use divs)
    return parseReportTextFallback(html);
  }

  let currentJudge: string | null = null;
  let currentCourtRoom: string | null = null;

  for (const row of rows) {
    const cells = extractCells(row);

    // Detect judge/courtroom header rows (typically have colspan or single cell)
    if (isHeaderRow(row, cells)) {
      const headerText = stripHtml(row);
      const judgeMatch = headerText.match(/(?:Judge|JUDGE)[:\s]+([A-Z][A-Za-z\s.'-]+?)(?=\s+(?:COURTROOM|CTRM|COURT\s*ROOM)|$)/);
      if (judgeMatch) {
        currentJudge = judgeMatch[1].trim();
      }
      const roomMatch = headerText.match(/((?:COURTROOM|CTRM|COURT\s*ROOM)\s*\S+)/i);
      if (roomMatch) {
        currentCourtRoom = roomMatch[1].trim();
      }
      // Sometimes the header has no "Judge:" label — just "NAME COURTROOM N"
      if (!judgeMatch && roomMatch) {
        const beforeRoom = headerText.slice(0, headerText.indexOf(roomMatch[1])).trim();
        if (beforeRoom.length >= 3 && /^[A-Z][A-Z\s.'-]+$/.test(beforeRoom)) {
          currentJudge = beforeRoom;
        }
      }
      // Sometimes the header is just the judge name in ALL CAPS (no courtroom)
      if (!judgeMatch && !roomMatch && /^[A-Z][A-Z\s.'-]{3,}$/.test(headerText.trim())) {
        currentJudge = headerText.trim();
      }
      continue;
    }

    // Try to parse a case data row
    const parsed = parseCaseRow(cells, currentJudge, currentCourtRoom);
    if (parsed) {
      events.push(parsed);
    }
  }

  return events;
}

/**
 * Extract <tr> blocks from HTML.
 */
function extractTableRows(html: string): string[] {
  const rows: string[] = [];
  const pattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    rows.push(match[1]);
  }
  return rows;
}

/**
 * Extract <td> or <th> cell contents from a row.
 */
function extractCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const pattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let match;
  while ((match = pattern.exec(rowHtml)) !== null) {
    cells.push(stripHtml(match[1]));
  }
  return cells;
}

/**
 * Detect if a row is a header (judge/courtroom) rather than case data.
 */
function isHeaderRow(rowHtml: string, cells: string[]): boolean {
  // Rows with colspan are usually headers
  if (/colspan/i.test(rowHtml)) return true;
  // Single-cell rows with short text are often headers
  if (cells.length === 1 && cells[0].length < 100) return true;
  // Rows with judge or courtroom keywords
  if (cells.length <= 2) {
    const text = cells.join(" ");
    if (/(?:Judge|COURTROOM|CTRM)/i.test(text)) return true;
  }
  return false;
}

/**
 * Parse a single case data row into a ReportEvent.
 *
 * The cell structure varies by court but commonly includes:
 * Cell 0: Time (e.g., "1:30 PM")
 * Cell 1: Case # and type
 * Cell 2: Hearing type
 * Cell 3: Party names (plaintiff vs defendant)
 * Cell 4: Attorney info
 * Cell 5: OTN/DOB/Citation info
 * Cell 6: Charges
 *
 * This parser handles flexible cell ordering by searching for known patterns.
 */
function parseCaseRow(
  cells: string[],
  currentJudge: string | null,
  currentCourtRoom: string | null
): ReportEvent | null {
  if (cells.length === 0) return null;

  const fullText = cells.join(" | ");

  // Must have a time pattern to be a valid case
  const timeMatch = fullText.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!timeMatch) return null;

  // Single-cell rows in table context (not fallback) are usually headers
  // But if the single cell has a time + date + case#, it's valid data
  if (cells.length === 1 && fullText.length < 30) return null;
  if (!timeMatch) return null;

  const eventTime = timeMatch[1].trim();

  // Extract date (M/D/YYYY)
  let eventDate: string | null = null;
  const dateMatch = fullText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dateMatch) {
    const month = dateMatch[1].padStart(2, "0");
    const day = dateMatch[2].padStart(2, "0");
    eventDate = `${dateMatch[3]}-${month}-${day}`;
  }

  // Case number
  const caseMatch = fullText.match(/(?:Case\s*#?\s*|#\s*)(\d{6,})/i);
  const caseNumber = caseMatch ? caseMatch[1] : null;

  // Defendant name (after "vs." or "v.")
  let defendantName: string | null = null;
  const vsMatch = fullText.match(/vs?\.?\s+([A-Z][A-Z\s,.'-]+?)(?=\s*\||$|\s{2,}|\s+(?:ATTY|OTN|DOB|Case))/i);
  if (vsMatch) {
    defendantName = vsMatch[1].replace(/[,.\s]+$/, "").trim();
  }

  // Prosecuting attorney
  let prosecutingAttorney: string | null = null;
  const prosMatch = fullText.match(/(?:Pros(?:ecuting)?\.?\s*(?:Atty|Attorney)[:\s]+|PROS\s+ATTY[:\s]+)([A-Za-z\s,.'-]+?)(?=\s*\||$|\s{2,}|Def)/i);
  if (prosMatch) {
    prosecutingAttorney = prosMatch[1].replace(/[,.\s]+$/, "").trim();
  }
  // Fallback: first ATTY: line
  if (!prosecutingAttorney) {
    const attyMatch = fullText.match(/ATTY:\s*([A-Za-z\s,.'-]+?)(?=\s*\||$|\s+ATTY:|\s{2,})/i);
    if (attyMatch) {
      prosecutingAttorney = attyMatch[1].replace(/[,.\s]+$/, "").trim();
    }
  }

  // Defense attorney
  let defenseAttorney: string | null = null;
  const defMatch = fullText.match(/(?:Def(?:ense)?\.?\s*(?:Atty|Attorney)[:\s]+|DEF\s+ATTY[:\s]+)([A-Za-z\s,.'-]+?)(?=\s*\||$|\s{2,})/i);
  if (defMatch) {
    defenseAttorney = defMatch[1].replace(/[,.\s]+$/, "").trim();
  }
  // Fallback: second ATTY: line
  if (!defenseAttorney) {
    const attyMatches = fullText.match(/ATTY:\s*([A-Za-z\s,.'-]+?)(?=\s*\||$|\s+ATTY:|\s{2,})/gi);
    if (attyMatches && attyMatches.length >= 2) {
      defenseAttorney = attyMatches[1].replace(/^ATTY:\s*/i, "").replace(/[,.\s]+$/, "").trim();
    }
  }

  // OTN
  let defendantOtn: string | null = null;
  const otnMatch = fullText.match(/OTN[:\s]+(\S+)/i);
  if (otnMatch) {
    defendantOtn = otnMatch[1].trim();
  }

  // DOB
  let defendantDob: string | null = null;
  const dobMatch = fullText.match(/DOB[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (dobMatch) {
    const parts = dobMatch[1].split("/");
    if (parts.length === 3) {
      defendantDob = `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
    }
  }

  // Citation number
  let citationNumber: string | null = null;
  const citMatch = fullText.match(/CITATION\s*#?[:\s]+(\S+)/i);
  if (citMatch) {
    citationNumber = citMatch[1].trim();
  }

  // Sheriff number
  let sheriffNumber: string | null = null;
  const shMatch = fullText.match(/SHERIFF\s*#?[:\s]+(\S+)/i);
  if (shMatch) {
    sheriffNumber = shMatch[1].trim();
  }

  // LEA number
  let leaNumber: string | null = null;
  const leaMatch = fullText.match(/LEA\s*#?[:\s]+(\S+)/i);
  if (leaMatch) {
    leaNumber = leaMatch[1].trim();
  }

  // Hearing type
  let hearingType: string | null = null;
  const htMatch = fullText.match(
    /(ARRAIGNMENT|PRETRIAL|SENTENCING|DISPOSITION|PRELIMINARY|REVIEW|STATUS|CONFERENCE|TRIAL|MOTION|EVIDENTIARY|PROBATION|PLEA|ROLL CALL|SCHEDULING|BENCH TRIAL|JURY TRIAL)/i
  );
  if (htMatch) {
    hearingType = htMatch[1].trim();
  }

  // Charges — look for charge patterns (statute codes or descriptions)
  const charges: string[] = [];
  // Pattern: "(charge description)" or charge code like "76-5-103" or labeled sections
  const chargePattern = /(?:Charge[s]?[:\s]+|(?:^|\|)\s*)(\d{1,3}-\d{1,2}-\d{1,4}[A-Za-z()\s,./-]*)/gi;
  let chMatch;
  while ((chMatch = chargePattern.exec(fullText)) !== null) {
    const charge = chMatch[1].trim();
    if (charge.length > 3 && charge.length < 200) {
      charges.push(charge);
    }
  }
  // Also look for descriptive charges after "Charge:" label
  const chargeDescMatch = fullText.match(/Charge[s]?[:\s]+([^|]+)/i);
  if (chargeDescMatch && charges.length === 0) {
    const desc = chargeDescMatch[1].trim();
    if (desc.length > 3 && desc.length < 300) {
      // Split by semicolons or numbered items
      const parts = desc.split(/\s*;\s*|\s*\d+\)\s*/);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 3) {
          charges.push(trimmed);
        }
      }
    }
  }

  const eventData: Omit<ReportEvent, "contentHash"> = {
    caseNumber,
    eventDate,
    eventTime,
    courtRoom: currentCourtRoom,
    judgeName: currentJudge,
    hearingType,
    defendantName,
    defendantOtn,
    defendantDob,
    prosecutingAttorney,
    defenseAttorney,
    citationNumber,
    sheriffNumber,
    leaNumber,
    charges,
  };

  return {
    ...eventData,
    contentHash: hashReportEvent(eventData),
  };
}

/**
 * Fallback parser for reports that use divs or text blocks instead of tables.
 * Uses a text-based approach similar to the legacy PDF parser.
 */
function parseReportTextFallback(html: string): ReportEvent[] {
  const events: ReportEvent[] = [];
  const text = stripHtml(html);

  if (!text || text.length < 20) return events;

  // Split on time patterns as block boundaries
  const timePattern = /(?:^|\n)\s*(\d{1,2}:\d{2}\s*[AP]M)/gi;
  const positions: number[] = [];
  let tm;
  while ((tm = timePattern.exec(text)) !== null) {
    positions.push(tm.index);
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : text.length;
    const block = text.slice(start, end).trim();

    if (block.length < 10) continue;

    // Re-use the row parser with the block as a single "cell"
    const parsed = parseCaseRow([block], null, null);
    if (parsed) {
      events.push(parsed);
    }
  }

  return events;
}

/**
 * Merge report data into existing ParsedCourtEvent records.
 *
 * Matches events by case_number + event_date. When a match is found,
 * enriches the existing event with attorney, OTN, DOB, citation,
 * sheriff, LEA, and charge data from the report.
 *
 * Returns the count of events enriched.
 */
export function enrichEventsWithReportData(
  existingEvents: ParsedCourtEvent[],
  reportEvents: ReportEvent[]
): number {
  let enriched = 0;

  // Build a lookup by case_number + event_date
  const reportLookup = new Map<string, ReportEvent>();
  for (const re of reportEvents) {
    if (re.caseNumber && re.eventDate) {
      const key = `${re.caseNumber}::${re.eventDate}`;
      reportLookup.set(key, re);
    }
  }

  for (const event of existingEvents) {
    if (!event.caseNumber || !event.eventDate) continue;

    const key = `${event.caseNumber}::${event.eventDate}`;
    const report = reportLookup.get(key);
    if (!report) continue;

    // Enrich only if the report has data that the event lacks
    let changed = false;

    if (!event.prosecutingAttorney && report.prosecutingAttorney) {
      event.prosecutingAttorney = report.prosecutingAttorney;
      changed = true;
    }
    if (!event.defenseAttorney && report.defenseAttorney) {
      event.defenseAttorney = report.defenseAttorney;
      changed = true;
    }
    if (!event.defendantOtn && report.defendantOtn) {
      event.defendantOtn = report.defendantOtn;
      changed = true;
    }
    if (!event.defendantDob && report.defendantDob) {
      event.defendantDob = report.defendantDob;
      changed = true;
    }
    if (!event.citationNumber && report.citationNumber) {
      event.citationNumber = report.citationNumber;
      changed = true;
    }
    if (!event.sheriffNumber && report.sheriffNumber) {
      event.sheriffNumber = report.sheriffNumber;
      changed = true;
    }
    if (!event.leaNumber && report.leaNumber) {
      event.leaNumber = report.leaNumber;
      changed = true;
    }

    if (changed) enriched++;
  }

  return enriched;
}
