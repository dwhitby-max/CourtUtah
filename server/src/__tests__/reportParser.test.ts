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

// Helper: build realistic reports.php HTML that matches the parser's
// <strong class="printhide"> pattern.
function buildReportBlock(opts: {
  time: string;
  date?: string;
  caseNumber?: string;
  caseType?: string;
  defendant?: string;
  judge?: string;
  courtroom?: string;
  plaAtty?: string;
  defAtty?: string;
  otn?: string;
  dob?: string;
  citation?: string;
  sheriff?: string;
  lea?: string;
  charges?: string[];
  hearingType?: string;
  citationSuffix?: string; // raw HTML after citation value (e.g. "</p>")
}): string {
  const date = opts.date || "3/16/2026";
  const caseNum = opts.caseNumber || "251100233";
  const caseType = opts.caseType || "State Felony";
  const defendant = opts.defendant || "TOBLER, GAIGE";
  const judge = opts.judge || "BRANDON MAYNARD";
  const courtroom = opts.courtroom || "COURTROOM 3";
  const hearingType = opts.hearingType || "";

  let attyHtml = "";
  if (opts.plaAtty) {
    attyHtml += `<strong>PLA ATTY:</strong> ${opts.plaAtty}<br>`;
  }
  if (opts.defAtty) {
    attyHtml += `<strong>DEF ATTY:</strong> ${opts.defAtty}<br>`;
  }

  let bottomLine = "";
  if (opts.otn) bottomLine += `OTN: ${opts.otn} `;
  if (opts.dob) bottomLine += `DOB: ${opts.dob} `;
  if (opts.citation) {
    bottomLine += `CITATION #: ${opts.citation}`;
    bottomLine += opts.citationSuffix || " ";
  }
  if (opts.sheriff) bottomLine += `SHERIFF #: ${opts.sheriff} `;
  if (opts.lea) bottomLine += `LEA #: ${opts.lea} `;

  let chargesHtml = "";
  if (opts.charges && opts.charges.length > 0) {
    chargesHtml = opts.charges.map((c) => `${c}<br>`).join("\n");
  }

  return `
<strong class="printhide"> ${opts.time} </strong>
<strong class="printshow"> ${opts.time} </strong>
<div>
  ${date}
  ${hearingType ? `\n${hearingType}\n` : ""}
  <div class="col-sm-4">
    STATE OF UTAH vs.<br>
    <span class="indent"> ${defendant} </span>
  </div>
  <div class="col-sm-4">
    ${attyHtml}
  </div>
  <div class="col-sm-4">
    Case # ${caseNum}<br />
    ${caseType}<br />
    ${judge}<br />
    ${courtroom}
  </div>
  <div class="bottomline">
    ${bottomLine}
    ${chargesHtml}
  </div>
</div>`;
}

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

  it("parses a single case block", () => {
    const html = buildReportBlock({
      time: "1:30 PM",
      date: "3/16/2026",
      caseNumber: "251100233",
      defendant: "TOBLER, GAIGE",
      judge: "BRANDON MAYNARD",
      courtroom: "COURTROOM 3",
      otn: "12345",
      dob: "01/15/1990",
    });

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].eventTime).toBe("1:30 PM");
    expect(events[0].eventDate).toBe("2026-03-16");
    expect(events[0].caseNumber).toBe("251100233");
    expect(events[0].defendantName).toBe("TOBLER, GAIGE");
    expect(events[0].defendantOtn).toBe("12345");
    expect(events[0].defendantDob).toBe("1990-01-15");
  });

  it("parses attorney info from PLA ATTY / DEF ATTY labels", () => {
    const html = buildReportBlock({
      time: "9:00 AM",
      date: "4/1/2026",
      caseNumber: "261200100",
      plaAtty: "PROSECUTOR, BOB",
      defAtty: "DEFENDER, ALICE",
    });

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].prosecutingAttorney).toBe("PROSECUTOR, BOB");
    expect(events[0].defenseAttorney).toBe("DEFENDER, ALICE");
  });

  it("parses citation and sheriff numbers", () => {
    const html = buildReportBlock({
      time: "10:00 AM",
      date: "5/20/2026",
      caseNumber: "261300050",
      citation: "C12345",
      sheriff: "S67890",
      lea: "L11111",
    });

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].citationNumber).toBe("C12345");
    expect(events[0].sheriffNumber).toBe("S67890");
    expect(events[0].leaNumber).toBe("L11111");
  });

  it("does not include </p> in citation number", () => {
    const html = buildReportBlock({
      time: "10:00 AM",
      date: "5/20/2026",
      caseNumber: "261300051",
      citation: "C99999",
      citationSuffix: "</p>",
    });

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].citationNumber).toBe("C99999");
    expect(events[0].citationNumber).not.toContain("</p>");
  });

  it("parses multi-word hearing type keywords", () => {
    // The hearing type regex requires [A-Z][A-Z\s/()-]+? before the keyword,
    // so it only matches multi-word types like "INITIAL ARRAIGNMENT"
    const html =
`<strong class="printhide"> 2:00 PM </strong>` +
`<strong class="printshow"> 2:00 PM </strong>` +
`<div>6/1/2026\n` +
`INITIAL ARRAIGNMENT<br>` +
`<div class="col-sm-4">STATE OF UTAH vs.<br><span class="indent"> JONES, BOB </span></div>` +
`<div class="col-sm-4"></div>` +
`<div class="col-sm-4">Case # 261400001<br />State Misdemeanor<br />JUDGE SMITH<br />COURTROOM 1</div>` +
`</div>`;

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].hearingType).toBe("INITIAL ARRAIGNMENT");
  });

  it("parses multiple cases", () => {
    const block1 = buildReportBlock({
      time: "8:30 AM",
      date: "3/20/2026",
      caseNumber: "100001",
      defendant: "ALPHA, ADAM",
    });
    const block2 = buildReportBlock({
      time: "9:00 AM",
      date: "3/20/2026",
      caseNumber: "100002",
      defendant: "BETA, BRIAN",
    });
    const block3 = buildReportBlock({
      time: "9:30 AM",
      date: "3/20/2026",
      caseNumber: "100003",
      defendant: "GAMMA, CARL",
    });

    const events = parseReportHtml(block1 + block2 + block3);
    expect(events.length).toBe(3);
    expect(events[0].caseNumber).toBe("100001");
    expect(events[1].caseNumber).toBe("100002");
    expect(events[2].caseNumber).toBe("100003");
  });

  it("generates unique content hashes for different events", () => {
    const block1 = buildReportBlock({
      time: "8:00 AM",
      date: "3/20/2026",
      caseNumber: "200001",
      defendant: "ONE, FIRST",
    });
    const block2 = buildReportBlock({
      time: "8:00 AM",
      date: "3/20/2026",
      caseNumber: "200002",
      defendant: "TWO, SECOND",
    });

    const events = parseReportHtml(block1 + block2);
    expect(events.length).toBe(2);
    expect(events[0].contentHash).not.toBe(events[1].contentHash);
  });

  it("parses charges from statute codes", () => {
    const html = buildReportBlock({
      time: "10:00 AM",
      date: "4/15/2026",
      caseNumber: "300001",
      charges: ["76-5-103 Assault", "76-6-404 Theft"],
    });

    const events = parseReportHtml(html);
    expect(events.length).toBe(1);
    expect(events[0].charges.length).toBeGreaterThanOrEqual(1);
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
