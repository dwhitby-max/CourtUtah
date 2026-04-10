import { describe, it, expect } from "vitest";
import { detectChanges } from "../services/changeDetector";

describe("detectChanges", () => {
  it("returns empty array when records are identical", () => {
    const existing = {
      court_room: "Courtroom 301",
      event_date: "2026-04-15",
      event_time: "9:00 AM",
      hearing_type: "Arraignment",
      case_number: "SLC 261901234",
      case_type: "Misdemeanor",
      defendant_name: "SMITH, JOHN",
      prosecuting_attorney: "Jones, Amy",
      defense_attorney: "Brown, Dan",
    };
    const incoming = { ...existing };

    expect(detectChanges(existing, incoming)).toEqual([]);
  });

  it("detects a single field change", () => {
    const existing = {
      court_room: "Courtroom 301",
      event_date: "2026-04-15",
      event_time: "9:00 AM",
      hearing_type: "Arraignment",
      case_number: "SLC 261901234",
      case_type: "Misdemeanor",
      defendant_name: "SMITH, JOHN",
      prosecuting_attorney: "Jones, Amy",
      defense_attorney: "Brown, Dan",
    };
    const incoming = { ...existing, event_time: "10:30 AM" };

    const changes = detectChanges(existing, incoming);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      field: "event_time",
      oldValue: "9:00 AM",
      newValue: "10:30 AM",
    });
  });

  it("detects multiple field changes", () => {
    const existing = {
      court_room: "Courtroom 301",
      event_date: "2026-04-15",
      event_time: "9:00 AM",
      hearing_type: "Arraignment",
      case_number: "SLC 261901234",
      case_type: "Misdemeanor",
      defendant_name: "SMITH, JOHN",
      prosecuting_attorney: "Jones, Amy",
      defense_attorney: "Brown, Dan",
    };
    const incoming = {
      ...existing,
      court_room: "Courtroom 405",
      event_date: "2026-04-20",
      hearing_type: "Pretrial Conference",
    };

    const changes = detectChanges(existing, incoming);
    expect(changes).toHaveLength(3);
    expect(changes.map((c) => c.field).sort()).toEqual(["court_room", "event_date", "hearing_type"]);
  });

  it("treats null/undefined as empty string for comparison", () => {
    const existing = {
      court_room: null,
      event_date: "2026-04-15",
      event_time: undefined,
    };
    const incoming = {
      court_room: null,
      event_date: "2026-04-15",
      event_time: undefined,
    };

    // null == null, undefined == undefined → both become "" → no change
    expect(detectChanges(existing as Record<string, unknown>, incoming as Record<string, unknown>)).toEqual([]);
  });

  it("detects change from null to a value", () => {
    const existing = { defense_attorney: null } as Record<string, unknown>;
    const incoming = { defense_attorney: "Smith, Jane" } as Record<string, unknown>;

    const changes = detectChanges(existing, incoming);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      field: "defense_attorney",
      oldValue: "",
      newValue: "Smith, Jane",
    });
  });

  it("ignores change from a value to null (sparse scrape should not erase enriched data)", () => {
    const existing = { event_time: "2:00 PM" } as Record<string, unknown>;
    const incoming = { event_time: null } as Record<string, unknown>;

    const changes = detectChanges(existing, incoming);
    expect(changes).toHaveLength(0);
  });

  it("ignores fields not in TRACKED_FIELDS", () => {
    const existing = {
      court_room: "Courtroom 301",
      source_pdf_url: "https://old.com/pdf",
      scraped_at: "2026-01-01",
    };
    const incoming = {
      court_room: "Courtroom 301",
      source_pdf_url: "https://new.com/pdf",
      scraped_at: "2026-03-13",
    };

    // source_pdf_url and scraped_at are not tracked → no changes
    expect(detectChanges(existing as Record<string, unknown>, incoming as Record<string, unknown>)).toEqual([]);
  });
});
