# Utah Court Calendar Tracker

## Overview
Full-stack web app that scrapes Utah court calendar data from legacy.utcourts.gov, lets users search court events, watch cases, sync matches to personal calendars (Google/Microsoft/Apple/CalDAV), detects schedule changes, and sends notifications via email, SMS, and in-app.

## Tech Stack
- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS
- **Backend:** Express + TypeScript
- **Database:** Replit PostgreSQL (SSL, `rejectUnauthorized: false`)
- **Real-time:** Socket.io (WebSocket + polling fallback)
- **Background Jobs:** node-cron (daily 2 AM UTC scrape)
- **Testing:** Vitest (139 tests across 10 suites)

## Project Structure
```
client/          # React frontend (Vite)
  src/
    api/         # API client modules
    components/  # Layout, ProtectedRoute, etc.
    hooks/       # useAuth
    pages/       # Dashboard, Search, Settings, Profile, Admin, Login, Register
    store/       # authStore.tsx (React context)
server/          # Express backend
  migrations/    # 10 idempotent SQL migration files
  src/
    config/      # env.ts
    db/          # pool.ts, migrate.ts
    middleware/  # auth, rateLimiter, errorHandler, requestLogger
    routes/      # health, auth, search, calendar, notifications, admin
    services/    # scraper, parser, calendarSync, notifications, scheduler, sentry, digest, watchedCaseMatcher
shared/          # types.ts — shared TypeScript interfaces
```

## Running
- **Workflow:** `bash start.sh` — installs deps, builds client+server, runs migrations, starts server on port 5000
- **Dev server serves built client** from `client/build/` as static files with SPA fallback
- **Single port:** 5000 on 0.0.0.0

## Key Environment Variables
- `DATABASE_URL` — auto-set by Replit PostgreSQL
- `JWT_SECRET` — set (auto-generated)
- `ENCRYPTION_KEY` — set (auto-generated, for AES-256-GCM token encryption)
- `PORT=5000`, `HOST=0.0.0.0`, `NODE_ENV=development` — set in .replit
- Optional: GOOGLE_CLIENT_ID/SECRET, MICROSOFT_CLIENT_ID/SECRET, SMTP_*, TWILIO_*, SENTRY_DSN, CORS_ORIGIN

## Architecture Rules
- Server listens BEFORE async DB connection (non-fatal if DB fails)
- Route order: health → logger → security → body parsers → rate limiting → API → static → SPA fallback → error handler
- `trust proxy` enabled for Replit's proxy
- `rootDir: ".."` in server tsconfig → compiled path is `server/dist/server/src/index.js`
- Use `process.cwd()` not `__dirname` for cross-package paths
- OAuth tokens encrypted AES-256-GCM
- Per-request correlation IDs

## Brand / UI Theme
- **Primary accent:** amber-700 (`#b45309`) — buttons, links, active states
- **Nav background:** slate-800 (`#1e293b`) — top navigation bar
- **Logo:** shield + gavel SVG (`client/public/logo.svg`), favicon (`favicon.svg`, `favicon-32.png`), PWA icon (`logo-192.png`)
- All former `indigo-*` Tailwind classes replaced with `amber-*` / `slate-*` equivalents
- Logo displayed in nav bar (Layout.tsx) and on auth pages (Login, Register, Forgot/Reset Password)

## Scraper Details
- `courtScraper.ts` — HTTP client with gzip/deflate decompression, browser-like headers, redirect-following, retry with exponential backoff
- `courtEventParser.ts` — regex-based HTML parser for search.php results (casehover blocks)
- `reportParser.ts` — POST request parser for reports.php (enriches events with attorneys, charges, OTN, DOB)
- `schedulerService.ts` — cron job (2 AM UTC daily) orchestrates fetch → parse → DB upsert
- `searchService.ts` — SQL query builder for /api/search (queries DB, not live scrape)
- `/api/search/coverage` — public endpoint showing event count, court count, date range
- Compression: both fetchers use shared `decompressBuffer()` helper supporting gzip, x-gzip, deflate with inflateRaw fallback

## Database
- PostgreSQL via Replit built-in (DATABASE_URL auto-set)
- 13 migrations (001–013, including google_oauth, calendar_preferences, admin_and_court_whitelist)
- Migrations run via `node server/dist/server/src/db/migrate.js`

## Fixes Applied on Replit Setup
- Renamed `client/src/store/authStore.ts` → `authStore.tsx` (contained JSX)
- Added `app.set("trust proxy", 1)` for express-rate-limit behind Replit proxy
- Added gzip/deflate decompression to courtScraper.ts and reportParser.ts (Utah courts server sends compressed responses)
- Moved /api/search/coverage before auth middleware (SearchForm needs public access for event count display)
