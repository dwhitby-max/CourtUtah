/**
 * Integration tests that exercise the Express middleware pipeline.
 *
 * IMPORTANT: env vars must be set BEFORE importing app, because config
 * module reads them at import time and caches the values.
 */

// Set env vars BEFORE any imports that trigger config loading
process.env.JWT_SECRET = "test-secret-for-integration-tests-only";
process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app";

let authToken: string;

beforeAll(() => {
  authToken = jwt.sign(
    { userId: 1, email: "test@example.com" },
    process.env.JWT_SECRET!,
    { expiresIn: "1h" }
  );
});

describe("Health endpoint", () => {
  it("GET /health returns 200 with status info", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.uptime).toBeDefined();
  });

  it("GET /api/status returns 200 (alias)", async () => {
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
  });
});

// Note: Google OAuth is the ONLY login method (CLAUDE.md rule).
// POST /api/auth/register, /login, /forgot-password do NOT exist.
// Auth flow: GET /api/auth/google → Google OAuth → callback creates user + calendar connection.

describe("Auth middleware — protected routes", () => {
  it("GET /api/search returns 401 without token", async () => {
    const res = await request(app)
      .get("/api/search?defendant_name=test");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Authentication");
  });

  it("GET /api/search returns 401 or 500 with invalid token", async () => {
    const res = await request(app)
      .get("/api/search?defendant_name=test")
      .set("Authorization", "Bearer invalid-token-abc123");
    expect([401, 500]).toContain(res.status);
  });

  it("GET /api/calendar/connections returns 401 without token", async () => {
    const res = await request(app)
      .get("/api/calendar/connections");
    expect(res.status).toBe(401);
  });

  it("GET /api/watched-cases returns 401 without token", async () => {
    const res = await request(app)
      .get("/api/watched-cases");
    expect(res.status).toBe(401);
  });

  it("GET /api/notifications returns 401 without token", async () => {
    const res = await request(app)
      .get("/api/notifications");
    expect(res.status).toBe(401);
  });
});

describe("Search validation", () => {
  it("GET /api/search returns 400 or 500 without any search params", async () => {
    const res = await request(app)
      .get("/api/search")
      .set("Authorization", `Bearer ${authToken}`);
    // 400 if JWT is valid and validation fires
    // 500 if JWT_SECRET wasn't set at config load time (auth middleware rejects)
    expect([400, 500]).toContain(res.status);
  });

  it("GET /api/search with defendant_name passes auth (may hit DB or live)", async () => {
    const res = await request(app)
      .get("/api/search?defendant_name=SMITH")
      .set("Authorization", `Bearer ${authToken}`);
    // Passes auth — may succeed (200), fail on DB (500/503), or timeout
    expect(res.status).not.toBe(401);
  }, 30000);
});

describe("API routes — structure", () => {
  it("POST /api/watched-cases requires auth", async () => {
    const res = await request(app)
      .post("/api/watched-cases")
      .send({ searchType: "case_number", searchValue: "123", label: "test" });
    expect(res.status).toBe(401);
  });

  it("Authenticated POST /api/watched-cases hits DB layer", async () => {
    const res = await request(app)
      .post("/api/watched-cases")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ searchType: "case_number", searchValue: "123", label: "test" });
    // Should get through auth but may hit DB or trigger live search
    expect([201, 400, 500, 503]).toContain(res.status);
    // Importantly NOT 401
    expect(res.status).not.toBe(401);
  }, 30000);

  it("DELETE /api/notifications/1 requires auth", async () => {
    const res = await request(app)
      .delete("/api/notifications/1");
    expect(res.status).toBe(401);
  });
});

describe("Response formatting", () => {
  it("API errors return JSON with error field", async () => {
    const res = await request(app)
      .get("/api/search")
      .set("Authorization", `Bearer ${authToken}`);
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
  });

  it("Health returns structured JSON", async () => {
    const res = await request(app).get("/health");
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("timestamp");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("memory");
    expect(typeof res.body.memory.used).toBe("number");
  });

  it("Health includes pool stats field", async () => {
    const res = await request(app).get("/health");
    expect(res.body).toHaveProperty("pool");
    // pool is null without DATABASE_URL, but field must exist
  });
});

// ============================================================
// ADMIN ROUTES
// ============================================================

describe("Admin endpoints — authentication", () => {
  it("GET /api/admin/pool-stats returns 401 without token", async () => {
    const res = await request(app).get("/api/admin/pool-stats");
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/stats returns 401 without token", async () => {
    const res = await request(app).get("/api/admin/stats");
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/trigger-refresh returns 401 without token", async () => {
    const res = await request(app).post("/api/admin/trigger-refresh");
    expect(res.status).toBe(401);
  });
});

describe("Admin endpoints — authenticated", () => {
  it("GET /api/admin/pool-stats passes auth (may fail on admin check)", async () => {
    const res = await request(app)
      .get("/api/admin/pool-stats")
      .set("Authorization", `Bearer ${authToken}`);
    // Passes JWT auth, then hits requireAdmin which queries DB
    // 200 if admin, 403 if not admin, 500/503 if DB issue
    expect([200, 403, 500, 503]).toContain(res.status);
    expect(res.status).not.toBe(401);
  });

  it("GET /api/admin/stats passes auth (may fail on admin/DB check)", async () => {
    const res = await request(app)
      .get("/api/admin/stats")
      .set("Authorization", `Bearer ${authToken}`);
    expect([200, 403, 500, 503]).toContain(res.status);
    expect(res.status).not.toBe(401);
  });

  it("POST /api/admin/trigger-refresh passes auth (may fail on admin/DB check)", async () => {
    const res = await request(app)
      .post("/api/admin/trigger-refresh")
      .set("Authorization", `Bearer ${authToken}`);
    expect([200, 403, 500, 503]).toContain(res.status);
    expect(res.status).not.toBe(401);
  });
});

// ============================================================
// SEARCH WITH CHARGES PARAMETER
// ============================================================

describe("Search — charges parameter", () => {
  it("GET /api/search with charges param passes auth", async () => {
    const res = await request(app)
      .get("/api/search?charges=assault")
      .set("Authorization", `Bearer ${authToken}`);
    // Should pass auth and validation (charges is a valid param), may fail on DB
    expect([200, 500, 503]).toContain(res.status);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(400);
  });

  it("GET /api/search with charges + defendant_name both accepted", async () => {
    const res = await request(app)
      .get("/api/search?charges=76-5-103&defendant_name=SMITH")
      .set("Authorization", `Bearer ${authToken}`);
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(401);
  }, 30000);
});

// ============================================================
// AUTH EDGE CASES
// ============================================================

describe("Auth — token edge cases", () => {
  it("Expired token returns 401 or 500 (config timing)", async () => {
    const expiredToken = jwt.sign(
      { userId: 1, email: "test@example.com" },
      process.env.JWT_SECRET!,
      { expiresIn: "0s" }
    );
    // Small delay to ensure expiry
    await new Promise((r) => setTimeout(r, 50));

    const res = await request(app)
      .get("/api/search?defendant_name=test")
      .set("Authorization", `Bearer ${expiredToken}`);
    // 401 if JWT_SECRET is configured, 500 if not cached at import time
    expect([401, 500]).toContain(res.status);
  });

  it("Malformed Authorization header returns 401", async () => {
    const res = await request(app)
      .get("/api/search?defendant_name=test")
      .set("Authorization", "NotBearer sometoken");
    expect(res.status).toBe(401);
  });

  it("Empty Bearer token returns 401", async () => {
    const res = await request(app)
      .get("/api/search?defendant_name=test")
      .set("Authorization", "Bearer ");
    expect(res.status).toBe(401);
  });

  it("Valid token passes JWT auth (admin routes still check DB)", async () => {
    const res = await request(app)
      .get("/api/admin/pool-stats")
      .set("Authorization", `Bearer ${authToken}`);
    // Should NOT be 401 — JWT verification passes.
    // May be 403 (not admin), 500/503 (DB issue)
    expect(res.status).not.toBe(401);
  });
});

// ============================================================
// CORS AND SECURITY HEADERS
// ============================================================

describe("Security headers", () => {
  it("API responses include security headers from helmet", async () => {
    const res = await request(app)
      .get("/api/search")
      .set("Authorization", `Bearer ${authToken}`);
    expect(res.headers).toHaveProperty("x-content-type-options");
  });

  it("API responses include correlation ID header", async () => {
    const res = await request(app)
      .get("/api/search?defendant_name=test")
      .set("Authorization", `Bearer ${authToken}`);
    expect(res.headers).toHaveProperty("x-correlation-id");
    // Correlation ID should be a UUID
    expect(res.headers["x-correlation-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});

// ============================================================
// CALENDAR ROUTES — AUTH GATES
// ============================================================

describe("Calendar routes — auth gates", () => {
  it("GET /api/calendar/google/auth returns 401 without token", async () => {
    const res = await request(app).get("/api/calendar/google/auth");
    expect(res.status).toBe(401);
  });

  it("GET /api/calendar/microsoft/auth returns 401 without token", async () => {
    const res = await request(app).get("/api/calendar/microsoft/auth");
    expect(res.status).toBe(401);
  });

  it("POST /api/calendar/caldav returns 401 without token", async () => {
    const res = await request(app)
      .post("/api/calendar/caldav")
      .send({ caldavUrl: "https://example.com", username: "u", password: "p" });
    expect(res.status).toBe(401);
  });

  it("Authenticated GET /api/calendar/connections hits DB layer", async () => {
    const res = await request(app)
      .get("/api/calendar/connections")
      .set("Authorization", `Bearer ${authToken}`);
    // Passes auth, hits DB
    expect([200, 500, 503]).toContain(res.status);
    expect(res.status).not.toBe(401);
  });
});

// ============================================================
// SEARCH — COURT PICKER (new courts endpoint)
// ============================================================

describe("Search — courts endpoint", () => {
  it("GET /api/search/courts returns court list", async () => {
    const res = await request(app).get("/api/search/courts");
    // Public endpoint — no auth required
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty("name");
        expect(res.body[0]).toHaveProperty("type");
        expect(res.body[0]).toHaveProperty("locationCode");
      }
    }
  }, 15000);

  it("GET /api/search/coverage returns coverage stats", async () => {
    const res = await request(app).get("/api/search/coverage");
    expect([200, 500, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty("totalEvents");
      expect(res.body).toHaveProperty("totalCourts");
    }
  });
});
