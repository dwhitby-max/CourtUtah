import cron from "node-cron";
import { getPool } from "../db/pool";
import { fetchCourtList, fetchCourtCalendarHtml, fetchUrl, buildSearchUrl, CourtInfo } from "./courtScraper";
import { parseHtmlCalendarResults, parseCourtCalendarText, ParsedCourtEvent } from "./courtEventParser";
import { detectChanges, processChanges } from "./changeDetector";
import { syncCalendarEntry } from "./calendarSync";
import { buildReportUrl, fetchReportHtml, parseReportHtml, enrichEventsWithReportData } from "./reportParser";
import { captureException, captureMessage } from "./sentryService";
import { matchWatchedCases } from "./watchedCaseMatcher";
import { sendDigestNotifications } from "./digestService";

let isRunning = false;

/** How many upcoming weekdays to scrape beyond today */
const SCRAPE_DAYS_AHEAD = 14;

/**
 * Build a list of date strings to scrape.
 * Includes "today" plus the next N weekdays (skips weekends — courts don't hold hearings).
 */
function buildDateList(daysAhead: number): string[] {
  const dates: string[] = ["today"];
  const now = new Date();
  let added = 0;
  let offset = 1;

  while (added < daysAhead) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    offset++;

    const dayOfWeek = d.getDay();
    // Skip Saturday (6) and Sunday (0)
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const iso = d.toISOString().split("T")[0]; // YYYY-MM-DD
    dates.push(iso);
    added++;
  }

  return dates;
}

/** Random delay between 0 and maxMs milliseconds */
function randomDelay(maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * maxMs);
  const minutes = Math.round(ms / 60000);
  console.log(`⏰ Random start delay: ${minutes} minutes`);
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Start the daily cron job for scraping court calendars.
 * Cron fires at 2:00 AM UTC; a random 0–60 min delay staggers the actual start
 * so requests don't hit utcourts.gov at the exact same time every day.
 */
export function startScheduler(): void {
  console.log("⏰ Starting court calendar scheduler (daily ~2:00–3:00 AM UTC)");

  // Main scrape job — daily at 2 AM UTC + random 0-60 min offset
  cron.schedule("0 2 * * *", async () => {
    console.log("⏰ Scheduled scrape triggered, adding random delay...");
    await randomDelay(60 * 60 * 1000);
    await runScrapeJob();
  });

  // Daily digest — every day at 6 AM UTC (after scrape completes)
  cron.schedule("0 6 * * *", async () => {
    console.log("📬 Daily digest triggered");
    try {
      await sendDigestNotifications("daily_digest");
    } catch (err) {
      console.error("❌ Daily digest failed:", err instanceof Error ? err.message : err);
      captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { service: "scheduler", phase: "daily-digest" },
      });
    }
  });

  // Weekly digest — every Monday at 6 AM UTC
  cron.schedule("0 6 * * 1", async () => {
    console.log("📬 Weekly digest triggered");
    try {
      await sendDigestNotifications("weekly_digest");
    } catch (err) {
      console.error("❌ Weekly digest failed:", err instanceof Error ? err.message : err);
      captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { service: "scheduler", phase: "weekly-digest" },
      });
    }
  });
}

/**
 * Run a full scrape job — fetches all court HTML calendars, parses events,
 * detects changes, and triggers calendar syncs.
 */
export async function runScrapeJob(): Promise<{
  courtsProcessed: number;
  eventsFound: number;
  eventsChanged: number;
}> {
  if (isRunning) {
    console.warn("⚠️  Scrape job already running — skipping");
    return { courtsProcessed: 0, eventsFound: 0, eventsChanged: 0 };
  }

  isRunning = true;
  const pool = getPool();

  let jobId: number | null = null;

  try {
    // Create job record
    if (pool) {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `INSERT INTO scrape_jobs (status, started_at) VALUES ('running', NOW()) RETURNING id`
        );
        jobId = result.rows[0].id;
      } finally {
        client.release();
      }
    }

    console.log("🔄 Starting court calendar scrape (HTML format)...");

    const allCourts = await fetchCourtList();
    const dates = buildDateList(SCRAPE_DAYS_AHEAD);
    let totalEvents = 0;
    let totalChanged = 0;
    let courtsProcessed = 0;

    // Apply court whitelist filter if configured
    let courts = allCourts;
    if (pool) {
      const client = await pool.connect();
      try {
        const wlResult = await client.query(
          "SELECT value FROM app_settings WHERE key = 'court_whitelist'"
        );
        if (wlResult.rows.length > 0) {
          const whitelist = wlResult.rows[0].value as string[];
          if (Array.isArray(whitelist) && whitelist.length > 0) {
            courts = allCourts.filter((c) => whitelist.includes(c.locationCode));
            console.log(`🔍 Court whitelist active: ${courts.length} of ${allCourts.length} courts selected`);
          }
        }
      } finally {
        client.release();
      }
    }

    console.log(`📅 Scraping ${courts.length} courts × ${dates.length} dates (today + ${SCRAPE_DAYS_AHEAD} weekdays)`);

    for (const court of courts) {
      try {
        let courtEventCount = 0;
        const allCourtEvents: ParsedCourtEvent[] = [];

        for (const date of dates) {
          try {
            const parsedEvents = await scrapeCourtEventsForDate(court, date);
            allCourtEvents.push(...parsedEvents);

            // Rate limit: 1s between requests to be respectful of utcourts.gov
            await new Promise((r) => setTimeout(r, 1000));
          } catch (err) {
            // Log per-date failures but continue with other dates
            console.warn(`  ⚠️  Failed ${court.name} on ${date}: ${err instanceof Error ? err.message : err}`);
          }
        }

        // Enrich events with reports.php data (attorneys, charges, OTN, DOB)
        // Build charges lookup: case_number::event_date -> charges[]
        const chargesLookup = new Map<string, string[]>();
        try {
          const reportHtml = await fetchReportHtml(court.locationCode, 15000);
          const reportEvents = parseReportHtml(reportHtml);
          if (reportEvents.length > 0) {
            const enrichedCount = enrichEventsWithReportData(allCourtEvents, reportEvents);
            if (enrichedCount > 0) {
              console.log(`  📋 Enriched ${enrichedCount} events from reports.php for ${court.name}`);
            }
            // Build charges map
            for (const re of reportEvents) {
              if (re.caseNumber && re.eventDate && re.charges.length > 0) {
                chargesLookup.set(`${re.caseNumber}::${re.eventDate}`, re.charges);
              }
            }
          }
          // Rate limit after report fetch
          await new Promise((r) => setTimeout(r, 1000));
        } catch {
          // reports.php enrichment is best-effort — don't fail the court
        }

        // Upsert all events (enriched or not)
        for (const event of allCourtEvents) {
          totalEvents++;
          courtEventCount++;
          const eventCharges = (event.caseNumber && event.eventDate)
            ? chargesLookup.get(`${event.caseNumber}::${event.eventDate}`) ?? []
            : [];
          const changed = await upsertCourtEvent(
            event,
            court.name,
            court.type,
            buildSearchUrl(court.locationCode, "today"),
            eventCharges
          );
          if (changed) totalChanged++;
        }

        courtsProcessed++;
        if (courtEventCount > 0) {
          console.log(`  ✅ ${court.name}: ${courtEventCount} events across ${dates.length} dates`);
        }
      } catch (err) {
        console.error(`❌ Failed to scrape ${court.name}:`, err instanceof Error ? err.message : err);
        captureException(err instanceof Error ? err : new Error(String(err)), {
          tags: { service: "scheduler", court: court.name },
        });
      }
    }

    // Update job record
    if (pool && jobId) {
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE scrape_jobs
           SET status = 'completed', courts_processed = $1,
               events_found = $2, events_changed = $3, completed_at = NOW()
           WHERE id = $4`,
          [courtsProcessed, totalEvents, totalChanged, jobId]
        );
      } finally {
        client.release();
      }
    }

    console.log(`✅ Scrape complete: ${courtsProcessed} courts, ${totalEvents} events, ${totalChanged} changes`);

    // Auto-match newly scraped events against active watched cases
    try {
      const matchResult = await matchWatchedCases();
      if (matchResult.newEntriesCreated > 0) {
        console.log(`🔗 Auto-match: ${matchResult.watchedCasesChecked} watched cases checked, ${matchResult.newEntriesCreated} new entries, ${matchResult.syncTriggered} synced`);
      }
    } catch (matchErr) {
      // Auto-matching failure is non-fatal — scrape data is already saved
      console.error("⚠️  Auto-match failed (non-fatal):", matchErr instanceof Error ? matchErr.message : matchErr);
      captureException(matchErr instanceof Error ? matchErr : new Error(String(matchErr)), {
        tags: { service: "scheduler", phase: "auto-match" },
      });
    }

    captureMessage(
      `Scrape complete: ${courtsProcessed} courts, ${totalEvents} events, ${totalChanged} changes`,
      "info",
      { tags: { service: "scheduler" }, extra: { courtsProcessed, totalEvents, totalChanged } }
    );
    return { courtsProcessed, eventsFound: totalEvents, eventsChanged: totalChanged };
  } catch (err) {
    console.error("❌ Scrape job failed:", err);
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { service: "scheduler", phase: "job" },
    });

    if (pool && jobId) {
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE scrape_jobs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
          [err instanceof Error ? err.message : String(err), jobId]
        );
      } finally {
        client.release();
      }
    }

    return { courtsProcessed: 0, eventsFound: 0, eventsChanged: 0 };
  } finally {
    isRunning = false;
  }
}

/**
 * Scrape events for a single court on a single date.
 * Primary: HTML from search.php
 * Fallback: PDF text (legacy format, only for "today")
 */
async function scrapeCourtEventsForDate(court: CourtInfo, date: string): Promise<ParsedCourtEvent[]> {
  // Primary path: fetch HTML calendar results
  try {
    const html = await fetchCourtCalendarHtml(court.locationCode, date);

    // Check if this looks like valid HTML results
    if (html.includes("results found") || html.includes("Case #")) {
      const events = parseHtmlCalendarResults(html);
      if (events.length > 0) {
        return events;
      }
    }

    // HTML returned but no events
    if (html.includes("0 results found") || html.includes("currently being updated")) {
      return [];
    }
  } catch (err) {
    // Only warn on today — future dates failing is less critical
    if (date === "today") {
      console.warn(`  ⚠️  HTML scrape failed for ${court.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Fallback: try legacy PDF URL (only makes sense for "today")
  if (date === "today") {
    try {
      const legacyPdfUrl = `https://www.utcourts.gov/cal/data/${court.locationCode}.pdf`;
      const pdfBuffer = await fetchUrl(legacyPdfUrl, 1, 10000);

      if (pdfBuffer.length > 100 && pdfBuffer.slice(0, 5).toString() === "%PDF-") {
        let pdfParse;
        try {
          pdfParse = require("pdf-parse");
        } catch {
          return [];
        }

        const data = await pdfParse(pdfBuffer);
        const events = parseCourtCalendarText(
          data.text,
          court.name,
          court.type,
          legacyPdfUrl
        );
        if (events.length > 0) {
          return events;
        }
      }
    } catch {
      // PDF fallback failed — not unexpected
    }
  }

  return [];
}

/**
 * Insert or update a court event. Returns true if the event changed.
 */
async function upsertCourtEvent(
  event: ParsedCourtEvent,
  courtName: string,
  courtType: string,
  sourceUrl: string,
  charges: string[] = []
): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;

  const client = await pool.connect();
  try {
    // Look for existing event by case_number + event_date + court_name
    const existing = await client.query(
      `SELECT * FROM court_events
       WHERE case_number = $1 AND event_date = $2 AND court_name = $3
       LIMIT 1`,
      [event.caseNumber, event.eventDate, courtName]
    );

    if (existing.rows.length > 0) {
      const existingRow = existing.rows[0];

      // Check for changes
      const changes = detectChanges(existingRow, {
        court_room: event.courtRoom,
        event_date: event.eventDate,
        event_time: event.eventTime,
        hearing_type: event.hearingType,
        case_number: event.caseNumber,
        case_type: event.caseType,
        defendant_name: event.defendantName,
        prosecuting_attorney: event.prosecutingAttorney,
        defense_attorney: event.defenseAttorney,
      } as Record<string, unknown>);

      if (changes.length > 0) {
        // Update the event
        await client.query(
          `UPDATE court_events SET
            court_room = $1, event_time = $2, hearing_type = $3,
            case_type = $4, defendant_name = $5, defendant_otn = $6,
            defendant_dob = $7, prosecuting_attorney = $8,
            defense_attorney = $9, citation_number = $10,
            sheriff_number = $11, lea_number = $12,
            content_hash = $13, scraped_at = NOW(), updated_at = NOW(),
            judge_name = $14, hearing_location = $15, is_virtual = $16,
            source_url = $17, charges = $19
          WHERE id = $18`,
          [
            event.courtRoom, event.eventTime, event.hearingType,
            event.caseType, event.defendantName, event.defendantOtn,
            event.defendantDob, event.prosecutingAttorney,
            event.defenseAttorney, event.citationNumber,
            event.sheriffNumber, event.leaNumber,
            event.contentHash, event.judgeName, event.hearingLocation,
            event.isVirtual, sourceUrl, existingRow.id,
            JSON.stringify(charges),
          ]
        );

        // Process changes (log + notify)
        await processChanges(existingRow.id, changes);

        // Re-sync affected calendar entries
        const calEntries = await client.query(
          `SELECT id FROM calendar_entries WHERE court_event_id = $1`,
          [existingRow.id]
        );
        for (const entry of calEntries.rows) {
          await syncCalendarEntry(entry.id);
        }

        return true;
      }

      return false;
    }

    // Insert new event
    await client.query(
      `INSERT INTO court_events (
        court_type, court_name, court_room, event_date, event_time,
        hearing_type, case_number, case_type, defendant_name,
        defendant_otn, defendant_dob, prosecuting_attorney,
        defense_attorney, citation_number, sheriff_number,
        lea_number, source_pdf_url, content_hash,
        judge_name, hearing_location, is_virtual, source_url, charges
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        courtType, courtName, event.courtRoom, event.eventDate,
        event.eventTime, event.hearingType, event.caseNumber,
        event.caseType, event.defendantName, event.defendantOtn,
        event.defendantDob, event.prosecutingAttorney,
        event.defenseAttorney, event.citationNumber,
        event.sheriffNumber, event.leaNumber, sourceUrl,
        event.contentHash, event.judgeName, event.hearingLocation,
        event.isVirtual, sourceUrl, JSON.stringify(charges),
      ]
    );

    return false;
  } finally {
    client.release();
  }
}
