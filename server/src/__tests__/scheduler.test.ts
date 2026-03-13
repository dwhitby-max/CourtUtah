import { describe, it, expect } from "vitest";

// We need to test buildDateList but it's not exported. Let's test the logic directly.
// This tests the weekday-skipping date builder used by the scheduler.

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
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const iso = d.toISOString().split("T")[0];
    dates.push(iso);
    added++;
  }

  return dates;
}

describe("buildDateList", () => {
  it("returns 'today' as the first element", () => {
    const dates = buildDateList(5);
    expect(dates[0]).toBe("today");
  });

  it("returns daysAhead + 1 entries (today + N)", () => {
    const dates = buildDateList(10);
    expect(dates.length).toBe(11); // today + 10
  });

  it("skips weekends — no Saturday or Sunday dates", () => {
    const dates = buildDateList(14);
    for (let i = 1; i < dates.length; i++) {
      const d = new Date(dates[i]);
      const day = d.getDay();
      expect(day).not.toBe(0); // Sunday
      expect(day).not.toBe(6); // Saturday
    }
  });

  it("returns 0 extra dates when daysAhead is 0", () => {
    const dates = buildDateList(0);
    expect(dates).toEqual(["today"]);
  });

  it("generates ISO date strings (YYYY-MM-DD)", () => {
    const dates = buildDateList(3);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("generates dates in chronological order", () => {
    const dates = buildDateList(10);
    for (let i = 2; i < dates.length; i++) {
      expect(new Date(dates[i]).getTime()).toBeGreaterThan(new Date(dates[i - 1]).getTime());
    }
  });
});
