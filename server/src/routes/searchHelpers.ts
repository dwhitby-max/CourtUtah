import { LiveSearchParams, CourtInfo } from "../services/courtScraper";
import { ParsedCourtEvent } from "../services/courtEventParser";
import { CourtEvent, DetectedChange } from "@shared/types";
import { getPool } from "../db/pool";
import { detectChanges, processChanges } from "../services/changeDetector";
import { notifyScheduleChange } from "../services/notificationService";
import { syncCalendarEntry } from "../services/calendarSync";

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
export function toLiveSearchBase(params: Record<string, string | undefined>): LiveSearchParams | null {
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
export function expandDates(params: Record<string, string | undefined>): string[] {
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
export function resolveCourtCodes(params: Record<string, string | undefined>, courts: CourtInfo[]): string[] {
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
export function searchParamsKey(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v).toUpperCase().trim()}`);
  return entries.join("&");
}

/**
 * Build a human-readable label from search params.
 */
export function buildSearchLabel(params: Record<string, string | undefined>): string {
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
export async function findExistingAutoSearch(
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
export async function saveSearch(
  userId: number,
  params: Record<string, string | undefined>,
  paramsKey: string,
  resultsCount: number,
  userPlan?: string
): Promise<{ savedSearchId: number; previousRunAt: string | null; limitReached?: boolean }> {
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

    // Free plan: max 3 saved searches
    const plan = userPlan || "free";
    if (plan === "free") {
      const countResult = await client.query<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM watched_cases
         WHERE user_id = $1 AND source = 'auto_search' AND is_active = true`,
        [userId]
      );
      if (parseInt(countResult.rows[0].cnt, 10) >= 3) {
        // Don't save — return flag so the caller can still return results
        return { savedSearchId: -1, previousRunAt: null, limitReached: true };
      }
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
export async function persistLiveResults(parsed: ParsedCourtEvent[]): Promise<DetectedChange[]> {
  const pool = getPool();
  if (!pool || parsed.length === 0) return [];

  const allDetectedChanges: DetectedChange[] = [];
  const client = await pool.connect();
  try {
    for (const event of parsed) {
      // Upsert by case_number + event_date + event_time — a case can have
      // multiple hearings on the same day at different times.
      // Also check for same case+date with different time (rescheduled hearing).
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

        // If no exact match, check for same case+date with a DIFFERENT time.
        // This catches rescheduled hearings — update the existing row's time
        // rather than creating a duplicate.
        if (existing.rows.length === 0) {
          const rescheduled = await client.query(
            `SELECT id, court_room, event_date::text, event_time, hearing_type,
                    case_number, case_type, defendant_name,
                    prosecuting_attorney, defense_attorney,
                    judge_name, hearing_location, content_hash
             FROM court_events
             WHERE case_number = $1 AND event_date = $2 AND COALESCE(event_time, '') != COALESCE($3, '')
             LIMIT 1`,
            [event.caseNumber, event.eventDate, event.eventTime]
          );
          if (rescheduled.rows.length > 0) {
            // Treat as an update to the existing row (time changed)
            existing.rows = rescheduled.rows;
          }
        }

        if (existing.rows.length > 0) {
          const row = existing.rows[0];

          // Build incoming record in DB column format for change detection.
          // Don't overwrite existing DB values with empty strings — enrichment
          // may have failed (e.g. details.php timeout), and blanking out known
          // attorney data triggers false "change" notifications.
          const incoming: Record<string, unknown> = {
            court_room: event.courtRoom || "",
            event_date: event.eventDate || "",
            event_time: event.eventTime || "",
            hearing_type: event.hearingType || "",
            case_number: event.caseNumber || "",
            case_type: event.caseType || "",
            defendant_name: event.defendantName || "",
            prosecuting_attorney: event.prosecutingAttorney || row.prosecuting_attorney || "",
            defense_attorney: event.defenseAttorney || row.defense_attorney || "",
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

/**
 * Mark events as new if they were created after the previous search run.
 * Events without createdAt (live results) are always considered new when previousRunAt exists.
 */
export function markNewEvents(events: CourtEvent[], previousRunAt: string | null): void {
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
export function toCourtEvent(event: ParsedCourtEvent): CourtEvent {
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
export function applyAllFilters(
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
    // Split search term into words — each word must appear in at least one attorney field
    const attyWords = params.attorney.toUpperCase().split(/\s+/).filter(Boolean);
    filtered = filtered.filter((e) => {
      const pros = (e.prosecutingAttorney || "").toUpperCase();
      const def = (e.defenseAttorney || "").toUpperCase();
      const combined = `${pros} ${def}`;
      return attyWords.every((w) => combined.includes(w));
    });
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
