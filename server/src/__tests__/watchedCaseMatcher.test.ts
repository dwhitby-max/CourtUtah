import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool before importing the module
const mockQuery = vi.fn();
const mockClient = {
  query: mockQuery,
  release: vi.fn(),
};
const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock("../db/pool", () => ({
  getPool: vi.fn(() => mockPool),
}));

// Mock calendarSync
const mockSyncCalendarEntry = vi.fn().mockResolvedValue(true);
vi.mock("../services/calendarSync", () => ({
  syncCalendarEntry: (...args: unknown[]) => mockSyncCalendarEntry(...args),
}));

// Mock notificationService
const mockCreateNotification = vi.fn().mockResolvedValue(1);
vi.mock("../services/notificationService", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

// Mock sentryService
vi.mock("../services/sentryService", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { matchWatchedCases } from "../services/watchedCaseMatcher";

describe("watchedCaseMatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it("returns zeroes when no active watched cases", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT watched_cases
    const result = await matchWatchedCases();
    expect(result.watchedCasesChecked).toBe(0);
    expect(result.newEntriesCreated).toBe(0);
  });

  it("returns zeroes when pool is null", async () => {
    const { getPool } = await import("../db/pool");
    (getPool as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const result = await matchWatchedCases();
    expect(result).toEqual({ watchedCasesChecked: 0, newEntriesCreated: 0, syncTriggered: 0, errors: 0 });
  });

  it("skips watched case with no active calendar connections", async () => {
    // Active watched cases
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, user_id: 10, search_type: "defendant_name", search_value: "SMITH", label: "Smith Case", monitor_changes: true, auto_add_new: true }],
    });
    // No calendar connections for user 10
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await matchWatchedCases();
    expect(result.watchedCasesChecked).toBe(1);
    expect(result.newEntriesCreated).toBe(0);
    expect(mockSyncCalendarEntry).not.toHaveBeenCalled();
  });

  it("skips when no matching court events found", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, user_id: 10, search_type: "case_number", search_value: "241000001", label: "My Case", monitor_changes: true, auto_add_new: true }],
    });
    // Calendar connection
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    // No matching court events
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await matchWatchedCases();
    expect(result.watchedCasesChecked).toBe(1);
    expect(result.newEntriesCreated).toBe(0);
  });

  it("creates calendar entry and syncs for new match", async () => {
    // Active watched case
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, user_id: 10, search_type: "defendant_name", search_value: "JONES", label: "Jones Watch", monitor_changes: true, auto_add_new: true }],
    });
    // Calendar connection
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    // Matching court events
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 100 }, { id: 101 }] });
    // Check existing entry for event 100 — none
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT calendar_entry for event 100
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 50 }] });
    // Check existing entry for event 101 — none
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT calendar_entry for event 101
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 51 }] });

    const result = await matchWatchedCases();
    expect(result.watchedCasesChecked).toBe(1);
    expect(result.newEntriesCreated).toBe(2);
    expect(result.syncTriggered).toBe(2);
    expect(mockSyncCalendarEntry).toHaveBeenCalledTimes(2);
    expect(mockSyncCalendarEntry).toHaveBeenCalledWith(50);
    expect(mockSyncCalendarEntry).toHaveBeenCalledWith(51);
    // Should notify user
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 10,
        type: "new_match",
        title: expect.stringContaining("Jones Watch"),
      })
    );
  });

  it("skips already-linked events (no duplicate entries)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, user_id: 10, search_type: "case_number", search_value: "240900555", label: "Existing", monitor_changes: true, auto_add_new: true }],
    });
    // Calendar connection
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    // Matching court event
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 100 }] });
    // Entry already exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 50 }] });

    const result = await matchWatchedCases();
    expect(result.newEntriesCreated).toBe(0);
    expect(mockSyncCalendarEntry).not.toHaveBeenCalled();
  });

  it("uses LIKE for defendant_name search and exact for court_date", async () => {
    // Two watched cases: one name, one date
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, user_id: 10, search_type: "defendant_name", search_value: "DOE", label: "Doe", monitor_changes: true, auto_add_new: true },
        { id: 2, user_id: 10, search_type: "court_date", search_value: "2026-04-01", label: "April 1", monitor_changes: true, auto_add_new: true },
      ],
    });

    // Watched case 1: cal connection → no events
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Watched case 2: cal connection → no events
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await matchWatchedCases();

    // Check query for defendant_name used LIKE
    const nameQuery = mockQuery.mock.calls[2]; // 3rd call: SELECT court_events for case 1
    expect(nameQuery[0]).toContain("UPPER(defendant_name) LIKE");
    expect(nameQuery[1][0]).toBe("%DOE%");

    // Check query for court_date used exact match
    const dateQuery = mockQuery.mock.calls[4]; // 5th call: SELECT court_events for case 2
    expect(dateQuery[0]).toContain("event_date = $1");
    expect(dateQuery[1][0]).toBe("2026-04-01");
  });

  it("handles sync failure gracefully (non-fatal)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, user_id: 10, search_type: "defendant_name", search_value: "FAIL", label: "Fail Test", monitor_changes: true, auto_add_new: true }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 200 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // No existing entry
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 60 }] }); // INSERT

    // Sync fails
    mockSyncCalendarEntry.mockRejectedValueOnce(new Error("Token expired"));

    const result = await matchWatchedCases();
    expect(result.newEntriesCreated).toBe(1);
    expect(result.syncTriggered).toBe(0); // Sync failed
    // But notification still sent
    expect(mockCreateNotification).toHaveBeenCalled();
  });

  it("handles multiple calendar connections per user", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, user_id: 10, search_type: "defendant_name", search_value: "MULTI", label: "Multi Cal", monitor_changes: true, auto_add_new: true }],
    });
    // Two calendar connections
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }, { id: 6 }] });
    // One matching event
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 300 }] });
    // Cal 5 × event 300: no existing
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 70 }] });
    // Cal 6 × event 300: no existing
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 71 }] });

    const result = await matchWatchedCases();
    expect(result.newEntriesCreated).toBe(2); // One per connection
    expect(mockSyncCalendarEntry).toHaveBeenCalledWith(70);
    expect(mockSyncCalendarEntry).toHaveBeenCalledWith(71);
  });
});
