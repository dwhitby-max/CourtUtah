# REPLIT DEPLOYMENT BIBLE — MASTER GUIDEBOOK FOR CLAUDE

**Document Version:** 6.0
**Last Updated:** March 2026
**Purpose:** Definitive, conflict-resolved ruleset for production-ready AI-assisted development targeting Replit deployment.
**Changelog v5.0:** Incorporated consensus feedback from Opus, Sonnet, Replit Agent, and Codex reviews. Loosened process ceremony (mode declarations, re-read mandates), refined TypeScript rules (allow `as const`, `import type`, aliases), made TDD default-not-mandatory, allowed coherent multi-file edits, distinguished mock business data from legitimate defaults, targeted DI at boundary services, and corrected platform-specific inaccuracies (path resolution, fuser availability, deployment arrays).

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

State mode only when it is unclear from context or when switching modes changes expected behavior. The content of the response makes the mode obvious in most cases.

---

## 1. CORE DEVELOPMENT CYCLE

### Read → Analyze → Explain → Propose → Edit → Lint → Halt

1. **READ** — Read this document once at session start. Re-check only the relevant section before risky work or when touching a known problem area. Read every referenced file (types, interfaces, helpers) from disk before editing.
2. **ANALYZE** — Analyze dependencies and gaps. If multiple files are required, explain the cross-file dependency and proceed with coherent units of work (e.g., a type, a route, and a component that form one logical change). Keep scope tight. Format: Discovery / Impact / Proposed checklist insert. Report discoveries immediately, no workarounds.
3. **EXPLAIN** — Restate plan in bullets with explicit commitment.
4. **PROPOSE** — State: "I will implement exactly this plan now." Note which checklist step it fulfills.
5. **EDIT** — Never touch files not explicitly instructed to modify. Follow plan exactly.
6. **LINT** — Lint file using internal tools. Fix all issues before proceeding.
7. **HALT** — Stop after completing a coherent unit of work (which may span related files) and wait for explicit user/test output before starting the next unit.

**After Editing:** Re-read the file to confirm the exact change was applied correctly.

---

## 2. CHECKLIST DISCIPLINE

**THE AGENT NEVER TOUCHES THE CHECKLIST UNLESS EXPLICITLY INSTRUCTED.**

### When Editing Checklists

- Do not edit checklist or its statuses without explicit instruction
- When instructed, change only the specified portion using legal-style numbering
- Execute exactly what the active checklist step instructs — no deviation or "creative interpretation"
- Each numbered step (1, 2, 3) = ONE file's entire TDD cycle (deps → types → tests → implementation → proof)
- Sub-steps use legal-style numbering (1.a, 1.b, 1.a.i, 1.a.ii)
- All changes to a single file are described within that file's numbered step

### Documentation

- Document every edit within the checklist
- If required edits are missing from the plan, explain the discovery, propose a new step, and halt
- Never update the status of any work step (checkboxes or badges) without explicit instruction
- After a block of related steps completing a working implementation, include a commit with proposed commit message

### Checklist Structure Rules

- Types files (interfaces, enums) are exempt from RED/GREEN testing requirements
- Each file edit includes: RED test → implementation → GREEN test → optional refactor
- Steps ordered by dependency (lowest dependencies first)
- Preserve all existing detail and work while adding new requirements
- NEVER create multiple top-level steps for the same file edit operation

### Example Checklist Structure

```
[ ] 1. **Title** Objective
  [ ] 1.a. [DEPS] List explaining dependencies of function, signature, return shape
    [ ] 1.a.i. eg. `function(something)` in `file.ts` provides this or that
  [ ] 1.b. [TYPES] List strictly typing all objects used in function
  [ ] 1.c. [TEST-UNIT] List explaining test cases
    [ ] 1.c.i. Assert `function(something)` in `file.ts` acts certain way
  [ ] 1.d. [SPACE] List explaining implementation requirements
    [ ] 1.d.i. Implement `function(something)` in `file.ts` acts certain way
  [ ] 1.e. [TEST-UNIT] Rerun and expand test proving function
  [ ] 1.f. [TEST-INT] If chain of functions work together, prove it
  [ ] 1.g. [CRITERIA] List explaining acceptance criteria for complete/correct work
  [ ] 1.h. [COMMIT] Commit explaining function and its proofs
```

---

## 3. BUILDER VS REVIEWER MODE BEHAVIOR

### Builder Mode

- Follow Read→...→Halt loop precisely
- If a deviation, blocker, or new requirement is discovered — or the current step cannot be completed as written — explain the problem, propose the required checklist change, and halt immediately
- Never improvise or work around limitations

### Reviewer Mode

- Treat all prior reasoning as untrusted
- Re-read relevant files and tests from scratch
- Produce a numbered EO&D list referencing files and sections
- Ignore checklist status or RED/GREEN history unless it causes a real defect
- If no EO&D found, state: "No EO&D detected; residual risks: ..."

---

## 4. PLAN FIDELITY & SHORTCUT BAN

### Implementation Rules

- Once a solution is described, implement EXACTLY that solution and the user's instruction
- Expedient shortcuts are forbidden without explicit approval
- If you realize a deviation mid-implementation, stop, report it, and wait for direction
- Repeating a corrected violation triggers halt-and-wait immediately

### Critical Violations to Avoid

- If your solution to a challenge is "rewrite the entire file" — STOP, explain why a rewrite is necessary, and get explicit approval before proceeding. A rewrite may be the right answer (e.g., accumulated tech debt, architecture migration), but it requires justification.
- Minimize file churn, but allow multi-file changes when they are part of one coherent fix. Keep scope tight and explain the cross-file dependency.
- If you are expanding scope beyond what was requested, you've made a discovery — STOP, report it, await instruction

### Refactoring Rules

- Must preserve all existing functionality unless the user explicitly authorizes removals
- Log and identifier fidelity is mandatory

---

## 5. REPORTING & TRACEABILITY

### Every Response Must Include

- Plan bullets (Builder) or EO&D findings (Reviewer)
- Checklist step references
- Lint/test evidence

### If Tests Not Run

- Explicitly state why
- List residual risks

### If No EO&D Found

- State that along with remaining risks

### Code Output Rules

- Never output large code blocks (entire files or multi-function dumps) in chat unless the user explicitly requests it
- Never print an entire function and tell the user to paste it in
- Edit the file directly or provide a minimal diff

### Tool Usage

- Agent uses only its own tools, never the user's terminal

---

## 6. PRE-CHANGE ANALYSIS

### Before ANY Code Change (MANDATORY)

1. **Complete System Analysis** — Search codebase for related functionality, review replit.md for previous decisions and user preferences, identify ALL files that might be affected, document current behavior before modification, verify understanding through testing/queries.

2. **Impact Assessment** — List ALL features that could be affected, identify ALL database tables/columns involved, check for existing user preferences or previous fixes, verify no circular problem-solving (check git history/replit.md), document expected behavior after change.

3. **Dependency Verification** — Verify all required functions exist and work correctly, check database schema consistency, validate API integration points, ensure no breaking changes to existing interfaces.

### Implementation Consistency Checks (MANDATORY)

When doing comprehensive analysis, verify:
- All authentication endpoints use IDENTICAL user ID retrieval patterns
- All session management uses consistent property access methods
- All database queries use same ORM patterns and error handling
- All API response formats follow identical structure and typing
- All middleware implementations follow same validation patterns
- Search for patterns like `req.user`, `req.session.user`, `userId` across ALL files
- Flag ANY inconsistencies as CRITICAL BUGS requiring immediate fix

### After Any Code Change

- Test specific functionality that was changed
- Verify ALL related features still work
- Check database consistency if applicable
- Validate API responses if applicable
- Confirm no regression in existing behavior

---

## 7. USER DECISION AUTHORITY

When the user asks "do we have other options?" or requests alternatives:

1. STOP implementation immediately
2. List ALL available options with clear explanations
3. Present advantages/disadvantages for each option
4. WAIT for explicit user approval before proceeding
5. Never assume user preference or implement without permission

**Example:** If user asks about authentication alternatives:
- Option A: Traditional email/password (pros/cons)
- Option B: Keep existing OAuth (pros/cons)
- Option C: Hybrid approach (pros/cons)
Then wait for the user's choice.

---

## 8. MOCK DATA & HARDCODED VALUES PROHIBITION

**MOCK DATA PROHIBITION — STRICT POLICY**

- NEVER include placeholder, synthetic, example, sample, or fallback **business data** in ANY code
- NEVER use `Math.random()` or hardcoded values as a substitute for real data in API responses
- ALL business data MUST come from authentic external API sources or user-provided information
- When authentic data cannot be retrieved, implement ONLY clear error states requesting proper credentials
- NO EXCEPTIONS for fake business data — violations represent fundamental failure to follow established agreements

**Legitimate uses that are NOT mock data:**
- Reasonable defaults: empty arrays, default pagination values, "No items found" placeholder text
- `Math.random()` for nonces, client-side IDs, shuffle logic, probabilistic sampling, or non-data purposes
- Default UI states and empty-state components

**Critical violations:**
- Including mock competitor names, revenue figures, or market data
- Using `Math.random()` or placeholder calculations as business data in API responses
- Providing sample data structures with fictional business information
- Creating fallback data when external APIs are unavailable
- Any form of synthetic data generation without explicit user authorization

### Credentials — Never Hardcode

No passwords, API keys, tokens, or secrets ever appear in source files. This includes `docker-compose.yml`, config files, and any file committed to git.

```yaml
# ❌ WRONG
environment:
  DB_PASSWORD: postgres

# ✅ CORRECT
environment:
  DB_PASSWORD: ${DB_PASSWORD}
```

Required `.gitignore` entries for every project:
```
.env
.env.local
.env.production
.env*.local
```

Always provide a `.env.example` with placeholder values — never real values. Generate secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

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
│
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
│
├── shared/                    # Shared types — single source of truth
│   └── types.ts
│
├── package.json               # Root package.json (monorepo scripts)
├── start.sh                   # Bootstrap script (optional, for .replit run field)
├── replit.nix
└── .replit
```

Any source rule referencing `frontend/` or `backend/` should be translated to `client/` and `server/` respectively.

### Rule 9.2: File Naming Convention (MANDATORY)

| Category | Convention | Example |
|----------|-----------|---------|
| Regular `.ts` files | camelCase | `userService.ts`, `authMiddleware.ts` |
| React components `.tsx` | PascalCase (must match export) | `DashboardPage.tsx` → `export default function DashboardPage()` |
| Directories | All lowercase | `components/`, `services/`, `routes/` |

**Explicitly banned:**
```
User_service.ts        ❌ snake_case
auth-middleware.ts     ❌ kebab-case (for .ts files)
dashboardpage.tsx      ❌ flat lowercase for components
```

### Rule 9.3: Import Path Normalization

```typescript
// ❌ fragile relative paths
import Button from "../../../../components/Button"

// ✅ path aliases
import Button from "@/components/Button"
import { User } from "@shared/types"
```

Configure in `client/vite.config.ts` (see Rule 12.1) and `client/tsconfig.json` (see Rule 12.2).

---

## 10. TYPE SAFETY & API CONTRACTS

### Rule 10.1: Types MUST Match API Responses Exactly

```typescript
// Step 1: Check actual API response
fetch('/api/endpoint').then(r => r.json()).then(console.log)

// Step 2: Define type matching EXACT structure
interface MessageListResponse {
  messages: Message[];  // ✅ Matches backend
  total: number;
}

// Step 3: Use type safely
const items = response.data.messages;  // ✅ Correct
```

Single source of truth in `shared/types.ts`.

### Rule 10.2: Strict Typing Requirements

- Use explicit types everywhere
- NO `any` — prefer `unknown` plus narrowing
- `as const` IS allowed for literal type inference (it is not an unsafe cast)
- `as` casts: avoid by default, but allow when boundary code or library interop makes them necessary — keep them local and document why
- Inline ad-hoc types: avoid for complex types, but simple parameter types like `{ id: string }` used exactly once are acceptable
- Every object and variable must be typed
- Construct full objects satisfying existing interfaces
- Compose complex objects from smaller typed components
- Never rely on defaults, fallbacks, or backfilling
- Use type guards to prove and narrow types for the compiler when required
- **Exceptions:** Database clients (Drizzle, etc.), intentionally malformed test objects

**Import Rules:**
- Never import entire libraries with `*`
- Import aliases ARE allowed when they improve clarity or resolve name collisions
- `import type` IS allowed and recommended — it ensures type-only imports are erased at compile time and prevents accidental side effects
- A ternary is NOT a type guard — default values prohibited

### Rule 10.3: Field Names MUST Match Exactly

| Backend | Frontend | Result |
|---------|----------|--------|
| `accessToken` | `token` | ❌ Auth fails |
| `messages` | `data` | ❌ Undefined |
| `full_name` | `name` | ❌ Validation fails |
| `created_at` | `createdAt` | ❌ Display fails |

### Rule 10.4: Validation Rules MUST Match Both Sides

Use shared validation (e.g., `shared/validation.ts`) consumed by both client and server.

### Rule 10.5: Shared Types Are the Single Source of Truth

Any type describing an API request or response MUST be defined once in `shared/types.ts` and imported by both client and server. Never duplicate types across the boundary — subtle field-name differences (`total` vs `count`, `total_movies` vs `unique_movies`) cause silent `undefined` bugs at runtime that TypeScript cannot catch across package boundaries.

---

## 11. DEPENDENCY INJECTION & ARCHITECTURE

### Rule 11.1: Dependency Injection (Targeted)

- Use explicit dependency injection for services with external dependencies (databases, APIs, file systems) that need to be tested or swapped
- Pass every dependency with no hidden defaults or optional fallbacks for injected services
- Build adapters/interfaces for services that cross system boundaries
- Simple utility/helper functions do NOT need DI wrappers or interfaces — keep them simple
- Work bottom-up so dependencies compile before consumers
- Preserve existing functionality, identifiers, and logging unless explicitly told otherwise

### Rule 11.2: File Size Management

- **When a file exceeds 600 lines, stop and propose logical refactoring**
- Decompose into smaller parts providing clear Separation of Concerns (SOC) and Don't Repeat Yourself (DRY)

### Rule 11.3: No Band-Aid Solutions

- Fix underlying problems, not just symptoms
- Address architectural issues causing recurring problems
- Ensure solutions are sustainable and won't break with future changes
- Consider system-wide impact of all modifications

---

## 12. TESTING STANDARDS

### TDD Cycle (Default for Behavior Changes)

```
RED test (desired behavior) → Implementation → GREEN test → Lint → Halt
```

- Use TDD by default for behavior changes and bug fixes with a clear failing case
- Skip strict RED-first for: exploratory work, config changes, build plumbing, CSS/UI tweaks, migrations, prototypes, or emergency fixes
- When RED is skipped, state why and describe the verification strategy
- Documents/types/interfaces exempt from tests (still follow Read→Halt)
- Bottom-up: Types/interfaces/helpers BEFORE consumers
- Agent may run tests directly when bash/terminal access is available; rely on provided outputs when it is not
- Write consumer tests ONLY after producers exist
- Do not advance until current file's proof is complete
- Keep application in provable state at all times

### Test Requirements

- Tests assert desired passing state — no RED/GREEN labels in test names
- New tests added to end of file
- Each test covers exactly one behavior
- Use real application functions/mocks with strict typing
- Never invent partial objects
- Integration tests exercise real code paths
- Unit tests stay isolated and mock dependencies explicitly
- **Never change assertions to match broken code — fix the code instead**

### Test Fixtures

- Tests use the same types, objects, structures, and helpers as real code
- Never create new fixtures only for tests
- Test relying on imaginary types or fixtures is invalid

### Proof Requirements

- Prove functional gap, implemented fix, AND regressions through tests before moving on
- Never assume success without proof

---

## 13. LOGGING, DEFAULTS & ERROR HANDLING

### Logging Rules

- Do NOT add or remove logging, defaults, fallbacks, or silent healing unless the user explicitly instructs
- Adding console logs solely for troubleshooting is exempt from TDD and checklist obligations
- That exemption applies only to the logging statements themselves

### Structured Console Logging (REQUIRED)

Use emoji-prefixed logging for readability in Replit's console:

```typescript
console.log('✅ Server started on port', PORT);
console.log('✅ Database connected');
console.error('❌ Database connection failed:', error);
console.warn('⚠️  Missing optional config:', key);
```

Pattern: ✅ success, ❌ error, ⚠️ warning. Always include context (port, URL, timing). Use `console.error` for errors (writes to stderr). Avoid opaque logger libraries — Replit's console surfaces `console.*` calls directly.

### Error Handling

- Believe failing tests, linter flags, and user-reported errors literally
- Fix the stated condition before chasing deeper causes
- If the user flags instruction noncompliance, acknowledge, halt, and wait for explicit direction
- Do not self-remediate in a way that risks further violations

---

## 14. LINTING & PROOF

### Linting Process

- After each edit, lint the touched file and resolve every warning/error
- Record lint/test evidence in the response (e.g., "Lint: clean via internal tool; Tests: not run per instructions")
- Evaluate if a linter error can be resolved in-file or out-of-file
- Only resolve in-file linter errors; report out-of-file errors and await instruction

### Important Notes

- Testing may produce unresolvable linter errors
- Do NOT silence them with `@ts` flags, create empty stub functions, or other workarounds
- A linter error is sometimes itself proof of RED state of a test

### Completion Proof

- Requires a lint-clean file plus GREEN test evidence (or documented exemption for types/docs)

---

## 15. PORT & HOST CONFIGURATION

### Rule 15.1: Port and Host Must Be Consistent Everywhere

Default port is **5000**. The app must respect `process.env.PORT` as an override but default to 5000. Must bind to `0.0.0.0` (not `localhost`).

```typescript
const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST);
```

### Rule 15.2: Only ONE Port Configuration in .replit (CRITICAL)

```toml
# ✅ SINGLE PORT ONLY
[[ports]]
localPort = 5000
externalPort = 80
```

Multiple `[[ports]]` sections cause deployment failures.

### Rule 15.3: MUST Bind to 0.0.0.0

```typescript
// ❌ WRONG — Container inaccessible
app.listen(5000, 'localhost');

// ✅ CORRECT — External access
app.listen(5000, '0.0.0.0');
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
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["src", "../shared"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

```json
// client/tsconfig.node.json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

### Rule 16.3: NEVER Use Create React App on Replit

Create React App (react-scripts 5.x) is INCOMPATIBLE with Node.js 20+. Always use Vite.

### Rule 16.4: React Library Compatibility

Before adding any React library, check peerDependencies for React 18 compatibility.

### Rule 16.5: Client-Side Environment Variables

Client-side variables must start with `VITE_` and are accessed via `import.meta.env.VITE_*`.

### Rule 16.6: Disable Source Maps in Production Builds

Source maps expose original TypeScript source to anyone with browser DevTools open.

```typescript
// client/vite.config.ts — build section
build: {
  outDir: 'build',
  sourcemap: false,           // ✅ production default
  // sourcemap: 'hidden',     // only if feeding an error tracker like Sentry
},
```

### Rule 16.7: Vite Config Path Resolution

When importing `vite.config` programmatically from a server subdirectory, always use absolute path resolution — never relative paths. Relative paths break when the working directory differs between dev and build contexts.

```typescript
// ❌ Breaks if working directory is not project root
import config from '../../vite.config';

// ✅ Resolves correctly regardless of working directory
import config from path.resolve(__dirname, '../../vite.config');
```

If `vite.config.ts` is imported at build time, confirm it is included in the project's `tsconfig.json` `include` array. Always verify that any file referenced by a server-side Vite import actually exists at the resolved path before deploying — path mismatches between dev and build context are a common source of "cannot be resolved" errors that only appear at deploy time.

---

## 17. SERVER CONFIGURATION

### Rule 17.1: Server MUST Start Immediately (CRITICAL)

The server MUST call `server.listen()` BEFORE any database connections or async work. This ensures Replit's health check succeeds.

```typescript
// ✅ Listen FIRST, connect AFTER
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
app.use(cors({ origin: '*' }));

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

**Key points:**
- Root route (`/`) must NOT return API JSON — it serves the React app
- API routes must come BEFORE static files or they'll be unreachable
- SPA fallback must include Cache-Control headers

### Rule 17.3: Database Connection Must Be Non-Fatal

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },  // Required for Replit PostgreSQL
  connectionTimeoutMillis: 8000,
  max: 5,
  min: 0,
  idleTimeoutMillis: 30000
});
```

If `DATABASE_URL` is missing, log a warning and continue. The server stays up; database-dependent routes return 503.

### Rule 17.4: Environment Variable Validation — NEVER process.exit()

Validate required env vars at startup but **NEVER** call `process.exit()` in the server's module load path. The server must always be reachable for health checks.

```typescript
// ✅ Boot, warn loudly, fail at point of use
function validateEnv(): void {
  const expected = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'];
  const missing = expected.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`⚠️  Missing environment variables: ${missing.join(', ')}`);
    console.error('⚠️  Server will start but affected features will fail.');
  }
}
```

**Exception:** `process.exit()` IS acceptable in standalone scripts (e.g., `migrate.ts`, seed scripts) that run in their own Node.js process.

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
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "..",
    "baseUrl": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "../shared/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Why `rootDir: ".."` instead of `"./src"`:** Setting `rootDir: ".."` is required to include `shared/` types in compilation. The simpler alternative (`rootDir: "./src"`) cannot reach `../shared/` and will fail with "File is not under 'rootDir'" errors. The tradeoff is a deeper output path — see Rule 17.7 for the `__dirname` side effect this creates.

**WARNING:** With `rootDir: ".."`, output paths are deeper:
- `server/src/index.ts` → `server/dist/server/src/index.js`

Adjust start scripts accordingly:
```json
"start": "node dist/server/src/index.js"
```

### Rule 17.7: Path Resolution — Context-Dependent

Use `process.cwd()` or `__dirname` based on the runtime entrypoint and packaging model. With `rootDir: ".."`, `__dirname` at runtime resolves to `.../server/dist/server/src/`, making it unreliable for cross-package paths. However, `npm --prefix` changes `process.cwd()`, making it unreliable when scripts run from a different directory.

**Default for Replit monorepo (no --prefix in runtime):**
```typescript
// ✅ process.cwd() is the monorepo root on Replit at runtime
path.join(process.cwd(), 'client', 'build')
```

**When npm --prefix is used at runtime:**
```typescript
// ✅ __dirname may be more reliable when cwd is shifted
path.join(__dirname, '../../client/build')
```

Document which assumption the current project relies on and why. Verify the resolved path exists before serving.

### Rule 17.8: req.user TypeScript Narrowing

TypeScript cannot narrow `req.user` through async callbacks. Capture it immediately after the guard:

```typescript
if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
const currentUser = req.user;  // Capture IMMEDIATELY — use currentUser everywhere
```

### Rule 17.9: Apply Auth Middleware ONCE

Apply `authenticateToken` either at the router mount level OR on individual routes — never both.

```typescript
// routes/index.ts — auth at mount level
router.use('/projects', authenticateToken, projectsRouter);

// routes/projects.ts — do NOT re-apply
router.get('/', async (req, res) => { ... });  // ✅ No auth here
```

### Rule 17.10: Graceful Feature Degradation

Every database-dependent route should check pool availability:

```typescript
router.get('/items', async (req, res) => {
  const pool = getPoolIfConnected();
  if (!pool) {
    res.status(503).json({ error: 'Database unavailable' });
    return;
  }
  // proceed with query
});
```

### Rule 17.11: Health Check Endpoint (REQUIRED)

Return structured status including uptime, memory, and database connectivity:

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

Every public-facing API must have rate limiting before production deployment. Internal/admin endpoints used only during development can defer rate limiting until they are exposed publicly.

Apply a global limiter and tighter limits on expensive endpoints:

```typescript
// npm install express-rate-limit
import rateLimit from 'express-rate-limit';

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const heavyLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

app.use(globalLimiter);
app.use('/api/search', heavyLimiter);   // Any endpoint hitting DB, external API, or doing heavy computation
app.use('/api/upload', heavyLimiter);
```

### Rule 17.13: Error Responses — Never Leak Internals

Never return raw error messages, stack traces, or database errors to the client in production.

```typescript
// ❌ Leaks DB schema, table names, stack traces
res.status(500).json({ detail: err.message });

// ✅ Generic to client, full detail in server logs
const correlationId = crypto.randomUUID();
console.error(`❌ [${correlationId}]`, err);
res.status(500).json({ detail: 'An unexpected error occurred', correlationId });
```

In production (`NODE_ENV === 'production'`), ALL 5xx responses must return a fixed generic message. The correlation ID lets you trace the real error in logs.

---

## 18. BUILD, SCRIPTS & DEPLOYMENT

### Rule 18.1: Root package.json (Monorepo)

```json
{
  "name": "project",
  "private": true,
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

Each subdirectory has its own `package.json` and needs its own `node_modules`. Running `npm install` at root does NOT install subdirectory deps. The build script MUST install deps first:

```bash
# ✅ CORRECT — Install ALL subdirectory deps FIRST
npm run install:all  # installs client/ and server/ node_modules
npm run build        # builds with deps available
npm start            # runs built code

# ❌ WRONG — Missing subdirectory install
npm run build        # ❌ vite not found! client deps missing
```

Without this, builds fail with "vite: not found" or similar.

### Rule 18.3: npm --prefix Syntax

```bash
# ❌ WRONG
npm run build --prefix server

# ✅ CORRECT — --prefix BEFORE subcommand
npm --prefix server run build
```

### Rule 18.4: Database Migrations

- Migrations MUST be idempotent (`CREATE TABLE IF NOT EXISTS`)
- Use the `pg` library Node.js migration runner — `psql` is NOT available on Replit
- Migrations should run as part of the deployment build step (after compilation), not as part of the server startup command
- Migration scripts can use `process.exit()` since they run in their own process

Migration path with `rootDir: ".."`:
```typescript
const migrationsDir = path.join(process.cwd(), 'server', 'migrations');
```

### Rule 18.5: PostgreSQL Column Types

Use `JSONB` columns when storing JSON data, not `TEXT[]`:

```sql
-- ❌ TEXT[] expects PostgreSQL array literals
tech_stack TEXT[] DEFAULT '{}'

-- ✅ JSONB accepts JSON.stringify() output
tech_stack JSONB DEFAULT '[]'
```

### Rule 18.6: Avoid ORDER BY RANDOM() at Scale

```sql
-- ❌ Full table scan on every call — does not scale
SELECT * FROM quotes ORDER BY RANDOM() LIMIT 1;

-- ✅ Scales to large tables
SELECT * FROM quotes
WHERE id >= (SELECT floor(random() * (SELECT MAX(id) FROM quotes))::int)
LIMIT 1;
```

### Rule 18.7: Always Guarantee Pool Client Release

```typescript
// ❌ Leaks connection if error thrown before release
const client = await pool.connect();
const result = await client.query(...);
client.release();

// ✅ Always releases
const client = await pool.connect();
try {
  return await client.query(...);
} finally {
  client.release();
}
```

### Rule 18.8: Destructive Methods Must Be Production-Guarded

Any function that deletes all records must be blocked in production and moved to a test-utilities file excluded from the production build.

```typescript
// ✅ Hard-blocked in production
static async deleteAllRecords(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('deleteAllRecords is disabled in production');
  }
  await db.query('DELETE FROM records');
}
```

### Rule 18.9: Cache External API Calls

Never make uncached calls to external APIs (YouTube, Stripe, OpenAI, etc.) on every user request.

```typescript
// Minimal in-memory cache — use Redis in production
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
NODE_ENV = "development"

[deployment]
deploymentTarget = "vm"
build = ["bash", "-c", "npm run build && npm run migrate"]
run = ["node", "server/dist/server/src/index.js"]

[[ports]]
localPort = 5000
externalPort = 80
```

**Key points:**
- `NODE_ENV = "development"` in the `[env]` section — NEVER set to `"production"` here or devDependencies are skipped
- Only ONE `[[ports]]` section
- The `[deployment]` section's `build` and `run` fields are arrays and do NOT have the `npm run` conflict described in Rule 19.3
- For WebSocket apps (Socket.io), use `deploymentTarget = "vm"` (Reserved VM) instead of autoscale

### Rule 19.2: replit.nix

```nix
{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.openssl
  ];
}
```

- Package names are tied to the nix channel. `pkgs.nodejs_20` is correct for `stable-24_05`
- Do NOT include `pkgs.postgresql` — Replit manages the database separately
- If you change the channel, verify package names still resolve

### Rule 19.3: Never Use "npm run" in .replit top-level `run` Field

Nix ships a binary also named `run`. When `.replit`'s top-level `run` field calls `npm run`, Nix intercepts it.

**Solution:** Use `bash start.sh` as the top-level `run` field:

```toml
run = "bash start.sh"
```

**Note:** This restriction ONLY applies to the top-level `run` field. The `[deployment]` section's `build` and `run` arrays are executed differently and `npm run` generally works inside them. However, if deployment failures occur with `npm run` in deployment arrays, prefer small bash scripts for deployment/build orchestration — they have proven more reliable when platform command arrays show inconsistent behavior.

### Rule 19.4: start.sh Bootstrap Script

```bash
#!/usr/bin/env bash
set -e

npm --prefix client install --include=dev
npm --prefix server install --include=dev
npm --prefix client run build
npm --prefix server run build

# Migrations (idempotent — safe to re-run)
npm run migrate 2>&1 || echo "⚠️  Migration had warnings"

node server/dist/server/src/index.js
```

**Note:** `start.sh` is used for the top-level `.replit` `run` field (development and first-run bootstrapping). In deployment, migrations run in the `[deployment] build` step instead.

On a fresh upload, `dist/` does not exist. The `run` field must build first (or use `start.sh` which builds). Never assume `dist/` exists.

### Rule 19.5: Zip Upload

When uploading `project.zip` to Replit shell, it extracts into a subfolder. Fix:
```bash
cp -r project/. . && rm -rf project
```

Remove lock files before zipping to avoid platform-specific binary mismatches:
```bash
rm -f client/package-lock.json server/package-lock.json
```

### Rule 19.6: @replit/vite-plugin-cartographer — Remove for Production

The `@replit/vite-plugin-cartographer` plugin is a dev/debugging tool only. It must not be present in production builds. Version mismatches between this plugin and Babel/AST libraries do not always surface in dev mode — a working dev environment does NOT guarantee it is safe for deployment.

If deployment fails with `"traverse is not a function"` errors from this plugin:

```typescript
// client/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // ✅ Only load cartographer in dev — never in production builds
    mode !== 'production' && (await import('@replit/vite-plugin-cartographer')).cartographer(),
  ].filter(Boolean),
}));
```

Or remove it entirely if cartographer features are not actively being used.

---

## 20. DEPLOYMENT CHECKLIST

**BEFORE EVERY DEPLOYMENT:**

#### Build & Config
```
□ Client uses Vite (NOT Create React App)
□ Vite config includes allowedHosts: true
□ index.html at client/ root (not public/)
□ Client tsconfig uses "moduleResolution": "bundler"
□ Only ONE [[ports]] section in .replit
□ Host binding is 0.0.0.0
□ NODE_ENV = "development" in dev .replit [env]
□ Root package.json install:all runs before build
□ npm --prefix syntax correct (before subcommand)
□ Build order: install → client → server
□ System utilities (fuser, killall, lsof) verified available before use in scripts
□ @replit/vite-plugin-cartographer excluded from production build
□ Compiled entry point path verified against rootDir/outDir in tsconfig.json
□ Compiled file confirmed to exist at exact path used in run command
```

#### Server Startup
```
□ Server listens IMMEDIATELY (before DB/async)
□ Health routes registered BEFORE middleware
□ Root route (/) serves React app (not API JSON)
□ Route order: health → API → static → SPA fallback
□ Third-party APIs use lazy initialization
□ No process.exit() during module load
□ Auth middleware applied ONCE per route path
```

#### Database
```
□ SSL enabled: ssl: { rejectUnauthorized: false }
□ Connection is non-fatal (server stays up if DB fails)
□ Connection has 8-second timeout
□ Pool: max: 5, min: 0
□ Migrations are idempotent (IF NOT EXISTS)
□ Missing DATABASE_URL handled gracefully
□ Migrations use Node.js runner (not psql)
```

#### Routing & Security
```
□ CORS allows all origins (Replit domains change)
□ Helmet CSP disabled or allows inline scripts
□ Static files don't block API routes
□ SPA fallback includes Cache-Control headers
□ Database-dependent routes check pool availability
□ Rate limiting applied (global + heavy-endpoint limiters)
□ Error responses return generic messages in production (no raw err.message)
□ Source maps disabled in client production build
```

#### Database
```
□ No ORDER BY RANDOM() on large tables
□ All pool client usage wrapped in try/finally
□ Destructive/test-only DB methods guarded or excluded from production build
□ External API calls cached (in-memory or Redis)
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
| "Cannot GET /" | 17.2 | Status at /api/status, root serves React |
| "npm doesn't recognize --prefix" | 18.3 | --prefix BEFORE subcommand |
| "Cannot GET /api/users" | 17.2 | API routes before static files |
| "Refused to load script... CSP" | 17.2 | Disable Helmet CSP |
| Server crashes when DB unavailable | 17.3 | Non-fatal DB connection |
| Server exits before health check | 17.4 | Never process.exit in module load |
| Migrations fail silently | 18.4 | Run migrations as separate step |
| "psql: command not found" | 18.4 | Use pg library, never psql |
| dist/index.js not found | 17.6 | Check rootDir → dist path mapping |
| Static files 404 | 17.7 | Verify path resolution context (process.cwd() vs __dirname) |
| req.user undefined in callback | 17.8 | Capture user before async |
| Nix build failure | 19.2 | Use pkgs.nodejs_20, no postgresql |
| 429 Too Many Requests in prod | 17.12 | Add express-rate-limit |
| Raw DB error in API response | 17.13 | Use generic error + correlationId |
| Source exposed in DevTools | 16.6 | Set sourcemap: false in vite build |
| Pool connection leak under load | 18.7 | Wrap client.query in try/finally |
| "traverse is not a function" at deploy | 19.6 | Remove cartographer plugin from prod build |
| "cannot be resolved" vite import at deploy | 16.7 | Use path.resolve(__dirname, ...) for vite.config imports |
| Wrong compiled entry point path | 17.6 | Check rootDir/outDir in tsconfig, verify file exists |

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

### .env.example

```
PORT=5000
HOST=0.0.0.0
NODE_ENV=development
DATABASE_URL=
JWT_SECRET=
ENCRYPTION_KEY=
ANTHROPIC_API_KEY=
```

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 24. CRA → VITE MIGRATION GUIDE

When inheriting a Create React App project for Replit deployment:

### Step 1: Install Vite
```bash
cd client
npm install --save-dev vite @vitejs/plugin-react
```

### Step 2: Create vite.config.ts
```typescript
// See Rule 16.1 for full config (proxy, allowedHosts, build outDir)
```

### Step 3: Move index.html to client root
```bash
mv public/index.html index.html
# Edit index.html — replace %PUBLIC_URL% references and add:
# <script type="module" src="/src/main.tsx"></script>
```

### Step 4: Update package.json scripts
```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

### Step 5: Remove CRA
```bash
npm uninstall react-scripts
```

### Step 6: Update tsconfig.json
```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "module": "ESNext"
  }
}
```

### Step 7: Rename entry file if needed
```bash
# If still using index.js/jsx
mv src/index.jsx src/main.tsx
# Update index.html script tag to point to /src/main.tsx
```

---

## 25. ANTI-PATTERNS — NEVER DO ON REPLIT

```bash
# ❌ MISSING SUBDIRECTORY DEPENDENCY INSTALLATION
{ "scripts": { "build": "npm --prefix client run build" } }  # vite not found!

# ❌ WRONG npm --prefix SYNTAX
npm run build --prefix server

# ❌ CREATE REACT APP
npx create-react-app client      # Incompatible with Node 20+

# ❌ EAGER THIRD-PARTY API INITIALIZATION
const shopify = shopifyApi({ apiKey: process.env.KEY });  # Crashes if key missing

# ❌ BLOCKING SERVER STARTUP
const pool = await connectDB();  # Server never starts if DB is slow/down
app.listen(PORT);

# ❌ CALLING process.exit() IN MODULE LOAD PATH
if (!process.env.JWT_SECRET) process.exit(1);  # Kills server before health check

# ❌ LOCALHOST BINDING
app.listen(PORT, 'localhost');   # Container inaccessible from outside

# ❌ MULTIPLE [[ports]] SECTIONS
[[ports]]
localPort = 5000
[[ports]]
localPort = 3000   # Deployment fails

# ❌ DB CONNECTION WITHOUT SSL
new Pool({ connectionString: url })  # Replit PostgreSQL requires SSL

# ❌ psql FOR MIGRATIONS
psql $DATABASE_URL -f migration.sql  # psql not available on Replit

# ❌ NODE_ENV=production IN DEVELOPMENT .replit
NODE_ENV = "production"   # Skips devDependencies — tsx, vite, typescript not found

# ❌ ROOT ROUTE RETURNING API JSON
app.get('/', (req, res) => res.json({ status: 'ok' }));  # React app never loads

# ⚠️ SYSTEM UTILITIES — VERIFY BEFORE USE
fuser -k 5000/tcp / killall node / lsof -ti:5000   # May not be available on all Replit environments — verify first, prefer portable approaches

# ❌ HARDCODED REPLIT DOMAIN IN CORS
cors({ origin: 'https://myapp.user.repl.co' })  # Breaks on every redeploy

# ❌ DEFAULT HELMET (blocks React inline scripts)
app.use(helmet());  # Use helmet({ contentSecurityPolicy: false })

# ❌ MOCK/SYNTHETIC BUSINESS DATA IN CODE
Math.random() as business data / hardcoded placeholder business values / fallback data structures pretending to be real

# ❌ HARDCODED SECRETS IN SOURCE FILES
DB_PASSWORD: postgres / apiKey: "sk-hardcoded" / JWT_SECRET: "mysecret"

# ❌ RAW ERROR MESSAGES TO CLIENT
res.status(500).json({ detail: err.message })  // leaks DB internals

# ❌ SOURCE MAPS ENABLED IN PRODUCTION BUILD
build: { sourcemap: true }  // exposes full TypeScript source in DevTools

# ❌ NO RATE LIMITING ON API ROUTES
// Any public API with no rate limiting is an open DoS vector

# ❌ ORDER BY RANDOM() ON LARGE TABLES
SELECT * FROM table ORDER BY RANDOM() LIMIT 1  // full table scan every call

# ❌ POOL CLIENT WITHOUT try/finally
const client = await pool.connect();
await client.query(...);  // if this throws, connection leaks forever
client.release();

# ❌ UNCACHED EXTERNAL API CALLS ON EVERY REQUEST
const result = await youtubeApi.search(query);  // no cache = rate limit / latency spike

# ❌ cd CHAINING BETWEEN SUBDIRECTORY BUILDS
cd client && npm run build && cd .. && cd server && npm run build  # breaks on path errors

# ✅ CORRECT
npm --prefix client run build && npm --prefix server run build

# ❌ @replit/vite-plugin-cartographer IN PRODUCTION BUILD
plugins: [react(), cartographer()]  // "traverse is not a function" at deploy time
```

---

**END OF MASTER GUIDEBOOK**
