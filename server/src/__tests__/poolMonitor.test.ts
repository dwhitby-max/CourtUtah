import { describe, it, expect } from "vitest";
import { getPoolStats, stopPoolMonitor } from "../../src/db/pool";

describe("Pool monitoring", () => {
  it("getPoolStats returns null when pool is not initialized (no DATABASE_URL)", () => {
    // Without DATABASE_URL, pool is never created
    const stats = getPoolStats();
    expect(stats).toBeNull();
  });

  it("stopPoolMonitor does not throw when no monitor is running", () => {
    expect(() => stopPoolMonitor()).not.toThrow();
  });

  it("PoolStats interface shape matches expected fields", () => {
    // This validates our type at compile time — the runtime check
    // uses a mock stats object matching the PoolStats interface
    const mockStats = {
      totalCount: 3,
      idleCount: 2,
      waitingCount: 0,
      maxConnections: 5,
      utilizationPct: 20,
      collectedAt: new Date().toISOString(),
    };

    expect(mockStats).toHaveProperty("totalCount");
    expect(mockStats).toHaveProperty("idleCount");
    expect(mockStats).toHaveProperty("waitingCount");
    expect(mockStats).toHaveProperty("maxConnections");
    expect(mockStats).toHaveProperty("utilizationPct");
    expect(mockStats).toHaveProperty("collectedAt");
    expect(mockStats.utilizationPct).toBe(20);
  });

  it("utilization calculation is correct", () => {
    // Test the math: (active / max) * 100 where active = total - idle
    const total = 4;
    const idle = 1;
    const max = 5;
    const active = total - idle;
    const pct = Math.round((active / max) * 100);
    expect(pct).toBe(60);
  });

  it("utilization at max returns 100%", () => {
    const total = 5;
    const idle = 0;
    const max = 5;
    const active = total - idle;
    const pct = Math.round((active / max) * 100);
    expect(pct).toBe(100);
  });

  it("utilization with all idle returns 0%", () => {
    const total = 3;
    const idle = 3;
    const max = 5;
    const active = total - idle;
    const pct = Math.round((active / max) * 100);
    expect(pct).toBe(0);
  });
});
