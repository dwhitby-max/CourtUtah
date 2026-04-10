import cron from "node-cron";
import { getPool } from "../db/pool";
import { captureException } from "./sentryService";
import { sendDigestNotifications } from "./digestService";

/**
 * Start the scheduler. Runs daily digest notifications and cleanup.
 * Times are in Mountain Time (America/Denver = UTC-7 MST / UTC-6 MDT).
 */
export function startScheduler(): void {
  console.log("⏰ Starting scheduler (daily digests + cleanup)");

  // Daily cleanup — 12:30 UTC (~6:30 AM MT)
  // Marks past calendar entries as completed
  cron.schedule("30 12 * * *", async () => {
    console.log("🧹 Daily past-event cleanup triggered");
    try {
      await cleanupPastEvents();
    } catch (err) {
      console.error("❌ Past event cleanup failed:", err instanceof Error ? err.message : err);
    }
  });

  // Daily digest — 7:00 AM MT (13:00 UTC)
  cron.schedule("0 13 * * *", async () => {
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

  // Weekly digest — Monday 7:00 AM MT (13:00 UTC)
  cron.schedule("0 13 * * 1", async () => {
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
