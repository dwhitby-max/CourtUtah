import https from "https";
import http from "http";
import zlib from "zlib";

const COURT_CALENDARS_BASE = "https://legacy.utcourts.gov/cal";

function decompressBuffer(buffer: Buffer, contentEncoding: string | string[] | undefined): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const enc = Array.isArray(contentEncoding)
      ? contentEncoding[0]?.toLowerCase().trim()
      : (contentEncoding || "").toLowerCase().trim();

    if (enc.includes("gzip") || enc === "x-gzip") {
      zlib.gunzip(buffer, (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      });
    } else if (enc.includes("deflate")) {
      zlib.inflate(buffer, (err, decoded) => {
        if (err) {
          zlib.inflateRaw(buffer, (err2, decoded2) => {
            if (err2) return reject(err);
            resolve(decoded2);
          });
          return;
        }
        resolve(decoded);
      });
    } else {
      resolve(buffer);
    }
  });
}

export interface CourtInfo {
  name: string;
  type: "DistrictCourt" | "JusticeCourt";
  locationCode: string;
  /** HTML calendar URL: search.php?t=c&d=today&loc=XXXX */
  calendarUrl: string;
}

/**
 * Fetch raw content from a URL with redirect-following and timeout.
 * Retries with exponential backoff on transient failures.
 */
export async function fetchUrl(
  url: string,
  maxRetries = 3,
  timeoutMs = 30000
): Promise<Buffer> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
      await new Promise((r) => setTimeout(r, delay));
      console.log(`🔁 Retry ${attempt}/${maxRetries - 1} for ${url}`);
    }

    try {
      const result = await fetchUrlOnce(url, timeoutMs);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const code = (err as NodeJS.ErrnoException).code;
      // Only retry on transient errors
      if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED") {
        continue;
      }
      // Non-transient error — don't retry
      throw lastError;
    }
  }

  throw lastError ?? new Error(`Failed after ${maxRetries} retries: ${url}`);
}

function fetchUrlOnce(url: string, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;

    const req = client.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate",
          "Connection": "keep-alive",
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).toString();
          fetchUrlOnce(redirectUrl, timeoutMs).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          decompressBuffer(buffer, res.headers["content-encoding"])
            .then(resolve)
            .catch(reject);
        });
        res.on("error", reject);
      }
    );

    req.on("timeout", () => {
      req.destroy();
      const err = new Error(`Timeout after ${timeoutMs}ms for ${url}`);
      (err as NodeJS.ErrnoException).code = "ETIMEDOUT";
      reject(err);
    });
    req.on("error", reject);
  });
}

/**
 * Parse the legacy.utcourts.gov/cal/ page to extract all court location codes.
 *
 * The page has links like:
 *   <a href="search.php?t=c&d=today&loc=1868D">Today</a>
 *   <a href="search.php?t=c&d=today&loc=1867J">Today</a>
 *
 * under "District Court Calendars" and "Justice Court Calendars" sections.
 */
export function parseCourtListHtml(html: string): CourtInfo[] {
  const courts: CourtInfo[] = [];
  const seen = new Set<string>();

  // --- District Courts ---
  // Pattern: "* CourtName - [Today](search.php?t=c&d=today&loc=XXXXD)"
  // In raw HTML: <li>...CourtName...<a href="search.php?t=c&d=today&loc=XXXXD">Today</a></li>
  const districtSection = extractSection(html, "District Court Calendars", "Justice Court Calendars");
  if (districtSection) {
    extractCourts(districtSection, "DistrictCourt", courts, seen);
  }

  // --- Justice Courts ---
  const justiceSection = extractSection(html, "Justice Court Calendars", null);
  if (justiceSection) {
    extractCourts(justiceSection, "JusticeCourt", courts, seen);
  }

  return courts;
}

/**
 * Extract a section of HTML between two header markers.
 */
function extractSection(html: string, startMarker: string, endMarker: string | null): string | null {
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;

  const endIdx = endMarker ? html.indexOf(endMarker, startIdx + startMarker.length) : html.length;
  if (endIdx === -1) return html.slice(startIdx);

  return html.slice(startIdx, endIdx);
}

/**
 * Extract court entries from an HTML section.
 * Looks for patterns like:
 *   <li>Court Name - <a href="search.php?t=c&d=today&loc=1867J">Today</a></li>
 * or in the actual HTML: any <a> tag with href containing search.php?t=c&d=today&loc=
 */
function extractCourts(
  section: string,
  courtType: "DistrictCourt" | "JusticeCourt",
  courts: CourtInfo[],
  seen: Set<string>
): void {
  // Match <li> blocks containing court names and search.php links
  const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;

  while ((liMatch = liPattern.exec(section)) !== null) {
    const liContent = liMatch[1];
    const linkMatch = liContent.match(/href="search\.php\?t=c&d=today&loc=([^"]+)"/i);
    if (!linkMatch) continue;

    const locationCode = linkMatch[1];
    if (seen.has(locationCode)) continue;
    seen.add(locationCode);

    // Extract court name — everything before the <a> tag, stripped of HTML
    const nameBeforeLink = liContent.split(/<a\s/i)[0];
    let name = stripHtml(nameBeforeLink).replace(/\s*-\s*$/, "").trim();

    // Fallback: if name is empty, try to build from location code
    if (!name) {
      name = `Court ${locationCode}`;
    }

    courts.push({
      name,
      type: courtType,
      locationCode,
      calendarUrl: `${COURT_CALENDARS_BASE}/search.php?t=c&d=today&loc=${locationCode}`,
    });
  }

  // Fallback: also scan for search.php links outside <li> tags (some courts might be in other structures)
  const linkPattern = /href="search\.php\?t=c&d=today&loc=([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkPattern.exec(section)) !== null) {
    const locationCode = linkMatch[1];
    if (seen.has(locationCode)) continue;
    seen.add(locationCode);

    courts.push({
      name: `Court ${locationCode}`,
      type: courtType,
      locationCode,
      calendarUrl: `${COURT_CALENDARS_BASE}/search.php?t=c&d=today&loc=${locationCode}`,
    });
  }
}

/**
 * Strip HTML tags and decode common entities.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch the court list from the main calendar page.
 */
export async function fetchCourtList(): Promise<CourtInfo[]> {
  console.log("🔄 Fetching court list from legacy.utcourts.gov/cal/...");
  const htmlBuffer = await fetchUrl(`${COURT_CALENDARS_BASE}/`);
  const html = htmlBuffer.toString("utf-8");
  console.log(`📄 Court list HTML preview (first 300 chars): ${html.slice(0, 300)}`);
  const courts = parseCourtListHtml(html);
  console.log(`✅ Found ${courts.length} courts (District + Justice)`);
  return courts;
}

/**
 * Build a search URL for a given court and date.
 *
 * @param locationCode — e.g. "1867J", "1868D"
 * @param date — "today" or ISO date "2026-03-13"
 */
export function buildSearchUrl(locationCode: string, date: string = "today"): string {
  return `${COURT_CALENDARS_BASE}/search.php?t=c&d=${encodeURIComponent(date)}&loc=${encodeURIComponent(locationCode)}`;
}

/**
 * Fetch the HTML calendar results for a single court + date.
 * Returns the raw HTML string for parsing.
 */
export async function fetchCourtCalendarHtml(
  locationCode: string,
  date: string = "today"
): Promise<string> {
  const url = buildSearchUrl(locationCode, date);
  const buffer = await fetchUrl(url);
  return buffer.toString("utf-8");
}

/**
 * Live search parameters for utcourts.gov search.php GET form.
 */
export interface LiveSearchParams {
  /** Party/defendant name (min 2 chars) */
  partyName?: string;
  /** Case number (min 3 digits) */
  caseNumber?: string;
  /** Judge name (min 2 chars) */
  judgeName?: string;
  /** Attorney last name (min 2 chars) */
  attorneyLastName?: string;
  /** Attorney first name */
  attorneyFirstName?: string;
  /** Attorney bar number */
  attorneyBarNumber?: string;
  /** Date in YYYY-MM-DD format, or "all" for all dates */
  date?: string;
  /** Court location code (e.g. "1868D") */
  locationCode?: string;
}

/**
 * GET from legacy.utcourts.gov/cal/search.php with query parameters.
 *
 * The form uses method="get" with these parameters:
 *   t = search type: "p" (party), "c" (case), "j" (judge), "a" (attorney)
 *   p = party name
 *   c = case number
 *   j = judge name
 *   f = attorney first name
 *   l = attorney last name
 *   b = attorney bar number
 *   d = date in YYYY-MM-DD format or "all"
 *   loc = court location code
 */
export async function liveSearchUtcourts(params: LiveSearchParams): Promise<string> {
  const qs: Record<string, string> = {};

  // Determine search type and set the appropriate field
  if (params.caseNumber) {
    qs.t = "c";
    qs.c = params.caseNumber;
  } else if (params.partyName) {
    qs.t = "p";
    qs.p = params.partyName;
  } else if (params.judgeName) {
    qs.t = "j";
    qs.j = params.judgeName;
  } else if (params.attorneyLastName || params.attorneyBarNumber) {
    qs.t = "a";
    if (params.attorneyLastName) qs.l = params.attorneyLastName;
    if (params.attorneyFirstName) qs.f = params.attorneyFirstName;
    if (params.attorneyBarNumber) qs.b = params.attorneyBarNumber;
  } else {
    throw new Error("At least one search field (party name, case number, judge, or attorney) is required");
  }

  // Date — already in YYYY-MM-DD or "all"
  qs.d = (params.date && params.date !== "all") ? params.date : "all";

  // Location
  if (params.locationCode) {
    qs.loc = params.locationCode;
  }

  const queryString = new URLSearchParams(qs).toString();
  const url = `${COURT_CALENDARS_BASE}/search.php?${queryString}`;
  console.log(`🔍 Live search GET: ${url}`);

  const buffer = await fetchUrl(url);
  return buffer.toString("utf-8");
}
