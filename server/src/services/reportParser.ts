import crypto from "crypto";
import https from "https";
import zlib from "zlib";
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
// URL format: POST to reports.php with form data loc=XXXXD&d=all&judge=&atty=
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
 * Fetch reports.php HTML via POST with the required form data.
 * reports.php requires a POST request with form fields:
 *   loc=XXXXD&d=all&judge=&atty=
 */
export function fetchReportHtml(
  locationCode: string,
  timeoutMs = 15000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = `loc=${encodeURIComponent(locationCode)}&d=all&judge=&atty=`;
    const url = new URL(REPORTS_BASE);

    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate",
          "Connection": "keep-alive",
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : `https://${url.hostname}${res.headers.location}`;
          https
            .get(redirectUrl, {
              timeout: timeoutMs,
              headers: {
                "Accept-Encoding": "gzip, deflate",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
              },
            }, (redirectRes) => {
              const chunks: Buffer[] = [];
              redirectRes.on("data", (chunk: Buffer) => chunks.push(chunk));
              redirectRes.on("end", () => {
                const buffer = Buffer.concat(chunks);
                const encoding = redirectRes.headers["content-encoding"];
                if (encoding === "gzip") {
                  zlib.gunzip(buffer, (err, decoded) => {
                    if (err) return reject(err);
                    resolve(decoded.toString("utf-8"));
                  });
                } else if (encoding === "deflate") {
                  zlib.inflate(buffer, (err, decoded) => {
                    if (err) return reject(err);
                    resolve(decoded.toString("utf-8"));
                  });
                } else {
                  resolve(buffer.toString("utf-8"));
                }
              });
              redirectRes.on("error", reject);
            })
            .on("error", reject)
            .on("timeout", function (this: ReturnType<typeof https.get>) {
              this.destroy();
              reject(new Error("Redirect request timed out"));
            });
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`reports.php returned HTTP ${res.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const encoding = res.headers["content-encoding"];
          if (encoding === "gzip") {
            zlib.gunzip(buffer, (err, decoded) => {
              if (err) return reject(err);
              resolve(decoded.toString("utf-8"));
            });
          } else if (encoding === "deflate") {
            zlib.inflate(buffer, (err, decoded) => {
              if (err) return reject(err);
              resolve(decoded.toString("utf-8"));
            });
          } else {
            resolve(buffer.toString("utf-8"));
          }
        });
        res.on("error", reject);
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("reports.php POST request timed out"));
    });

    req.write(postData);
    req.end();
  });
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
 * The reports page uses div-based layout (not tables). Each case block contains:
 * - Time + date + court info header
 * - col-sm-4: defendant/parties with vs. pattern
 * - col-sm-4: attorneys (DEF ATTY: / PLA ATTY:)
 * - col-sm-4: case #, case type, judge, courtroom
 * - Additional bottomline div: OTN, DOB, charges, citation/sheriff/LEA
 *
 * Cases are separated by time headers within "nobreakdiv box" containers.
 */
export function parseReportHtml(html: string): ReportEvent[] {
  const events: ReportEvent[] = [];

  if (!html || html.trim().length === 0) return events;
  if (html.includes("No cases") || html.includes("no cases")) return events;
  if (html.includes("currently being updated")) return events;
  if (!html.includes("Case #")) return events;

  // Split into case blocks by finding each time header followed by case data
  // Each time appears twice: once in <strong class="printhide"> and once in <strong class="printshow">
  // We match only the printhide version to avoid duplicates
  const casePattern = /<strong class="printhide">\s*(\d{1,2}:\d{2}\s*[AP]M)\s*<\/strong>([\s\S]*?)(?=<strong class="printhide">\s*\d{1,2}:\d{2}\s*[AP]M\s*<\/strong>|<div class="break">|$)/gi;

  let match;
  while ((match = casePattern.exec(html)) !== null) {
    const eventTime = match[1].trim();
    const blockHtml = match[2];

    // Skip blocks without case numbers
    if (!blockHtml.includes("Case #")) continue;

    // Extract date (M/D/YYYY)
    let eventDate: string | null = null;
    const dateMatch = blockHtml.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      eventDate = `${dateMatch[3]}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`;
    }

    // Extract hearing type from header (text before the date section)
    let hearingType: string | null = null;
    const htMatch = blockHtml.match(/\n([A-Z][A-Z\s/()-]+?(?:HEARING|ARRAIGNMENT|CONFERENCE|TRIAL|MOTION|SENTENCING|DISPOSITION|REVIEW|PRETRIAL|PRELIMINARY|PLEA|ROLL CALL|SCHEDULING|PROBATION|INJUNCTION|WARRANT|SHOW CAUSE|ORDER|EVIDENTIARY)[A-Z\s/()-]*?)\s*(?:<\/div>|<br)/i);
    if (htMatch) {
      hearingType = htMatch[1].trim().replace(/\s+/g, " ");
    }

    // Extract defendant name (after vs.)
    let defendantName: string | null = null;
    const vsMatch = blockHtml.match(/vs\.\s*<br>\s*<span class="indent">\s*([^<]+)/i);
    if (vsMatch) {
      defendantName = vsMatch[1].trim();
    }

    // Extract attorneys
    let prosecutingAttorney: string | null = null;
    let defenseAttorney: string | null = null;

    const plaMatch = blockHtml.match(/<strong>PLA ATTY:<\/strong>\s*([^<]+)/i);
    if (plaMatch) {
      prosecutingAttorney = plaMatch[1].trim();
    }
    const defAttyMatch = blockHtml.match(/<strong>DEF ATTY:<\/strong>\s*([^<]+)/i);
    if (defAttyMatch) {
      defenseAttorney = defAttyMatch[1].trim();
    }

    // Extract case number and case type from the case info div
    let caseNumber: string | null = null;
    let caseType: string | null = null;
    let judgeName: string | null = null;
    let courtRoom: string | null = null;

    const caseMatch = blockHtml.match(/Case\s*#\s*(\d+)/i);
    if (caseMatch) {
      caseNumber = caseMatch[1];
    }

    // Case type, judge, courtroom are in the right col-sm-4
    // Pattern: Case # NNNNN<br /> CaseType<br> JUDGE NAME<br> COURTROOM X
    const rightColMatch = blockHtml.match(/Case\s*#\s*\d+\s*<br\s*\/?>\s*[\r\n]*\s*([^<\r\n]+)\s*<br\s*\/?>\s*[\r\n]*\s*([^<\r\n]+)\s*<br\s*\/?>\s*[\r\n]*\s*([^<\r\n]+)/i);
    if (rightColMatch) {
      caseType = rightColMatch[1].trim() || null;
      judgeName = rightColMatch[2].trim() || null;
      courtRoom = rightColMatch[3].trim() || null;
    }

    // Extract OTN
    let defendantOtn: string | null = null;
    const otnMatch = blockHtml.match(/OTN:\s*(\d+)/i);
    if (otnMatch) {
      defendantOtn = otnMatch[1].trim();
    }

    // Extract DOB
    let defendantDob: string | null = null;
    const dobMatch = blockHtml.match(/DOB:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (dobMatch) {
      const parts = dobMatch[1].split("/");
      if (parts.length === 3) {
        defendantDob = `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
      }
    }

    // Extract citation, sheriff, LEA numbers
    let citationNumber: string | null = null;
    const citMatch = blockHtml.match(/CITATION\s*#?:\s*(\S+)/i);
    if (citMatch) citationNumber = citMatch[1].trim();

    let sheriffNumber: string | null = null;
    const shMatch = blockHtml.match(/SHERIFF\s*#?:\s*(\S+)/i);
    if (shMatch) sheriffNumber = shMatch[1].trim();

    let leaNumber: string | null = null;
    const leaMatch = blockHtml.match(/LEA\s*#?:\s*(\S+)/i);
    if (leaMatch) leaNumber = leaMatch[1].trim();

    // Extract charges (Utah statute codes like 76-5-103, 41-6a-502)
    const charges: string[] = [];
    const chargePattern = /(\d{2,3}-\d{1,2}[a-z]?-\d{1,4}(?:\.\d+)?(?:\([^)]*\))?[A-Za-z()\s,./-]*?)(?=<br|<\/p|<\/div|\n|$)/gi;
    let chMatch;
    while ((chMatch = chargePattern.exec(blockHtml)) !== null) {
      const rawCharge = chMatch[1].replace(/<[^>]+>/g, "").trim();
      // Must start with a plausible Utah statute prefix (41+)
      const prefixNum = parseInt(rawCharge.split("-")[0], 10);
      if (rawCharge.length > 5 && rawCharge.length < 200 && prefixNum >= 41) {
        charges.push(rawCharge);
      }
    }

    const eventData: Omit<ReportEvent, "contentHash"> = {
      caseNumber,
      eventDate,
      eventTime,
      courtRoom,
      judgeName,
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

    events.push({
      ...eventData,
      contentHash: hashReportEvent(eventData),
    });
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
