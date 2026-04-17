import { getPool } from "../db/pool";
import { SearchRequest, CourtEvent } from "@shared/types";

/** Escape LIKE pattern special characters so user input is treated literally. */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

/**
 * Extract location-matching patterns from a court picker name.
 * e.g. "Third District Court - Salt Lake" → ["THIRD DISTRICT COURT - SALT LAKE", "SALT LAKE"]
 * e.g. "Provo Justice Court" → ["PROVO JUSTICE COURT", "PROVO"]
 */
function extractCourtLocationPatterns(name: string): string[] {
  const upper = name.toUpperCase().trim();
  const patterns = [upper];
  const dashIdx = upper.indexOf(" - ");
  if (dashIdx !== -1) {
    const loc = upper.slice(dashIdx + 3).trim();
    if (loc.length >= 2) patterns.push(loc);
  }
  const courtSuffix = upper.match(/^(.+?)\s+(JUSTICE|DISTRICT)\s+COURT/);
  if (courtSuffix) {
    const prefix = courtSuffix[1].trim();
    if (prefix.length >= 2 && !/^(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\b/.test(prefix)) {
      patterns.push(prefix);
    }
  }
  return [...new Set(patterns)];
}

export async function searchCourtEvents(params: SearchRequest): Promise<CourtEvent[]> {
  const pool = getPool();
  if (!pool) {
    throw new Error("Database unavailable");
  }

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.defendantName) {
    // Word-by-word match so "jon sill" finds "JONATHAN D SILL" — a substring
    // match would miss the middle initial. Each whitespace-separated word must
    // appear somewhere in defendant_name.
    const words = params.defendantName.toUpperCase().split(/\s+/).filter(Boolean);
    for (const word of words) {
      conditions.push(`UPPER(defendant_name) LIKE $${paramIndex} ESCAPE '\\'`);
      values.push(`%${escapeLike(word)}%`);
      paramIndex++;
    }
  }

  if (params.caseNumber) {
    conditions.push(`UPPER(case_number) LIKE $${paramIndex} ESCAPE '\\'`);
    values.push(`%${escapeLike(params.caseNumber.toUpperCase())}%`);
    paramIndex++;
  }

  if (params.courtNames) {
    const names = params.courtNames.split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length > 0) {
      // Court picker names like "Third District Court - Salt Lake" don't match
      // DB values like "Salt Lake City", so extract location keywords too.
      const patterns = names.flatMap(extractCourtLocationPatterns);
      const orClauses = patterns.map((_, i) => `UPPER(court_name) LIKE $${paramIndex + i} ESCAPE '\\' OR UPPER(hearing_location) LIKE $${paramIndex + i} ESCAPE '\\'`);
      conditions.push(`(${orClauses.join(" OR ")})`);
      patterns.forEach((p) => values.push(`%${escapeLike(p)}%`));
      paramIndex += patterns.length;
    }
  } else if (params.courtName) {
    const patterns = extractCourtLocationPatterns(params.courtName);
    const orClauses = patterns.map((_, i) => `UPPER(court_name) LIKE $${paramIndex + i} ESCAPE '\\' OR UPPER(hearing_location) LIKE $${paramIndex + i} ESCAPE '\\'`);
    conditions.push(`(${orClauses.join(" OR ")})`);
    patterns.forEach((p) => values.push(`%${escapeLike(p)}%`));
    paramIndex += patterns.length;
  }

  if (params.courtDate) {
    conditions.push(`event_date = $${paramIndex}`);
    values.push(params.courtDate);
    paramIndex++;
  }

  if (params.dateFrom && params.dateTo) {
    conditions.push(`event_date >= $${paramIndex} AND event_date <= $${paramIndex + 1}`);
    values.push(params.dateFrom, params.dateTo);
    paramIndex += 2;
  } else if (params.dateFrom) {
    conditions.push(`event_date >= $${paramIndex}`);
    values.push(params.dateFrom);
    paramIndex++;
  } else if (params.dateTo) {
    conditions.push(`event_date <= $${paramIndex}`);
    values.push(params.dateTo);
    paramIndex++;
  }

  if (params.defendantOtn) {
    conditions.push(`UPPER(defendant_otn) LIKE $${paramIndex} ESCAPE '\\'`);
    values.push(`%${escapeLike(params.defendantOtn.toUpperCase())}%`);
    paramIndex++;
  }

  if (params.citationNumber) {
    conditions.push(`UPPER(citation_number) LIKE $${paramIndex} ESCAPE '\\'`);
    values.push(`%${escapeLike(params.citationNumber.toUpperCase())}%`);
    paramIndex++;
  }

  if (params.charges) {
    conditions.push(`UPPER(charges::text) LIKE $${paramIndex} ESCAPE '\\'`);
    values.push(`%${escapeLike(params.charges.toUpperCase())}%`);
    paramIndex++;
  }

  if (params.judgeName) {
    conditions.push(`UPPER(judge_name) LIKE $${paramIndex} ESCAPE '\\'`);
    values.push(`%${escapeLike(params.judgeName.toUpperCase())}%`);
    paramIndex++;
  }

  if (params.attorney) {
    conditions.push(`(UPPER(REPLACE(prosecuting_attorney, chr(13), '')) LIKE $${paramIndex} ESCAPE '\\' OR UPPER(REPLACE(defense_attorney, chr(13), '')) LIKE $${paramIndex} ESCAPE '\\')`);
    values.push(`%${escapeLike(params.attorney.toUpperCase())}%`);
    paramIndex++;
  }

  if (conditions.length === 0) {
    return [];
  }

  const whereClause = conditions.join(" AND ");
  const sql = `
    SELECT
      id, court_type, court_name, court_room, event_date, event_time,
      hearing_type, case_number, case_type, defendant_name, defendant_otn,
      defendant_dob, citation_number, sheriff_number, lea_number,
      prosecuting_attorney, defense_attorney, source_pdf_url,
      source_page_number, content_hash, scraped_at,
      judge_name, hearing_location, is_virtual, source_url, charges, created_at
    FROM court_events
    WHERE ${whereClause}
    ORDER BY event_date DESC, event_time ASC
    LIMIT 2000
  `;

  const client = await pool.connect();
  try {
    const result = await client.query(sql, values);
    return result.rows.map(mapRowToCourtEvent);
  } finally {
    client.release();
  }
}

/** Format a DB date/timestamp to YYYY-MM-DD string using local date components */
function toDateString(val: unknown): string {
  if (!val) return "";
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(val);
  // If it already looks like YYYY-MM-DD, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try to parse and extract date portion
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${dy}`;
  }
  return s;
}

function mapRowToCourtEvent(row: Record<string, unknown>): CourtEvent {
  return {
    id: row.id as number,
    courtType: row.court_type as string,
    courtName: row.court_name as string,
    courtRoom: row.court_room as string | null,
    eventDate: toDateString(row.event_date),
    eventTime: row.event_time as string | null,
    hearingType: row.hearing_type as string | null,
    caseNumber: row.case_number as string | null,
    caseType: row.case_type as string | null,
    defendantName: row.defendant_name as string | null,
    defendantOtn: row.defendant_otn as string | null,
    defendantDob: toDateString(row.defendant_dob) || null,
    citationNumber: row.citation_number as string | null,
    sheriffNumber: row.sheriff_number as string | null,
    leaNumber: row.lea_number as string | null,
    prosecutingAttorney: row.prosecuting_attorney as string | null,
    defenseAttorney: row.defense_attorney as string | null,
    judgeName: row.judge_name as string | null,
    hearingLocation: row.hearing_location as string | null,
    isVirtual: (row.is_virtual as boolean) ?? false,
    sourcePdfUrl: row.source_pdf_url as string | null,
    sourceUrl: row.source_url as string | null,
    sourcePageNumber: row.source_page_number as number | null,
    contentHash: row.content_hash as string,
    charges: Array.isArray(row.charges) ? row.charges as string[] : [],
    scrapedAt: row.scraped_at ? toDateString(row.scraped_at) : "",
    createdAt: row.created_at ? new Date(row.created_at as string).toISOString() : undefined,
  };
}
