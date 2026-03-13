import { describe, it, expect } from "vitest";
import { buildGoogleEventBody, buildMicrosoftEventBody, buildVCalendar } from "../services/calendarSync";
import { CalendarEventData } from "../../../shared/types";

const timedEvent: CalendarEventData = {
  title: "Court: SLC 261901234 - Arraignment",
  description: "Court: Salt Lake District\nRoom: 301\nCase: SLC 261901234",
  startDate: "2026-04-15",
  startTime: "9:00 AM",
  location: "Salt Lake District Courtroom 301",
  courtName: "Salt Lake District",
  caseNumber: "SLC 261901234",
};

const allDayEvent: CalendarEventData = {
  title: "Court: SLC 261905678 - Hearing",
  description: "Court: Provo District\nCase: SLC 261905678",
  startDate: "2026-05-20",
  startTime: null,
  location: "Provo District",
  courtName: "Provo District",
  caseNumber: "SLC 261905678",
};

describe("buildGoogleEventBody", () => {
  it("builds a timed event with dateTime start/end and Denver timezone", () => {
    const body = buildGoogleEventBody(timedEvent) as Record<string, Record<string, string>>;

    expect(body.summary).toBe(timedEvent.title);
    expect(body.description).toBe(timedEvent.description);
    expect(body.location).toBe(timedEvent.location);
    expect(body.start.timeZone).toBe("America/Denver");
    expect(body.end.timeZone).toBe("America/Denver");
    expect(body.start.dateTime).toBe("2026-04-15T09:00:00");
    expect(body.end.dateTime).toBe("2026-04-15T10:00:00");
  });

  it("builds an all-day event with date start/end", () => {
    const body = buildGoogleEventBody(allDayEvent) as Record<string, Record<string, string>>;

    expect(body.start.date).toBe("2026-05-20");
    expect(body.end.date).toBe("2026-05-20");
    expect(body.start.dateTime).toBeUndefined();
  });

  it("sets end time one hour after start for timed events", () => {
    const body = buildGoogleEventBody(timedEvent) as Record<string, Record<string, string>>;
    expect(body.start.dateTime).toContain("09:00");
    expect(body.end.dateTime).toContain("10:00");
  });
});

describe("buildMicrosoftEventBody", () => {
  it("builds a timed event with dateTime and Denver timezone", () => {
    const body = buildMicrosoftEventBody(timedEvent) as Record<string, unknown>;

    expect(body.subject).toBe(timedEvent.title);
    expect(body.isAllDay).toBe(false);

    const start = body.start as Record<string, string>;
    expect(start.timeZone).toBe("America/Denver");
    expect(start.dateTime).toContain("2026-04-15T");

    const location = body.location as Record<string, string>;
    expect(location.displayName).toBe(timedEvent.location);

    const bodyContent = body.body as Record<string, string>;
    expect(bodyContent.contentType).toBe("text");
  });

  it("builds an all-day event with isAllDay=true", () => {
    const body = buildMicrosoftEventBody(allDayEvent) as Record<string, unknown>;

    expect(body.isAllDay).toBe(true);
    const start = body.start as Record<string, string>;
    expect(start.dateTime).toContain("2026-05-20T00:00:00");
  });

  it("sets end time one hour after start for timed events", () => {
    const body = buildMicrosoftEventBody(timedEvent) as Record<string, unknown>;
    const end = body.end as Record<string, string>;
    expect(end.dateTime).toContain("2026-04-15T10:");
  });
});

describe("buildVCalendar", () => {
  it("produces valid VCALENDAR with VEVENT for timed events", () => {
    const ics = buildVCalendar("test-uid-123@courttracker.app", timedEvent);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("UID:test-uid-123@courttracker.app");
    expect(ics).toContain("PRODID:-//UtahCourtTracker//EN");
  });

  it("uses DTSTART with TZID for timed events", () => {
    const ics = buildVCalendar("uid@ct", timedEvent);
    expect(ics).toContain("DTSTART;TZID=America/Denver:");
    expect(ics).toContain("DTEND;TZID=America/Denver:");
  });

  it("uses VALUE=DATE for all-day events", () => {
    const ics = buildVCalendar("uid@ct", allDayEvent);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260520");
    expect(ics).toContain("DTEND;VALUE=DATE:20260520");
  });

  it("converts 9:00 AM to 0900 in DTSTART", () => {
    const ics = buildVCalendar("uid@ct", timedEvent);
    expect(ics).toContain("20260415T090000");
  });

  it("converts PM times correctly", () => {
    const pmEvent: CalendarEventData = {
      ...timedEvent,
      startTime: "2:30 PM",
    };
    const ics = buildVCalendar("uid@ct", pmEvent);
    expect(ics).toContain("T143000");
  });

  it("handles 12:00 PM as noon (12), not midnight (0)", () => {
    const noonEvent: CalendarEventData = {
      ...timedEvent,
      startTime: "12:00 PM",
    };
    const ics = buildVCalendar("uid@ct", noonEvent);
    expect(ics).toContain("T120000");
  });

  it("handles 12:00 AM as midnight (0)", () => {
    const midnightEvent: CalendarEventData = {
      ...timedEvent,
      startTime: "12:00 AM",
    };
    const ics = buildVCalendar("uid@ct", midnightEvent);
    expect(ics).toContain("T000000");
  });

  it("escapes special ICS characters in text fields", () => {
    const specialEvent: CalendarEventData = {
      ...timedEvent,
      title: "Court; case #123, details",
      description: "Line1\nLine2",
    };
    const ics = buildVCalendar("uid@ct", specialEvent);
    expect(ics).toContain("SUMMARY:Court\\; case #123\\, details");
    expect(ics).toContain("DESCRIPTION:Line1\\nLine2");
  });

  it("includes DTSTAMP", () => {
    const ics = buildVCalendar("uid@ct", timedEvent);
    expect(ics).toContain("DTSTAMP:");
  });
});
