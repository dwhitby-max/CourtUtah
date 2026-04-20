import cron from "node-cron";
import { getPool } from "../db/pool";
import { captureException } from "./sentryService";
import { sendDigestNotifications } from "./digestService";
import { runDailyRefresh } from "./dailyRefresh";

/**
 * Start the scheduler. Runs daily refresh, digest notifications, and cleanup.
 * All schedules are interpreted in Mountain Time (America/Denver), which
 * automatically tracks MST/MDT so the wall-clock times stay stable year-round.
 *
 * Schedule (Mountain Time):
 *   6:00 AM — Daily refresh: re-run all saved searches (fires at 6:00, jittered 0–30 min)
 *   6:30 AM — Cleanup: mark past calendar entries as completed
 *   7:00 AM — Daily digest: send notification summaries
 *   7:00 AM Mon — Weekly digest
 */
const MT_TZ = { timezone: "America/Denver" } as const;

export function startScheduler(): void {
  console.log("⏰ Starting scheduler (daily refresh + digests + cleanup) — America/Denver");

  // Daily refresh — 6:00 AM MT base, jittered 0–30 min so the actual start
  // varies day to day (6:00–6:30 AM). Utah courts publish their daily update
  // around 5:30 AM MT, so starting at 6:00 guarantees we scrape AFTER the
  // update lands — earlier runs would cache yesterday's data as today's truth
  // (the same-day cache would then block a corrective scrape for the rest of
  // the day). Jitter plus per-search delays in runDailyRefresh keep traffic
  // from looking bot-like.
  cron.schedule("0 6 * * *", async () => {
    const jitterMs = Math.floor(Math.random() * 30 * 60 * 1000); // 0–30 min
    console.log(`🔄 Daily refresh triggered — starting in ${(jitterMs / 60_000).toFixed(1)} minutes`);
    await new Promise((resolve) => setTimeout(resolve, jitterMs));
    try {
      await runDailyRefresh();
    } catch (err) {
      console.error("❌ Daily refresh failed:", err instanceof Error ? err.message : err);
      captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { service: "scheduler", phase: "daily-refresh" },
      });
    }
  }, MT_TZ);

  // Daily cleanup — 6:30 AM MT
  // Marks past calendar entries as completed
  cron.schedule("30 6 * * *", async () => {
    console.log("🧹 Daily past-event cleanup triggered");
    try {
      await cleanupPastEvents();
    } catch (err) {
      console.error("❌ Past event cleanup failed:", err instanceof Error ? err.message : err);
    }
  }, MT_TZ);

  // Daily digest — 7:00 AM MT
  cron.schedule("0 7 * * *", async () => {
    console.log("📬 Daily digest triggered");
    try {
      await sendDigestNotifications("daily_digest");
    } catch (err) {
      console.error("❌ Daily digest failed:", err instanceof Error ? err.message : err);
      captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { service: "scheduler", phase: "daily-digest" },
      });
    }
  }, MT_TZ);

  // Weekly digest — Monday 7:00 AM MT
  cron.schedule("0 7 * * 1", async () => {
    console.log("📬 Weekly digest triggered");
    try {
      await sendDigestNotifications("weekly_digest");
    } catch (err) {
      console.error("❌ Weekly digest failed:", err instanceof Error ? err.message : err);
      captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { service: "scheduler", phase: "weekly-digest" },
      });
    }
  }, MT_TZ);
}

/**
 * Mark calendar entries as completed for events that have passed.
 * Uses Mountain Time (America/Denver) as the reference timezone since all
 * Utah court events are in Mountain Time.
 */
export async function cleanupPastEvents(): Promise<{ completedEntries: number }> {
  const pool = getPool();
  if (!pool) return { completedEntries: 0 };

  const client = await pool.connect();
  try {
    const entriesResult = await client.query(
      `UPDATE calendar_entries ce
       SET sync_status = 'completed', updated_at = NOW()
       FROM court_events ev
       WHERE ce.court_event_id = ev.id
         AND ce.sync_status IN ('synced', 'pending', 'pending_update')
         AND ev.event_date < (NOW() AT TIME ZONE 'America/Denver')::date`
    );
    const completedEntries = entriesResult.rowCount || 0;

    if (completedEntries > 0) {
      console.log(`🧹 Cleanup: ${completedEntries} calendar entries completed`);
    }

    return { completedEntries };
  } catch (err) {
    console.error("❌ Past event cleanup failed:", err instanceof Error ? err.message : err);
    return { completedEntries: 0 };
  } finally {
    client.release();
  }
}
