import * as Sentry from "@sentry/node";
import { config } from "../config/env";

let initialized = false;

/**
 * Lazy-initialize Sentry (Rule 17.5 — third-party APIs always lazy-initialized).
 * Only sets up if SENTRY_DSN is provided. Noop otherwise.
 */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN || "";
  if (!dsn) {
    console.log("ℹ️  SENTRY_DSN not set — Sentry error tracking disabled");
    return;
  }

  Sentry.init({
    dsn,
    environment: config.nodeEnv,
    release: `court-calendar-tracker@0.14.0`,
    tracesSampleRate: config.nodeEnv === "production" ? 0.2 : 1.0,
    // Attach server name for multi-instance debugging
    serverName: process.env.REPL_SLUG || "court-tracker",
  });

  console.log("✅ Sentry error tracking initialized");
}

/**
 * Capture an exception in Sentry with the request's correlation ID.
 * Noop if Sentry is not initialized (no DSN).
 */
export function captureException(
  error: Error,
  context?: {
    correlationId?: string;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  }
): void {
  const dsn = process.env.SENTRY_DSN || "";
  if (!dsn) return;

  Sentry.withScope((scope) => {
    if (context?.correlationId) {
      scope.setTag("correlationId", context.correlationId);
    }

    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }

    if (context?.extra) {
      for (const [key, value] of Object.entries(context.extra)) {
        scope.setExtra(key, value);
      }
    }

    Sentry.captureException(error);
  });
}

/**
 * Capture a message-level event in Sentry.
 */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  context?: {
    correlationId?: string;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  }
): void {
  const dsn = process.env.SENTRY_DSN || "";
  if (!dsn) return;

  Sentry.withScope((scope) => {
    if (context?.correlationId) {
      scope.setTag("correlationId", context.correlationId);
    }

    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }

    if (context?.extra) {
      for (const [key, value] of Object.entries(context.extra)) {
        scope.setExtra(key, value);
      }
    }

    Sentry.captureMessage(message, level);
  });
}

/**
 * Flush pending Sentry events — call during graceful shutdown.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  const dsn = process.env.SENTRY_DSN || "";
  if (!dsn) return;

  await Sentry.flush(timeoutMs);
}
