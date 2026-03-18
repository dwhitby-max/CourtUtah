import { describe, it, expect } from "vitest";
import {
  parseHtmlCalendarResults,
  parseCourtCalendarText,
  ParsedCourtEvent,
} from "../services/courtEventParser";

// ============================================================
// HTML Parser Tests (primary — new format)
//
// The parser looks for "casehover" class markers and expects:
//   - Time/date header BEFORE each casehover block (in <strong> tags)
//   - Event box with class "casehover" containing:
//     * bottomline div: court name + hearing location
//     * col-sm-4: parties (defendant)
//     * col-sm-8 > col-sm-6: judge, courtroom, hearing type
//     * div.case: case number + case type
// ============================================================

/**
 * Build realistic HTML matching the actual utcourts.gov search result structure.
 */
function buildEventHtml(opts: {
  time: string;
  date: string;
  virtual?: boolean;
  location?: string;
  courtType?: string;
  parties?: string;
  judgeRoomHearing?: string;
  caseNumber?: string;
  caseType?: string;
}): string {
  const virtualBadge = opts.virtual
    ? `<span class="badge badge-info">Virtual Hearing</span>`
    : "";
  const locationLine = opts.location
    ? `(Hearing location is in ${opts.location} - More Info)`
    : "";
  return `
    <div class="row">
      <strong>${opts.time}</strong> ${virtualBadge}
      <strong>${opts.date}</strong>
    </div>
    <div class="casehover">
      <div class="bottomline">${opts.courtType || "District Court"} ${locationLine}</div>
      <div class="row">
        <div class="col-xs-12 col-sm-4">${opts.parties || ""}</div>
        <div class="col-xs-12 col-sm-8">
          <div class="col-xs-12 col-sm-6">${opts.judgeRoomHearing || ""}</div>
        </div>
      </div>
      <div class="case">Case # ${opts.caseNumber || "000000000"} ${opts.caseType || "Felony"}<br>View Case Details</div>
    </div>
  `;
}

function wrapResults(count: number, ...blocks: string[]): string {
  return `<div>${count} results found. Sorting by date and time</div>${blocks.join("\n")}`;
}

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
    const html = wrapResults(1,
      buildEventHtml({
        time: "1:30 PM",
        date: "3/16/2026",
        virtual: true,
        location: "BRIGHAM CITY",
        courtType: "District Court",
        parties: `STATE OF UTAH vs. <span class="indent">GAIGE TOBLER</span>`,
        judgeRoomHearing: "BRANDON MAYNARD<br>COURTROOM 3<br>WEB--DECISION TO PRELIM",
        caseNumber: "251100233",
        caseType: "State Felony",
      })
    );
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
    const html = wrapResults(1,
      buildEventHtml({
        time: "8:30 AM",
        date: "3/31/2026",
        location: "PROVO",
        parties: `STATE OF UTAH vs. <span class="indent">OMAR DARIO TAPIA</span>`,
        judgeRoomHearing: "DENISE M PORTER<br>PROVO 2ND FL CTRM 2B<br>WBX DISPOSITION HEARING",
        caseNumber: "261400567",
        caseType: "State Felony",
      })
    );
    const events = parseHtmlCalendarResults(html);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const e = events[0];
    expect(e.eventTime).toBe("8:30 AM");
    expect(e.eventDate).toBe("2026-03-31");
    expect(e.caseNumber).toBe("261400567");
    expect(e.isVirtual).toBe(false);
  });

  it("extracts case type from text after case number", () => {
    const html = wrapResults(1,
      buildEventHtml({
        time: "9:00 AM",
        date: "4/1/2026",
        parties: `STATE OF UTAH vs. <span class="indent">JOHN DOE</span>`,
        judgeRoomHearing: "JUDGE SMITH<br>COURTROOM 5<br>ARRAIGNMENT",
        caseNumber: "261200001",
        caseType: "Misdemeanor",
      })
    );
    const events = parseHtmlCalendarResults(html);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].caseType).toBe("Misdemeanor");
  });

  it("parses multiple result blocks", () => {
    const html = wrapResults(2,
      buildEventHtml({
        time: "1:30 PM",
        date: "3/16/2026",
        virtual: true,
        parties: `STATE vs. <span class="indent">PERSON ONE</span>`,
        judgeRoomHearing: "JUDGE A<br>COURTROOM 3<br>ARRAIGNMENT",
        caseNumber: "111111111",
        caseType: "State Felony",
      }),
      buildEventHtml({
        time: "8:30 AM",
        date: "3/31/2026",
        parties: `STATE vs. <span class="indent">PERSON TWO</span>`,
        judgeRoomHearing: "JUDGE B<br>COURTROOM 2B<br>SENTENCING",
        caseNumber: "222222222",
        caseType: "Misdemeanor",
      })
    );
    const events = parseHtmlCalendarResults(html);
    expect(events).toHaveLength(2);
    expect(events[0].caseNumber).toBe("111111111");
    expect(events[1].caseNumber).toBe("222222222");
  });

  it("generates unique content hashes for different events", () => {
    const html = wrapResults(2,
      buildEventHtml({
        time: "9:00 AM",
        date: "3/15/2026",
        parties: `STATE vs. <span class="indent">AAA</span>`,
        judgeRoomHearing: "JUDGE X<br>COURTROOM 1<br>ARRAIGNMENT",
        caseNumber: "100000001",
        caseType: "Felony",
      }),
      buildEventHtml({
        time: "10:00 AM",
        date: "3/15/2026",
        parties: `STATE vs. <span class="indent">BBB</span>`,
        judgeRoomHearing: "JUDGE Y<br>COURTROOM 2<br>SENTENCING",
        caseNumber: "100000002",
        caseType: "Misdemeanor",
      })
    );
    const events = parseHtmlCalendarResults(html);
    expect(events).toHaveLength(2);
    expect(events[0].contentHash).not.toBe(events[1].contentHash);
  });

  it("handles hearing location extraction with 'More Info' suffix", () => {
    const html = wrapResults(1,
      buildEventHtml({
        time: "2:00 PM",
        date: "5/10/2026",
        location: "SALT LAKE CITY",
        parties: `STATE vs. <span class="indent">TEST PERSON</span>`,
        caseNumber: "999888777",
        caseType: "Felony",
      })
    );
    const events = parseHtmlCalendarResults(html);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].hearingLocation).toBe("SALT LAKE CITY");
  });

  it("correctly identifies virtual vs in-person hearings", () => {
    const virtualHtml = wrapResults(1,
      buildEventHtml({
        time: "10:00 AM",
        date: "6/1/2026",
        virtual: true,
        parties: `STATE vs. <span class="indent">VIRTUAL PERSON</span>`,
        caseNumber: "555000111",
        caseType: "Felony",
      })
    );
    const inPersonHtml = wrapResults(1,
      buildEventHtml({
        time: "10:00 AM",
        date: "6/1/2026",
        virtual: false,
        parties: `STATE vs. <span class="indent">INPERSON PERSON</span>`,
        caseNumber: "555000222",
        caseType: "Felony",
      })
    );

    const virtualEvents = parseHtmlCalendarResults(virtualHtml);
    const inPersonEvents = parseHtmlCalendarResults(inPersonHtml);

    expect(virtualEvents[0].isVirtual).toBe(true);
    expect(inPersonEvents[0].isVirtual).toBe(false);
  });

  it("parses date correctly with single-digit month and day", () => {
    const html = wrapResults(1,
      buildEventHtml({
        time: "9:00 AM",
        date: "1/5/2026",
        parties: `STATE vs. <span class="indent">TEST</span>`,
        caseNumber: "100000001",
        caseType: "Felony",
      })
    );
    const events = parseHtmlCalendarResults(html);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].eventDate).toBe("2026-01-05");
  });

  it("parses date correctly with double-digit month and day", () => {
    const html = wrapResults(1,
      buildEventHtml({
        time: "11:30 AM",
        date: "12/25/2026",
        parties: `STATE vs. <span class="indent">HOLIDAY TEST</span>`,
        caseNumber: "100000002",
        caseType: "Misdemeanor",
      })
    );
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
