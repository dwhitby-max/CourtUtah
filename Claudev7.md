# REPLIT DEPLOYMENT BIBLE — MASTER GUIDEBOOK FOR CLAUDE

**Document Version:** 7.1
**Last Updated:** April 2026
**Purpose:** Definitive, conflict-resolved ruleset for production-ready AI-assisted development targeting Replit deployment.
**Changelog v7.1:** Merged security guardrails from external AI-code audit. Added critical dependency sovereignty (Rule 11.5), critical-path release gates (Section 12), CORS nuance + RLS/payment/webhook verification (Rules 17.2, 17.14, 17.15), expanded deployment checklist (Section 20), anti-patterns for provider lock-in, open RLS, insecure randomness, unverified billing state (Section 25), AI code generation review protocol (Section 26), security debt expiry (Section 27), and architecture kickoff checklist (Section 28). Strengthened cryptographic standards (Section 8), CI gate requirements (Section 12), and CORS version-control mandate (Rule 17.2).
**Changelog v6.1:** Added context window management and planning pass (Section 1), cross-model review (Section 3), multi-agent scoping (Rule 11.4), visual debugging and ASCII diagrams (Section 5), commit cadence (Section 2), CLAUDE.md relationship note.
**Changelog v5.0:** Consensus feedback from Opus, Sonnet, Replit Agent, Codex. Loosened ceremony, refined TypeScript rules, made TDD default-not-mandatory, allowed coherent multi-file edits, corrected platform inaccuracies.

---

## RELATIONSHIP TO CLAUDE.md

This document is the coding standards and deployment ruleset. It is NOT the project-level `CLAUDE.md` used by Claude Code CLI.

Each project should have its own `CLAUDE.md` at the repository root containing:
- A one-line pointer: `@file CLAUDEv7.1.md` (or inline the relevant subset)
- Project-specific setup commands (install, build, test, run)
- Environment requirements and secrets the agent needs
- Key architectural decisions specific to that project
- Known gotchas or failure points unique to that codebase

Keep each `CLAUDE.md` under 200 lines. If it grows beyond that, split rules into `.claude/rules/` files with conditional `<important if="...">` tags so the agent only loads what's relevant. This document is the source of truth — project-level `CLAUDE.md` files reference it, they do not duplicate it.

---

## 0. AUTHORITY HIERARCHY

**Command Priority (Highest to Lowest):**
1. User's explicit instructions (ABSOLUTE PRIORITY)
2. This unified rules document
3. Checklist items

**Critical Enforcement:**
- Never hide behind checklist to ignore user corrections
- Both method AND content must comply with these rules
- Partial compliance is a violation — any deviation triggers rework
- This block is an absolute firewall — no conditional or downstream objective outranks it

**Mode Declaration (Required only when ambiguous or switching modes):**
- **Mode: Builder** — Executes work following Read→Analyze→Explain→Propose→Edit→Lint→Halt
- **Mode: Reviewer** — Searches for errors, omissions, and discrepancies (EO&D)

State mode only when unclear from context or when switching modes changes expected behavior.

---

## 1. CORE DEVELOPMENT CYCLE

### Read → Analyze → Explain → Propose → Edit → Lint → Halt

1. **READ** — Read this document once at session start. Re-check only the relevant section before risky work. Read every referenced file (types, interfaces, helpers) from disk before editing.
2. **ANALYZE** — Analyze dependencies and gaps. For multi-file work, explain the cross-file dependency and proceed with coherent units. Format: Discovery / Impact / Proposed checklist insert. Report discoveries immediately, no workarounds.
3. **EXPLAIN** — Restate plan in bullets with explicit commitment.
4. **PROPOSE** — State: "I will implement exactly this plan now." Note which checklist step it fulfills.
5. **EDIT** — Never touch files not explicitly instructed to modify. Follow plan exactly.
6. **LINT** — Lint file using internal tools. Fix all issues before proceeding.
7. **HALT** — Stop after completing a coherent unit of work and wait for explicit user/test output.

**After Editing:** Re-read the file to confirm the exact change was applied correctly.

### Context Window Management

- **50% threshold:** When context usage reaches ~50%, proactively compact or summarize session state before continuing. Do not wait for symptoms of degradation.
- **70% ceiling:** Never push past ~70% context usage. Quality drops sharply — the "agent dumb zone." Halt, summarize key state (current task, files touched, remaining work), and start a fresh session.
- **Task switching:** When switching to an unrelated task, clear or compact first. Residual context from the prior task pollutes reasoning.
- **Session labeling:** When running multiple parallel sessions (e.g., frontend / backend), label each clearly so work can be resumed without confusion.

### Planning Pass (Greenfield & Unfamiliar Code)

For new features, major refactors, or unfamiliar areas:
1. Research relevant code, dependencies, and existing patterns
2. Produce a written plan (bullets or checklist) covering scope, affected files, and verification strategy
3. Optionally use a second agent session as a "staff engineer" reviewer (see Section 3)
4. Only after the plan is approved, enter the Read→...→Halt cycle

For small, well-understood changes (bug fixes with a clear failing test, config tweaks), skip the planning pass and go directly into the Builder cycle.

---

## 2. CHECKLIST DISCIPLINE

**THE AGENT NEVER TOUCHES THE CHECKLIST UNLESS EXPLICITLY INSTRUCTED.**

### When Editing Checklists
- Do not edit checklist or its statuses without explicit instruction
- When instructed, change only the specified portion using legal-style numbering
- Execute exactly what the active checklist step instructs — no deviation
- Each numbered step (1, 2, 3) = ONE file's entire TDD cycle (deps → types → tests → implementation → proof)
- Sub-steps use legal-style numbering (1.a, 1.b, 1.a.i, 1.a.ii)
- All changes to a single file are described within that file's numbered step

### Documentation
- Document every edit within the checklist
- If required edits are missing from the plan, explain the discovery, propose a new step, and halt
- Never update the status of any work step without explicit instruction
- After related steps completing a working implementation, include a commit with proposed message
- **Commit cadence:** Aim to commit at least once per hour during active development. Small, frequent commits are easier to review, revert, and reason about than large, infrequent ones.

### Checklist Structure Rules
- Types files (interfaces, enums) are exempt from RED/GREEN testing requirements
- Each file edit includes: RED test → implementation → GREEN test → optional refactor
- Steps ordered by dependency (lowest dependencies first)
- Preserve all existing detail while adding new requirements
- NEVER create multiple top-level steps for the same file edit operation

### Example Checklist Structure

```
[ ] 1. **Title** Objective
  [ ] 1.a. [DEPS] Dependencies of function, signature, return shape
    [ ] 1.a.i. e.g. `function(x)` in `file.ts` provides this
  [ ] 1.b. [TYPES] Strictly type all objects used
  [ ] 1.c. [TEST-UNIT] Test cases
    [ ] 1.c.i. Assert `function(x)` in `file.ts` acts certain way
  [ ] 1.d. [SPACE] Implementation requirements
  [ ] 1.e. [TEST-UNIT] Rerun and expand test proving function
  [ ] 1.f. [TEST-INT] Prove chain of functions works together
  [ ] 1.g. [CRITERIA] Acceptance criteria
  [ ] 1.h. [COMMIT] Commit with proof summary
```

---

## 3. BUILDER VS REVIEWER MODE BEHAVIOR

### Builder Mode
- Follow Read→...→Halt loop precisely
- If a deviation, blocker, or new requirement is discovered — explain the problem, propose the required checklist change, and halt immediately
- Never improvise or work around limitations

### Reviewer Mode
- Treat all prior reasoning as untrusted
- Re-read relevant files and tests from scratch
- Produce a numbered EO&D list referencing files and sections
- Ignore checklist status or RED/GREEN history unless it causes a real defect
- If no EO&D found, state: "No EO&D detected; residual risks: ..."

### Cross-Model / Cross-Session Review

For high-stakes decisions (architecture changes, security-sensitive code, complex data migrations):
- Spin up a second session and prompt it as a staff engineer reviewer: "Review this plan/diff for errors, security issues, missed edge cases, and architectural concerns."
- The reviewing session must have no prior context from the building session — fresh eyes catch what accumulated context buries.
- Cross-model review (Claude builds, different model reviews) can surface blind spots same-model review misses.
- Reserve for: new system architecture, auth/payment flows, database schema changes, and any work expensive to reverse.

---

## 4. PLAN FIDELITY & SHORTCUT BAN

### Implementation Rules
- Once a solution is described, implement EXACTLY that solution
- Expedient shortcuts are forbidden without explicit approval
- If you realize a deviation mid-implementation, stop, report it, and wait for direction
- Repeating a corrected violation triggers halt-and-wait immediately

### Critical Violations to Avoid
- "Rewrite the entire file" — STOP, explain why, get explicit approval before proceeding
- Multi-file changes are allowed when part of one coherent fix — keep scope tight, explain cross-file dependency
- Expanding scope beyond what was requested = a discovery — STOP, report it, await instruction

### Refactoring Rules
- Must preserve all existing functionality unless the user explicitly authorizes removals
- Log and identifier fidelity is mandatory

---

## 5. REPORTING & TRACEABILITY

### Every Response Must Include
- Plan bullets (Builder) or EO&D findings (Reviewer)
- Checklist step references
- Lint/test evidence; if tests not run, explicitly state why and list residual risks

### Code Output Rules
- Never output large code blocks (entire files or multi-function dumps) in chat unless explicitly requested
- Never print an entire function and tell the user to paste it in
- Edit the file directly or provide a minimal diff
- Agent uses only its own tools, never the user's terminal

### Visual Debugging
- When stuck on a UI bug, share a screenshot — it communicates faster than a text description
- When browser automation access is available (MCP, Playwright), use it to capture console logs and network errors directly rather than relying on the user to relay them

### Architecture Diagrams
- When making structural changes (new services, route reorganization, schema changes), produce or update an ASCII architecture diagram showing affected components and their relationships
- ASCII diagrams live in code comments, README files, or checklist steps — cheap to produce, enormously useful for reasoning

---

## 6. PRE-CHANGE ANALYSIS

### Before ANY Code Change (MANDATORY)

1. **Complete System Analysis** — Search codebase for related functionality, review replit.md for previous decisions, identify ALL files that might be affected, document current behavior before modification.
2. **Impact Assessment** — List ALL features that could be affected, identify ALL database tables/columns involved, check for existing user preferences or previous fixes, verify no circular problem-solving.
3. **Dependency Verification** — Verify all required functions exist and work correctly, check database schema consistency, validate API integration points, ensure no breaking changes to existing interfaces.

### Implementation Consistency Checks (MANDATORY)
- All authentication endpoints use IDENTICAL user ID retrieval patterns
- All session management uses consistent property access methods
- All database queries use same ORM patterns and error handling
- All API response formats follow identical structure and typing
- Search for patterns like `req.user`, `req.session.user`, `userId` across ALL files
- Flag ANY inconsistencies as CRITICAL BUGS requiring immediate fix

### After Any Code Change
- Test specific functionality that was changed
- Verify ALL related features still work
- Check database consistency if applicable
- Confirm no regression in existing behavior

---

## 7. USER DECISION AUTHORITY

When the user asks "do we have other options?" or requests alternatives:
1. STOP implementation immediately
2. List ALL available options with clear explanations
3. Present advantages/disadvantages for each option
4. WAIT for explicit user approval before proceeding
5. Never assume user preference or implement without permission

---

## 8. MOCK DATA, CREDENTIALS & CRYPTOGRAPHIC STANDARDS

### Mock Data Prohibition
- NEVER include placeholder, synthetic, example, sample, or fallback **business data** in ANY code
- ALL business data MUST come from authentic external API sources or user-provided information
- When authentic data cannot be retrieved, implement ONLY clear error states requesting proper credentials

**Legitimate uses (NOT mock data):**
- Reasonable defaults: empty arrays, default pagination values, "No items found" placeholder text
- `Math.random()` for nonces, client-side IDs, shuffle logic, or probabilistic sampling
- Default UI states and empty-state components

**Critical violations:**
- Mock competitor names, revenue figures, or market data
- `Math.random()` as business data in API responses
- Fallback data when external APIs are unavailable
- Any synthetic data generation without explicit user authorization

### Cryptographic Standards
- **Never** use `Math.random()` or any non-CSPRNG for anything security-sensitive: passwords, tokens, session IDs, invite codes, reset links, nonces
- All security-sensitive randomness requires `crypto.randomBytes` (Node.js) or equivalent
- Enforce at linting level: ban `Math.random` in security contexts via ESLint rule
- **AI-generated code must be explicitly validated against this rule before merge** — LLMs default to the simpler, insecure path

### Credentials — Never Hardcode
No passwords, API keys, tokens, or secrets ever appear in source files (including `docker-compose.yml` and any file committed to git).

```yaml
# ❌ WRONG
environment:
  DB_PASSWORD: postgres

# ✅ CORRECT
environment:
  DB_PASSWORD: ${DB_PASSWORD}
```

Required `.gitignore` entries: `.env`, `.env.local`, `.env.production`, `.env*.local`

Always provide a `.env.example` with placeholder values — never real values.

---

## 9. PROJECT STRUCTURE

### Rule 9.1: Directory Convention (MANDATORY)

```
project-root/
├── client/                    # React frontend (Vite)
│   ├── index.html             # At ROOT (not in public/)
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── package.json           # "type": "module" REQUIRED
│   ├── src/
│   │   ├── main.tsx           # Entry point
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── store/
│   │   ├── api/
│   │   ├── utils/
│   │   └── assets/
│   └── public/                # Static assets only
├── server/                    # Express backend
│   ├── src/
│   │   ├── index.ts           # Entry point
│   │   ├── app.ts             # Express app setup
│   │   ├── routes/
│   │   ├── services/
│   │   ├── middleware/
│   │   ├── config/
│   │   ├── db/
│   │   └── utils/
│   ├── migrations/            # SQL migration files (idempotent)
│   ├── tsconfig.json
│   └── package.json
├── shared/                    # Shared types — single source of truth
│   └── types.ts
├── package.json               # Root package.json (monorepo scripts)
├── start.sh                   # Bootstrap script
├── replit.nix
└── .replit
```

Any source rule referencing `frontend/` or `backend/` → translate to `client/` and `server/`.

### Rule 9.2: File Naming Convention (MANDATORY)

| Category | Convention | Example |
|----------|-----------|---------|
| Regular `.ts` files | camelCase | `userService.ts`, `authMiddleware.ts` |
| React components `.tsx` | PascalCase (must match export) | `DashboardPage.tsx` |
| Directories | All lowercase | `components/`, `services/` |

Banned: `snake_case`, `kebab-case` for `.ts` files, flat lowercase for components.

### Rule 9.3: Import Path Normalization

```typescript
// ❌ fragile relative paths
import Button from "../../../../components/Button"

// ✅ path aliases
import Button from "@/components/Button"
import { User } from "@shared/types"
```

---

## 10. TYPE SAFETY & API CONTRACTS

### Rule 10.1: Types MUST Match API Responses Exactly
Single source of truth in `shared/types.ts`. Types define the EXACT structure of API requests/responses — never duplicate across the boundary. Subtle field-name differences (`total` vs `count`) cause silent `undefined` bugs TypeScript cannot catch across package boundaries.

### Rule 10.2: Strict Typing Requirements
- Use explicit types everywhere; NO `any` — prefer `unknown` plus narrowing
- `as const` IS allowed for literal type inference
- `as` casts: avoid by default, allow at boundary/library interop — keep local and document why
- Every object and variable must be typed; construct full objects satisfying existing interfaces
- Use type guards to narrow types for the compiler; a ternary is NOT a type guard
- `import type` IS allowed and recommended; never import entire libraries with `*`
- **Exceptions:** Database clients (Drizzle, etc.), intentionally malformed test objects

### Rule 10.3: Field Names MUST Match Exactly
`accessToken` vs `token`, `messages` vs `data`, `created_at` vs `createdAt` — all cause silent runtime failures.

### Rule 10.4: Validation Rules MUST Match Both Sides
Use shared validation (e.g., `shared/validation.ts`) consumed by both client and server.

---

## 11. DEPENDENCY INJECTION & ARCHITECTURE

### Rule 11.1: Dependency Injection (Targeted)
- Use DI for services with external dependencies (databases, APIs, file systems) that need testing or swapping
- Pass every dependency with no hidden defaults for injected services
- Build adapters/interfaces for services crossing system boundaries
- Simple utility/helper functions do NOT need DI — keep them simple
- Work bottom-up so dependencies compile before consumers
- Preserve existing functionality, identifiers, and logging unless explicitly told otherwise

### Rule 11.2: File Size Management
- **When a file exceeds 600 lines, stop and propose logical refactoring**
- Decompose into smaller parts providing clear SOC and DRY

### Rule 11.3: No Band-Aid Solutions
- Fix underlying problems, not just symptoms
- Address architectural issues causing recurring problems
- Consider system-wide impact of all modifications

### Rule 11.4: Multi-Agent Workflow Scoping
- Each agent receives a scoped subset of these rules relevant to its task (e.g., frontend agent gets Sections 10, 16; backend agent gets Sections 10, 17, 18)
- **One agent owns one scope** — agents must not edit files outside their assigned scope; cross-scope discoveries are reported and halted, not acted on
- **Shared types are the coordination contract** — `shared/types.ts` is the boundary between agents; changes require orchestrator approval
- Each agent commits to its own branch (or git worktree); merges happen after review
- Context isolation is a feature — separate context windows produce better results than one overloaded session

### Rule 11.5: Critical Dependency Sovereignty
- Any dependency core to product value (AI gateway, auth, payments, messaging, storage, search) must be wrapped behind an interface, adapter, or internal service boundary you control
- Do NOT wire core business logic directly to a proprietary vendor-owned gateway URL unless the user explicitly accepts the lock-in
- For each critical dependency, document the failure mode: graceful degradation, manual fallback, provider substitution path, or migration plan
- If losing the dependency would disable core workflows, treat direct integration without abstraction as an architecture defect
- Fallback providers are encouraged where justified, but ownership of the boundary and a credible exit path are always required

---

## 12. TESTING STANDARDS

### TDD Cycle (Default for Behavior Changes)

```
RED test (desired behavior) → Implementation → GREEN test → Lint → Halt
```

- Use TDD by default for behavior changes and bug fixes with a clear failing case
- Skip strict RED-first for: exploratory work, config changes, build plumbing, CSS/UI tweaks, migrations, prototypes, emergency fixes — state why and describe the verification strategy
- Documents/types/interfaces exempt from tests; bottom-up: types/helpers BEFORE consumers
- Write consumer tests ONLY after producers exist; do not advance until current file's proof is complete
- Keep application in provable state at all times

### Critical-Path Release Gate
- **Critical paths require proof before release:** auth, permissions, payments, webhooks, tenant isolation, destructive actions, and any code touching PII or financial data
- Coverage percentages inform confidence but do NOT replace targeted proof on critical paths
- For deployment/migration/infrastructure changes where RED/GREEN is insufficient, provide alternate proof: build success, startup success, migration rehearsal, webhook verification flow, or route behavior validation
- **CI enforcement:** A build with 0 tests on auth functions does not pass — coverage thresholds are enforced in CI, not just recommended
- **AI-generated code is held to the same standard as human-written code** — "the AI wrote it" is not a reason to skip tests
- Minimum required test surface: auth flows, permission boundaries, payment state transitions, API contract validation
- Test payment **failure paths** explicitly — not just the happy path

### Test Requirements
- Tests assert desired passing state — no RED/GREEN labels in test names
- New tests added to end of file; each test covers exactly one behavior
- Use real application functions/mocks with strict typing; never invent partial objects
- Integration tests exercise real code paths; unit tests stay isolated and mock dependencies explicitly
- **Never change assertions to match broken code — fix the code instead**
- Tests use the same types, objects, structures, and helpers as real code — never create fixtures only for tests

### Proof Requirements
- Prove functional gap, implemented fix, AND regressions through tests before moving on
- Never assume success without proof

---

## 13. LOGGING, DEFAULTS & ERROR HANDLING

### Logging Rules
- Do NOT add or remove logging, defaults, fallbacks, or silent healing unless explicitly instructed
- Adding console logs solely for troubleshooting is exempt from TDD and checklist obligations

### Structured Console Logging (REQUIRED)

```typescript
console.log('✅ Server started on port', PORT);
console.log('✅ Database connected');
console.error('❌ Database connection failed:', error);
console.warn('⚠️  Missing optional config:', key);
```

Pattern: ✅ success, ❌ error, ⚠️ warning. Always include context (port, URL, timing). Use `console.error` for errors. Avoid opaque logger libraries — Replit's console surfaces `console.*` directly.

### Error Handling
- Believe failing tests, linter flags, and user-reported errors literally
- Fix the stated condition before chasing deeper causes
- If the user flags instruction noncompliance, acknowledge, halt, and wait for explicit direction

---

## 14. LINTING & PROOF

- After each edit, lint the touched file and resolve every warning/error
- Record lint/test evidence in the response
- Only resolve in-file linter errors; report out-of-file errors and await instruction
- Do NOT silence errors with `@ts` flags or empty stub functions — a linter error is sometimes proof of RED state
- Completion proof requires a lint-clean file plus GREEN test evidence (or documented exemption)

---

## 15. PORT & HOST CONFIGURATION

### Rule 15.1: Port and Host Must Be Consistent Everywhere
Default port is **5000**. Respect `process.env.PORT` as override. Must bind to `0.0.0.0`.

```typescript
const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST);
```

### Rule 15.2: Only ONE Port Configuration in .replit (CRITICAL)
```toml
[[ports]]
localPort = 5000
externalPort = 80
```
Multiple `[[ports]]` sections cause deployment failures.

### Rule 15.3: MUST Bind to 0.0.0.0
```typescript
app.listen(5000, 'localhost');  // ❌ Container inaccessible
app.listen(5000, '0.0.0.0');   // ✅ External access
```

---

## 16. VITE & CLIENT CONFIGURATION

### Rule 16.1: Vite Config (REQUIRED)

```typescript
// client/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/health': { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:5000', changeOrigin: true, ws: true },
    },
    host: true,
    allowedHosts: true,  // CRITICAL for Replit iframe proxy
  },
  build: {
    outDir: 'build',  // Must match server's static file path
  },
});
```

### Rule 16.2: Client TypeScript Configuration

```json
// client/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020", "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext", "skipLibCheck": true,
    "moduleResolution": "bundler", "allowImportingTsExtensions": true,
    "resolveJsonModule": true, "isolatedModules": true,
    "noEmit": true, "jsx": "react-jsx", "strict": true,
    "noUnusedLocals": false, "noUnusedParameters": false,
    "esModuleInterop": true, "allowSyntheticDefaultImports": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"], "@shared/*": ["../shared/*"] }
  },
  "include": ["src", "../shared"],
  "references": [{ "path": "./tsconfig.node.json" }]
}

// client/tsconfig.node.json
{
  "compilerOptions": {
    "composite": true, "skipLibCheck": true,
    "module": "ESNext", "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

### Rule 16.3: NEVER Use Create React App on Replit
CRA (react-scripts 5.x) is INCOMPATIBLE with Node.js 20+. Always use Vite.

### Rule 16.4: React Library Compatibility
Before adding any React library, check peerDependencies for React 18 compatibility.

### Rule 16.5: Client-Side Environment Variables
Client-side variables must start with `VITE_` and are accessed via `import.meta.env.VITE_*`.

### Rule 16.6: Disable Source Maps in Production Builds
Source maps expose original TypeScript source to anyone with browser DevTools open.

```typescript
build: {
  outDir: 'build',
  sourcemap: false,        // ✅ production default
  // sourcemap: 'hidden',  // only if feeding an error tracker like Sentry
},
```

### Rule 16.7: Vite Config Path Resolution
Always use absolute path resolution when importing `vite.config` programmatically — relative paths break when the working directory differs between dev and build contexts.

```typescript
// ❌ Breaks if cwd is not project root
import config from '../../vite.config';

// ✅ Resolves correctly regardless of cwd
import config from path.resolve(__dirname, '../../vite.config');
```

Confirm `vite.config.ts` is in the project's `tsconfig.json` `include` array. Always verify the resolved path exists before deploying — path mismatches only appear at deploy time.

---

## 17. SERVER CONFIGURATION

### Rule 17.1: Server MUST Start Immediately (CRITICAL)
The server MUST call `server.listen()` BEFORE any database connections or async work.

```typescript
const server = createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`✅ Server listening on ${HOST}:${PORT}`);
});

// THEN async initialization (non-fatal)
connectDatabase().catch(err => {
  console.error('❌ Database connection failed:', err);
});
```

### Rule 17.2: Route Registration Order (IMMUTABLE)

```typescript
// 1. Health checks FIRST (before middleware)
app.get('/health', healthCheck);
app.get('/api/status', statusCheck);

// 2. Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));  // See CORS strategy below

// 3. Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. API routes (BEFORE static files)
app.use('/api', apiRouter);

// 5. Static files (client build)
app.use(express.static(path.join(process.cwd(), 'client', 'build')));

// 6. SPA fallback (LAST)
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(process.cwd(), 'client', 'build', 'index.html'));
});
```

**CORS Strategy:**
- Replit preview and deployment hostnames can change — do NOT hardcode a single Replit domain
- `cors({ origin: '*' })` is acceptable ONLY for fully public, read-only, unauthenticated resources
- Any endpoint that touches user data, mutations, or authenticated sessions must have an explicit allowlist of origins
- For cookie-based auth, credentialed requests, admin surfaces, or sensitive browser flows, use an allowlist — never wildcard
- CORS configuration lives in version control and is reviewed like code, not set-and-forgotten in a dashboard
- **"Open for now, fix later" is never acceptable for auth/permissions in any environment beyond a local sandbox**

### Rule 17.3: Database Connection Must Be Non-Fatal

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },  // Required for Replit PostgreSQL
  connectionTimeoutMillis: 8000,
  max: 5, min: 0, idleTimeoutMillis: 30000
});
```

If `DATABASE_URL` is missing, log a warning and continue. Server stays up; database-dependent routes return 503.

### Rule 17.4: Environment Variable Validation — NEVER process.exit()

```typescript
function validateEnv(): void {
  const expected = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'];
  const missing = expected.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`⚠️  Missing environment variables: ${missing.join(', ')}`);
    console.error('⚠️  Server will start but affected features will fail.');
  }
}
```

`process.exit()` IS acceptable in standalone scripts (`migrate.ts`, seed scripts) that run in their own process.

### Rule 17.5: Third-Party API Initialization — Always Lazy

```typescript
// ❌ Crashes on startup if API keys missing
const shopify = shopifyApi({ apiKey: process.env.KEY });

// ✅ Lazy initialization
let instance: Shopify | null = null;
export function getShopify(): Shopify | null {
  if (!instance) {
    const apiKey = process.env.SHOPIFY_API_KEY;
    if (!apiKey) { console.warn('⚠️  Shopify not configured'); return null; }
    instance = shopifyApi({ apiKey });
  }
  return instance;
}
```

### Rule 17.6: Server TypeScript Configuration

```json
// server/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020", "module": "commonjs",
    "outDir": "./dist", "rootDir": "..",
    "baseUrl": "./src", "strict": true,
    "esModuleInterop": true, "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true, "resolveJsonModule": true
  },
  "include": ["src/**/*", "../shared/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Why `rootDir: ".."` instead of `"./src"`:** Required to include `shared/` types. Output paths are deeper: `server/src/index.ts` → `server/dist/server/src/index.js`. Adjust start scripts: `"start": "node dist/server/src/index.js"`

### Rule 17.7: Path Resolution — Context-Dependent

With `rootDir: ".."`, `__dirname` at runtime resolves to `.../server/dist/server/src/`, making it unreliable for cross-package paths.

```typescript
// ✅ Default for Replit monorepo — process.cwd() is the monorepo root at runtime
path.join(process.cwd(), 'client', 'build')

// ✅ When npm --prefix shifts cwd, __dirname may be more reliable
path.join(__dirname, '../../client/build')
```

Document which assumption the project uses and why. Verify the resolved path exists before serving.

### Rule 17.8: req.user TypeScript Narrowing
```typescript
if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
const currentUser = req.user;  // Capture IMMEDIATELY — use currentUser everywhere
```

### Rule 17.9: Apply Auth Middleware ONCE
Apply `authenticateToken` either at the router mount level OR on individual routes — never both.

### Rule 17.10: Graceful Feature Degradation
```typescript
router.get('/items', async (req, res) => {
  const pool = getPoolIfConnected();
  if (!pool) { res.status(503).json({ error: 'Database unavailable' }); return; }
  // proceed with query
});
```

### Rule 17.11: Health Check Endpoint (REQUIRED)
```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    port: process.env.PORT,
    database: pool ? 'connected' : 'disconnected',
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
    }
  });
});
```

### Rule 17.12: Rate Limiting (Required on Public-Facing APIs)
```typescript
import rateLimit from 'express-rate-limit';

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const heavyLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

app.use(globalLimiter);
app.use('/api/search', heavyLimiter);  // DB, external API, or heavy computation
app.use('/api/upload', heavyLimiter);
```

### Rule 17.13: Error Responses — Never Leak Internals
```typescript
// ❌ Leaks DB schema, table names, stack traces
res.status(500).json({ detail: err.message });

// ✅ Generic to client, full detail in server logs
const correlationId = crypto.randomUUID();
console.error(`❌ [${correlationId}]`, err);
res.status(500).json({ detail: 'An unexpected error occurred', correlationId });
```

In production (`NODE_ENV === 'production'`), ALL 5xx responses must return a fixed generic message.

### Rule 17.14: Payment, Webhook, and Entitlement Verification
- Never grant credits, plan upgrades, or feature access from a client redirect or optimistic frontend state alone
- Payment completion must be verified server-side using the payment provider's source-of-truth
- All payment webhooks must validate provider signatures before processing
- Webhook handlers must be idempotent and replay-safe
- Any scheduled job resetting quotas or credits must verify the underlying billing state before applying changes

### Rule 17.15: Authorization and RLS Safety
- Authorization is default-deny: access is explicitly granted, never assumed
- RLS policies such as `USING (true)` are forbidden on sensitive or multi-tenant tables in any live environment
- Every data path must answer: who can access it, what enforces access, and how that access is tested
- Never trust client-supplied role, tenancy, or entitlement claims without server-side verification

---

## 18. BUILD, SCRIPTS & DEPLOYMENT

### Rule 18.1: Root package.json (Monorepo)
```json
{
  "name": "project", "private": true,
  "scripts": {
    "install:all": "npm --prefix client install && npm --prefix server install",
    "build:client": "npm --prefix client run build",
    "build:server": "npm --prefix server run build",
    "build": "npm run install:all && npm run build:client && npm run build:server",
    "start": "npm --prefix server start",
    "dev:client": "npm --prefix client run dev",
    "dev:server": "npm --prefix server run dev",
    "migrate": "npm --prefix server run migrate"
  }
}
```

### Rule 18.2: Monorepo Dependency Installation (CRITICAL)
Each subdirectory has its own `package.json` and needs its own `node_modules`. Running `npm install` at root does NOT install subdirectory deps. The build script MUST install deps first (`npm run install:all`). Without this, builds fail with "vite: not found".

### Rule 18.3: npm --prefix Syntax
```bash
npm run build --prefix server  # ❌ WRONG
npm --prefix server run build  # ✅ CORRECT — --prefix BEFORE subcommand
```

### Rule 18.4: Database Migrations
- Migrations MUST be idempotent (`CREATE TABLE IF NOT EXISTS`)
- Use the `pg` library Node.js runner — `psql` is NOT available on Replit
- Migrations run as part of the deployment build step (after compilation), not during server startup
- Migration scripts can use `process.exit()` since they run in their own process
- Migration path with `rootDir: ".."`: `path.join(process.cwd(), 'server', 'migrations')`

### Rule 18.5: PostgreSQL Column Types
```sql
tech_stack TEXT[] DEFAULT '{}'   -- ❌ expects PostgreSQL array literals
tech_stack JSONB DEFAULT '[]'    -- ✅ accepts JSON.stringify() output
```

### Rule 18.6: Avoid ORDER BY RANDOM() at Scale
```sql
-- ❌ Full table scan on every call
SELECT * FROM quotes ORDER BY RANDOM() LIMIT 1;

-- ✅ Scales to large tables
SELECT * FROM quotes
WHERE id >= (SELECT floor(random() * (SELECT MAX(id) FROM quotes))::int)
LIMIT 1;
```

### Rule 18.7: Always Guarantee Pool Client Release
```typescript
const client = await pool.connect();
try {
  return await client.query(...);
} finally {
  client.release();  // ✅ Always releases, even on error
}
```

### Rule 18.8: Destructive Methods Must Be Production-Guarded
```typescript
static async deleteAllRecords(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('deleteAllRecords is disabled in production');
  }
  await db.query('DELETE FROM records');
}
```

### Rule 18.9: Cache External API Calls
```typescript
const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function cachedFetch<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fn();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
```

---

## 19. REPLIT PLATFORM RULES

### Rule 19.1: .replit Configuration Template
```toml
modules = ["nodejs-20"]
run = "bash start.sh"
entrypoint = "server/src/index.ts"

[nix]
channel = "stable-24_05"

[env]
PORT = "5000"
HOST = "0.0.0.0"
NODE_ENV = "development"  # NEVER "production" here — skips devDependencies

[deployment]
deploymentTarget = "vm"
build = ["bash", "-c", "npm run build && npm run migrate"]
run = ["node", "server/dist/server/src/index.js"]

[[ports]]
localPort = 5000
externalPort = 80
```

- Only ONE `[[ports]]` section
- `[deployment]` arrays do NOT have the `npm run` / Nix conflict of the top-level `run` field
- For WebSocket apps (Socket.io), use `deploymentTarget = "vm"` instead of autoscale

### Rule 19.2: replit.nix
```nix
{ pkgs }: {
  deps = [ pkgs.nodejs_20 pkgs.openssl ];
}
```
- `pkgs.nodejs_20` is correct for `stable-24_05`; do NOT include `pkgs.postgresql`
- If you change the channel, verify package names still resolve

### Rule 19.3: Never Use "npm run" in .replit top-level `run` Field
Nix ships a binary named `run` — when `.replit`'s top-level `run` field calls `npm run`, Nix intercepts it. Use `bash start.sh`. This restriction ONLY applies to the top-level `run` field.

### Rule 19.4: start.sh Bootstrap Script
```bash
#!/usr/bin/env bash
set -e

npm --prefix client install --include=dev
npm --prefix server install --include=dev
npm --prefix client run build
npm --prefix server run build

npm run migrate 2>&1 || echo "⚠️  Migration had warnings"

node server/dist/server/src/index.js
```

On a fresh upload, `dist/` does not exist — `start.sh` must build first. In deployment, migrations run in the `[deployment] build` step instead.

### Rule 19.5: Zip Upload
```bash
cp -r project/. . && rm -rf project
rm -f client/package-lock.json server/package-lock.json  # remove before zipping
```

### Rule 19.6: @replit/vite-plugin-cartographer — Remove for Production
```typescript
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode !== 'production' && (await import('@replit/vite-plugin-cartographer')).cartographer(),
  ].filter(Boolean),
}));
```
Or remove entirely if not actively used. Version mismatches don't always surface in dev — a working dev environment does NOT guarantee it's safe for deployment.

---

## 20. DEPLOYMENT CHECKLIST

**BEFORE EVERY DEPLOYMENT:**

#### Build & Config
```
[ ] Client uses Vite (NOT Create React App)
[ ] Vite config includes allowedHosts: true
[ ] index.html at client/ root (not public/)
[ ] Client tsconfig uses "moduleResolution": "bundler"
[ ] Only ONE [[ports]] section in .replit
[ ] Host binding is 0.0.0.0
[ ] NODE_ENV = "development" in dev .replit [env]
[ ] Root package.json install:all runs before build
[ ] npm --prefix syntax correct (before subcommand)
[ ] Build order: install → client → server
[ ] System utilities (fuser, killall, lsof) verified available before use
[ ] @replit/vite-plugin-cartographer excluded from production build
[ ] Compiled entry point path verified against rootDir/outDir in tsconfig.json
[ ] Compiled file confirmed to exist at exact path used in run command
```

#### Server Startup
```
[ ] Server listens IMMEDIATELY (before DB/async)
[ ] Health routes registered BEFORE middleware
[ ] Root route (/) serves React app (not API JSON)
[ ] Route order: health → API → static → SPA fallback
[ ] Third-party APIs use lazy initialization
[ ] No process.exit() during module load
[ ] Auth middleware applied ONCE per route path
```

#### Database
```
[ ] SSL enabled: ssl: { rejectUnauthorized: false }
[ ] Connection is non-fatal (server stays up if DB fails)
[ ] Connection has 8-second timeout; Pool: max: 5, min: 0
[ ] Migrations are idempotent (IF NOT EXISTS)
[ ] Missing DATABASE_URL handled gracefully
[ ] Migrations use Node.js runner (not psql)
[ ] No ORDER BY RANDOM() on large tables
[ ] All pool client usage wrapped in try/finally
[ ] Destructive/test-only DB methods guarded or excluded from production
[ ] External API calls cached (in-memory or Redis)
```

#### Routing & Security
```
[ ] CORS strategy matches auth model (no hardcoded Replit domain)
[ ] Wildcard CORS only for fully public, read-only, unauthenticated endpoints
[ ] Cookie/credentialed/admin flows use allowlist CORS, not wildcard
[ ] Helmet CSP disabled or tuned for React/Replit scripts
[ ] Static files don't block API routes
[ ] SPA fallback includes Cache-Control headers
[ ] Database-dependent routes check pool availability
[ ] Rate limiting applied (global + heavy-endpoint limiters)
[ ] Error responses return generic messages in production (no raw err.message)
[ ] Source maps disabled in client production build
[ ] RLS/ACL policy reviewed for default-deny behavior
[ ] No sensitive table uses open RLS like USING (true)
[ ] Payment state verified server-side before granting access or credits
[ ] Webhook signatures verified and handlers idempotent
```

#### Testing & Critical Paths
```
[ ] Auth flows have meaningful tests
[ ] Permission boundaries and tenant isolation have meaningful tests
[ ] Payment and webhook flows have meaningful tests or equivalent proof
[ ] Payment failure paths tested, not just happy path
[ ] Critical-path test coverage exists beyond superficial UI/style tests
```

---

## 21. COMMON ERRORS & FIXES

| Error | Rule | Fix |
|-------|------|-----|
| "vite: not found" | 18.2 | Add install:all, run before build |
| Health check timeout | 17.1 | Listen immediately before async |
| "Multiple ports configured" | 15.2 | Keep only one [[ports]] |
| "Database connection failed - 28000" | 17.3 | Add SSL to Pool config |
| "MODULE_NOT_FOUND" (react-scripts) | 16.3 | Migrate to Vite |
| "tsx: command not found" | 19.1 | Set NODE_ENV=development |
| API crash on missing credentials | 17.5 | Use lazy initialization |
| "Cannot GET /" | 17.2 | Root serves React, status at /api/status |
| "npm doesn't recognize --prefix" | 18.3 | --prefix BEFORE subcommand |
| "Cannot GET /api/users" | 17.2 | API routes before static files |
| "Refused to load script... CSP" | 17.2 | Disable Helmet CSP |
| Server crashes when DB unavailable | 17.3 | Non-fatal DB connection |
| Server exits before health check | 17.4 | Never process.exit in module load |
| Migrations fail silently | 18.4 | Run migrations as separate step |
| "psql: command not found" | 18.4 | Use pg library, never psql |
| dist/index.js not found | 17.6 | Check rootDir → dist path mapping |
| Static files 404 | 17.7 | Verify path resolution context |
| req.user undefined in callback | 17.8 | Capture user before async |
| Nix build failure | 19.2 | Use pkgs.nodejs_20, no postgresql |
| 429 Too Many Requests in prod | 17.12 | Add express-rate-limit |
| Raw DB error in API response | 17.13 | Use generic error + correlationId |
| Source exposed in DevTools | 16.6 | Set sourcemap: false in vite build |
| Pool connection leak under load | 18.7 | Wrap client.query in try/finally |
| "traverse is not a function" at deploy | 19.6 | Remove cartographer from prod build |
| "cannot be resolved" vite import at deploy | 16.7 | Use path.resolve(__dirname, ...) |
| Wrong compiled entry point path | 17.6 | Check rootDir/outDir in tsconfig |
| Vendor lock-in on critical dependency | 11.5 | Wrap behind owned adapter/interface |
| Open RLS on multi-tenant table | 17.15 | Replace USING (true) with tenant-scoped policy |
| Payment granted without server verification | 17.14 | Verify via provider webhook/API, not client state |
| Insecure token generation | 8 | Use crypto.randomBytes, not Math.random |

---

## 22. RULE PRIORITY HIERARCHY

```
1. User's explicit instruction (ALWAYS WINS)
   ↓
2. Replit Platform Rules (Section 19) — OVERRIDES general patterns
   ↓
3. Other sections of this document
   ↓
4. General best practices
```

---

## 23. QUICK REFERENCE — ENVIRONMENT

```bash
# .env.example
PORT=5000
HOST=0.0.0.0
NODE_ENV=development
DATABASE_URL=
JWT_SECRET=
ENCRYPTION_KEY=
ANTHROPIC_API_KEY=

# Generate secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 24. CRA → VITE MIGRATION GUIDE

```bash
# Step 1: Install Vite
cd client && npm install --save-dev vite @vitejs/plugin-react

# Step 2: Create vite.config.ts (see Rule 16.1)

# Step 3: Move index.html to client root
mv public/index.html index.html
# Replace %PUBLIC_URL% refs; add: <script type="module" src="/src/main.tsx"></script>

# Step 4: Update client/package.json
# "type": "module"
# "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" }

# Step 5: Remove CRA
npm uninstall react-scripts

# Step 6: Update client/tsconfig.json
# "moduleResolution": "bundler", "module": "ESNext"

# Step 7: Rename entry if needed
mv src/index.jsx src/main.tsx
# Update index.html script tag to /src/main.tsx
```

---

## 25. ANTI-PATTERNS — NEVER DO ON REPLIT

```bash
# ❌ MISSING SUBDIRECTORY DEPENDENCY INSTALLATION
{ "scripts": { "build": "npm --prefix client run build" } }  # vite not found!

# ❌ WRONG npm --prefix SYNTAX
npm run build --prefix server  # ✅ correct: npm --prefix server run build

# ❌ CREATE REACT APP
npx create-react-app client      # Incompatible with Node 20+

# ❌ EAGER THIRD-PARTY API INITIALIZATION
const shopify = shopifyApi({ apiKey: process.env.KEY });  # Crashes if key missing

# ❌ BLOCKING SERVER STARTUP
const pool = await connectDB();
app.listen(PORT);                # Server never starts if DB is slow/down

# ❌ CALLING process.exit() IN MODULE LOAD PATH
if (!process.env.JWT_SECRET) process.exit(1);  # Kills server before health check

# ❌ LOCALHOST BINDING
app.listen(PORT, 'localhost');   # Container inaccessible from outside

# ❌ MULTIPLE [[ports]] SECTIONS — deployment fails

# ❌ DB CONNECTION WITHOUT SSL
new Pool({ connectionString: url })  # Replit PostgreSQL requires SSL

# ❌ psql FOR MIGRATIONS
psql $DATABASE_URL -f migration.sql  # psql not available on Replit

# ❌ NODE_ENV=production IN DEVELOPMENT .replit
NODE_ENV = "production"          # Skips devDependencies — tsx, vite, typescript not found

# ❌ ROOT ROUTE RETURNING API JSON
app.get('/', (req, res) => res.json({ status: 'ok' }));  # React app never loads

# ⚠️ SYSTEM UTILITIES — VERIFY BEFORE USE
fuser -k 5000/tcp / killall node / lsof -ti:5000  # May not be available — verify first

# ❌ HARDCODED REPLIT DOMAIN IN CORS
cors({ origin: 'https://myapp.user.repl.co' })   # Breaks on every redeploy

# ❌ ASSUMING WILDCARD CORS IS ALWAYS SAFE
cors({ origin: '*' })            # Not safe for cookie auth, admin flows, or sensitive endpoints

# ❌ DEFAULT HELMET (blocks React inline scripts)
app.use(helmet());               # Use helmet({ contentSecurityPolicy: false })

# ❌ MOCK/SYNTHETIC BUSINESS DATA IN CODE
Math.random() as business data / hardcoded placeholder business values

# ❌ INSECURE RANDOMNESS FOR SECURITY BOUNDARIES
const tempPassword = Math.random().toString(36).slice(2)  # use crypto.randomBytes instead

# ❌ HARDCODED SECRETS IN SOURCE FILES
DB_PASSWORD: postgres / apiKey: "sk-hardcoded" / JWT_SECRET: "mysecret"

# ❌ CORE PRODUCT LOGIC DEPENDS DIRECTLY ON VENDOR-OWNED AI GATEWAY
await fetch('https://vendor-platform.example.ai/gateway', ...)  # no owned adapter, no exit path

# ❌ OPEN RLS ON LIVE MULTI-TENANT TABLES
CREATE POLICY open_access ON projects USING (true)  # any authenticated user touches any row

# ❌ PAYMENT SUCCESS ASSUMED WITHOUT WEBHOOK VERIFICATION
if (checkoutSuccess) credits = monthlyPlanCredits  # no server-side verification

# ❌ RAW ERROR MESSAGES TO CLIENT
res.status(500).json({ detail: err.message })      # leaks DB internals

# ❌ SOURCE MAPS ENABLED IN PRODUCTION BUILD
build: { sourcemap: true }                          # exposes TypeScript source in DevTools

# ❌ NO RATE LIMITING ON API ROUTES
// Any public API with no rate limiting is an open DoS vector

# ❌ ORDER BY RANDOM() ON LARGE TABLES
SELECT * FROM table ORDER BY RANDOM() LIMIT 1      // full table scan every call

# ❌ POOL CLIENT WITHOUT try/finally
const client = await pool.connect();
await client.query(...);                            // throws → connection leaks forever

# ❌ UNCACHED EXTERNAL API CALLS ON EVERY REQUEST
const result = await youtubeApi.search(query);     // no cache = rate limit / latency spike

# ❌ cd CHAINING BETWEEN SUBDIRECTORY BUILDS
cd client && npm run build && cd .. && cd server && npm run build  # breaks on path errors
# ✅ CORRECT: npm --prefix client run build && npm --prefix server run build

# ❌ @replit/vite-plugin-cartographer IN PRODUCTION BUILD
plugins: [react(), cartographer()]  // "traverse is not a function" at deploy time
```

---

## 26. AI CODE GENERATION REVIEW PROTOCOL

**Rule: Code produced by AI tools goes through a mandatory checklist before merge — not just a functional review.**

Every AI-generated code change must be validated against:

```
[ ] Does any cryptographic operation use Math.random() or a non-CSPRNG?
[ ] Are hardcoded URLs, secrets, or credentials present?
[ ] Does this introduce a new vendor dependency that isn't abstracted behind an interface?
[ ] Are all new endpoints protected by explicit auth and CORS policy?
[ ] Are there tests, or is this a critical path that requires them?
[ ] Does any new data access path have explicit RLS/ACL coverage?
[ ] Are payment/webhook handlers validating provider signatures?
[ ] Does any new entitlement or access grant rely on client-side state?
```

AI tools accelerate building but they don't ask security questions. Every developer is responsible for validating AI output against this checklist before merge. "The AI wrote it" is not a defense.

---

## 27. SECURITY DEBT EXPIRY

**Rule: Known security gaps that are deferred get a maximum time-to-close, not an indefinite backlog ticket.**

| Issue Type | Max Deferral | If Not Fixed |
|------------|-------------|--------------|
| Auth / permission gap | 24 hours | Gate or disable the affected feature |
| Cryptographic weakness | Before next deploy | Deploy is blocked |
| Data exposure / PII leak | Immediate | Incident response, not sprint planning |
| Open RLS on live table | Before next deploy | Deploy is blocked |
| Unverified payment webhook | Before payment flow goes live | Payment feature disabled |

**"We'll fix it soon" with no deadline is a policy violation, not a tradeoff.**

---

## 28. ARCHITECTURE KICKOFF CHECKLIST

**Rule: Before writing any code, answer these questions in writing. AI tools accelerate building — they don't ask these questions. Someone has to.**

```
[ ] What external services are core to product function?
[ ] What happens if each one disappears tomorrow?
    -> Is there an abstraction layer? A fallback provider? A migration path?
[ ] Where does money move, and what confirms it moved successfully?
    -> Webhook handlers exist for all payment events before any flow goes live?
    -> Failure paths tested, not just happy path?
[ ] Who can access what data, and what enforces that?
    -> Default-deny at every layer (RLS, ACL, IAM)?
    -> Explicit grant documented for every table and endpoint?
[ ] What is the test strategy for auth and payments?
    -> Tests exist before these features ship, not after?
[ ] What vendor lock-in points exist?
    -> Each one documented with failure mode and exit path?
[ ] What is the CORS strategy, and does it match the auth model?
[ ] Are all secrets in environment variables, not source files?
```

Revisit this checklist on every major sprint, not just at project start.

---

**END OF MASTER GUIDEBOOK**
