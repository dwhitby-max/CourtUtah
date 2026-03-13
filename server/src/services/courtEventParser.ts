import crypto from "crypto";

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
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Strip HTML tags and decode common entities.
 * Inserts pipe delimiters (|) at block-level tag boundaries (div, br, p, tr, td, li)
 * so that structural separation between fields is preserved even after stripping.
 */
function stripHtml(html: string): string {
  return html
    // Insert delimiter before block-level closing/opening tags
    .replace(/<\/(div|p|tr|td|li|span|dt|dd)>/gi, " | ")
    .replace(/<br\s*\/?>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// HTML PARSER — Primary path (new format)
// ============================================================

/**
 * Parse an HTML search results page from search.php into structured events.
 *
 * The HTML contains result blocks. Each result includes structured data
 * about a court hearing: time, date, location, parties, judge, case number, etc.
 */
export function parseHtmlCalendarResults(html: string): ParsedCourtEvent[] {
  const events: ParsedCourtEvent[] = [];

  if (!html || html.trim().length === 0) return events;

  // Check for no-results indicators
  if (html.includes("0 results found")) return events;
  if (html.includes("currently being updated")) return events;

  // Extract the text content
  const textContent = stripHtml(html);

  if (!textContent || textContent.length < 20) return events;

  // Check result count
  const resultCountMatch = textContent.match(/(\d+)\s+results?\s+found/i);
  if (resultCountMatch && parseInt(resultCountMatch[1], 10) === 0) return events;

  // Parse each result block using time+date anchors
  const resultBlocks = splitIntoResultBlocks(textContent);

  for (const block of resultBlocks) {
    const parsed = parseResultBlock(block);
    if (parsed) {
      events.push(parsed);
    }
  }

  return events;
}

/**
 * Split the text content into individual result blocks.
 * Each block starts with a time pattern like "1:30 PM" followed by a date.
 */
function splitIntoResultBlocks(text: string): string[] {
  const blocks: string[] = [];

  // Find all positions where a time is followed (within 200 chars) by a date
  const timePattern = /(?:^|\s)(\d{1,2}:\d{2}\s*[AP]M\s)/gi;
  const matches: number[] = [];
  let m;

  while ((m = timePattern.exec(text)) !== null) {
    const afterTime = text.slice(m.index, Math.min(m.index + 200, text.length));
    if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(afterTime)) {
      matches.push(m.index);
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1] : text.length;
    const block = text.slice(start, end).trim();
    if (block.length > 10) {
      blocks.push(block);
    }
  }

  return blocks;
}

/**
 * Parse a single result block into a structured event.
 *
 * Expected text pattern (from the rendered HTML):
 *   "1:30 PM Virtual Hearing 3/16/2026 FIRST JUDICIAL DISTRICT - BRIGHAM CITY DISTR
 *    (Hearing location is in BRIGHAM CITY - More Info) District Court
 *    STATE OF UTAH vs. GAIGE TOBLER BRANDON MAYNARD COURTROOM 3
 *    WEB--DECISION TO PRELIM Case # 251100233 State Felony View Case Details"
 */
function parseResultBlock(block: string): ParsedCourtEvent | null {
  // 1. Extract time
  const timeMatch = block.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!timeMatch) return null;
  const eventTime = timeMatch[1].trim();

  // 2. Check virtual hearing flag
  const isVirtual = /virtual\s+hearing/i.test(block);

  // 3. Extract date (M/D/YYYY or MM/DD/YYYY)
  const dateMatch = block.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!dateMatch) return null;
  const month = dateMatch[1].padStart(2, "0");
  const day = dateMatch[2].padStart(2, "0");
  const year = dateMatch[3];
  const eventDate = `${year}-${month}-${day}`;

  // 4. Extract case number: "Case # NNNNNNNNN" or "Case #NNNNNNNNN"
  const caseMatch = block.match(/Case\s*#\s*(\d+)/i);
  const caseNumber = caseMatch ? caseMatch[1] : null;

  // 5. Extract case type — text after case number, before "View Case Details"
  let caseType: string | null = null;
  if (caseMatch) {
    const caseEnd = (caseMatch.index ?? 0) + caseMatch[0].length;
    const viewIdx = block.indexOf("View Case Details", caseEnd);
    const endIdx = viewIdx > 0 ? viewIdx : Math.min(caseEnd + 100, block.length);
    const afterCase = block.slice(caseEnd, endIdx).trim();
    if (afterCase && afterCase.length < 100) {
      caseType = afterCase.replace(/\s+/g, " ").trim() || null;
    }
  }

  // 6. Extract defendant name, judge name, courtroom, and hearing type.
  // Strategy: The stripped HTML uses | delimiters at structural boundaries.
  // The pattern after "vs." is typically:
  //   "... vs. DEFENDANT NAME | JUDGE NAME COURTROOM X | HEARING TYPE | Case # ..."
  // Or without delimiters in some formats:
  //   "... vs. DEFENDANT NAME JUDGE NAME COURTROOM X HEARING TYPE Case # ..."
  let defendantName: string | null = null;
  let judgeName: string | null = null;
  let courtRoom: string | null = null;
  let hearingType: string | null = null;

  const vsIdx = block.search(/vs?\.\s/i);
  const vsEndMatch = block.match(/vs?\.\s+/i);
  const vsEnd = vsIdx >= 0 && vsEndMatch ? vsIdx + vsEndMatch[0].length : -1;
  const caseIdx = caseMatch ? (caseMatch.index ?? block.length) : block.length;

  // Find courtroom anchor
  const roomMatch = block.match(/((?:\S+\s+)?(?:COURTROOM|CTRM|COURT\s*ROOM)\s*\S+)/i);

  if (vsEnd > 0) {
    // Get the full span from vs. to Case #
    const fullSpan = block.slice(vsEnd, caseIdx);

    // Check if pipe delimiters exist (HTML structure was preserved)
    const hasPipes = fullSpan.includes("|");

    if (hasPipes && roomMatch) {
      // Split by pipe and find segments
      const segments = fullSpan.split("|").map(s => s.trim()).filter(s => s.length > 0);

      // First segment = defendant name
      if (segments.length >= 1) {
        defendantName = cleanName(segments[0]);
      }

      // Find the segment containing COURTROOM — it has judge + courtroom
      for (let si = 1; si < segments.length; si++) {
        const seg = segments[si];
        const crMatch = seg.match(/(COURTROOM|CTRM|COURT\s*ROOM)\s*(\S+)/i);
        if (crMatch && crMatch.index !== undefined) {
          // Text before COURTROOM keyword = judge name (full name)
          const beforeCR = seg.slice(0, crMatch.index).trim();
          if (beforeCR.length >= 2) {
            judgeName = cleanName(beforeCR);
          }
          // Courtroom = "COURTROOM X"
          courtRoom = (crMatch[1] + " " + (crMatch[2] || "")).trim();
          break;
        }
      }

      // Hearing type: segment(s) between courtroom segment and "Case #"
      const crSegIdx = segments.findIndex(s => /COURTROOM|CTRM/i.test(s));
      if (crSegIdx >= 0) {
        // Text after courtroom in same segment
        const crSeg = segments[crSegIdx];
        const crEndMatch = crSeg.match(/(?:COURTROOM|CTRM|COURT\s*ROOM)\s*\S+\s*/i);
        if (crEndMatch) {
          const afterCR = crSeg.slice((crEndMatch.index ?? 0) + crEndMatch[0].length).trim();
          // Also gather any subsequent segments before Case #
          const htParts = [afterCR, ...segments.slice(crSegIdx + 1)].filter(s => s.length > 0);
          const htText = htParts.join(" ").replace(/\s*View\s*Case\s*Details\s*$/i, "").trim();
          if (htText.length > 0 && htText.length < 200) {
            hearingType = htText;
          }
        }
      }
    } else if (roomMatch && roomMatch.index !== undefined) {
      // No pipe delimiters — fallback to word-count heuristic
      const roomKeywordIdx = roomMatch.index;
      const vsToRoom = block.slice(vsEnd, roomKeywordIdx).trim();

      courtRoom = roomMatch[1].trim();
      courtRoom = courtRoom.replace(/\s+(WEB|WBX|ARRAIGNMENT|PRETRIAL|SENTENCING|DISPOSITION|HEARING|TRIAL|MOTION|REVIEW|PLEA).*$/i, "").trim();

      // Hearing type after courtroom
      const roomEnd = roomKeywordIdx + roomMatch[0].length;
      if (roomEnd < caseIdx) {
        const htCandidate = block.slice(roomEnd, caseIdx).trim();
        if (htCandidate.length > 0 && htCandidate.length < 200) {
          hearingType = htCandidate.replace(/\s+/g, " ").replace(/\s*\|.*$/g, "").replace(/\s*View\s*Case\s*Details\s*$/i, "").trim() || null;
        }
      }

      if (vsToRoom.length > 0) {
        // Split into words, last 2-3 = judge, rest = defendant
        const words = vsToRoom.replace(/\|/g, " ").split(/\s+/).filter(w => w.length > 0);
        if (words.length <= 3) {
          defendantName = cleanName(words.join(" "));
        } else {
          let judgeWordCount = 2;
          if (words.length >= 4) {
            const thirdFromLast = words[words.length - 3];
            const secondFromLast = words[words.length - 2];
            if (thirdFromLast.length <= 2 || secondFromLast.length <= 2) {
              judgeWordCount = 3;
            }
          }
          defendantName = cleanName(words.slice(0, words.length - judgeWordCount).join(" "));
          judgeName = cleanName(words.slice(words.length - judgeWordCount).join(" "));

          if (judgeName && ["STATE", "UTAH", "VS", "OF", "THE", "CITY"].includes(judgeName)) {
            defendantName = cleanName(vsToRoom.replace(/\|/g, " "));
            judgeName = null;
          }
        }
      }
    } else {
      // No courtroom at all — everything from vs. to Case # is defendant
      let defSpan = fullSpan.replace(/\|/g, " ").trim();
      for (const boundary of ["Case #", "View Case"]) {
        const bIdx = defSpan.indexOf(boundary);
        if (bIdx > 0) defSpan = defSpan.slice(0, bIdx);
      }
      defendantName = cleanName(defSpan);

      // Look for hearing type keywords
      const htMatch = block.match(
        /(ARRAIGNMENT|PRETRIAL|SENTENCING|DISPOSITION|PRELIMINARY|REVIEW|STATUS|CONFERENCE|TRIAL|MOTION|EVIDENTIARY|PROBATION|PLEA|ROLL CALL|SCHEDULING|BENCH TRIAL|JURY TRIAL|WEB[A-Z\s-]*HEARING|WEB[A-Z\s-]*PRELIM|WEB[A-Z\s-]*ARRAIGNMENT|WBX[A-Z\s-]*)/i
      );
      if (htMatch) {
        const htStart = htMatch.index ?? 0;
        hearingType = block.slice(htStart, caseIdx).replace(/\s+/g, " ").replace(/\|/g, " ").trim();
        if (hearingType.length > 150) hearingType = hearingType.slice(0, 150);
        hearingType = hearingType.replace(/\s*View\s*Case\s*Details\s*$/i, "").trim() || null;
      }
    }
  }

  // 7. Extract hearing location — "(Hearing location is in XXXXX ...)"
  let hearingLocation: string | null = null;
  const locationMatch = block.match(/\(Hearing location is in\s+([^)]+)\)/i);
  if (locationMatch) {
    hearingLocation = locationMatch[1].replace(/\s*-\s*More Info\s*/i, "").trim();
  }

  // Clean up judge name
  if (judgeName) {
    judgeName = judgeName.replace(/\s+\d+\s*$/, "").trim();
    if (judgeName.length < 3) judgeName = null;
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
    prosecutingAttorney: null,
    defenseAttorney: null,
    citationNumber: null,
    sheriffNumber: null,
    leaNumber: null,
    judgeName,
    hearingLocation,
    isVirtual,
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
      currentTime = timeMatch[0].trim();
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
