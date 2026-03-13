import { describe, it, expect } from "vitest";
import { parseCourtListHtml } from "../services/courtScraper";

describe("parseCourtListHtml", () => {
  it("returns empty array for empty HTML", () => {
    expect(parseCourtListHtml("")).toEqual([]);
    expect(parseCourtListHtml("<html></html>")).toEqual([]);
  });

  it("parses district court entries from list items", () => {
    const html = `
      <h3>District Court Calendars</h3>
      <ul>
        <li>Salt Lake County District Court - <a href="search.php?t=c&d=today&loc=1868D">Today</a></li>
        <li>Provo District Court - <a href="search.php?t=c&d=today&loc=2550D">Today</a></li>
      </ul>
      <h3>Justice Court Calendars</h3>
    `;
    const courts = parseCourtListHtml(html);
    expect(courts.length).toBe(2);
    expect(courts[0].name).toBe("Salt Lake County District Court");
    expect(courts[0].type).toBe("DistrictCourt");
    expect(courts[0].locationCode).toBe("1868D");
    expect(courts[0].calendarUrl).toContain("search.php?t=c&d=today&loc=1868D");
    expect(courts[1].locationCode).toBe("2550D");
  });

  it("parses justice court entries", () => {
    const html = `
      <h3>District Court Calendars</h3>
      <ul></ul>
      <h3>Justice Court Calendars</h3>
      <ul>
        <li>Salt Lake City Justice Court - <a href="search.php?t=c&d=today&loc=1867J">Today</a></li>
        <li>West Valley Justice Court - <a href="search.php?t=c&d=today&loc=1890J">Today</a></li>
      </ul>
    `;
    const courts = parseCourtListHtml(html);
    expect(courts.length).toBe(2);
    expect(courts[0].type).toBe("JusticeCourt");
    expect(courts[0].locationCode).toBe("1867J");
    expect(courts[1].locationCode).toBe("1890J");
  });

  it("deduplicates courts by location code", () => {
    const html = `
      <h3>District Court Calendars</h3>
      <ul>
        <li>Salt Lake - <a href="search.php?t=c&d=today&loc=1868D">Today</a></li>
        <li>Salt Lake - <a href="search.php?t=c&d=today&loc=1868D">Today</a></li>
      </ul>
      <h3>Justice Court Calendars</h3>
    `;
    const courts = parseCourtListHtml(html);
    expect(courts.length).toBe(1);
  });

  it("parses both district and justice courts together", () => {
    const html = `
      <h3>District Court Calendars</h3>
      <ul>
        <li>Ogden District Court - <a href="search.php?t=c&d=today&loc=2921D">Today</a></li>
      </ul>
      <h3>Justice Court Calendars</h3>
      <ul>
        <li>Murray Justice Court - <a href="search.php?t=c&d=today&loc=1853J">Today</a></li>
      </ul>
    `;
    const courts = parseCourtListHtml(html);
    expect(courts.length).toBe(2);

    const district = courts.find((c) => c.type === "DistrictCourt");
    const justice = courts.find((c) => c.type === "JusticeCourt");

    expect(district).toBeDefined();
    expect(district?.locationCode).toBe("2921D");
    expect(justice).toBeDefined();
    expect(justice?.locationCode).toBe("1853J");
  });
});
