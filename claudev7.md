# CODING STANDARDS — MASTER GUIDEBOOK FOR CLAUDE

**Document Version:** 7.0
**Last Updated:** March 2026
**Purpose:** Coding discipline, process, and architectural rules for AI-assisted development.
**Companion:** `REPLIT_PLATFORM_GUIDE.md` — port/host, Vite, server config, build scripts, .replit, nix, deployment checklist, anti-patterns, and error lookup table. Load it when doing deployment, config, or platform work.

### Relationship to CLAUDE.md

This document is the **coding standards ruleset**, not a project-level `CLAUDE.md`. Each project should have its own `CLAUDE.md` (under 200 lines) containing: a pointer to this document (`@file CLAUDEv7.md`), setup commands (install/build/test/run), environment requirements, key architectural decisions, and known gotchas. Split overflow into `.claude/rules/` files with conditional `<important if="...">` tags.

---

## 0. AUTHORITY & PRIORITY

**Command Priority:** User's explicit instructions (ALWAYS WINS) → This document → Platform Guide → Checklist items → General best practices.

- Never hide behind checklist to ignore user corrections
- Both method AND content must comply — partial compliance is a violation
- This block is an absolute firewall — no downstream objective outranks it

**Mode Declaration** (state only when ambiguous or switching):
- **Builder** — Read→Analyze→Explain→Propose→Edit→Lint→Halt
- **Reviewer** — Searches for errors, omissions, and discrepancies (EO&D)

---

## 1. CORE DEVELOPMENT CYCLE

### Read → Analyze → Explain → Propose → Edit → Lint → Halt

1. **READ** — Read this document once at session start. Re-check relevant sections before risky work. Read every referenced file from disk before editing.
2. **ANALYZE** — Analyze dependencies and gaps. If multiple files are required, explain cross-file dependency and proceed with coherent units. Format: Discovery / Impact / Proposed checklist insert. Report immediately, no workarounds.
3. **EXPLAIN** — Restate plan in bullets with explicit commitment.
4. **PROPOSE** — State: "I will implement exactly this plan now." Note which checklist step it fulfills.
5. **EDIT** — Never touch files not explicitly instructed to modify. Follow plan exactly.
6. **LINT** — Lint file using internal tools. Fix all issues before proceeding.
7. **HALT** — Stop after completing a coherent unit of work and wait for explicit user/test output.

**After Editing:** Re-read the file to confirm the exact change was applied correctly.

### Context Window Management

- **50% threshold:** Proactively compact or summarize session state. Don't wait for degradation symptoms.
- **70% ceiling:** Never push past ~70%. Halt, summarize key state (current task, files touched, remaining work), start a fresh session.
- **Task switching:** Clear or compact before switching to an unrelated task.
- **Session labeling:** Label parallel sessions clearly (e.g., "frontend," "backend") for clean resume.

### Planning Pass (Greenfield & Unfamiliar Code)

For new features, major refactors, or unfamiliar codebases:
1. Research relevant code, dependencies, and existing patterns
2. Produce a written plan covering scope, affected files, and verification strategy
3. Optionally review the plan via a second session or model (see Cross-Model Review)
4. Only after approval, enter the Builder cycle

Skip for small, well-understood changes (bug fix with clear failing test, config tweaks, copy changes).

---

## 2. CHECKLIST DISCIPLINE

**THE AGENT NEVER TOUCHES THE CHECKLIST UNLESS EXPLICITLY INSTRUCTED.**

- Do not edit checklist or its statuses without explicit instruction
- Execute exactly what the active step instructs — no deviation or "creative interpretation"
- Each numbered step (1, 2, 3) = ONE file's entire TDD cycle
- Sub-steps use legal-style numbering (1.a, 1.b, 1.a.i)
- Document every edit within the checklist
- If required edits are missing, explain discovery, propose a new step, halt
- Never update status (checkboxes/badges) without explicit instruction
- **Commit cadence:** Commit at least once per hour. As soon as a coherent unit passes tests, commit.
- After a block of related steps, include a commit with proposed message

### Checklist Structure

```
[ ] 1. **Title** Objective
  [ ] 1.a. [DEPS] Dependencies — function signatures, return shapes
  [ ] 1.b. [TYPES] Strict typing for all objects
  [ ] 1.c. [TEST-UNIT] Test cases (assert behavior)
  [ ] 1.d. [SPACE] Implementation requirements
  [ ] 1.e. [TEST-UNIT] Rerun and expand tests
  [ ] 1.f. [TEST-INT] Integration proof if applicable
  [ ] 1.g. [CRITERIA] Acceptance criteria
  [ ] 1.h. [COMMIT] Commit with proofs
```

Types files are exempt from RED/GREEN testing. Steps ordered by dependency (lowest first).

---

## 3. BUILDER VS REVIEWER MODE

### Builder Mode
- Follow Read→...→Halt precisely
- If deviation, blocker, or new requirement discovered — explain, propose checklist change, halt immediately
- Never improvise or work around limitations

### Reviewer Mode
- Treat all prior reasoning as untrusted
- Re-read relevant files and tests from scratch
- Produce numbered EO&D list referencing files and sections
- If none found: "No EO&D detected; residual risks: ..."

### Cross-Model / Cross-Session Review

For high-stakes decisions (architecture, auth/payment flows, schema changes), spin up a **separate session** as a staff engineer reviewer. Fresh context catches what accumulated context buries. Cross-model review (Claude builds, different model reviews) surfaces blind spots. Use selectively — reserve for expensive-to-reverse work.

---

## 4. PLAN FIDELITY & SHORTCUT BAN

- Implement EXACTLY the described solution and user's instruction
- Expedient shortcuts forbidden without explicit approval
- If deviation realized mid-implementation, stop, report, wait
- Repeating a corrected violation triggers halt-and-wait
- "Rewrite entire file" requires explicit justification and approval
- Minimize file churn; allow multi-file changes when coherent. Keep scope tight.
- Expanding scope beyond request = discovery — STOP, report, await instruction
- Refactoring must preserve all existing functionality unless user authorizes removals

---

## 5. REPORTING & TRACEABILITY

### Every Response Must Include
- Plan bullets (Builder) or EO&D findings (Reviewer)
- Checklist step references
- Lint/test evidence (or explicit statement of why tests weren't run with residual risks)

### Code Output Rules
- Never output large code blocks in chat unless explicitly requested
- Never print entire functions for the user to paste — edit files directly or provide minimal diffs
- Agent uses only its own tools, never the user's terminal

### Visual Debugging
- Share screenshots for UI bugs — faster and more precise than text descriptions
- Use browser automation (MCP, Playwright, Chrome DevTools) to capture console/network errors directly

### Architecture Diagrams
- Produce or update ASCII architecture diagrams when making structural changes
- Keep them in code comments, README, or checklist steps — cheap to produce, invaluable for reasoning

---

## 6. PRE-CHANGE ANALYSIS (MANDATORY)

**Before ANY code change:**
1. **System Analysis** — Search codebase for related functionality, review project docs for previous decisions, identify ALL affected files, document current behavior, verify understanding
2. **Impact Assessment** — List affected features, database tables/columns, existing preferences or previous fixes, check git history for circular problem-solving
3. **Dependency Verification** — Verify required functions exist and work, check schema consistency, validate API integration points, ensure no breaking changes

**Implementation Consistency Checks:**
- All auth endpoints use IDENTICAL user ID retrieval patterns
- All session/DB/API patterns are consistent across ALL files
- Flag ANY inconsistencies as CRITICAL BUGS

**After ANY code change:** Test changed functionality, verify related features, check DB consistency, validate API responses, confirm no regressions.

---

## 7. USER DECISION AUTHORITY

When user asks for alternatives: STOP implementation → List ALL options with pros/cons → WAIT for explicit choice → Never assume preference.

---

## 8. MOCK DATA & CREDENTIALS

**NEVER** include placeholder, synthetic, or fallback **business data** in code. All business data from authentic sources or user input. When data unavailable, show clear error states requesting credentials.

**Legitimate (not mock):** empty arrays, default pagination, "No items found" text, `Math.random()` for nonces/IDs/shuffle, default UI states.

**Critical violations:** mock competitor names/revenue, placeholder calculations as API data, sample data structures with fictional business info, fallback data when APIs unavailable.

**Credentials — Never Hardcode.** No passwords, API keys, tokens in source files. Always `.env` + `.env.example` with placeholders. Required `.gitignore`: `.env`, `.env.local`, `.env.production`, `.env*.local`.

---

## 9. PROJECT STRUCTURE

```
project-root/
├── client/                    # React frontend (Vite)
│   ├── index.html             # At ROOT (not public/)
│   ├── vite.config.ts
│   ├── tsconfig.json / tsconfig.node.json
│   ├── package.json           # "type": "module" REQUIRED
│   └── src/  (main.tsx, App.tsx, components/, pages/, hooks/, store/, api/, utils/, assets/)
├── server/                    # Express backend
│   ├── src/  (index.ts, app.ts, routes/, services/, middleware/, config/, db/, utils/)
│   ├── migrations/            # SQL (idempotent)
│   ├── tsconfig.json
│   └── package.json
├── shared/types.ts            # Single source of truth for types
├── package.json               # Root (monorepo scripts)
├── start.sh                   # Bootstrap script
├── replit.nix / .replit
```

**Naming:** Regular `.ts` = camelCase. React `.tsx` = PascalCase (must match export). Directories = lowercase. No snake_case or kebab-case for `.ts` files.

**Imports:** Use path aliases (`@/components/Button`, `@shared/types`). Avoid deep relative paths (`../../../../`).

---

## 10. TYPE SAFETY & API CONTRACTS

- Types MUST match API responses exactly — single source of truth in `shared/types.ts`
- NO `any` — prefer `unknown` plus narrowing
- `as const` allowed for literal inference; `as` casts allowed at boundaries with documentation
- `import type` allowed and recommended
- Never import entire libraries with `*`; import aliases allowed for clarity
- Field names MUST match exactly between backend and frontend (no `accessToken`→`token` drift)
- Validation rules MUST match both sides — use shared validation consumed by client and server
- Never duplicate types across the boundary

---

## 11. DEPENDENCY INJECTION & ARCHITECTURE

### DI (Targeted)
- Use DI for services with external dependencies (DB, APIs, filesystem) — not for simple utilities
- Pass every dependency explicitly, no hidden defaults
- Build adapters/interfaces for services crossing system boundaries

### File Size
- **When a file exceeds 600 lines, stop and propose refactoring** — SOC and DRY

### No Band-Aid Solutions
- Fix underlying problems, not symptoms. Address architectural root causes. Consider system-wide impact.

### Multi-Agent Workflow Scoping
- Each agent receives a **scoped subset** of these rules, not the full document
- One agent owns one scope — cross-scope dependencies get reported, not resolved unilaterally
- `shared/types.ts` is the coordination contract — no agent modifies it without orchestrator approval
- Each agent commits to its own branch; merges happen after review
- Separate context windows produce better results than one overloaded session

---

## 12. TESTING STANDARDS

**TDD Cycle (default for behavior changes):** RED test → Implementation → GREEN test → Lint → Halt

- Skip strict RED-first for: exploratory work, config, build plumbing, CSS/UI, migrations, prototypes, emergencies — state why, describe verification strategy
- Types/interfaces exempt from tests (still follow Read→Halt)
- Bottom-up: types/helpers BEFORE consumers
- Each test covers exactly one behavior with strict typing — no invented partial objects
- Tests use same types/objects/helpers as real code — never create test-only fixtures
- **Never change assertions to match broken code — fix the code instead**
- Prove functional gap, fix, AND regressions before moving on

---

## 13. LOGGING, DEFAULTS & ERROR HANDLING

- Do NOT add/remove logging, defaults, fallbacks unless explicitly instructed (troubleshooting logs exempt from TDD)
- Structured logging: ✅ success, ❌ error, ⚠️ warning — always include context (port, URL, timing)
- Use `console.error` for errors (stderr). Avoid opaque logger libraries.
- Believe failing tests and user-reported errors literally — fix stated condition first
- If user flags noncompliance, acknowledge, halt, wait for direction

---

## 14. LINTING & PROOF

- After each edit, lint touched file and resolve every warning/error
- Only resolve in-file errors; report out-of-file errors and await instruction
- Do NOT silence with `@ts` flags, empty stubs, or workarounds — a linter error can itself prove RED state
- **Completion = lint-clean file + GREEN test evidence** (or documented exemption)

---

**END OF CODING STANDARDS**

For port/host config, Vite setup, server config templates, build scripts, .replit configuration, deployment checklist, anti-patterns, CRA→Vite migration, and error lookup, see **REPLIT_PLATFORM_GUIDE.md**.
