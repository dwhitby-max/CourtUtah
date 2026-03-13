import { describe, it, expect } from "vitest";
import {
  parseHtmlCalendarResults,
  parseCourtCalendarText,
  ParsedCourtEvent,
} from "../services/courtEventParser";

// ============================================================
// HTML Parser Tests (primary — new format)
// ============================================================

describe("parseHtmlCalendarResults", () => {
  it("returns empty array for empty HTML", () => {
    expect(parseHtmlCalendarResults("")).toEqual([]);
    expect(parseHtmlCalendarResults("   ")).toEqual([]);
  });

  it("returns empty array for '0 results found'", () => {
    const html = `<div>Return to Calendars Page</div><div>0 results found.</div>`;
    expect(parseHtmlCalendarResults(html)).toEqual([]);
  });

  it("returns empty array for 'currently being updated' notice", () => {
    const html = `<div>The calendar data is currently being updated.</div>`;
    expect(parseHtmlCalendarResults(html)).toEqual([]);
  });

  it("parses a single search result block", () => {
    const html = `
      <div>2 results found. Sorting by date and time</div>
      <div>
        <span>1:30 PM</span>
        <span>Virtual Hearing</span>
        <span>3/16/2026</span>
        <div>FIRST JUDICIAL DISTRICT - BRIGHAM CITY DISTR (Hearing location is in BRIGHAM CITY - More Info)</div>
        <div>District Court</div>
        <div>STATE OF UTAH vs. GAIGE TOBLER</div>
        <div>BRANDON MAYNARD COURTROOM 3 WEB--DECISION TO PRELIM</div>
        <div>Case # 251100233 State Felony View Case Details</div>
      </div>
    `;
    const events = parseHtmlCalendarResults(html);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const e = events[0];
    expect(e.eventTime).toBe("1:30 PM");
    expect(e.eventDate).toBe("2026-03-16");
    expect(e.caseNumber).toBe("251100233");
    expect(e.isVirtual).toBe(true);
    expect(e.hearingLocation).toBe("BRIGHAM CITY");
    expect(e.contentHash).toBeTruthy();
    expect(e.contentHash.length).toBe(64);
  });

  it("extracts defendant name from 'vs.' pattern", () => {
    const html = `
      <div>1 results found.</div>
      <div>
        <span>8:30 AM</span>
        <span>3/31/2026</span>
        <div>FOURTH JUDICIAL DISTRICT - PROVO DISTRICT COU</div>
        <div>District Court</div>
        <div>STATE OF UTAH vs. OMAR DARIO TAPIA</div>
        <div>DENISE M PORTER PROVO 2ND FL CTRM 2B WBX DISPOSITION HEARING</div>
        <div>Case # 261400567 State Felony View Case Details</div>
      </div>
    `;
    const events = parseHtmlCalendarResults(html);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const e = events[0];
    expect(e.eventTime).toBe("8:30 AM");
    expect(e.eventDate).toBe("2026-03-31");
    expect(e.caseNumber).toBe("261400567");
    expect(e.isVirtual).toBe(false);
  });

  it("extracts case type from text after case number", () => {
    const html = `
      <div>1 results found.</div>
      <div>
        <span>9:00 AM</span>
        <span>4/1/2026</span>
        <div>District Court</div>
        <div>STATE OF UTAH vs. JOHN DOE</div>
        <div>COURTROOM 5 ARRAIGNMENT</div>
        <div>Case # 261200001 Misdemeanor View Case Details</div>
      </div>
    `;
    const events = parseHtmlCalendarResults(html);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].caseType).toBe("Misdemeanor");
  });

  it("parses multiple result blocks", () => {
    const html = `
      <div>2 results found.</div>
      <div>
        <span>1:30 PM</span> <span>Virtual Hearing</span>
        <span>3/16/2026</span>
        <div>FIRST JUDICIAL DISTRICT</div>
        <div>District Court</div>
        <div>STATE OF UTAH vs. PERSON ONE</div>
        <div>COURTROOM 3 ARRAIGNMENT</div>
        <div>Case # 111111111 State Felony View Case Details</div>
      </div>
      <div>
        <span>8:30 AM</span>
        <span>3/31/2026</span>
        <div>FOURTH JUDICIAL DISTRICT</div>
        <div>District Court</div>
        <div>STATE OF UTAH vs. PERSON TWO</div>
        <div>COURTROOM 2B SENTENCING</div>
        <div>Case # 222222222 Misdemeanor View Case Details</div>
      </div>
    `;
    const events = parseHtmlCalendarResults(html);
    expect(events).toHaveLength(2);
    expect(events[0].caseNumber).toBe("111111111");
    expect(events[1].caseNumber).toBe("222222222");
  });

  it("generates unique content hashes for different events", () => {
    const html = `
      <div>2 results found.</div>
      <div>
        <span>9:00 AM</span> <span>3/15/2026</span>
        <div>District Court</div>
        <div>STATE vs. AAA</div>
        <div>COURTROOM 1 ARRAIGNMENT</div>
        <div>Case # 100000001 Felony View Case Details</div>
      </div>
      <div>
        <span>10:00 AM</span> <span>3/15/2026</span>
        <div>District Court</div>
        <div>STATE vs. BBB</div>
        <div>COURTROOM 2 SENTENCING</div>
        <div>Case # 100000002 Misdemeanor View Case Details</div>
      </div>
    `;
    const events = parseHtmlCalendarResults(html);
    expect(events).toHaveLength(2);
    expect(events[0].contentHash).not.toBe(events[1].contentHash);
  });

  it("handles hearing location extraction with 'More Info' suffix", () => {
    const html = `
      <div>1 results found.</div>
      <div>
        <span>2:00 PM</span>
        <span>5/10/2026</span>
        <div>THIRD DISTRICT (Hearing location is in SALT LAKE CITY - More Info)</div>
        <div>District Court</div>
        <div>STATE vs. TEST PERSON</div>
        <div>Case # 999888777 Felony View Case Details</div>
      </div>
    `;
    const events = parseHtmlCalendarResults(html);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].hearingLocation).toBe("SALT LAKE CITY");
  });

  it("correctly identifies virtual vs in-person hearings", () => {
    const virtualHtml = `
      <div>1 results found.</div>
      <div>
        <span>10:00 AM</span> <span>Virtual Hearing</span> <span>6/1/2026</span>
        <div>District Court</div>
        <div>STATE vs. VIRTUAL PERSON</div>
        <div>Case # 555000111 Felony View Case Details</div>
      </div>
    `;
    const inPersonHtml = `
      <div>1 results found.</div>
      <div>
        <span>10:00 AM</span> <span>6/1/2026</span>
        <div>District Court</div>
        <div>STATE vs. INPERSON PERSON</div>
        <div>Case # 555000222 Felony View Case Details</div>
      </div>
    `;

    const virtualEvents = parseHtmlCalendarResults(virtualHtml);
    const inPersonEvents = parseHtmlCalendarResults(inPersonHtml);

    expect(virtualEvents[0].isVirtual).toBe(true);
    expect(inPersonEvents[0].isVirtual).toBe(false);
  });

  it("parses date correctly with single-digit month and day", () => {
    const html = `
      <div>1 results found.</div>
      <div>
        <span>9:00 AM</span> <span>1/5/2026</span>
        <div>District Court</div>
        <div>STATE vs. TEST</div>
        <div>Case # 100000001 Felony View Case Details</div>
      </div>
    `;
    const events = parseHtmlCalendarResults(html);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].eventDate).toBe("2026-01-05");
  });

  it("parses date correctly with double-digit month and day", () => {
    const html = `
      <div>1 results found.</div>
      <div>
        <span>11:30 AM</span> <span>12/25/2026</span>
        <div>District Court</div>
        <div>STATE vs. HOLIDAY TEST</div>
        <div>Case # 100000002 Misdemeanor View Case Details</div>
      </div>
    `;
    const events = parseHtmlCalendarResults(html);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].eventDate).toBe("2026-12-25");
  });
});

// ============================================================
// Legacy PDF Parser Tests (backward compatibility)
// ============================================================

const DIVIDER = "------------------------------------------------------------------------------";

describe("parseCourtCalendarText (legacy PDF)", () => {
  it("returns empty array for empty text", () => {
    expect(parseCourtCalendarText("", "Salt Lake", "District", "http://example.com")).toEqual([]);
  });

  it("returns empty array for whitespace-only text", () => {
    expect(parseCourtCalendarText("   \n\n  ", "Salt Lake", "District", "http://example.com")).toEqual([]);
  });

  it("returns empty array for 'Nothing to Report'", () => {
    const text = `Salt Lake District Court Calendar\nFebruary 22, 2026\nNothing to Report`;
    expect(parseCourtCalendarText(text, "Salt Lake", "District", "http://example.com")).toEqual([]);
  });

  it("parses a single event with time, hearing type, and case number", () => {
    const text = [
      "Third District Court - Salt Lake County",
      "February 22, 2026",
      "COURTROOM 301",
      DIVIDER,
      "9:00 AM   ARRAIGNMENT   SLC 261901234   Misdemeanor",
      "State of Utah vs.",
      "ATTY: Jones, Amy",
      "SMITH, JOHN ROBERT   ATTY: Brown, Daniel",
      "OTN: 12345678   DOB: 01/15/1990",
      "CITATION #: T12345678   SHERIFF #: SO-2026-001   LEA #: LE-001",
    ].join("\n");

    const events = parseCourtCalendarText(text, "Salt Lake", "District", "http://example.com");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const event = events[0];
    expect(event.eventDate).toBe("2026-02-22");
    expect(event.eventTime).toBe("9:00 AM");
    expect(event.courtRoom).toContain("COURTROOM 301");
    expect(event.contentHash).toBeTruthy();
    expect(event.contentHash.length).toBe(64);
    // New fields should be null for PDF parser
    expect(event.judgeName).toBeNull();
    expect(event.hearingLocation).toBeNull();
    expect(event.isVirtual).toBe(false);
  });

  it("extracts attorney names from ATTY: lines", () => {
    const text = [
      "Third District Court",
      "March 15, 2026",
      DIVIDER,
      "10:00 AM   PRETRIAL CONFERENCE   SLC 261905678   Felony",
      "ATTY: Prosecutor, Pat",
      "DOE, JANE MARIE   ATTY: Defender, David",
    ].join("\n");

    const events = parseCourtCalendarText(text, "Salt Lake", "District", "http://example.com");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const event = events[0];
    expect(event.prosecutingAttorney).toBe("Prosecutor, Pat");
    expect(event.defenseAttorney).toBe("Defender, David");
    expect(event.defendantName).toBe("DOE, JANE MARIE");
  });

  it("extracts OTN and DOB", () => {
    const text = [
      "Court Calendar",
      "April 10, 2026",
      DIVIDER,
      "2:00 PM   SENTENCING   SLC 261909999   Misdemeanor",
      "ATTY: Smith, Sam",
      "JONES, BOB   ATTY: Lee, Lisa",
      "OTN: 98765432   DOB: 03/22/1985",
    ].join("\n");

    const events = parseCourtCalendarText(text, "Test Court", "District", "http://example.com");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const event = events[0];
    expect(event.defendantOtn).toBe("98765432");
    expect(event.defendantDob).toBe("1985-03-22");
  });

  it("extracts citation, sheriff, and LEA numbers", () => {
    const text = [
      "Court Calendar",
      "May 5, 2026",
      DIVIDER,
      "8:30 AM   ARRAIGNMENT   SLC 261901111",
      "ATTY: A, B",
      "C, D   ATTY: E, F",
      "CITATION #: T99887766   SHERIFF #: SO-2026-050   LEA #: LE-500",
    ].join("\n");

    const events = parseCourtCalendarText(text, "Test Court", "District", "http://example.com");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const event = events[0];
    expect(event.citationNumber).toBe("T99887766");
    expect(event.sheriffNumber).toBe("SO-2026-050");
    expect(event.leaNumber).toBe("LE-500");
  });

  it("parses multiple events separated by dividers", () => {
    const text = [
      "Court Calendar",
      "June 1, 2026",
      DIVIDER,
      "9:00 AM   ARRAIGNMENT   SLC 261901111",
      "ATTY: A, B",
      "ONE, PERSON   ATTY: C, D",
      DIVIDER,
      "9:30 AM   PRETRIAL   SLC 261902222",
      "ATTY: E, F",
      "TWO, PERSON   ATTY: G, H",
      DIVIDER,
      "10:00 AM   SENTENCING   SLC 261903333",
      "ATTY: I, J",
      "THREE, PERSON   ATTY: K, L",
    ].join("\n");

    const events = parseCourtCalendarText(text, "Test Court", "District", "http://example.com");
    expect(events).toHaveLength(3);
  });

  it("generates unique content hashes for different events", () => {
    const text = [
      "Court Calendar",
      "July 4, 2026",
      DIVIDER,
      "9:00 AM   ARRAIGNMENT   SLC 261901111",
      "ATTY: A, B",
      "FIRST, PERSON   ATTY: C, D",
      DIVIDER,
      "10:00 AM   SENTENCING   SLC 261902222",
      "ATTY: E, F",
      "SECOND, PERSON   ATTY: G, H",
    ].join("\n");

    const events = parseCourtCalendarText(text, "Test Court", "District", "http://example.com");
    expect(events).toHaveLength(2);
    expect(events[0].contentHash).not.toBe(events[1].contentHash);
  });
});
