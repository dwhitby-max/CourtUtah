import { Router, Request, Response } from "express";
import { heavyLimiter } from "../middleware/rateLimiter";
import { authenticateToken } from "../middleware/auth";
import { searchCourtEvents } from "../services/searchService";
import { liveSearchUtcourts, LiveSearchParams, fetchCourtList, CourtInfo } from "../services/courtScraper";
import { parseHtmlCalendarResults, ParsedCourtEvent } from "../services/courtEventParser";
import { CourtEvent, DetectedChange } from "../../../shared/types";
import { getPool } from "../db/pool";
import { config } from "../config/env";
import { detectChanges, processChanges } from "../services/changeDetector";
import { notifyScheduleChange } from "../services/notificationService";
import { syncCalendarEntry } from "../services/calendarSync";


const router = Router();

// --- Court list cache (refreshed every 24h) ---
let cachedCourts: CourtInfo[] = [];
let courtsCachedAt = 0;
const COURTS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getCourts(): Promise<CourtInfo[]> {
  if (cachedCourts.length > 0 && Date.now() - courtsCachedAt < COURTS_CACHE_TTL) {
    return cachedCourts;
  }
  try {
    cachedCourts = await fetchCourtList();
    courtsCachedAt = Date.now();
  } catch (err) {
    console.error("Failed to fetch court list:", err);
    // Return stale cache if available
    if (cachedCourts.length > 0) return cachedCourts;
    throw err;
  }
  return cachedCourts;
}

// GET /api/search/courts — list all available courts (public, cached)
router.get("/courts", async (_req: Request, res: Response) => {
  try {
    const courts = await getCourts();
    res.json(courts.map((c) => ({
      name: c.name,
      type: c.type,
      locationCode: c.locationCode,
    })));
  } catch (err) {
    console.error("Failed to serve court list:", err);
    res.status(500).json({ error: "Failed to fetch court list" });
  }
});

// GET /api/search/coverage — date range and counts of scraped data (public)
router.get("/coverage", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as total_events,
                COUNT(DISTINCT court_name) as total_courts,
                MIN(event_date) as earliest_date,
                MAX(event_date) as latest_date
         FROM court_events`
      );
      const row = result.rows[0];
      res.json({
        totalEvents: parseInt(row.total_events, 10),
        totalCourts: parseInt(row.total_courts, 10),
        earliestDate: row.earliest_date ? new Date(row.earliest_date).toISOString().split("T")[0] : null,
        latestDate: row.latest_date ? new Date(row.latest_date).toISOString().split("T")[0] : null,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Failed to fetch coverage:", err);
    res.status(500).json({ error: "Failed to fetch coverage" });
  }
});

// Search is public (no auth required) — rate-limited to prevent abuse
router.use(heavyLimiter);

/**
 * Map user search params to LiveSearchParams for utcourts.gov.
 * Returns null if no searchable field is provided (OTN, citation, charges are DB-only).
 *
 * IMPORTANT: utcourts.gov requires a location code (loc=) for all search types
 * to return results. Without it, every search returns "No results found."
 * The loc code is added separately per-court in the search route.
 *
 * This returns the base params WITHOUT date or location — those are
 * expanded into individual requests (one per court × date combo).
 */
function toLiveSearchBase(params: Record<string, string | undefined>): LiveSearchParams | null {
  if (params.caseNumber) return { caseNumber: params.caseNumber };
  if (params.defendantName) return { partyName: params.defendantName };
  if (params.judgeName) return { judgeName: params.judgeName };
  if (params.attorney) {
    const parts = params.attorney.trim().split(/\s+/);
    if (parts.length >= 2) {
      return {
        attorneyFirstName: parts.slice(0, -1).join(" "),
        attorneyLastName: parts[parts.length - 1],
      };
    }
    return { attorneyLastName: parts[0] };
  }
  return null;
}

/** Expand date params into individual YYYY-MM-DD strings (weekdays only). */
function expandDates(params: Record<string, string | undefined>): string[] {
  if (params.courtDate) return [params.courtDate];
  const from = params.dateFrom;
  const to = params.dateTo;
  if (from && to) {
    const dates: string[] = [];
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) dates.push(d.toISOString().split("T")[0]);
    }
    return dates.slice(0, 15);
  }
  if (from) return [from];
  if (to) return [to];
  return ["all"];
}

/** Resolve court selection to location codes.
 *  - allCourts=true → every court
 *  - courtNames set  → only those courts
 *  - neither         → empty (no live search)
 */
function resolveCourtCodes(params: Record<string, string | undefined>, courts: CourtInfo[]): string[] {
  if (params.allCourts === "true") return courts.map((c) => c.locationCode);
  if (!params.courtNames || courts.length === 0) return [];
  const names = params.courtNames.split(",").map((n) => n.trim().replace(/\s+/g, " ").toUpperCase()).filter(Boolean);
  const codes: string[] = [];
  for (const name of names) {
    // Try exact match first, then substring match (handles minor format differences)
    const match = courts.find((c) => {
      const normalized = c.name.trim().replace(/\s+/g, " ").toUpperCase();
      return normalized === name || normalized.includes(name) || name.includes(normalized);
    });
    if (match) {
      codes.push(match.locationCode);
    } else {
      console.warn(`  ⚠️ resolveCourtCodes: no match for "${name}" among ${courts.length} courts`);
    }
  }
  return codes;
}

/**
 * Build a canonical key from search params for deduplication.
 */
function searchParamsKey(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v).toUpperCase().trim()}`);
  return entries.join("&");
}

/**
 * Build a human-readable label from search params.
 */
function buildSearchLabel(params: Record<string, string | undefined>): string {
  const parts: string[] = [];
  if (params.defendantName) parts.push(`Defendant: ${params.defendantName}`);
  if (params.caseNumber) parts.push(`Case: ${params.caseNumber}`);
  if (params.courtNames) {
    const names = params.courtNames.split(",").map((n) => n.trim()).filter(Boolean);
    parts.push(names.length <= 2 ? `Courts: ${names.join(", ")}` : `Courts: ${names.length} selected`);
  } else if (params.courtName) parts.push(`Court: ${params.courtName}`);
  if (params.judgeName) parts.push(`Judge: ${params.judgeName}`);
  if (params.attorney) parts.push(`Attorney: ${params.attorney}`);
  if (params.defendantOtn) parts.push(`OTN: ${params.defendantOtn}`);
  if (params.citationNumber) parts.push(`Citation: ${params.citationNumber}`);
  if (params.charges) parts.push(`Charges: ${params.charges}`);
  if (params.courtDate) parts.push(`Date: ${params.courtDate}`);
  if (params.dateFrom && params.dateTo) parts.push(`${params.dateFrom} to ${params.dateTo}`);
  else if (params.dateFrom) parts.push(`From: ${params.dateFrom}`);
  else if (params.dateTo) parts.push(`To: ${params.dateTo}`);
  return parts.join(" | ") || "Search";
}

/**
 * Check if a watched case (auto-saved search) already exists for this user with matching params.
 */
async function findExistingAutoSearch(
  userId: number,
  paramsKey: string
): Promise<{ id: number; last_refreshed_at: string | null } | null> {
  const pool = getPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, last_refreshed_at FROM watched_cases
       WHERE user_id = $1 AND search_params->>'_key' = $2 AND is_active = true
       LIMIT 1`,
      [userId, paramsKey]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    client.release();
  }
}

/**
 * Save or update a watched case record for the user (replaces saved_searches).
 * Derives search_type/search_value from the primary searchable field.
 */
async function saveSearch(
  userId: number,
  params: Record<string, string | undefined>,
  paramsKey: string,
  resultsCount: number
): Promise<{ savedSearchId: number; previousRunAt: string | null }> {
  const pool = getPool();
  if (!pool) return { savedSearchId: -1, previousRunAt: null };
  const client = await pool.connect();
  try {
    const existing = await findExistingAutoSearch(userId, paramsKey);
    const paramsWithKey = { ...params, _key: paramsKey };
    const label = buildSearchLabel(params);

    // Derive search_type and search_value from the primary field
    let searchType = "defendant_name";
    let searchValue = "unknown";
    if (params.defendantName) { searchType = "defendant_name"; searchValue = params.defendantName; }
    else if (params.caseNumber) { searchType = "case_number"; searchValue = params.caseNumber; }
    else if (params.judgeName) { searchType = "judge_name"; searchValue = params.judgeName; }
    else if (params.attorney) { searchType = "attorney"; searchValue = params.attorney; }
    else if (params.courtName) { searchType = "court_name"; searchValue = params.courtName; }
    else if (params.defendantOtn) { searchType = "defendant_otn"; searchValue = params.defendantOtn; }
    else if (params.citationNumber) { searchType = "citation_number"; searchValue = params.citationNumber; }

    if (existing) {
      const previousRunAt = existing.last_refreshed_at
        ? new Date(existing.last_refreshed_at).toISOString()
        : null;
      await client.query(
        `UPDATE watched_cases
         SET results_count = $1, last_refreshed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [resultsCount, existing.id]
      );
      return { savedSearchId: existing.id, previousRunAt };
    }

    const result = await client.query(
      `INSERT INTO watched_cases (user_id, search_type, search_value, label, search_params, results_count, last_refreshed_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'auto_search')
       RETURNING id`,
      [userId, searchType, searchValue, label, JSON.stringify(paramsWithKey), resultsCount]
    );
    return { savedSearchId: result.rows[0].id, previousRunAt: null };
  } finally {
    client.release();
  }
}

/**
 * Persist live-scraped events into court_events table so future searches hit the DB.
 * Detects changes against existing DB records, logs them, and notifies affected users.
 * Returns array of detected changes for the API response.
 */
async function persistLiveResults(parsed: ParsedCourtEvent[]): Promise<DetectedChange[]> {
  const pool = getPool();
  if (!pool || parsed.length === 0) return [];

  const allDetectedChanges: DetectedChange[] = [];
  const client = await pool.connect();
  try {
    for (const event of parsed) {
      // Upsert by case_number + event_date + event_time
      if (!event.caseNumber || !event.eventDate) continue;
      try {
        const existing = await client.query(
          `SELECT id, court_room, event_date::text, event_time, hearing_type,
                  case_number, case_type, defendant_name,
                  prosecuting_attorney, defense_attorney,
                  judge_name, hearing_location, content_hash
           FROM court_events
           WHERE case_number = $1 AND event_date = $2 AND COALESCE(event_time, '') = COALESCE($3, '') LIMIT 1`,
          [event.caseNumber, event.eventDate, event.eventTime]
        );

        if (existing.rows.length > 0) {
          const row = existing.rows[0];

          // Build incoming record in DB column format for change detection
          const incoming: Record<string, unknown> = {
            court_room: event.courtRoom || "",
            event_date: event.eventDate || "",
            event_time: event.eventTime || "",
            hearing_type: event.hearingType || "",
            case_number: event.caseNumber || "",
            case_type: event.caseType || "",
            defendant_name: event.defendantName || "",
            prosecuting_attorney: event.prosecutingAttorney || "",
            defense_attorney: event.defenseAttorney || "",
            judge_name: event.judgeName || "",
            hearing_location: event.hearingLocation || "",
          };

          // Detect field-level changes
          const changes = detectChanges(row, incoming);

          if (changes.length > 0) {
            console.log(`🔄 Changes detected for case ${event.caseNumber} (event ${row.id}):`, changes.map(c => `${c.field}: "${c.oldValue}" → "${c.newValue}"`).join(", "));

            // Log changes to change_log table
            await processChanges(row.id, changes);

            allDetectedChanges.push({
              courtEventId: row.id,
              caseNumber: event.caseNumber,
              defendantName: event.defendantName || null,
              changes,
            });

            // Update the DB record with all live-scraped fields
            await client.query(
              `UPDATE court_events SET
                court_name = COALESCE(NULLIF($1, ''), court_name),
                court_room = COALESCE(NULLIF($2, ''), court_room),
                hearing_type = COALESCE(NULLIF($3, ''), hearing_type),
                case_type = COALESCE(NULLIF($4, ''), case_type),
                defendant_name = COALESCE(NULLIF($5, ''), defendant_name),
                prosecuting_attorney = COALESCE(NULLIF($6, ''), prosecuting_attorney),
                defense_attorney = COALESCE(NULLIF($7, ''), defense_attorney),
                judge_name = COALESCE(NULLIF($8, ''), judge_name),
                hearing_location = COALESCE(NULLIF($9, ''), hearing_location),
                content_hash = COALESCE(NULLIF($10, ''), content_hash),
                updated_at = NOW()
              WHERE id = $11`,
              [
                event.courtName || "", event.courtRoom, event.hearingType, event.caseType,
                event.defendantName, event.prosecutingAttorney,
                event.defenseAttorney, event.judgeName,
                event.hearingLocation, event.contentHash, row.id,
              ]
            );

            // Notify all users who are watching this case + trigger calendar sync
            const watchers = await client.query(
              `SELECT DISTINCT wc.user_id
               FROM watched_cases wc
               WHERE wc.is_active = true
                 AND (
                   (wc.search_type = 'case_number' AND UPPER(wc.search_value) = UPPER($1))
                   OR (wc.search_type = 'defendant_name' AND UPPER($2) LIKE '%' || UPPER(wc.search_value) || '%')
                 )`,
              [event.caseNumber, event.defendantName || ""]
            );

            for (const watcher of watchers.rows) {
              await notifyScheduleChange(
                watcher.user_id,
                `${event.defendantName || "Unknown"} — Case ${event.caseNumber}`,
                changes
              );
            }

            // Re-sync any calendar entries linked to this court event
            const calEntries = await client.query(
              `SELECT id FROM calendar_entries
               WHERE court_event_id = $1 AND sync_status IN ('synced', 'pending_update')`,
              [row.id]
            );
            for (const ce of calEntries.rows) {
              syncCalendarEntry(ce.id).catch((err) =>
                console.warn(`⚠️ Calendar re-sync failed for entry ${ce.id}:`, err instanceof Error ? err.message : err)
              );
            }
          } else {
            // No tracked-field changes, but still fill in missing attorney data
            const updates: string[] = [];
            const values: (string | null)[] = [];
            let paramIdx = 1;

            if (event.defenseAttorney && !row.defense_attorney) {
              updates.push(`defense_attorney = $${paramIdx++}`);
              values.push(event.defenseAttorney);
            }
            if (event.prosecutingAttorney && !row.prosecuting_attorney) {
              updates.push(`prosecuting_attorney = $${paramIdx++}`);
              values.push(event.prosecutingAttorney);
            }

            if (updates.length > 0) {
              updates.push(`updated_at = NOW()`);
              await client.query(
                `UPDATE court_events SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
                [...values, row.id]
              );
            }
          }
          continue;
        }

        await client.query(
          `INSERT INTO court_events (
            court_type, court_name, court_room, event_date, event_time,
            hearing_type, case_number, case_type, defendant_name,
            defendant_otn, defendant_dob, prosecuting_attorney,
            defense_attorney, citation_number, sheriff_number,
            lea_number, content_hash,
            judge_name, hearing_location, is_virtual
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [
            "", event.courtName || "", event.courtRoom, event.eventDate,
            event.eventTime, event.hearingType, event.caseNumber,
            event.caseType, event.defendantName, event.defendantOtn,
            event.defendantDob, event.prosecutingAttorney,
            event.defenseAttorney, event.citationNumber,
            event.sheriffNumber, event.leaNumber, event.contentHash,
            event.judgeName, event.hearingLocation, event.isVirtual,
          ]
        );
      } catch (err) {
        // Log but continue — don't let one event failure stop the rest
        console.warn(`⚠️ Failed to persist event ${event.caseNumber}:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    client.release();
  }
  return allDetectedChanges;
}

// GET /api/search — supports: defendant_name, case_number, court_name, court_date,
// date_from, date_to, defendant_otn, citation_number, charges, judge_name, attorney
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  console.log("🔍 Search params:", req.query);
  /** Extract a query param as string or undefined (type-safe) */
  function qp(key: string): string | undefined {
    const val = req.query[key];
    return typeof val === "string" ? val : undefined;
  }
  const searchParams: Record<string, string | undefined> = {
    defendantName: qp("defendant_name"),
    caseNumber: qp("case_number"),
    courtName: qp("court_name"),
    courtNames: qp("court_names"),
    allCourts: qp("all_courts"),
    courtDate: qp("court_date"),
    dateFrom: qp("date_from"),
    dateTo: qp("date_to"),
    defendantOtn: qp("defendant_otn"),
    citationNumber: qp("citation_number"),
    charges: qp("charges"),
    judgeName: qp("judge_name"),
    attorney: qp("attorney"),
  };

  // Courts, dates, and allCourts are filters — at least one actual search field is required
  const hasSearchField = !!(
    searchParams.defendantName || searchParams.caseNumber ||
    searchParams.defendantOtn || searchParams.citationNumber ||
    searchParams.charges || searchParams.judgeName || searchParams.attorney
  );
  if (!hasSearchField) {
    res.status(400).json({ error: "Please enter at least one search field (defendant name, case number, OTN, citation, charges, judge, or attorney)." });
    return;
  }

  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const userId = req.user.userId;
  const pKey = searchParamsKey(searchParams);

  try {
    const liveBase = toLiveSearchBase(searchParams);
    const courts = await getCourts();
    const courtCodes = resolveCourtCodes(searchParams, courts);

    // utcourts.gov REQUIRES a location code for searches to return results.
    // If no courts selected or no live-searchable field, use DB only.
    if (!liveBase || courtCodes.length === 0) {
      const dbResults = await searchCourtEvents(searchParams);
      const source = !liveBase ? "database" : "database";
      if (courtCodes.length === 0 && liveBase) {
        console.log("  ⚠️ No courts selected — using DB only (utcourts.gov requires a court location)");
      }
      console.log(`  📊 DB-only search: ${dbResults.length} results`);
      const { savedSearchId, previousRunAt } = await saveSearch(userId, searchParams, pKey, dbResults.length);
      markNewEvents(dbResults, previousRunAt);
      res.json({
        results: dbResults,
        resultsCount: dbResults.length,
        searchParams,
        source,
        savedSearchId,
        previousRunAt,
        processedAt: new Date().toISOString(),
      });
      return;
    }

    // Build exact court × date combinations to query.
    // Each request to utcourts.gov mirrors exactly what a user would do on
    // the site: one search with a specific court, date, and search field.
    const dates = expandDates(searchParams);
    const jobs: { loc: string; date: string }[] = [];
    for (const loc of courtCodes) {
      for (const date of dates) {
        jobs.push({ loc, date });
      }
    }

    const BATCH_SIZE = 15;
    console.log(`🌐 Live searching: ${courtCodes.length} court(s) × ${dates.length} date(s) = ${jobs.length} request(s)`);

    // Build a lookup from location code → full court info so we can annotate parsed events
    const courtByLoc = new Map(courts.map((c) => [c.locationCode, c]));

    const dbResultsPromise = searchCourtEvents(searchParams);
    const allParsed: ParsedCourtEvent[] = [];
    let failedJobs = 0;
    let emptyJobs = 0;
    let totalHtmlLen = 0;
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      const batch = jobs.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((j) =>
          liveSearchUtcourts({ ...liveBase, locationCode: j.loc, date: j.date })
            .then((html) => ({ html, loc: j.loc }))
            .catch((err) => {
              failedJobs++;
              console.warn(`⚠️ Search failed for loc=${j.loc} date=${j.date}:`, err instanceof Error ? err.message : err);
              return { html: "", loc: j.loc };
            })
        )
      );
      // Parse each job's HTML separately and annotate with court metadata
      for (const { html, loc } of results) {
        totalHtmlLen += html.length;
        if (html.length === 0) { emptyJobs++; continue; }
        const courtInfo = courtByLoc.get(loc);
        const parsed = parseHtmlCalendarResults(html);
        for (const event of parsed) {
          event.courtName = courtInfo?.name ?? null;
          event.courtLocationCode = loc;
        }
        allParsed.push(...parsed);
      }
    }

    const dbResults = await dbResultsPromise;

    // Diagnostic logging
    console.log(`  📋 Live: ${allParsed.length} parsed events from ${totalHtmlLen} chars HTML (${failedJobs} failed jobs, ${emptyJobs} empty responses)`);
    console.log(`  📋 DB: ${dbResults.length} events`);

    // Persist live results and detect changes (awaited so we can return changes)
    let detectedChanges: DetectedChange[] = [];
    try {
      detectedChanges = await persistLiveResults(allParsed);
      if (detectedChanges.length > 0) {
        console.log(`🔔 ${detectedChanges.length} event(s) with changes detected`);
      }
    } catch (err) {
      console.warn("⚠️ Failed to persist live results:", err instanceof Error ? err.message : err);
    }

    // Convert live-parsed results to CourtEvent format and apply filters
    const liveEvents = allParsed.map((event) => toCourtEvent(event));
    const filteredLive = applyAllFilters(liveEvents, searchParams);

    // Merge: use DB results as the base (they have richer data from reports.php),
    // then add any live results whose case_number+date aren't already in the DB set.
    const dbKeys = new Set(
      dbResults.map((r) => `${r.caseNumber}|${r.eventDate}|${r.eventTime || ""}`)
    );
    const extraLive = filteredLive.filter(
      (e) => !dbKeys.has(`${e.caseNumber}|${e.eventDate}|${e.eventTime || ""}`)
    );
    const merged = [...dbResults, ...extraLive].slice(0, 2000);

    console.log(`  📊 Merge: ${dbResults.length} DB + ${extraLive.length} extra live = ${merged.length} total results`);

    const { savedSearchId, previousRunAt } = await saveSearch(userId, searchParams, pKey, merged.length);
    markNewEvents(merged, previousRunAt);
    res.json({
      results: merged,
      resultsCount: merged.length,
      searchParams,
      source: "live",
      savedSearchId,
      previousRunAt,
      processedAt: new Date().toISOString(),
      detectedChanges: detectedChanges.length > 0 && previousRunAt ? detectedChanges : undefined,
    });
  } catch (err) {
    console.error("❌ Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

/**
 * Mark events as new if they were created after the previous search run.
 * Events without createdAt (live results) are always considered new when previousRunAt exists.
 */
function markNewEvents(events: CourtEvent[], previousRunAt: string | null): void {
  if (!previousRunAt) return; // First run — nothing is "new"
  const cutoff = new Date(previousRunAt).getTime();
  for (const event of events) {
    if (!event.createdAt) {
      // Live result without DB row — it's new
      event.isNew = true;
    } else {
      event.isNew = new Date(event.createdAt).getTime() > cutoff;
    }
  }
}

/** Counter for assigning temporary negative IDs to live (non-persisted) results */
let liveIdCounter = 0;

/**
 * Convert a ParsedCourtEvent to a CourtEvent for the API response.
 */
function toCourtEvent(event: ParsedCourtEvent): CourtEvent {
  liveIdCounter -= 1;
  return {
    id: liveIdCounter,
    courtType: "",
    courtName: event.courtName || event.hearingLocation || "",
    courtRoom: event.courtRoom,
    eventDate: event.eventDate || "",
    eventTime: event.eventTime,
    hearingType: event.hearingType,
    caseNumber: event.caseNumber,
    caseType: event.caseType,
    defendantName: event.defendantName,
    defendantOtn: event.defendantOtn,
    defendantDob: event.defendantDob,
    citationNumber: event.citationNumber,
    sheriffNumber: event.sheriffNumber,
    leaNumber: event.leaNumber,
    prosecutingAttorney: event.prosecutingAttorney,
    defenseAttorney: event.defenseAttorney,
    judgeName: event.judgeName,
    hearingLocation: event.hearingLocation,
    isVirtual: event.isVirtual,
    sourcePdfUrl: null,
    sourceUrl: null,
    sourcePageNumber: null,
    contentHash: event.contentHash,
    charges: [],
    scrapedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Apply all search filters locally against scraped results.
 */
function applyAllFilters(
  results: CourtEvent[],
  params: Record<string, string | undefined>
): CourtEvent[] {
  let filtered = results;

  if (params.defendantName) {
    const name = params.defendantName.toUpperCase();
    filtered = filtered.filter(
      (e) => e.defendantName && e.defendantName.toUpperCase().includes(name)
    );
  }

  if (params.caseNumber) {
    const cn = params.caseNumber.toUpperCase();
    filtered = filtered.filter(
      (e) => e.caseNumber && e.caseNumber.toUpperCase().includes(cn)
    );
  }

  if (params.courtNames) {
    // Match against courtName (now set from court list) and hearingLocation.
    // Check both directions for backward compat with old DB rows that only have city names.
    const names = params.courtNames.split(",").map((n) => n.trim().toUpperCase()).filter(Boolean);
    if (names.length > 0) {
      filtered = filtered.filter((e) => {
        const cn = (e.courtName || "").toUpperCase();
        const hl = (e.hearingLocation || "").toUpperCase();
        return names.some(
          (name) =>
            cn.includes(name) || hl.includes(name) ||
            (cn.length > 2 && name.includes(cn)) ||
            (hl.length > 2 && name.includes(hl))
        );
      });
    }
  } else if (params.courtName) {
    const court = params.courtName.toUpperCase();
    filtered = filtered.filter((e) => {
      const cn = (e.courtName || "").toUpperCase();
      const hl = (e.hearingLocation || "").toUpperCase();
      return cn.includes(court) || hl.includes(court) ||
        (cn.length > 2 && court.includes(cn)) ||
        (hl.length > 2 && court.includes(hl));
    });
  }

  if (params.judgeName) {
    const judge = params.judgeName.toUpperCase();
    filtered = filtered.filter(
      (e) => e.judgeName && e.judgeName.toUpperCase().includes(judge)
    );
  }

  if (params.attorney) {
    const atty = params.attorney.toUpperCase();
    filtered = filtered.filter(
      (e) =>
        (e.prosecutingAttorney && e.prosecutingAttorney.toUpperCase().includes(atty)) ||
        (e.defenseAttorney && e.defenseAttorney.toUpperCase().includes(atty))
    );
  }

  if (params.defendantOtn) {
    const otn = params.defendantOtn.toUpperCase();
    filtered = filtered.filter(
      (e) => e.defendantOtn && e.defendantOtn.toUpperCase().includes(otn)
    );
  }

  if (params.citationNumber) {
    const cit = params.citationNumber.toUpperCase();
    filtered = filtered.filter(
      (e) => e.citationNumber && e.citationNumber.toUpperCase().includes(cit)
    );
  }

  if (params.charges) {
    const ch = params.charges.toUpperCase();
    filtered = filtered.filter(
      (e) => e.charges && e.charges.some((c) => c.toUpperCase().includes(ch))
    );
  }

  if (params.courtDate) {
    filtered = filtered.filter((e) => e.eventDate === params.courtDate);
  }
  if (params.dateFrom) {
    filtered = filtered.filter((e) => e.eventDate && e.eventDate >= params.dateFrom!);
  }
  if (params.dateTo) {
    filtered = filtered.filter((e) => e.eventDate && e.eventDate <= params.dateTo!);
  }

  return filtered;
}

export default router;
