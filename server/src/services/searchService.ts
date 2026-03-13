import { getPool } from "../db/pool";
import { SearchRequest, CourtEvent } from "../../../shared/types";

export async function searchCourtEvents(params: SearchRequest): Promise<CourtEvent[]> {
  const pool = getPool();
  if (!pool) {
    throw new Error("Database unavailable");
  }

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.defendantName) {
    conditions.push(`UPPER(defendant_name) LIKE $${paramIndex}`);
    values.push(`%${params.defendantName.toUpperCase()}%`);
    paramIndex++;
  }

  if (params.caseNumber) {
    conditions.push(`UPPER(case_number) LIKE $${paramIndex}`);
    values.push(`%${params.caseNumber.toUpperCase()}%`);
    paramIndex++;
  }

  if (params.courtName) {
    conditions.push(`UPPER(court_name) LIKE $${paramIndex}`);
    values.push(`%${params.courtName.toUpperCase()}%`);
    paramIndex++;
  }

  if (params.courtDate) {
    conditions.push(`event_date = $${paramIndex}`);
    values.push(params.courtDate);
    paramIndex++;
  }

  if (params.defendantOtn) {
    conditions.push(`UPPER(defendant_otn) LIKE $${paramIndex}`);
    values.push(`%${params.defendantOtn.toUpperCase()}%`);
    paramIndex++;
  }

  if (params.citationNumber) {
    conditions.push(`UPPER(citation_number) LIKE $${paramIndex}`);
    values.push(`%${params.citationNumber.toUpperCase()}%`);
    paramIndex++;
  }

  if (params.charges) {
    conditions.push(`UPPER(charges::text) LIKE $${paramIndex}`);
    values.push(`%${params.charges.toUpperCase()}%`);
    paramIndex++;
  }

  if (params.judgeName) {
    conditions.push(`UPPER(judge_name) LIKE $${paramIndex}`);
    values.push(`%${params.judgeName.toUpperCase()}%`);
    paramIndex++;
  }

  if (params.attorney) {
    conditions.push(`(UPPER(prosecuting_attorney) LIKE $${paramIndex} OR UPPER(defense_attorney) LIKE $${paramIndex})`);
    values.push(`%${params.attorney.toUpperCase()}%`);
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
      judge_name, hearing_location, is_virtual, source_url, charges
    FROM court_events
    WHERE ${whereClause}
    ORDER BY event_date DESC, event_time ASC
    LIMIT 200
  `;

  const client = await pool.connect();
  try {
    const result = await client.query(sql, values);
    return result.rows.map(mapRowToCourtEvent);
  } finally {
    client.release();
  }
}

function mapRowToCourtEvent(row: Record<string, unknown>): CourtEvent {
  return {
    id: row.id as number,
    courtType: row.court_type as string,
    courtName: row.court_name as string,
    courtRoom: row.court_room as string | null,
    eventDate: row.event_date ? String(row.event_date) : "",
    eventTime: row.event_time as string | null,
    hearingType: row.hearing_type as string | null,
    caseNumber: row.case_number as string | null,
    caseType: row.case_type as string | null,
    defendantName: row.defendant_name as string | null,
    defendantOtn: row.defendant_otn as string | null,
    defendantDob: row.defendant_dob ? String(row.defendant_dob) : null,
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
    scrapedAt: row.scraped_at ? String(row.scraped_at) : "",
  };
}
