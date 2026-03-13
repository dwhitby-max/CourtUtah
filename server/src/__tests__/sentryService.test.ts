import { describe, it, expect } from "vitest";
import { captureException, captureMessage, flushSentry, initSentry } from "../../src/services/sentryService";

describe("Sentry service", () => {
  it("initSentry does not throw when SENTRY_DSN is not set", () => {
    // Without SENTRY_DSN, init should be a safe noop
    expect(() => initSentry()).not.toThrow();
  });

  it("captureException does not throw without SENTRY_DSN", () => {
    const error = new Error("test error");
    expect(() =>
      captureException(error, {
        correlationId: "test-123",
        tags: { method: "GET", path: "/api/test" },
        extra: { query: { foo: "bar" } },
      })
    ).not.toThrow();
  });

  it("captureException handles error without context", () => {
    const error = new Error("bare error");
    expect(() => captureException(error)).not.toThrow();
  });

  it("captureMessage does not throw without SENTRY_DSN", () => {
    expect(() =>
      captureMessage("test warning", "warning", {
        correlationId: "msg-456",
        tags: { service: "scheduler" },
      })
    ).not.toThrow();
  });

  it("captureMessage handles call with no context", () => {
    expect(() => captureMessage("simple message")).not.toThrow();
  });

  it("flushSentry resolves without SENTRY_DSN", async () => {
    await expect(flushSentry(100)).resolves.toBeUndefined();
  });

  it("multiple initSentry calls are idempotent", () => {
    // Calling init multiple times should not throw
    expect(() => {
      initSentry();
      initSentry();
      initSentry();
    }).not.toThrow();
  });
});
