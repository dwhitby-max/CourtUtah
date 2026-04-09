import crypto from "crypto";
import https from "https";

// ============================================================
// COURT EVENT PARSER — HTML format from legacy.utcourts.gov/cal/search.php
//
// The HTML search results contain event blocks with this structure:
//   Time (e.g., "1:30 PM") + optional "Virtual Hearing" flag
//   Date (e.g., "3/16/2026")
//   Court name + hearing location (e.g., "FIRST JUDICIAL DISTRICT - BRIGHAM CITY DISTR")
//   Court type (e.g., "District Court" or "Justice Court")
//   Case parties (e.g., "STATE OF UTAH vs. GAIGE TOBLER")
//   Judge + courtroom + hearing type (e.g., "BRANDON MAYNARD COURTROOM 3 WEB--DECISION TO PRELIM")
//   Case number + case type (e.g., "Case # 251100233 State Felony")
//
// This parser also retains backward compatibility with the old PDF text
// format (divider-based) for any courts that still produce it.
// ============================================================

export interface ParsedCourtEvent {
  courtRoom: string | null;
  eventDate: string | null;
  eventTime: string | null;
  hearingType: string | null;
  caseNumber: string | null;
  caseType: string | null;
  defendantName: string | null;
  defendantOtn: string | null;
  defendantDob: string | null;
  prosecutingAttorney: string | null;
  defenseAttorney: string | null;
  citationNumber: string | null;
  sheriffNumber: string | null;
  leaNumber: string | null;
  judgeName: string | null;
  hearingLocation: string | null;
  isVirtual: boolean;
  contentHash: string;
  /** Full court name from the court list (e.g. "Third District Court - Salt Lake"). Set by caller, not parser. */
  courtName?: string | null;
  /** Court location code used for the live search (e.g. "1868D"). Set by caller, not parser. */
  courtLocationCode?: string | null;
  /** URL to details.php page for this event (extracted from search results). */
  detailsUrl?: string | null;
}

/**
 * Generate SHA-256 hash of event fields for change detection.
 */
function hashEvent(event: Omit<ParsedCourtEvent, "contentHash">): string {
  const data = JSON.stringify({
    courtRoom: event.courtRoom,
    eventDate: event.eventDate,
    eventTime: event.eventTime,
    hearingType: event.hearingType,
    caseNumber: event.caseNumber,
    caseType: event.caseType,
    defendantName: event.defendantName,
    judgeName: event.judgeName,
    hearingLocation: event.hearingLocation,
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Decode common HTML entities.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&quot;/g, '"');
}

/**
 * Strip HTML tags from a string and collapse whitespace.
 */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

/**
 * Extract text content from HTML, converting <br> to newlines.
 */
function htmlToLines(html: string): string[] {
  const withNewlines = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withNewlines)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

// ============================================================
// HTML PARSER — Primary path (new format)
// ============================================================

/**
 * Parse an HTML search results page from search.php into structured events.
 *
 * The HTML contains event blocks with div-based structure:
 * - Time/date header row
 * - Event box with class "casehover" containing:
 *   - Court name/location (bottomline div)
 *   - Defendant/parties (col-sm-4)
 *   - Judge/room/hearing (col-sm-8 > col-sm-6)
 *   - Case number/type (div.case)
 */
export interface SearchContext {
  /** The attorney name being searched (if attorney-type search) */
  searchedAttorney?: string;
}

export function parseHtmlCalendarResults(html: string, context?: SearchContext): ParsedCourtEvent[] {
  const events: ParsedCourtEvent[] = [];

  if (!html || html.trim().length === 0) return events;

  // Check for no-results indicators (use regex to avoid "1000" matching "0 results")
  if (/\b0 results found\b/i.test(html)) return events;
  if (html.includes("currently being updated")) return events;

  // Check result count
  const resultCountMatch = html.match(/(\d+)\s+results?\s+found/i);
  if (resultCountMatch && parseInt(resultCountMatch[1], 10) === 0) return events;

  // Strategy: Find each event block by its "bottomline little" div (court name header),
  // which is the consistent marker across all search types (attorney, case number,
  // party, judge). The old "casehover" class is no longer present in current HTML.
  // Each event runs from one "bottomline little" to the next (or end of page), and
  // contains the defendant (col-sm-4), judge/room/hearing (col-sm-6), and case
  // number (div.case). Note: attorney searches also have a "col-sm-12 bottomline"
  // div for the attorney name row — we specifically match "bottomline little" to
  // avoid double-counting events.
  const boxPattern = /class="[^"]*bottomline little[^"]*"/gi;
  const boxPositions: number[] = [];
  let bm;
  while ((bm = boxPattern.exec(html)) !== null) {
    // Back up to the containing <div> tag start
    const divStart = html.lastIndexOf("<div", bm.index);
    if (divStart >= 0 && !boxPositions.includes(divStart)) {
      boxPositions.push(divStart);
    }
  }

  // Fallback: if no bottomline divs found, try "casehover" (legacy) or
  // div.case containing "Case #" (last resort — captures only case number section)
  if (boxPositions.length === 0) {
    const casehoverPattern = /casehover/gi;
    let chm;
    while ((chm = casehoverPattern.exec(html)) !== null) {
      boxPositions.push(chm.index);
    }
  }
  if (boxPositions.length === 0) {
    const caseBlockPattern = /class="case"[^>]*>[\s\S]*?Case\s*#/gi;
    let cbm;
    while ((cbm = caseBlockPattern.exec(html)) !== null) {
      const blockStart = html.lastIndexOf("<div", cbm.index);
      if (blockStart >= 0 && !boxPositions.includes(blockStart)) {
        boxPositions.push(blockStart);
      }
    }
  }

  if (boxPositions.length === 0) return events;

  for (let bi = 0; bi < boxPositions.length; bi++) {
    const boxStart = boxPositions[bi];
    const boxEnd = bi + 1 < boxPositions.length ? boxPositions[bi + 1] : html.length;

    // Get the HTML chunk from just before this box to the next box
    // Look back up to 500 chars for the time/date header
    const headerStart = Math.max(0, bi > 0 ? boxPositions[bi - 1] + 20 : boxStart - 500);
    const headerHtml = html.slice(headerStart, boxStart);
    const boxHtml = html.slice(boxStart, boxEnd);

    const parsed = parseEventBlock(headerHtml, boxHtml, context);
    if (parsed) {
      events.push(parsed);
    }
  }

  return events;
}

/**
 * Parse a single event block from its header HTML and box HTML.
 */
function parseEventBlock(
  headerHtml: string,
  boxHtml: string,
  context?: SearchContext
): ParsedCourtEvent | null {
  // 1. Extract time from the header — grab the LAST match (closest to this
  //    event box) to avoid picking up a preceding event's time header.
  const headerTimeMatches = [...headerHtml.matchAll(/(\d{1,2}:\d{2}\s*[AP]M)/gi)];
  let timeMatch: RegExpMatchArray | null = headerTimeMatches.length > 0
    ? headerTimeMatches[headerTimeMatches.length - 1]
    : null;
  if (!timeMatch) {
    // Fallback: check boxHtml for time if not in header (some formats embed it)
    const boxTimeMatches = [...boxHtml.matchAll(/(\d{1,2}:\d{2}\s*[AP]M)/gi)];
    timeMatch = boxTimeMatches.length > 0 ? boxTimeMatches[boxTimeMatches.length - 1] : null;
  }
  const eventTime = timeMatch ? timeMatch[1].trim().toUpperCase() : null;

  // 2. Extract date from header — look for <strong>M/D/YYYY</strong>
  //    Also check boxHtml for date if not in header
  let dateMatch = headerHtml.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!dateMatch) {
    dateMatch = boxHtml.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  }
  if (!dateMatch) return null;
  const month = dateMatch[1].padStart(2, "0");
  const day = dateMatch[2].padStart(2, "0");
  const year = dateMatch[3];
  const eventDate = `${year}-${month}-${day}`;

  // 3. Virtual hearing flag — check header for "Virtual Hearing"
  const isVirtual = /virtual\s+hearing/i.test(headerHtml);

  // 4. Extract hearing location from "(Hearing location is in XXXXX ...)"
  let hearingLocation: string | null = null;
  const locationMatch = boxHtml.match(/\(Hearing location is in\s+([^)]+)\)/i);
  if (locationMatch) {
    hearingLocation = stripTags(locationMatch[1])
      .replace(/\s*-?\s*More Info\s*/i, "")
      .trim();
  }

  // 5. Extract attorney name from search results.
  //    search.php only shows ONE attorney with the generic label "Attorney: &nbsp;"
  //    followed by the name (with HILI spans highlighting search matches).
  //    No role label ("Prosecuting" / "Defense") is provided, and NO opposing
  //    counsel is shown. We cannot determine the attorney's role from search.php
  //    alone — that data comes from reports.php enrichment stored in the DB.
  //    We leave both prosecutingAttorney and defenseAttorney null here.
  let prosecutingAttorney: string | null = null;
  let defenseAttorney: string | null = null;

  // 6. Extract defendant name from the col-sm-4 div (parties section)
  let defendantName: string | null = null;
  const partiesDivMatch = boxHtml.match(
    /class="[^"]*col-sm-4[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*col-sm-8)/i
  );
  if (partiesDivMatch) {
    const partiesHtml = partiesDivMatch[1];
    // Look for name after "vs." — the defendant is typically after "vs."
    const vsMatch = partiesHtml.match(/vs\.\s*([\s\S]*?)$/i);
    if (vsMatch) {
      // Get all <span class="indent"> content after vs.
      const afterVs = vsMatch[1];
      const indentMatches = afterVs.match(/<span[^>]*class="indent"[^>]*>([\s\S]*?)<\/span>/gi);
      if (indentMatches && indentMatches.length > 0) {
        // Take the first indent span after vs. as defendant
        defendantName = cleanName(stripTags(indentMatches[0]));
      } else {
        // Fallback: strip tags from what's after vs.
        defendantName = cleanName(stripTags(afterVs));
      }
    } else {
      // No "vs." — extract from indent spans directly
      const indentMatches = partiesHtml.match(/<span[^>]*class="indent"[^>]*>([\s\S]*?)<\/span>/gi);
      if (indentMatches && indentMatches.length > 0) {
        // Use the last indent span as the primary name
        defendantName = cleanName(stripTags(indentMatches[indentMatches.length - 1]));
      }
    }
  }

  // 7. Extract judge name, courtroom, and hearing type from col-sm-6 inside col-sm-8
  let judgeName: string | null = null;
  let courtRoom: string | null = null;
  let hearingType: string | null = null;

  const sm8Match = boxHtml.match(
    /class="[^"]*col-sm-8[^"]*"[^>]*>([\s\S]*?)$/i
  );
  if (sm8Match) {
    const sm8Html = sm8Match[1];

    const sm6Match = sm8Html.match(
      /class="[^"]*col-sm-6[^"]*"[^>]*>([\s\S]*?)(?:<\/div>)/i
    );
    if (sm6Match) {
      const sm6Html = sm6Match[1];
      // Content is separated by <br> tags: judge name, courtroom, hearing type
      const lines = htmlToLines(sm6Html);

      // Filter out empty lines and the <hr class="sep"/> artifact
      const contentLines = lines.filter(
        (l) => l.length > 0 && !/^\s*$/.test(l)
      );

      if (contentLines.length >= 1) {
        judgeName = cleanName(contentLines[0]);
        if (judgeName.length < 2) judgeName = null;
      }
      if (contentLines.length >= 2) {
        courtRoom = cleanName(contentLines[1]);
        if (courtRoom.length < 1) courtRoom = null;
      }
      if (contentLines.length >= 3) {
        hearingType = cleanName(contentLines.slice(2).join(" "));
        if (hearingType.length < 1) hearingType = null;
      }
    }
  }

  // 8. Extract case number and case type from div.case
  let caseNumber: string | null = null;
  let caseType: string | null = null;

  const caseDivMatch = boxHtml.match(
    /<div[^>]*class="case"[^>]*>([\s\S]*?)<\/div>/i
  );
  if (caseDivMatch) {
    const caseHtml = caseDivMatch[1];
    const caseNumMatch = caseHtml.match(/Case\s*#\s*(\d+)/i);
    if (caseNumMatch) {
      caseNumber = caseNumMatch[1];
    }

    // Case type may be on the same line after the case number digits,
    // e.g. "Case # 261200001 Misdemeanor" or "Case # 251100233 State Felony"
    if (caseNumber) {
      const afterNumMatch = caseHtml.match(
        new RegExp(`Case\\s*#\\s*${caseNumber}\\s+([A-Za-z][A-Za-z ]+?)(?:<|$)`, "i")
      );
      if (afterNumMatch) {
        const candidate = afterNumMatch[1]
          .replace(/View\s*Case\s*Details/i, "")
          .trim();
        if (candidate.length > 0 && candidate.length < 100) {
          caseType = candidate;
        }
      }
    }

    // Fallback: case type on a separate line after case number (separated by <br>)
    if (!caseType) {
      const caseLines = htmlToLines(caseHtml);
      for (const line of caseLines) {
        if (/Case\s*#/i.test(line)) continue;
        if (/View\s*Case\s*Details/i.test(line)) continue;
        const trimmed = line.trim();
        if (trimmed.length > 0 && trimmed.length < 100) {
          caseType = trimmed;
          break;
        }
      }
    }
  } else {
    // Fallback: search anywhere in boxHtml
    const caseMatch = boxHtml.match(/Case\s*#\s*(\d+)/i);
    if (caseMatch) {
      caseNumber = caseMatch[1];
    }
  }

  // Extract details.php URL for fetching attorney data
  let detailsUrl: string | null = null;
  const detailsMatch = boxHtml.match(/href="[^"]*?(details\.php\?ref=\d+[^"]*?)"/i);
  if (detailsMatch) {
    detailsUrl = `https://legacy.utcourts.gov/cal/${detailsMatch[1].replace(/&amp;/g, "&")}`;
  }

  // Must have a case number AND at least one meaningful field (defendant,
  // hearing type, or judge) to be a valid event. Without these the record
  // is too sparse to be useful and would create near-empty DB rows.
  if (!caseNumber) return null;
  if (!defendantName && !hearingType && !judgeName) {
    // Log so we can spot HTML format changes causing parser failures
    console.warn(`⚠️ Parser: skipping sparse event — case ${caseNumber} on ${eventDate} has no defendant, hearing type, or judge`);
    return null;
  }

  // Build event
  const eventData: Omit<ParsedCourtEvent, "contentHash"> = {
    courtRoom,
    eventDate,
    eventTime,
    hearingType,
    caseNumber,
    caseType,
    defendantName,
    defendantOtn: null,
    defendantDob: null,
    prosecutingAttorney,
    defenseAttorney,
    citationNumber: null,
    sheriffNumber: null,
    leaNumber: null,
    judgeName,
    hearingLocation,
    isVirtual,
    detailsUrl,
  };

  return {
    ...eventData,
    contentHash: hashEvent(eventData),
  };
}

/**
 * Clean a name string — trim, collapse whitespace, remove trailing punctuation.
 */
function cleanName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/[,.\s]+$/, "")
    .trim();
}

// ============================================================
// LEGACY PDF PARSER — Backward compatibility
// ============================================================

const EVENT_DIVIDER = "------------------------------------------------------------------------------";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Try to parse a date string like "February 22, 2016" into YYYY-MM-DD.
 */
function parseCourtDate(text: string): string | null {
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    for (const month of MONTHS) {
      const idx = trimmed.indexOf(month);
      if (idx >= 0) {
        const dateStr = trimmed.slice(idx).trim();
        const dateMatch = dateStr.match(new RegExp(`${month}\\s+\\d{1,2},?\\s+\\d{4}`));
        if (dateMatch) {
          try {
            const d = new Date(dateMatch[0]);
            if (!isNaN(d.getTime())) {
              return d.toISOString().split("T")[0];
            }
          } catch {
            // ignore
          }
        }
        try {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            return d.toISOString().split("T")[0];
          }
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}

/**
 * Parse old-format PDF text with divider-separated event blocks.
 * Kept for backward compatibility.
 */
export function parseCourtCalendarText(
  fullText: string,
  courtName: string,
  courtType: string,
  sourceUrl: string
): ParsedCourtEvent[] {
  const events: ParsedCourtEvent[] = [];

  if (!fullText || fullText.trim().length === 0) return events;
  if (fullText.includes("Nothing to Report")) return events;

  const sections = fullText.split(EVENT_DIVIDER);

  let currentCourtRoom: string | null = null;
  let currentDate: string | null = null;
  let currentTime: string | null = null;

  if (sections.length > 0) {
    currentDate = parseCourtDate(sections[0]);
    const headerLines = sections[0].split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    for (const line of headerLines) {
      if (line.toUpperCase().startsWith("COURTROOM") || line.toUpperCase().startsWith("COURT ROOM")) {
        currentCourtRoom = line;
        break;
      }
    }
  }

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const rows = section.split("\n").map((r) => r.trim()).filter((r) => r.length > 0);
    if (rows.length === 0) continue;

    const firstRow = rows[0];
    const firstRowParts = firstRow.split(/\s{3,}/).map((p) => p.trim()).filter((p) => p.length > 0);

    const timeMatch = firstRow.match(/\d{1,2}:\d{2}\s*[AP]M/i);
    if (timeMatch) {
      currentTime = timeMatch[0].trim().toUpperCase();
    }

    let caseNumber: string | null = null;
    let caseType: string | null = null;
    let hearingType: string | null = null;

    if (firstRowParts.length >= 2) {
      const lastPart = firstRowParts[firstRowParts.length - 1];
      const caseMatch = lastPart.match(/^([A-Z]{2,}\s+\d+)/);
      if (caseMatch) {
        caseNumber = caseMatch[1];
        const remaining = lastPart.replace(caseNumber, "").trim();
        if (remaining) caseType = remaining;
      }
      hearingType = firstRowParts.length >= 3 ? firstRowParts[1] : firstRowParts[0];
      if (hearingType === currentTime) {
        hearingType = firstRowParts.length >= 2 ? firstRowParts[1] : null;
      }
    }

    let prosecutingAttorney: string | null = null;
    let defenseAttorney: string | null = null;
    let defendantName: string | null = null;

    const attyRows = rows.filter((r) => r.includes("ATTY:"));
    for (const attyRow of attyRows) {
      const parts = attyRow.split("ATTY:").map((p) => p.trim());
      if (parts.length >= 2) {
        if (!prosecutingAttorney) {
          prosecutingAttorney = parts[1] || null;
        } else {
          defenseAttorney = parts[1] || null;
          if (parts[0]) {
            defendantName = parts[0];
          }
        }
      }
    }

    let defendantOtn: string | null = null;
    let defendantDob: string | null = null;
    const otnRow = rows.find((r) => r.includes("OTN:") && r.includes("DOB:"));
    if (otnRow) {
      const dobPart = otnRow.split("DOB:")[1];
      if (dobPart) {
        const dobMatch = dobPart.trim().match(/\d{2}\/\d{2}\/\d{4}/);
        if (dobMatch) {
          try {
            const parts = dobMatch[0].split("/");
            defendantDob = `${parts[2]}-${parts[0]}-${parts[1]}`;
          } catch {
            // ignore
          }
        }
      }
      const otnPart = otnRow.split("DOB:")[0].replace("OTN:", "").trim();
      if (otnPart) defendantOtn = otnPart;
    }

    let citationNumber: string | null = null;
    const citationRow = rows.find((r) => r.includes("CITATION #:"));
    if (citationRow) {
      if (citationRow.includes("SHERIFF #:")) {
        const part = citationRow.split("SHERIFF #:")[0];
        citationNumber = part.replace("CITATION #:", "").trim() || null;
      } else {
        citationNumber = citationRow.replace("CITATION #:", "").trim() || null;
      }
    }

    let sheriffNumber: string | null = null;
    const soRow = rows.find((r) => r.includes("SHERIFF #:"));
    if (soRow && soRow.includes("LEA #:")) {
      sheriffNumber = soRow.split("SHERIFF #:")[1].split("LEA #:")[0].trim() || null;
    }

    let leaNumber: string | null = null;
    const leaRow = rows.find((r) => r.includes("LEA #:"));
    if (leaRow) {
      leaNumber = leaRow.split("LEA #:")[1]?.trim() || null;
    }

    for (const row of rows) {
      if (row.toUpperCase().startsWith("COURTROOM") || row.toUpperCase().startsWith("COURT ROOM")) {
        currentCourtRoom = row;
        break;
      }
    }

    const eventData: Omit<ParsedCourtEvent, "contentHash"> = {
      courtRoom: currentCourtRoom,
      eventDate: currentDate,
      eventTime: currentTime,
      hearingType,
      caseNumber,
      caseType,
      defendantName,
      defendantOtn,
      defendantDob,
      prosecutingAttorney,
      defenseAttorney,
      citationNumber,
      sheriffNumber,
      leaNumber,
      judgeName: null,
      hearingLocation: null,
      isVirtual: false,
    };

    events.push({
      ...eventData,
      contentHash: hashEvent(eventData),
    });
  }

  return events;
}

// ============================================================
// DETAILS PAGE PARSER — legacy.utcourts.gov/cal/details.php
//
// The details page shows both attorneys with role labels:
//   <strong>DEF ATTY:</strong> BRANDON LARSEN
//   <strong>PLA ATTY:</strong> RYAN ROBINSON
// ============================================================

export interface DetailAttorneys {
  prosecutingAttorney: string | null;
  defenseAttorney: string | null;
  defendantDob: string | null;
  defendantOtn: string | null;
  citationNumber: string | null;
  charges: string[];
}

/**
 * Fetch a details.php page via GET (single attempt, no retry).
 */
function fetchDetailsHtmlOnce(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Details fetch timeout")), timeoutMs);
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "text/html",
      },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith("http")
          ? res.headers.location
          : `https://legacy.utcourts.gov${res.headers.location}`;
        res.resume();
        https.get(redirectUrl, { timeout: timeoutMs }, (rRes) => {
          const chunks: Buffer[] = [];
          rRes.on("data", (c: Buffer) => chunks.push(c));
          rRes.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString("utf-8")); });
          rRes.on("error", (e) => { clearTimeout(timer); reject(e); });
        }).on("error", (e) => { clearTimeout(timer); reject(e); });
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString("utf-8")); });
      res.on("error", (e) => { clearTimeout(timer); reject(e); });
    }).on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Fetch a details.php page with retry logic and exponential backoff.
 * Retries up to maxRetries times on transient errors (timeouts, network errors).
 */
function fetchDetailsHtml(url: string, timeoutMs = 12000, maxRetries = 2): Promise<string> {
  const retryDelays = [2000, 4000]; // backoff delays between retries
  let attempt = 0;

  const tryFetch = (): Promise<string> =>
    fetchDetailsHtmlOnce(url, timeoutMs).catch((err) => {
      attempt++;
      if (attempt <= maxRetries) {
        const delay = retryDelays[attempt - 1] || 4000;
        return new Promise<string>((resolve) =>
          setTimeout(() => resolve(tryFetch()), delay)
        );
      }
      throw err;
    });

  return tryFetch();
}

/**
 * Parse attorney and enrichment data from a details.php HTML page.
 *
 * Labels found in the HTML:
 *   <strong>DEF ATTY:</strong> name  — defense attorney
 *   <strong>PLA ATTY:</strong> name  — plaintiff/prosecuting attorney
 *   <strong>DOB:</strong> date
 *   OTN: value
 *   Citation: value
 */
export function parseDetailsHtml(html: string): DetailAttorneys {
  let prosecutingAttorney: string | null = null;
  let defenseAttorney: string | null = null;
  let defendantDob: string | null = null;
  let defendantOtn: string | null = null;
  let citationNumber: string | null = null;
  const charges: string[] = [];

  // PLA ATTY: (plaintiff/prosecuting attorney)
  const plaMatch = html.match(/<strong>PLA\s+ATTY:<\/strong>\s*([\s\S]*?)(?:<br|<\/p|<\/div|<strong>)/i);
  if (plaMatch) {
    // Normalize whitespace — the HTML has newlines between first/last name
    const name = stripTags(plaMatch[1]).replace(/\s+/g, " ").trim();
    if (name.length >= 2) prosecutingAttorney = name;
  }

  // DEF ATTY: (defense attorney)
  const defMatch = html.match(/<strong>DEF\s+ATTY:<\/strong>\s*([\s\S]*?)(?:<br|<\/p|<\/div|<strong>)/i);
  if (defMatch) {
    const name = stripTags(defMatch[1]).replace(/\s+/g, " ").trim();
    if (name.length >= 2) defenseAttorney = name;
  }

  // DOB
  const dobMatch = html.match(/<strong>DOB:<\/strong>\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (dobMatch) {
    try {
      const parts = dobMatch[1].split("/");
      defendantDob = `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
    } catch { /* ignore */ }
  }

  // OTN
  const otnMatch = html.match(/OTN:\s*(?:&nbsp;)?\s*([A-Z0-9-]+)/i);
  if (otnMatch && otnMatch[1].trim().length > 1) {
    defendantOtn = otnMatch[1].trim();
  }

  // Citation
  const citMatch = html.match(/Citation:\s*(?:&nbsp;)?\s*#?\s*([A-Z0-9-]+)/i);
  if (citMatch && citMatch[1].trim().length > 1) {
    citationNumber = citMatch[1].trim();
  }

  // Charges — lines starting with "- " in the charges section
  const chargeMatches = html.matchAll(/- ([A-Z][A-Z /()-]+)/g);
  for (const m of chargeMatches) {
    const charge = m[1].trim();
    if (charge.length > 3) charges.push(charge);
  }

  return { prosecutingAttorney, defenseAttorney, defendantDob, defendantOtn, citationNumber, charges };
}

export interface EnrichmentResult {
  enriched: number;
  failed: number;
  total: number;
}

/**
 * Enrich parsed events by fetching their details.php pages in parallel.
 * Updates events in-place with attorney and other enrichment data.
 *
 * Uses adaptive batch sizing: starts at initialBatchSize (default 5),
 * drops to 3 if >50% of a batch fails, recovers back up if failures decrease.
 *
 * Has a total time budget (default 30s) to prevent enrichment from blocking
 * the search response indefinitely. When budget is exceeded, remaining events
 * are skipped — the DB backfill will cover attorney data from prior enrichments.
 */
export async function enrichFromDetailsPages(
  events: ParsedCourtEvent[],
  initialBatchSize = 5,
  timeBudgetMs = 30000
): Promise<EnrichmentResult> {
  const toEnrich = events.filter((e) => e.detailsUrl && !e.prosecutingAttorney && !e.defenseAttorney);
  if (toEnrich.length === 0) return { enriched: 0, failed: 0, total: 0 };

  let enriched = 0;
  let failed = 0;
  let skipped = 0;
  let currentBatchSize = initialBatchSize;
  const startTime = Date.now();

  for (let i = 0; i < toEnrich.length; i += currentBatchSize) {
    // Check time budget before starting a new batch
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeBudgetMs) {
      const remaining = toEnrich.length - i;
      skipped += remaining;
      console.warn(`⏱️ Details enrichment time budget exhausted (${Math.round(elapsed / 1000)}s) — skipping ${remaining} remaining events`);
      break;
    }

    const batch = toEnrich.slice(i, i + currentBatchSize);

    // Calculate per-batch timeout: remaining budget, but at least 8s per fetch
    const remainingBudget = timeBudgetMs - elapsed;
    const batchTimeout = Math.max(8000, Math.min(12000, remainingBudget - 1000));

    const results = await Promise.all(
      batch.map((event) =>
        fetchDetailsHtml(event.detailsUrl!, batchTimeout, remainingBudget < 15000 ? 0 : 1)
          .then((html) => ({ event, data: parseDetailsHtml(html) }))
          .catch((err) => {
            console.warn(`⚠️ Details fetch failed for ${event.caseNumber}:`, err instanceof Error ? err.message : err);
            return null;
          })
      )
    );

    let batchFailed = 0;
    for (const result of results) {
      if (!result) { batchFailed++; continue; }
      const { event, data } = result;
      if (data.prosecutingAttorney) { event.prosecutingAttorney = data.prosecutingAttorney; enriched++; }
      if (data.defenseAttorney) event.defenseAttorney = data.defenseAttorney;
      if (data.defendantDob && !event.defendantDob) event.defendantDob = data.defendantDob;
      if (data.defendantOtn && !event.defendantOtn) event.defendantOtn = data.defendantOtn;
      if (data.citationNumber && !event.citationNumber) event.citationNumber = data.citationNumber;
    }
    failed += batchFailed;

    // Adaptive batch sizing: shrink on high failure rate, recover on success
    const failRate = batchFailed / batch.length;
    if (failRate > 0.5 && currentBatchSize > 3) {
      currentBatchSize = 3;
      console.warn(`⚠️ Details enrichment: >50% failure rate, reducing batch size to ${currentBatchSize}`);
    } else if (failRate === 0 && currentBatchSize < initialBatchSize) {
      currentBatchSize = initialBatchSize;
    }

    // Add a small delay between batches to avoid hammering the server
    if (i + currentBatchSize < toEnrich.length) {
      await new Promise((r) => setTimeout(r, batchFailed > 0 ? 1000 : 300));
    }
  }

  return { enriched, failed: failed + skipped, total: toEnrich.length };
}
