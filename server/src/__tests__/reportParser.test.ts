import { describe, it, expect } from "vitest";
import {
  parseReportHtml,
  buildReportUrl,
  enrichEventsWithReportData,
  ReportEvent,
} from "../../src/services/reportParser";
import { ParsedCourtEvent } from "../../src/services/courtEventParser";

describe("Report parser — buildReportUrl", () => {
  it("builds correct URL for district court", () => {
    const url = buildReportUrl("0211D");
    expect(url).toBe("https://legacy.utcourts.gov/cal/reports.php?loc=0211D");
  });

  it("builds correct URL for justice court", () => {
    const url = buildReportUrl("1867J");
    expect(url).toBe("https://legacy.utcourts.gov/cal/reports.php?loc=1867J");
  });

  it("encodes special characters in location code", () => {
    const url = buildReportUrl("test&loc");
    expect(url).toContain("test%26loc");
  });
});

describe("Report parser — parseReportHtml", () => {
  it("returns empty array for empty HTML", () => {
    expect(parseReportHtml("")).toEqual([]);
  });

  it("returns empty array for null-ish input", () => {
    expect(parseReportHtml("   ")).toEqual([]);
  });

  it("returns empty array when currently being updated", () => {
    const html = "<html><body>The calendar data is currently being updated.</body></html>";
    expect(parseReportHtml(html)).toEqual([]);
  });

  it("returns empty array for no cases message", () => {
    const html = "<html><body><p>No cases scheduled</p></body></html>";
    expect(parseReportHtml(html)).toEqual([]);
  });

  it("parses a single case from table rows", () => {
    const html = `
      <table>
        <tr colspan="6"><td colspan="6">Judge: BRANDON MAYNARD COURTROOM 3</td></tr>
        <tr>
          <td>1:30 PM</td>
          <td>3/16/2026</td>
          <td>Case # 251100233</td>
          <td>STATE OF UTAH vs. GAIGE TOBLER</td>
          <td>ATTY: SMITH, JOHN  ATTY: JONES, SARAH</td>
          <td>OTN: 12345 DOB: 01/15/1990</td>
        </tr>
      </table>
    `;

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].eventTime).toBe("1:30 PM");
    expect(events[0].eventDate).toBe("2026-03-16");
    expect(events[0].caseNumber).toBe("251100233");
    expect(events[0].defendantName).toBe("GAIGE TOBLER");
    expect(events[0].defendantOtn).toBe("12345");
    expect(events[0].defendantDob).toBe("1990-01-15");
    expect(events[0].judgeName).toBe("BRANDON MAYNARD");
    expect(events[0].courtRoom).toBe("COURTROOM 3");
  });

  it("parses attorney info from ATTY: labels", () => {
    const html = `
      <table>
        <tr>
          <td>9:00 AM</td>
          <td>4/1/2026 Case # 261200100</td>
          <td>SALT LAKE CITY vs. DOE, JOHN</td>
          <td>ATTY: PROSECUTOR, BOB  ATTY: DEFENDER, ALICE</td>
          <td></td>
        </tr>
      </table>
    `;

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].prosecutingAttorney).toBe("PROSECUTOR, BOB");
    expect(events[0].defenseAttorney).toBe("DEFENDER, ALICE");
  });

  it("parses citation and sheriff numbers", () => {
    const html = `
      <table>
        <tr>
          <td>10:00 AM 5/20/2026</td>
          <td>Case # 261300050</td>
          <td>CITY vs. SMITH, JANE</td>
          <td>CITATION #: C12345 SHERIFF #: S67890 LEA #: L11111</td>
        </tr>
      </table>
    `;

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].citationNumber).toBe("C12345");
    expect(events[0].sheriffNumber).toBe("S67890");
    expect(events[0].leaNumber).toBe("L11111");
  });

  it("parses hearing type keywords", () => {
    const html = `
      <table>
        <tr>
          <td>2:00 PM 6/1/2026 Case # 261400001 ARRAIGNMENT</td>
          <td>STATE vs. JONES, BOB</td>
        </tr>
      </table>
    `;

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].hearingType).toBe("ARRAIGNMENT");
  });

  it("parses multiple cases from table", () => {
    const html = `
      <table>
        <tr colspan="4"><td colspan="4">JUDGE SMITH COURTROOM 1</td></tr>
        <tr>
          <td>8:30 AM</td>
          <td>3/20/2026 Case # 100001</td>
          <td>STATE vs. ALPHA, ADAM</td>
          <td></td>
        </tr>
        <tr>
          <td>9:00 AM</td>
          <td>3/20/2026 Case # 100002</td>
          <td>STATE vs. BETA, BRIAN</td>
          <td></td>
        </tr>
        <tr>
          <td>9:30 AM</td>
          <td>3/20/2026 Case # 100003</td>
          <td>STATE vs. GAMMA, CARL</td>
          <td></td>
        </tr>
      </table>
    `;

    const events = parseReportHtml(html);
    expect(events.length).toBe(3);
    expect(events[0].defendantName).toBe("ALPHA, ADAM");
    expect(events[1].defendantName).toBe("BETA, BRIAN");
    expect(events[2].defendantName).toBe("GAMMA, CARL");
    // All should inherit JUDGE SMITH
    for (const e of events) {
      expect(e.courtRoom).toBe("COURTROOM 1");
    }
  });

  it("generates unique content hashes for different events", () => {
    const html = `
      <table>
        <tr>
          <td>8:00 AM 3/20/2026 Case # 200001</td>
          <td>STATE vs. ONE, FIRST</td>
        </tr>
        <tr>
          <td>8:00 AM 3/20/2026 Case # 200002</td>
          <td>STATE vs. TWO, SECOND</td>
        </tr>
      </table>
    `;

    const events = parseReportHtml(html);
    expect(events.length).toBe(2);
    expect(events[0].contentHash).not.toBe(events[1].contentHash);
  });

  it("parses charges from statute codes", () => {
    const html = `
      <table>
        <tr>
          <td>10:00 AM 4/15/2026 Case # 300001</td>
          <td>STATE vs. CHARGED, PERSON</td>
          <td>Charges: 76-5-103 Assault; 76-6-404 Theft</td>
        </tr>
      </table>
    `;

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].charges.length).toBeGreaterThanOrEqual(1);
  });

  it("handles text fallback when no table rows found", () => {
    const html = `
      <div>
        <p>9:00 AM 3/25/2026 Case # 400001 STATE OF UTAH vs. NOROW, TIM ARRAIGNMENT</p>
        <p>10:00 AM 3/25/2026 Case # 400002 CITY vs. NOROW, JIM PRETRIAL</p>
      </div>
    `;

    const events = parseReportHtml(html);
    expect(events.length).toBe(2);
    expect(events[0].caseNumber).toBe("400001");
    expect(events[1].caseNumber).toBe("400002");
  });
});

describe("Report parser — enrichEventsWithReportData", () => {
  function makeEvent(overrides: Partial<ParsedCourtEvent> = {}): ParsedCourtEvent {
    return {
      courtRoom: "COURTROOM 1",
      eventDate: "2026-03-20",
      eventTime: "9:00 AM",
      hearingType: "ARRAIGNMENT",
      caseNumber: "100001",
      caseType: "State Felony",
      defendantName: "DOE, JOHN",
      defendantOtn: null,
      defendantDob: null,
      prosecutingAttorney: null,
      defenseAttorney: null,
      citationNumber: null,
      sheriffNumber: null,
      leaNumber: null,
      judgeName: "SMITH",
      hearingLocation: "SALT LAKE CITY",
      isVirtual: false,
      contentHash: "abc123",
      ...overrides,
    };
  }

  function makeReport(overrides: Partial<ReportEvent> = {}): ReportEvent {
    return {
      caseNumber: "100001",
      eventDate: "2026-03-20",
      eventTime: "9:00 AM",
      courtRoom: "COURTROOM 1",
      judgeName: "SMITH",
      hearingType: "ARRAIGNMENT",
      defendantName: "DOE, JOHN",
      defendantOtn: "OTN12345",
      defendantDob: "1990-05-15",
      prosecutingAttorney: "PROSECUTOR, BOB",
      defenseAttorney: "DEFENDER, ALICE",
      citationNumber: "CIT999",
      sheriffNumber: "SH777",
      leaNumber: "LEA555",
      charges: ["76-5-103 Assault"],
      contentHash: "def456",
      ...overrides,
    };
  }

  it("enriches event with attorney data from report", () => {
    const events = [makeEvent()];
    const reports = [makeReport()];

    const count = enrichEventsWithReportData(events, reports);
    expect(count).toBe(1);
    expect(events[0].prosecutingAttorney).toBe("PROSECUTOR, BOB");
    expect(events[0].defenseAttorney).toBe("DEFENDER, ALICE");
  });

  it("enriches event with OTN and DOB", () => {
    const events = [makeEvent()];
    const reports = [makeReport()];

    enrichEventsWithReportData(events, reports);
    expect(events[0].defendantOtn).toBe("OTN12345");
    expect(events[0].defendantDob).toBe("1990-05-15");
  });

  it("enriches event with citation, sheriff, LEA numbers", () => {
    const events = [makeEvent()];
    const reports = [makeReport()];

    enrichEventsWithReportData(events, reports);
    expect(events[0].citationNumber).toBe("CIT999");
    expect(events[0].sheriffNumber).toBe("SH777");
    expect(events[0].leaNumber).toBe("LEA555");
  });

  it("does not overwrite existing attorney data", () => {
    const events = [makeEvent({
      prosecutingAttorney: "EXISTING, PROS",
      defenseAttorney: "EXISTING, DEF",
    })];
    const reports = [makeReport()];

    enrichEventsWithReportData(events, reports);
    expect(events[0].prosecutingAttorney).toBe("EXISTING, PROS");
    expect(events[0].defenseAttorney).toBe("EXISTING, DEF");
  });

  it("returns 0 when no matching events found", () => {
    const events = [makeEvent({ caseNumber: "999999" })];
    const reports = [makeReport()];

    const count = enrichEventsWithReportData(events, reports);
    expect(count).toBe(0);
  });

  it("returns 0 when report has no case number", () => {
    const events = [makeEvent()];
    const reports = [makeReport({ caseNumber: null })];

    const count = enrichEventsWithReportData(events, reports);
    expect(count).toBe(0);
  });

  it("matches on case_number + event_date combination", () => {
    const events = [
      makeEvent({ caseNumber: "100001", eventDate: "2026-03-20" }),
      makeEvent({ caseNumber: "100001", eventDate: "2026-03-21" }),
    ];
    const reports = [makeReport({ caseNumber: "100001", eventDate: "2026-03-21" })];

    enrichEventsWithReportData(events, reports);
    // Only the second event (matching date) should be enriched
    expect(events[0].prosecutingAttorney).toBeNull();
    expect(events[1].prosecutingAttorney).toBe("PROSECUTOR, BOB");
  });

  it("handles empty arrays gracefully", () => {
    expect(enrichEventsWithReportData([], [])).toBe(0);
    expect(enrichEventsWithReportData([makeEvent()], [])).toBe(0);
    expect(enrichEventsWithReportData([], [makeReport()])).toBe(0);
  });
});
