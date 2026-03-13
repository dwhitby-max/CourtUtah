# CLAUDE.md — Utah Court Calendar Tracker

**Project:** Utah Court Calendar Tracker
**Version:** 0.12.0
**Last Updated:** 2026-03-13
**Platform:** Replit (Node.js 20, PostgreSQL, VM deployment)

---

## PROJECT OVERVIEW

A full-stack application that:
1. Scrapes Utah court calendar HTML results from legacy.utcourts.gov/cal/search.php (PDF fallback for legacy courts), enriches with reports.php data (attorneys, charges, OTN/DOB)
2. Allows users to search court schedules by 9 fields: defendant name, case number, court, date, OTN, citation number, charges, judge name, attorney — matching all utcourts.gov search options plus 3 extras
3. Creates calendar entries in the user's connected calendar (Google, Microsoft Outlook, Apple iCloud, or generic CalDAV/ICS)
4. Runs a daily scrape (2 AM UTC) across 135+ courts × 15 dates, auto-matches new events against watched cases, and syncs to calendars
5. Detects schedule changes via field-level diff and notifies users via email, in-app, and SMS — with frequency control (immediate, daily digest, weekly digest)
6. Only touches calendar items the app created — never edits/deletes anything else

---

## ARCHITECTURE

### Stack
- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS
- **Backend:** Express + TypeScript
- **Database:** Replit PostgreSQL (SSL required)
- **Background Jobs:** node-cron (in-process) + Replit scheduled deployment (external trigger)
- **Notifications:** Email (Nodemailer/SendGrid), In-App (WebSocket via Socket.io), SMS (Twilio)

### Monorepo Structure
```
project-root/
├── client/                    # React frontend (Vite)
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── Layout.tsx
│       │   ├── ProtectedRoute.tsx
│       │   ├── NotificationBell.tsx
│       │   └── SearchForm.tsx
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── RegisterPage.tsx
│       │   ├── ForgotPasswordPage.tsx
│       │   ├── ResetPasswordPage.tsx
│       │   ├── DashboardPage.tsx
│       │   ├── SearchPage.tsx
│       │   ├── SearchResultsPage.tsx
│       │   ├── WatchedCasesPage.tsx
│       │   ├── CalendarSettingsPage.tsx
│       │   ├── NotificationSettingsPage.tsx
│       │   └── ProfilePage.tsx
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   ├── useNotifications.ts
│       │   └── useSearch.ts
│       ├── api/
│       │   ├── client.ts
│       │   ├── auth.ts
│       │   ├── search.ts
│       │   ├── calendar.ts
│       │   └── notifications.ts
│       ├── store/
│       │   └── authStore.ts
│       └── utils/
│           └── formatters.ts
│
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── migrations/
│   │   ├── 001_users.sql
│   │   ├── 002_calendar_connections.sql
│   │   ├── 003_court_events.sql
│   │   ├── 004_watched_cases.sql
│   │   ├── 005_calendar_entries.sql
│   │   ├── 006_notifications.sql
│   │   ├── 007_change_log.sql
│   │   ├── 008_scrape_jobs.sql
│   │   └── 009_html_scraper_columns.sql
│   └── src/
│       ├── index.ts
│       ├── app.ts
│       ├── routes/
│       │   ├── index.ts
│       │   ├── auth.ts
│       │   ├── search.ts
│       │   ├── calendar.ts
│       │   ├── notifications.ts
│       │   ├── watchedCases.ts
│       │   └── health.ts
│       ├── services/
│       │   ├── courtScraper.ts        # HTML court list + search.php fetcher (primary)
│       │   ├── pdfScraper.ts          # Deprecated re-export → courtScraper
│       │   ├── courtEventParser.ts    # HTML result parser + legacy PDF parser
│       │   ├── reportParser.ts        # reports.php Full Court Calendar parser (attorneys + charges)
│       │   ├── searchService.ts
│       │   ├── calendarSync.ts
│       │   ├── googleCalendar.ts
│       │   ├── microsoftCalendar.ts
│       │   ├── appleCalendar.ts
│       │   ├── caldavCalendar.ts
│       │   ├── schedulerService.ts
│       │   ├── changeDetector.ts
│       │   ├── notificationService.ts
│       │   ├── emailService.ts
│       │   ├── smsService.ts
│       │   ├── encryptionService.ts
│       │   ├── watchedCaseMatcher.ts  # Auto-matches scraped events → watched cases → calendar entries
│       │   └── sentryService.ts       # Sentry error tracking with correlation IDs
│       ├── middleware/
│       │   ├── auth.ts
│       │   ├── rateLimiter.ts
│       │   ├── requestLogger.ts
│       │   └── errorHandler.ts
│       ├── config/
│       │   └── env.ts
│       ├── db/
│       │   ├── pool.ts
│       │   └── migrate.ts
│       └── utils/
│           └── logger.ts
│
├── shared/
│   └── types.ts
│
├── package.json               # Root monorepo scripts
├── start.sh
├── .replit
├── replit.nix
├── .env.example
├── .gitignore
└── CLAUDE.md
```

---

## DATABASE SCHEMA

### users
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| email | VARCHAR(255) UNIQUE NOT NULL | |
| password_hash | VARCHAR(255) NOT NULL | bcrypt |
| phone | VARCHAR(20) | For SMS notifications |
| email_verified | BOOLEAN DEFAULT false | |
| email_verification_token | VARCHAR(255) | |
| reset_password_token | VARCHAR(255) | |
| reset_password_expires | TIMESTAMP | |
| notification_preferences | JSONB DEFAULT '{}' | email/sms/in-app toggles |
| created_at | TIMESTAMP DEFAULT NOW() | |
| updated_at | TIMESTAMP DEFAULT NOW() | |

### calendar_connections
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| user_id | INTEGER REFERENCES users(id) | |
| provider | VARCHAR(50) NOT NULL | google, microsoft, apple, caldav |
| access_token_encrypted | TEXT | AES-256 encrypted |
| refresh_token_encrypted | TEXT | AES-256 encrypted |
| token_expires_at | TIMESTAMP | |
| calendar_id | VARCHAR(255) | Selected calendar within the provider |
| caldav_url | TEXT | For generic CalDAV connections |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMP DEFAULT NOW() | |
| updated_at | TIMESTAMP DEFAULT NOW() | |

### court_events
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| court_type | VARCHAR(50) | DistrictCourt, JusticeCourt |
| court_name | VARCHAR(255) | |
| court_room | VARCHAR(100) | |
| event_date | DATE | |
| event_time | VARCHAR(20) | |
| hearing_type | VARCHAR(255) | |
| case_number | VARCHAR(255) | |
| case_type | VARCHAR(255) | |
| defendant_name | VARCHAR(255) | |
| defendant_otn | VARCHAR(255) | Offender Tracking Number |
| defendant_dob | DATE | |
| citation_number | VARCHAR(255) | |
| sheriff_number | VARCHAR(255) | |
| lea_number | VARCHAR(255) | Law enforcement agency # |
| prosecuting_attorney | VARCHAR(255) | |
| defense_attorney | VARCHAR(255) | |
| judge_name | VARCHAR(255) | From HTML scraper (migration 009) |
| hearing_location | VARCHAR(255) | City where hearing is held (migration 009) |
| is_virtual | BOOLEAN DEFAULT false | Virtual hearing flag (migration 009) |
| source_pdf_url | TEXT | Legacy PDF URL |
| source_url | TEXT | HTML calendar URL (migration 009) |
| source_page_number | INTEGER | |
| content_hash | VARCHAR(64) | SHA-256 of event data for change detection |
| scraped_at | TIMESTAMP DEFAULT NOW() | |
| created_at | TIMESTAMP DEFAULT NOW() | |
| updated_at | TIMESTAMP DEFAULT NOW() | |

### watched_cases
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| user_id | INTEGER REFERENCES users(id) | |
| search_type | VARCHAR(50) | defendant_name, case_number, etc. |
| search_value | VARCHAR(255) | The search term |
| label | VARCHAR(255) | User-friendly label |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMP DEFAULT NOW() | |
| updated_at | TIMESTAMP DEFAULT NOW() | |

### calendar_entries
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| user_id | INTEGER REFERENCES users(id) | |
| watched_case_id | INTEGER REFERENCES watched_cases(id) | |
| court_event_id | INTEGER REFERENCES court_events(id) | |
| calendar_connection_id | INTEGER REFERENCES calendar_connections(id) | |
| external_event_id | VARCHAR(255) | ID from the calendar provider |
| external_calendar_id | VARCHAR(255) | Calendar ID from provider |
| last_synced_content_hash | VARCHAR(64) | For change detection |
| sync_status | VARCHAR(50) DEFAULT 'pending' | pending, synced, error |
| sync_error | TEXT | |
| created_at | TIMESTAMP DEFAULT NOW() | |
| updated_at | TIMESTAMP DEFAULT NOW() | |

### notifications
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| user_id | INTEGER REFERENCES users(id) | |
| type | VARCHAR(50) | schedule_change, new_event, sync_error |
| title | VARCHAR(255) | |
| message | TEXT | |
| metadata | JSONB DEFAULT '{}' | Related IDs, old/new values |
| read | BOOLEAN DEFAULT false | |
| channels_sent | JSONB DEFAULT '[]' | ['email','sms','in_app'] |
| created_at | TIMESTAMP DEFAULT NOW() | |

### change_log
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| court_event_id | INTEGER REFERENCES court_events(id) | |
| field_changed | VARCHAR(100) | |
| old_value | TEXT | |
| new_value | TEXT | |
| detected_at | TIMESTAMP DEFAULT NOW() | |

### scrape_jobs
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| status | VARCHAR(50) | pending, running, completed, failed |
| courts_processed | INTEGER DEFAULT 0 | |
| events_found | INTEGER DEFAULT 0 | |
| events_changed | INTEGER DEFAULT 0 | |
| error_message | TEXT | |
| started_at | TIMESTAMP | |
| completed_at | TIMESTAMP | |
| created_at | TIMESTAMP DEFAULT NOW() | |

---

## KEY DECISIONS

1. **PDF Scraping:** Use `pdf-parse` (Node.js) to download and parse court calendar PDFs from utcourts.gov. The PDF structure is documented in the existing Rails repo's `court_calendar_extraction_process.rb`.
2. **Calendar OAuth:** Google Calendar API (OAuth 2.0), Microsoft Graph API (OAuth 2.0), Apple iCloud (CalDAV with app-specific password), generic CalDAV.
3. **Token Storage:** All OAuth tokens encrypted with AES-256-GCM using ENCRYPTION_KEY env var.
4. **Change Detection:** SHA-256 hash of event data fields. Compare on each scrape cycle.
5. **Scheduling:** node-cron runs daily at 2:00 AM UTC. Also supports manual trigger via `/api/admin/trigger-scrape` and Replit scheduled deployments.
6. **Calendar Item Tracking:** Every calendar entry created by the app is tracked in `calendar_entries` table with the provider's external event ID. The app ONLY updates/deletes entries it created.

---

## ENVIRONMENT VARIABLES

```
PORT=5000
HOST=0.0.0.0
NODE_ENV=development
DATABASE_URL=              # Replit PostgreSQL connection string
JWT_SECRET=                # Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=            # Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Google Calendar OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=       # https://your-app.replit.app/api/calendar/google/callback

# Microsoft OAuth
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=    # https://your-app.replit.app/api/calendar/microsoft/callback

# Email (SendGrid or SMTP)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
FROM_EMAIL=

# SMS (Twilio)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Sentry Error Tracking (optional — leave blank to disable)
SENTRY_DSN=
```

---

## CHANGE LOG

| Date | Version | Changes |
|------|---------|---------|
| 2026-03-13 | 0.1.0 | Initial architecture, schema, and project plan |
| 2026-03-13 | 0.2.0 | Full server scaffolding: all services, routes, middleware |
| 2026-03-13 | 0.3.0 | Full client scaffolding: React + Tailwind, all pages and API layer |
| 2026-03-13 | 0.4.0 | CLAUDEv5 compliance audit: requestLogger, graceful shutdown, heavyLimiter, typed pool.query() |
| 2026-03-13 | 0.5.0 | Google Calendar API v3: full CRUD, token refresh, typed sync functions |
| 2026-03-13 | 0.6.0 | Microsoft Graph API, CalDAV/Apple iCloud, Socket.io notifications, email verification, AM/PM time fix, 33 tests |
| 2026-03-13 | 0.7.0 | HTML scraper rewrite (search.php), court list parser, judge/location/virtual fields, 48 tests |
| 2026-03-13 | 0.7.1 | Multi-date scraping (today + 14 weekdays), CORS tightened, token expiry UI, 72 tests |
| 2026-03-13 | 0.8.0 | Pool monitoring, Sentry error tracking, reports.php parser (attorneys/charges/OTN/DOB), 108 tests |
| 2026-03-13 | 0.9.0 | Admin dashboard, charges search + display, comprehensive integration tests, 130 tests |
| 2026-03-13 | 0.10.0 | Watched case auto-matching (matchWatchedCases in scheduler post-scrape), 139 tests |
| 2026-03-13 | 0.11.0 | Parser validated against real utcourts.gov HTML — pipe-delimiter fix for defendant/judge separation. Mobile responsive: hamburger nav, card layouts. Smoke test script. 139 tests |
| 2026-03-13 | 0.12.0 | Full search parity with utcourts.gov: judge name + attorney search (9 fields total). Notification frequency: immediate/daily/weekly digest with digestService.ts + cron jobs. ProfilePage frequency selector UI. 139 tests |

---

## ALL FEATURES COMPLETE (v0.12.0)

### Core
- ✅ User auth: register, login, password reset, email verification with resend
- ✅ HTML scraper: fetches 135+ courts from legacy.utcourts.gov/cal/search.php, multi-date (today + 14 weekdays)
- ✅ Parser: validated against real court HTML, pipe-delimiter injection for clean field separation
- ✅ reports.php enrichment: attorneys, charges, OTN, DOB, citation/sheriff/LEA numbers
- ✅ PDF fallback: legacy divider-based parser for any courts still producing PDFs
- ✅ Search: 9 fields (defendant, case#, court, date, OTN, citation, charges, judge, attorney) — full parity with utcourts.gov + 3 extras
- ✅ Watched cases: CRUD + manual sync + auto-matching (all 9 search types)
- ✅ Change detection: SHA-256 content hashing + 9-field diff → change_log + user notifications

### Calendar Integrations
- ✅ Google Calendar API v3: OAuth 2.0, token refresh, POST/PATCH events, America/Denver timezone
- ✅ Microsoft Graph API: OAuth 2.0, rotating refresh tokens, POST/PATCH /me/events
- ✅ Apple iCloud / CalDAV: RFC 5545 VCALENDAR/VEVENT, Basic auth, ICS UID tracking
- ✅ Calendar entry tracking: only touches app-created items, re-syncs on event changes

### Notifications
- ✅ In-app: real-time via Socket.io push to user rooms, NotificationBell with unread count, 30s polling fallback
- ✅ Email: Nodemailer with SMTP, schedule change emails with HTML diff table, verification + password reset emails
- ✅ SMS: Twilio integration, schedule change summary messages
- ✅ Frequency control: immediate / daily digest (6 AM UTC) / weekly digest (Monday 6 AM UTC)
- ✅ Digest service: aggregates deferred notifications, sends HTML summary email + SMS, marks as delivered

### Production Hardening
- ✅ Per-request correlation IDs (UUID) on all API responses
- ✅ Rate limiting: global (100/15min), heavy/calendar (20/min), auth (10/15min)
- ✅ AES-256-GCM token encryption via ENCRYPTION_KEY env var
- ✅ CORS tightened for production (CORS_ORIGIN env var)
- ✅ Connection pool monitoring: periodic stats logging, 80%+ utilization warnings, /health pool stats
- ✅ Sentry error tracking: lazy-init, correlation IDs + tags, errorHandler integration
- ✅ Graceful shutdown: Socket.io + HTTP + pool monitor + Sentry flush, 10s timeout
- ✅ Token expiry UI: Active/Expiring/Expired badges, re-auth buttons

### Client
- ✅ Mobile responsive: hamburger nav menu, card layouts on small screens, overflow-x-auto tables
- ✅ Admin dashboard: scrape job history, pool stats, manual trigger, aggregate counts
- ✅ Search results: expandable detail rows (attorneys, OTN, DOB, charges), virtual hearing badges
- ✅ Login page: verification banner (success/invalid/expired), registered redirect

### Testing & DevOps
- ✅ 139 tests across 10 suites (vitest): changeDetector, courtEventParser, courtScraper, calendarSync, scheduler, integration, poolMonitor, sentryService, reportParser, watchedCaseMatcher
- ✅ Smoke test script: `bash smoke-test.sh [url]` — 15+ checks for health, auth, headers, rate limiting, SPA, DB

## NEXT STEPS (TODO)

1. **Deploy to Replit** — Run smoke-test.sh, trigger manual scrape, verify DB inserts and auto-matching
2. **Reports.php validation** — Test parser against real rendered HTML (server-side fetcher bypasses robots.txt)
3. **Notification delivery testing** — Wire real SMTP + Twilio credentials, test email/SMS end-to-end
4. **Parser edge cases** — Run scrape across all 135+ courts, log/tune failures for non-standard formats
5. **Digest service tests** — Unit tests for digestService.ts aggregation + delivery logic
