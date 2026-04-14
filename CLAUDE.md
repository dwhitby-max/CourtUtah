# CLAUDE.md — Utah Court Calendar Tracker

**Version:** 0.14.0 | **Last Updated:** 2026-04-03
**Platform:** Replit (Node.js 20, PostgreSQL, VM deployment)
**Coding Standards:** `@file claudev7.md` (v7.0)

---

## PROJECT OVERVIEW

Full-stack app that scrapes Utah court calendars (legacy.utcourts.gov), lets users search by 9 fields, syncs events to connected calendars (Google/Microsoft/Apple/CalDAV), detects schedule changes, and notifies users via email/in-app/SMS.

**Stack:** React 18 + TypeScript + Vite + Tailwind | Express + TypeScript | PostgreSQL | node-cron | Socket.io | Nodemailer | Twilio

**Monorepo:** `client/` (React frontend), `server/` (Express backend), `shared/` (types)

---

## DEVELOPMENT RULES (MUST FOLLOW)

### Build & Deploy
- **Rebuild both client AND server after any code change:** `npm --prefix client run build && npm --prefix server run build`. Stale builds are the #1 cause of "my change didn't work."
- **`start-production.sh` must verify build artifacts exist** (`client/build/index.html`, `server/dist/server/src/index.js`) before starting. If missing, rebuild.
- **Prefer `__dirname`-based path resolution** with existence checks. `process.cwd()` is OK when Replit monorepo root is the CWD at runtime.
- **Simulate deployment locally** before committing: `bash build.sh && bash start-production.sh`. Also test from a different CWD.

### Authentication & OAuth
- **Google OAuth is the ONLY login method.** No email/password. `/api/auth/google` creates user + calendar_connections row in one transaction.
- **Write to localStorage synchronously in `setUser()`**, not via `useEffect`. React navigations happen before async effects → stale state → redirect loops.
- **Never use `clearToken()` in ProtectedRoute.** Just redirect; the OAuth callback issues a new JWT.
- **Use `sessionStorage` flags to prevent redirect loops** (one attempt per browser session).

### Timezone
- **All dates and times must use Mountain Standard Time (America/Denver).** This includes frontend date pickers, calendar event times, scheduler cron jobs, and any user-facing timestamps. Use local date components (not `toISOString()`) to avoid UTC shifts.

### Frontend Guards
- **Pages behind `ProtectedRoute` should NOT re-check `isLoggedIn`.** The wrapper guarantees auth.
- **"No calendar connected" API errors → redirect to `/api/auth/google`**, not an error message.

### Token Lifecycle
- **Store refresh tokens with `COALESCE`** — don't overwrite existing tokens with NULL.
- **Persist rotated refresh tokens** — Google and Microsoft can rotate during refresh.
- **Calendar changes require user confirmation** — set `sync_status = 'pending_update'`, don't auto-sync.

---

## CRITICAL LESSONS LEARNED

- **search.php shows only ONE attorney** with generic "Attorney:" label. Must fetch details.php for both attorneys (PLA ATTY / DEF ATTY labels).
- **Court list has commented-out courts** — strip HTML comments before parsing `<option>` tags.
- **DB upsert key must include event_time** — same case can have multiple hearings per day at different times.
- **Live results are authoritative for scheduling** (time, date, courtroom) but DB has richer enrichment (attorneys, OTN, charges). Enrich live results from DB BEFORE filtering.
- **Attorney filter must run AFTER enrichment** — otherwise live results with null attorneys get dropped before DB backfill.
- **Old parser corrupted defense_attorney** by blindly assigning generic "Attorney:" field. Migrations 033/034 clean this up.
- **Details page HTML has newlines in names** (e.g., "RYAN\nROBINSON") — normalize with `.replace(/\s+/g, " ")`.

---

## KEY DECISIONS

1. **Scraping:** HTML from search.php (primary), pdf-parse fallback for legacy courts. details.php fetched in parallel batches of 10 for attorney enrichment.
2. **Tokens:** AES-256-GCM encrypted via ENCRYPTION_KEY env var.
3. **Change detection:** SHA-256 content hash per event, field-level diff on each scrape cycle.
4. **Scheduling:** node-cron in `America/Denver` timezone — daily refresh 6:00 AM MT, cleanup 6:30 AM MT, daily digest 7:00 AM MT, weekly digest Mon 7:00 AM MT + manual `/api/admin/trigger-scrape` + Replit scheduled deployments.
5. **Calendar safety:** Only updates/deletes entries the app created (tracked in `calendar_entries` with provider's external event ID).
6. **Search caching:** First-time searches go live to utcourts.gov and persist results. Same-day repeats return cached DB results (courts update once daily at 5:30 AM).
7. **Saved searches:** Auto-saved for logged-in users. `search_params` JSONB with `_key` for dedup.
8. **Stripe cancellation:** `cancel_at_period_end: true` — stays active until renewal date.

---

## DATABASE TABLES

`users`, `calendar_connections`, `court_events`, `watched_cases`, `calendar_entries`, `notifications`, `change_log`, `saved_searches`, `export_templates`, `scrape_jobs`

See `server/migrations/` (001–035) for full schema. Key relationships:
- `calendar_connections.user_id` → `users.id`
- `calendar_entries` links `user_id`, `watched_case_id`, `court_event_id`, `calendar_connection_id`
- `court_events.content_hash` (SHA-256) drives change detection

---

## ENVIRONMENT VARIABLES

See `.env.example` for full list. Required: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Optional: Microsoft OAuth, SMTP, Twilio, Sentry.

---

## NEXT STEPS (TODO)

1. **Details page enrichment in scheduler** — daily cron should fetch details.php for attorney data (currently only during user searches)
2. **Notification delivery testing** — wire real SMTP + Twilio, test end-to-end
3. **Parser edge cases** — scrape all 135+ courts, log/tune failures
4. **Digest service tests** — unit tests for digestService.ts
5. **Export template validation** — verify persistence across logout/login cycles

---

## TESTING

139 tests across 10 vitest suites. Smoke test: `bash smoke-test.sh [url]` (15+ checks).
