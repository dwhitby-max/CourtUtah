# PROJECT HANDOFF — Utah Court Calendar Tracker

**Date:** 2026-03-13
**Version:** 0.12.0
**Status:** Full search parity with utcourts.gov (+ 3 extras). Notification frequency control (immediate/daily/weekly digest). 139 tests across 10 suites. Ready for Replit deployment.

---

## WHAT THIS IS

A full-stack web app that scrapes Utah court calendar HTML results from legacy.utcourts.gov/cal/search.php, lets users search court events, syncs matches to their personal calendar (Google/Microsoft/Apple/CalDAV), checks for schedule changes every 24 hours, and notifies users via email, SMS, and in-app notifications. Only touches calendar items the app created — never edits/deletes anything else.

## TECH STACK

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS
- **Backend:** Express + TypeScript
- **Database:** Replit PostgreSQL (SSL required, `rejectUnauthorized: false`)
- **Background Jobs:** node-cron (daily 2 AM UTC) + Replit scheduled deployment
- **Real-time:** Socket.io (WebSocket + polling fallback)
- **Error Tracking:** Sentry (optional — SENTRY_DSN env var)
- **Testing:** Vitest (139 tests across 10 suites)
- **Deployment:** Replit VM (`deploymentTarget = "vm"`)

## ARCHITECTURE RULES

This project follows a strict guideline document (`CLAUDEv5.md`) with these critical rules:

- Monorepo: `client/` + `server/` + `shared/` (never `frontend/` or `backend/`)
- Server listens BEFORE async DB connection (Rule 17.1)
- Single port 5000 on 0.0.0.0, single `[[ports]]` in `.replit` (Rule 15)
- Route order: health → request logger → security middleware → body parsers → rate limiting → API → static → SPA fallback (Rule 17.2)
- DB connection non-fatal — server stays up if DB fails (Rule 17.3)
- Never `process.exit()` in module load path (Rule 17.4)
- Third-party APIs always lazy-initialized (Rule 17.5)
- `rootDir: ".."` in server tsconfig → compiled path is `server/dist/server/src/index.js` (Rule 17.6)
- Use `process.cwd()` not `__dirname` for cross-package paths (Rule 17.7)
- Migrations idempotent SQL via Node.js runner, never psql (Rule 18.4)
- OAuth tokens encrypted AES-256-GCM via ENCRYPTION_KEY env var
- Error responses never leak internals in production — use correlation IDs (Rule 17.13)
- Per-request correlation IDs via requestLogger middleware
- All pool client usage wrapped in try/finally (Rule 18.7)
- Rate limiting on all API routes — global + heavy (calendar) + auth limiters (Rule 17.12)
- No mock data, no hardcoded secrets, no `any` types (Rules 8, 10.2)
- shared/types.ts is the single source of truth for all interfaces (Rule 10.5)
- Read→Analyze→Explain→Propose→Edit→Lint→Halt cycle for all changes (Rule 1)
- Update CLAUDE.md after every major change

## DATABASE SCHEMA (8 tables + schema_migrations, 10 migration files)

```
users                  — id, email, password_hash, phone, email_verified, email_verification_token,
                         reset_password_token, reset_password_expires, notification_preferences (JSONB)
calendar_connections   — id, user_id, provider, access_token_encrypted, refresh_token_encrypted,
                         token_expires_at, calendar_id, caldav_url, is_active
court_events           — id, court_type, court_name, court_room, event_date, event_time, hearing_type,
                         case_number, case_type, defendant_name, defendant_otn, defendant_dob,
                         citation_number, sheriff_number, lea_number, prosecuting_attorney,
                         defense_attorney, judge_name, hearing_location, is_virtual,
                         source_pdf_url, source_url, source_page_number, content_hash, charges (JSONB),
                         scraped_at
watched_cases          — id, user_id, search_type, search_value, label, is_active
calendar_entries       — id, user_id, watched_case_id, court_event_id, calendar_connection_id,
                         external_event_id, external_calendar_id, last_synced_content_hash,
                         sync_status (pending/synced/error), sync_error
notifications          — id, user_id, type, title, message, metadata (JSONB), read, channels_sent (JSONB)
change_log             — id, court_event_id, field_changed, old_value, new_value, detected_at
scrape_jobs            — id, status, courts_processed, events_found, events_changed, error_message,
                         started_at, completed_at
```

## WHAT WORKS NOW

### Core Features (no external credentials needed)
- User registration, login, password reset flow
- **Email verification** — verification email sent on register, GET /api/auth/verify-email endpoint, resend-verification endpoint
- **Login page verification banner** — reads ?verified=success/invalid/expired and ?registered=true from URL params, shows colored banner with resend button
- **HTML court calendar scraping** — fetches court list from legacy.utcourts.gov/cal/, parses 35 district + 100+ justice court location codes, fetches search.php HTML results per court
- **HTML event parser** — extracts time, date, court name, case parties, judge, courtroom, hearing type, case number, case type, virtual hearing flag, hearing location from search.php results. **Validated against real utcourts.gov HTML** — uses pipe-delimiter injection at `</div>` boundaries to cleanly separate defendant names from judge names.
- **Legacy PDF fallback** — retains divider-based PDF text parser for any courts still producing PDFs
- **reports.php Full Court Calendar parser** — parses HTML tables for attorneys, charges, OTN, DOB, citation/sheriff/LEA numbers; text-block fallback for non-table formats; integrated into scheduler for automatic enrichment
- Court event parsing with SHA-256 content hashing + field-level diff
- Full search across 9 fields (defendant name, case #, court, date, OTN, citation, charges, judge name, attorney)
- Search results display judge name, hearing location, virtual hearing badge, charges badge + expandable detail rows
- Watched cases CRUD + sync-to-calendar trigger (supports all 9 search types including judge + attorney)
- Change detection via SHA-256 content hashing + field-level diff
- In-app notifications with read/unread management
- **Notification frequency control** — immediate (send on every change), daily digest (6 AM UTC summary email/SMS), weekly digest (Monday 6 AM UTC). In-app + Socket.io always immediate. Digest service aggregates deferred notifications into HTML summary emails.
- **Socket.io real-time notifications** — server pushes to user rooms, NotificationBell auto-updates, 30s polling fallback
- Daily scheduler (node-cron at 2 AM UTC) with 200ms inter-court rate limiting
- **Watched case auto-matching** — after each scrape, automatically matches new events against all active watched cases, creates calendar entries, triggers syncs, and sends `new_match` notifications. Runs as non-fatal post-scrape step.
- **Retry logic with exponential backoff** — fetchUrl retries 3x (1s/2s/4s) on transient network errors (ECONNRESET, ETIMEDOUT, ECONNREFUSED)
- **Mobile responsive** — hamburger nav menu, card layout for watched cases on small screens, overflow-x-auto tables
- **Smoke test script** — `bash smoke-test.sh [url]` validates health, auth gates, security headers, rate limiting, SPA fallback, DB status
- Profile page with notification preference toggles (PATCH /api/auth/profile)

### Google Calendar Integration (requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REDIRECT_URI)
- Full OAuth 2.0 flow: authorization URL generation → callback → token exchange → encrypted storage
- Event CRUD via Google Calendar API v3: POST new events, PATCH existing events
- Automatic token refresh when access_token expires (60s buffer), writes refreshed token back to DB
- America/Denver timezone, AM/PM → 24h time conversion

### Microsoft Calendar Integration (requires MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET + MICROSOFT_REDIRECT_URI)
- Full OAuth 2.0 flow via Microsoft identity platform (common tenant)
- Event CRUD via Microsoft Graph API: POST /me/events, PATCH /me/events/{id}
- Automatic token refresh, preserves rotating refresh tokens
- America/Denver timezone, isAllDay flag for dateless events

### Apple iCloud / CalDAV Integration (user provides credentials per-connection)
- CalDAV PUT with VCALENDAR/VEVENT body (RFC 5545 compliant)
- ICS UID tracking for updates, Basic auth with encrypted credentials
- Supports iCloud (caldav.icloud.com) and any generic CalDAV server
- AM/PM → 24h time conversion, TZID=America/Denver for timed events

### Production Hardening
- Per-request correlation IDs, graceful shutdown (Socket.io + HTTP + pool monitor + Sentry flush + 10s timeout)
- Heavy rate limiting on calendar routes (20 req/min), global (100 req/15min), auth (10 req/15min)
- Typed pool.query(), typed CalendarSyncRow (no Record<string, unknown>)
- **CORS tightened** — uses `CORS_ORIGIN` env var in production, same-origin default, wildcard only in dev
- **Token expiry UI** — CalendarSettingsPage shows Active/Expiring/Expired badges, re-auth button for Google/Microsoft
- **Connection pool monitoring** — `getPoolStats()` returns total/idle/waiting/max/utilization%, periodic logging every 5 min, warns at 80%+ utilization or waiting clients, pool stats exposed in /health endpoint
- **Sentry error tracking** — lazy-initialized sentryService.ts (noop without SENTRY_DSN), captureException with correlation IDs + method/path tags, captureMessage for scrape job completion, integrated into errorHandler middleware and scheduler

### Testing (139 tests, all passing)
- `changeDetector.test.ts` (7): identical records, single/multi changes, null handling, untracked fields
- `courtEventParser.test.ts` (21): HTML parser + legacy PDF parser
- `courtScraper.test.ts` (5): empty HTML, district courts, justice courts, deduplication, combined parsing
- `calendarSync.test.ts` (15): Google/Microsoft/CalDAV builders, timed vs all-day, AM/PM, 12PM/12AM, ICS escaping
- `scheduler.test.ts` (6): date list builder — weekday-only, chronological order, ISO format, edge cases
- `integration.test.ts` (40): health endpoint, auth validation, protected routes, search validation, response formatting, admin auth gates, admin authenticated, charges search, auth token edge cases, security headers, calendar auth gates
- `poolMonitor.test.ts` (6): null stats without DB, stopPoolMonitor safety, interface shape, utilization math
- `sentryService.test.ts` (7): init/capture/flush noop without DSN, idempotent init, context handling
- `reportParser.test.ts` (23): URL builder, empty/null/updating HTML, single/multi case parsing, attorney extraction, citation/sheriff/LEA, hearing types, charges, text fallback, enrichment merge
- `watchedCaseMatcher.test.ts` (9): no watched cases, null pool, no calendar connections, no matching events, new match creation + sync, duplicate skipping, LIKE vs exact query types, sync failure graceful handling, multiple calendar connections

## WHAT NEEDS CREDENTIALS (env vars)

- **Google Calendar** → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` — **Complete**
- **Microsoft Calendar** → `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` — **Complete**
- **Apple/CalDAV** → user provides per-connection (stored encrypted) — **Complete**
- Email → `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`
- SMS → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- CORS → `CORS_ORIGIN` (optional — production only, defaults to same-origin)
- Sentry → `SENTRY_DSN` (optional — error tracking disabled if unset)

## TODO — PRIORITY ORDER

### 1. Deploy to Replit
Deploy and run `bash smoke-test.sh`. Trigger a manual scrape via Admin dashboard and verify events are inserted into DB correctly. Check pool stats in /health.

### 2. Reports.php Validation
The reports.php parser was built from documented format (attorneys, charges, OTN/DOB), but the actual rendered HTML could not be fetched during development (JavaScript-driven, robots.txt blocks). Needs validation against real HTML output from the server-side fetcher (which bypasses robots.txt).

### 3. Notification Delivery Testing
Wire real SMTP and Twilio credentials. emailService and smsService are fully implemented — just need env vars on Replit. Test schedule change email and SMS delivery end-to-end.

### 4. Parser Edge Cases
Run scrape across all 135+ courts and log any parsing failures. Tune regex patterns for edge cases (non-standard courtroom names, unusual hearing types, multi-defendant cases).

---

## REPLIT DEPLOYMENT STEPS

1. Create new Replit project (Node.js)
2. Upload zip, run: `unzip utah-court-calendar-tracker.zip -d . && rm utah-court-calendar-tracker.zip`
3. Enable Replit PostgreSQL add-on (auto-sets `DATABASE_URL`)
4. Add required secrets:
   - `JWT_SECRET` → `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `ENCRYPTION_KEY` → same command
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`
   - `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_REDIRECT_URI`
   - `CORS_ORIGIN` → your Replit deployment URL (e.g., `https://yourapp.repl.co`)
   - `SENTRY_DSN` → (optional) your Sentry project DSN
5. Hit Run — `start.sh` handles install, build, migrate, start
6. Run tests: `cd server && npm test`

---

## KEY FILES CHANGED IN v0.7.1 → v0.8.0

| File | Change |
|------|--------|
| `server/src/db/pool.ts` | **UPDATED** — Added `getPoolStats()`, `stopPoolMonitor()`, periodic pool monitoring (5 min interval, 80% utilization warning) |
| `server/src/routes/health.ts` | **UPDATED** — Health endpoint returns pool stats (total, idle, waiting, max, utilizationPct) |
| `server/src/services/sentryService.ts` | **NEW** — Sentry error tracking: lazy init, `captureException` with correlation IDs + tags, `captureMessage`, `flushSentry` |
| `server/src/services/reportParser.ts` | **NEW** — reports.php Full Court Calendar parser: HTML table + text fallback, extracts attorneys/charges/OTN/DOB/citation/sheriff/LEA, `enrichEventsWithReportData()` merges into existing events |
| `server/src/services/schedulerService.ts` | **UPDATED** — Integrated reportParser into scrape loop (fetch reports.php per court, enrich events, pass charges to upsert), added Sentry captures on job failure/completion |
| `server/src/middleware/errorHandler.ts` | **UPDATED** — Captures every unhandled error to Sentry with correlation ID, method, path |
| `server/src/index.ts` | **UPDATED** — `initSentry()` on startup, `flushSentry()` + `stopPoolMonitor()` on graceful shutdown |
| `server/src/config/env.ts` | **UPDATED** — Added `sentryDsn` config |
| `server/migrations/010_charges_column.sql` | **NEW** — Adds charges JSONB column to court_events |
| `shared/types.ts` | **UPDATED** — Added `charges: string[]` to CourtEvent, pool stats to HealthResponse |
| `.env.example` | **UPDATED** — Added SENTRY_DSN |
| `server/src/__tests__/poolMonitor.test.ts` | **NEW** — 6 tests for pool stats |
| `server/src/__tests__/sentryService.test.ts` | **NEW** — 7 tests for Sentry service noop behavior |
| `server/src/__tests__/reportParser.test.ts` | **NEW** — 23 tests for report parser + enrichment |

## KEY FILES CHANGED IN v0.9.0 → v0.10.0

| File | Change |
|------|--------|
| `server/src/services/watchedCaseMatcher.ts` | **NEW** — Auto-matches scraped events against active watched cases, creates calendar entries, triggers syncs, sends `new_match` notifications |
| `server/src/services/schedulerService.ts` | **UPDATED** — Calls `matchWatchedCases()` after scrape completion (non-fatal on failure) |
| `shared/types.ts` | **UPDATED** — Added `"new_match"` to `NotificationType` union |
| `server/src/__tests__/watchedCaseMatcher.test.ts` | **NEW** — 9 tests for auto-matching: empty cases, null pool, no connections, no events, new match + sync, dedup, LIKE vs exact, sync failure, multi-connection |

---

## VERSION HISTORY

| Version | Changes |
|---------|---------|
| 0.1.0 | Initial architecture, schema, project plan |
| 0.2.0 | Full server scaffolding: all services, routes, middleware |
| 0.3.0 | Full client scaffolding: React + Tailwind, all pages and API layer |
| 0.4.0 | CLAUDEv5 compliance audit: requestLogger, graceful shutdown, heavyLimiter, typed pool.query() |
| 0.5.0 | Google Calendar API v3 integration: full CRUD, token refresh, typed sync functions |
| 0.6.0 | Microsoft Graph API, CalDAV/Apple iCloud, Socket.io notifications, email verification, AM/PM time fix, 33 unit tests |
| 0.7.0 | HTML scraper rewrite (search.php), court list parser, HTML event parser, login verification banner, judge/location/virtual fields, 48 unit tests |
| 0.7.1 | Multi-date scraping (today + 14 weekdays), CORS tightened for production, token expiry UI with re-auth, RegisterPage redirect fix, 54 → 72 unit tests |
| 0.8.0 | Connection pool monitoring (getPoolStats, periodic logging, /health pool stats), Sentry error tracking (sentryService.ts with correlation IDs, errorHandler integration), reports.php parser (attorneys/charges/OTN/DOB enrichment, scheduler integration, charges JSONB migration), 108 tests across 9 suites |
| 0.9.0 | Admin dashboard (scrape job history, pool stats, manual trigger, aggregate stats), charges search (JSONB text search), expandable detail rows (attorneys/OTN/DOB/charges), 22 new integration tests, 130 tests across 9 suites |
| 0.10.0 | Watched case auto-matching (matchWatchedCases in scheduler post-scrape, creates calendar entries + syncs + new_match notifications), 139 tests across 10 suites |
| 0.11.0 | Parser validated against real utcourts.gov HTML — critical fix: pipe-delimiter injection at div boundaries for clean defendant/judge separation. Mobile responsive: hamburger nav, card layouts. Smoke test script (smoke-test.sh). 139 tests across 10 suites |
| 0.12.0 | Full search parity: added judge name + attorney search (9 fields total). Notification frequency: immediate/daily_digest/weekly_digest with digestService.ts, deferred delivery markers, cron jobs at 6AM UTC daily + Monday weekly. ProfilePage frequency selector UI. 139 tests across 10 suites |
