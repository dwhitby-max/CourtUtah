## HANDOFF INSTRUCTIONS FOR NEW CHAT

Upload the attached `utcourts2.zip` and paste this message:

---

Here is the project you were working on with handoff included. The zip contains the project root with CLAUDE.md and HANDOFF.md inside.

**Project:** Utah Court Calendar Tracker v0.12.0
**Stack:** React 18 + Express + TypeScript + PostgreSQL on Replit
**Tests:** 139 passing across 10 suites (run: `cd server && npm test`)

**What's complete:**
- HTML scraper for legacy.utcourts.gov/cal/search.php — validated against real court HTML, pipe-delimiter parser fix
- Full search parity with utcourts.gov: 9 search fields (defendant, case#, court, date, OTN, citation, charges, judge, attorney)
- Google Calendar, Microsoft Graph, Apple iCloud/CalDAV integrations (all with OAuth + token refresh)
- Watched case auto-matching (post-scrape: events → watched cases → calendar entries → syncs → notifications)
- Notification frequency: immediate / daily digest / weekly digest (digestService.ts + cron jobs)
- Admin dashboard, Socket.io real-time, email verification, mobile responsive, smoke test script
- Connection pool monitoring + Sentry error tracking with correlation IDs
- 139 unit + integration tests across 10 suites

**What needs doing next (priority order):**
1. Deploy to Replit — run smoke-test.sh, trigger manual scrape, verify DB inserts
2. Reports.php validation — test parser against real rendered HTML
3. Notification delivery testing — wire SMTP/Twilio credentials, test end-to-end
4. Parser edge cases — run scrape across all 135+ courts, log/tune failures
5. Digest service tests — unit tests for digestService.ts

**Key files to read first:** HANDOFF.md (full status), CLAUDE.md (architecture rules), shared/types.ts (all interfaces)

**Critical rules:** Follows CLAUDEv5.md strictly — monorepo client/server/shared, server listens before DB, non-fatal DB, no process.exit in modules, port 5000/0.0.0.0, idempotent migrations, AES-256 tokens, try/finally pool clients, rate limiting everywhere, no mock data, no `any` types, shared/types.ts is SSoT.

Continue where we left off.

---
