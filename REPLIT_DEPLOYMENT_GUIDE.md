# Replit App Development & Deployment Guide for AI LLMs

> A complete, general-purpose reference for any AI LLM to correctly build, structure, configure, and deploy a fully working web application on Replit. Every section is precise, example-driven, and framework-agnostic where possible.

---

## Table of Contents

1. [Replit Environment Overview](#1-replit-environment-overview)
2. [The `.replit` Configuration File](#2-the-replit-configuration-file)
3. [Project Structure Patterns](#3-project-structure-patterns)
4. [Package Management](#4-package-management)
5. [Database (PostgreSQL)](#5-database-postgresql)
6. [Environment Variables & Secrets](#6-environment-variables--secrets)
7. [Build & Run Scripts](#7-build--run-scripts)
8. [Workflows](#8-workflows)
9. [Networking & Proxy Rules](#9-networking--proxy-rules)
10. [Deployment](#10-deployment)
11. [Post-Merge Hooks](#11-post-merge-hooks)
12. [Common Pitfalls & Debugging](#12-common-pitfalls--debugging)
13. [Framework-Specific Examples](#13-framework-specific-examples)
14. [Step-by-Step Checklist](#14-step-by-step-checklist)

---

## 1. Replit Environment Overview

Replit runs a **Linux container** based on **NixOS**. Key characteristics:

- **Nix-based environment — avoid Docker and virtual environments.** Replit runs inside its own container infrastructure and uses Nix for system-level packages. Do not create Dockerfiles, and avoid `venv`/`conda` unless you have a specific reason — the Nix environment provides Python, Node, etc. directly.
- **Single machine.** Dev and deployed (production) environments are separate containers, but each is a single machine — not a cluster.
- **Proxied access.** Users see your app through an **iframe proxy**. They never hit `localhost` directly. In development, the public URL is available as `$REPLIT_DEV_DOMAIN` (format: `*.replit.dev`). In production deployments, use `$REPLIT_DOMAINS` instead.
- **Persistent filesystem.** Files persist across restarts. `/tmp` does not persist across deployments.
- **Modules** are Replit's term for language runtimes/toolchains (e.g., `nodejs-20`, `python-3.11`, `postgresql-16`).

---

## 2. The `.replit` Configuration File

The `.replit` file is the **single source of truth** for how Replit runs your project. It uses TOML syntax.

### Full Annotated Example

```toml
# ─── Language Runtimes ───────────────────────────────────────────────
# Install Node.js 20 and PostgreSQL 16 into the Nix environment.
# Available modules: nodejs-20, python-3.11, postgresql-16, etc.
modules = ["nodejs-20", "postgresql-16"]

# ─── Default Run Command ─────────────────────────────────────────────
# Executed when the user clicks "Run" in the IDE.
run = "bash start.sh"

# ─── Entrypoint ──────────────────────────────────────────────────────
# The primary source file (for IDE display purposes, not execution).
entrypoint = "server/src/index.ts"

# ─── Nix Channel ─────────────────────────────────────────────────────
[nix]
channel = "stable-24_05"

# ─── Environment Variables (non-secret) ──────────────────────────────
# These are available in BOTH dev and production.
# NEVER put secrets (API keys, passwords) here — use Replit Secrets instead.
[env]
PORT = "5000"
HOST = "0.0.0.0"
NODE_ENV = "development"

# ─── Deployment Configuration ────────────────────────────────────────
[deployment]
deploymentTarget = "vm"                    # Options: "vm", "autoscale", "static", "scheduled"
build = ["bash", "build.sh"]              # Runs ONCE during deploy build phase
run = ["bash", "start-production.sh"]     # Runs CONTINUOUSLY in production

# ─── Port Mapping ────────────────────────────────────────────────────
# Maps your internal port to the external port the proxy exposes.
[[ports]]
localPort = 5000
externalPort = 80

# ─── Workflows ────────────────────────────────────────────────────────
[workflows]
runButton = "Project"

[[workflows.workflow]]
name = "Project"
mode = "parallel"
author = "agent"

[[workflows.workflow.tasks]]
task = "workflow.run"
args = "Start application"

[[workflows.workflow]]
name = "Start application"
author = "agent"

[workflows.workflow.metadata]
outputType = "webview"

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "bash start.sh"
waitForPort = 5000

# ─── Post-Merge Hook ─────────────────────────────────────────────────
# Runs automatically after code merges from task agents.
[postMerge]
path = "scripts/post-merge.sh"
timeoutMs = 180000
```

### Key Rules

| Field | Purpose | Required |
|-------|---------|----------|
| `modules` | Language runtimes to install | Yes |
| `run` | Dev run command | Yes |
| `entrypoint` | Primary source file (IDE display only) | No (optional when `run` is set) |
| `[env]` | Non-secret env vars | No |
| `[deployment]` | Production config | For deployment |
| `[[ports]]` | Port mapping | Yes (for web apps) |
| `[postMerge]` | Post-merge script | No |

---

## 3. Project Structure Patterns

### Pattern A: Monorepo (Client + Server + Shared Types)

Best for full-stack TypeScript apps. Most common pattern.

```
project-root/
├── .replit                    # Replit config
├── package.json               # Root: orchestration scripts only
├── start.sh                   # Dev startup script
├── build.sh                   # Deployment build script
├── start-production.sh        # Production run script
├── replit.md                  # Project documentation (always loaded by agent)
├── client/                    # Frontend (React, Vue, etc.)
│   ├── package.json           # Client dependencies
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── api/               # API client modules
│   │   └── store/             # State management
│   └── public/                # Static assets
├── server/                    # Backend (Express, Fastify, etc.)
│   ├── package.json           # Server dependencies
│   ├── tsconfig.json
│   ├── migrations/            # SQL migration files (numbered)
│   └── src/
│       ├── index.ts           # Entry point
│       ├── app.ts             # Express app setup
│       ├── config/            # Environment config
│       ├── db/                # Database pool & migration runner
│       ├── middleware/        # Auth, rate limiting, logging
│       ├── routes/            # API route handlers
│       └── services/          # Business logic
├── shared/                    # Shared TypeScript types
│   └── types.ts
└── scripts/
    └── post-merge.sh          # Post-merge hook
```

**Root `package.json`** — Contains only orchestration scripts, NOT application dependencies:

```json
{
  "name": "my-app",
  "private": true,
  "scripts": {
    "install:all": "npm --prefix client install --include=dev && npm --prefix server install --include=dev",
    "build:client": "npm --prefix client run build",
    "build:server": "npm --prefix server run build",
    "build": "npm install --include=dev && npm run install:all && npm run build:client && npm run build:server",
    "start": "node server/dist/server/src/index.js",
    "migrate": "node server/dist/server/src/db/migrate.js"
  }
}
```

### Pattern B: Single-App (API only or SSR)

For simpler apps without a separate frontend build step.

```
project-root/
├── .replit
├── package.json               # All dependencies here
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── routes/
│   └── services/
└── public/                    # Static files (if any)
```

### Pattern C: Static Site

For sites with no backend (static HTML/CSS/JS or a static site generator).

```
project-root/
├── .replit
├── package.json
├── dist/                      # Built output (served directly)
└── src/                       # Source files
```

`.replit` for static:
```toml
[deployment]
deploymentTarget = "static"
build = ["npm", "run", "build"]
publicDir = "dist"
```

### Shared Types in Monorepo

When server and client share TypeScript types, use a `shared/` directory at the project root.

**Server `tsconfig.json`** — Must set `rootDir: ".."` to include shared:
```json
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
    "resolveJsonModule": true,
    "paths": {
      "@shared/*": ["../../shared/*"]
    }
  },
  "include": ["src/**/*", "../shared/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**CRITICAL:** When `rootDir` is `".."`, the compiled output path mirrors the source structure:
```
server/dist/server/src/index.js    (NOT server/dist/src/index.js)
server/dist/shared/types.js
```
All `node` commands must use the full path: `node server/dist/server/src/index.js`

**Client `vite.config.ts`** — Use path aliases:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

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
      "/api": { target: "http://localhost:5000", changeOrigin: true },
      "/socket.io": { target: "http://localhost:5000", changeOrigin: true, ws: true },
    },
    host: true,
    allowedHosts: true,
  },
  build: {
    outDir: "build",
    sourcemap: false,
  },
});
```

---

## 4. Package Management

### Rules

1. **Use `npm` by default.** Replit supports npm, yarn, and pnpm. Use whichever the project already has.
2. **Always use `--include=dev`** when installing in dev/build contexts. Dev dependencies (TypeScript, Vite, build tools) are needed for compilation.
3. **Never use global installs** (`npm install -g`). Install locally.
4. **System dependencies** (ffmpeg, imagemagick, etc.) are installed via Nix modules, not `apt` or `brew`.

### Monorepo Install Pattern

```bash
# Root dependencies (orchestration tools)
npm install --include=dev

# Client dependencies
npm --prefix client install --include=dev

# Server dependencies
npm --prefix server install --include=dev
```

### Common Modules

Add to the `modules` array in `.replit`:

| Module | Purpose |
|--------|---------|
| `nodejs-20` | Node.js 20 runtime + npm |
| `python-3.11` | Python 3.11 + pip |
| `postgresql-16` | PostgreSQL 16 server + client |
| `bun-1.1` | Bun runtime |

---

## 5. Database (PostgreSQL)

### Provisioning

Replit provides a **built-in PostgreSQL** database. When provisioned:
- `DATABASE_URL` is **automatically set** as a runtime-managed environment variable
- Additional vars like `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` may also be set

### CRITICAL Rules

1. **NEVER add `DATABASE_URL` to Replit Secrets manually.** It is auto-managed. Adding it to Secrets causes deployment failures with "External database detected" warnings.
2. **Dev uses `sslmode=disable`** (local PostgreSQL). Production uses SSL — use `rejectUnauthorized: false` as a compatibility fallback since Replit's platform-managed certs may not be in the default CA bundle. Prefer verified TLS if you can supply the CA cert.
3. **NEVER change primary key column types** in migrations. Converting `serial` to `varchar` or vice versa generates destructive `ALTER TABLE` statements.

### Connection Pool Pattern (Node.js / `pg`)

```typescript
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.warn("DATABASE_URL not set — database features unavailable");
}

// Replit's dev PostgreSQL uses sslmode=disable (local socket).
// Replit's production PostgreSQL uses SSL, but with platform-managed certs
// that may not be in the default CA bundle — rejectUnauthorized: false is
// the standard compatibility fallback on Replit. If you can verify the CA,
// prefer { rejectUnauthorized: true, ca: ... } instead.
const sslDisabled = databaseUrl?.includes("sslmode=disable");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
  max: 5,
  min: 0,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});
```

### Connection Pool Pattern (Python / `psycopg2`)

```python
import os
import psycopg2
from psycopg2.pool import SimpleConnectionPool

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set")

pool = SimpleConnectionPool(
    minconn=1,
    maxconn=5,
    dsn=DATABASE_URL,
    connect_timeout=8,
    sslmode="prefer"
)
```

### Migration Pattern

Use a **numbered sequential migration system** with a tracking table:

```
server/migrations/
├── 001_users.sql
├── 002_sessions.sql
├── 003_posts.sql
└── 004_add_index.sql
```

**Migration runner** (Node.js example):

```typescript
import { Pool } from "pg";
import fs from "fs";
import path from "path";

async function runMigrations(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  const client = await pool.connect();
  try {
    // Create tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Get already-executed migrations
    const executed = await client.query("SELECT filename FROM schema_migrations");
    const executedSet = new Set(executed.rows.map((r) => r.filename));

    // Find migration files
    const migrationsDir = path.resolve(process.cwd(), "server", "migrations");
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (executedSet.has(file)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error("Migration failed (non-fatal):", err.message);
});
```

### Migration Rules

1. **Migrations are idempotent** — use `IF NOT EXISTS`, `IF EXISTS` guards
2. **Never modify an already-deployed migration** — create a new one instead
3. **Run migrations at startup** — both dev (`start.sh`) and production (`start-production.sh`)
4. **Non-fatal failures** — if a migration fails, log the error but let the server start anyway
5. **Production is read-only** from the dev environment — schema changes must go through migrations + deployment

### Migration Path Resolution

When using a monorepo with `rootDir: ".."` in tsconfig, the compiled migration runner ends up at `server/dist/server/src/db/migrate.js`. Use multiple candidate paths to find the migrations directory:

```typescript
const candidates = [
  path.resolve(__dirname, "..", "..", "..", "..", "migrations"),
  path.resolve(__dirname, "..", "..", "..", "migrations"),
  path.resolve(process.cwd(), "migrations"),
  path.resolve(process.cwd(), "server", "migrations"),
];
const migrationsDir = candidates.find((dir) => fs.existsSync(dir));
```

---

## 6. Environment Variables & Secrets

### Three Scopes

| Scope | Where Available | Set How |
|-------|----------------|---------|
| **shared** | Dev + Production | Replit Secrets UI or API |
| **development** | Dev only | Replit Secrets UI or API |
| **production** | Production only | Replit Secrets UI or API |

### Non-Secret Variables

Set non-secret config in `.replit` under `[env]`:

```toml
[env]
PORT = "5000"
HOST = "0.0.0.0"
NODE_ENV = "development"
```

These are available in both dev and production.

### Secrets

Secrets (API keys, tokens, passwords) are managed through the **Replit Secrets system** — never hardcode them in source files or `.replit`.

**Rules:**
1. **Never `console.log` secret values** — only log presence: `console.log("API_KEY:", process.env.API_KEY ? "OK" : "MISSING")`
2. **Never commit secrets** to version control
3. **Use `shared` scope** unless the value differs between dev and prod
4. **Runtime-managed vars** (`DATABASE_URL`, `REPLIT_DEV_DOMAIN`, `REPL_ID`) — do NOT manually set these

### Reading Environment Variables in Code

```typescript
// Node.js
const config = {
  port: parseInt(process.env.PORT || "5000"),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
};
```

```python
# Python
import os

PORT = int(os.environ.get("PORT", 5000))
HOST = os.environ.get("HOST", "0.0.0.0")
DATABASE_URL = os.environ.get("DATABASE_URL")
JWT_SECRET = os.environ.get("JWT_SECRET")
```

---

## 7. Build & Run Scripts

Replit uses **shell scripts** to orchestrate the build and run process. There are four key scripts:

### 7.1 `start.sh` — Development Startup

Used by the workflow. Installs deps, builds, migrates, and starts the server.

```bash
#!/usr/bin/env bash
set -e

echo "=== Installing dependencies ==="
npm install --include=dev
npm --prefix client install --include=dev
npm --prefix server install --include=dev

echo "=== Building client ==="
npm --prefix client run build

echo "=== Building server ==="
npm --prefix server run build

echo "=== Running migrations ==="
npm run migrate 2>&1 || echo "Migration had warnings"

echo "=== Verifying build artifacts ==="
ls -la client/build/index.html server/dist/server/src/index.js

echo "=== Starting server ==="
exec node server/dist/server/src/index.js
```

### 7.2 `build.sh` — Deployment Build Phase

Runs ONCE during the deployment build step. Does NOT start the server.

```bash
#!/usr/bin/env bash
set -e

echo "=== Installing dependencies ==="
npm install --include=dev
cd client && npm install --include=dev && cd ..
cd server && npm install --include=dev && cd ..

echo "=== Building client ==="
cd client && npm run build && cd ..

echo "=== Building server (clean) ==="
rm -rf server/dist
cd server && npm run build && cd ..

echo "=== Build complete ==="
ls -la client/build/index.html server/dist/server/src/index.js
```

### 7.3 `start-production.sh` — Deployment Run Phase

Runs CONTINUOUSLY in production. Sets `NODE_ENV=production`, verifies artifacts, runs migrations, starts server.

```bash
#!/usr/bin/env bash
set -e

export NODE_ENV=production

echo "=== Starting production server ==="

# Safety: rebuild if artifacts are missing
if [ ! -f "client/build/index.html" ]; then
  echo "Client build missing! Running build..."
  bash build.sh
fi

if [ ! -f "server/dist/server/src/index.js" ]; then
  echo "Server build missing! Running build..."
  bash build.sh
fi

# Run migrations
npm run migrate 2>&1 || echo "Migration had warnings"

# Start with exec (replaces shell process, proper signal handling)
exec node server/dist/server/src/index.js
```

### 7.4 `scripts/post-merge.sh` — Post-Merge Hook

Runs automatically after task agent code is merged. Rebuilds everything.

```bash
#!/usr/bin/env bash
set -e

echo "=== Post-merge setup ==="

npm install --no-audit --no-fund < /dev/null
cd client && npm install --no-audit --no-fund < /dev/null && cd ..
cd server && npm install --no-audit --no-fund < /dev/null && cd ..

cd client && npm run build && cd ..

rm -rf server/dist
cd server && npm run build && cd ..

npm run migrate 2>&1 || echo "Migration had warnings"

echo "=== Post-merge setup complete ==="
```

### Key Rules for Scripts

1. **Always use `set -e`** — stop on first error
2. **Use `exec`** for the final command — replaces the shell process, enables proper signal handling (SIGTERM)
3. **Use `--include=dev`** — dev dependencies are needed for TypeScript compilation, Vite builds, etc.
4. **Non-fatal migrations** — pipe stderr and use `|| echo` to prevent migration failures from killing the app
5. **Verify artifacts** — check that expected build outputs exist before starting
6. **Post-merge: use `< /dev/null`** — prevents npm install from hanging on stdin prompts

### How Scripts Connect to `.replit`

```
start.sh              → [workflows] → "Start application" workflow → dev environment
build.sh              → [deployment] build → runs once during deploy
start-production.sh   → [deployment] run → runs continuously in production
post-merge.sh         → [postMerge] path → runs after task merges
```

---

## 8. Workflows

Workflows bind shell commands to long-running tasks managed by Replit. They are defined in `.replit`.

### Rules

1. **One workflow per project** is usually sufficient
2. **Workflows run until stopped** — they are for persistent processes (web servers, watchers)
3. **Restart after code changes** — workflows must be restarted to pick up server-side changes
4. **Use `waitForPort`** — tells Replit which port to wait for before showing the preview

### Minimal Workflow Config

```toml
[workflows]
runButton = "Project"

[[workflows.workflow]]
name = "Start application"
author = "agent"

[workflows.workflow.metadata]
outputType = "webview"

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "bash start.sh"
waitForPort = 5000
```

### Important

- The `outputType = "webview"` metadata tells Replit to show the preview pane
- `waitForPort = 5000` — Replit waits for your server to bind before showing the preview
- If users can't see the app, restart the workflow first

---

## 9. Networking & Proxy Rules

### How the Replit Proxy Works

```
User Browser → Replit Proxy (iframe) → Your Server (0.0.0.0:5000)
                                       ↓
                             externalPort: 80 → localPort: 5000
```

Users NEVER access `localhost` directly. All requests go through Replit's proxy.

### Critical Networking Rules

#### 1. Bind to `0.0.0.0`, NOT `localhost`

```typescript
// CORRECT
app.listen(5000, "0.0.0.0", () => { ... });

// WRONG — won't be accessible through proxy
app.listen(5000, "127.0.0.1", () => { ... });
app.listen(5000, "localhost", () => { ... });
```

```python
# CORRECT
app.run(host="0.0.0.0", port=5000)

# WRONG
app.run(host="127.0.0.1", port=5000)
```

#### 2. Use Port 5000

The standard port for Replit web apps is 5000. Map it in `.replit`:

```toml
[[ports]]
localPort = 5000
externalPort = 80
```

#### 3. Allow All Hosts (Dev Servers)

Because the proxy forwards from a different origin, dev servers must allow all hosts:

**Vite:**
```typescript
server: {
  host: true,
  allowedHosts: true,
}
```

**Webpack:**
```javascript
devServer: {
  allowedHosts: "all",
}
```

**Angular:**
```bash
ng serve --host 0.0.0.0 --allowed-hosts all
```

#### 4. Trust the Proxy (Express)

For rate limiting and IP detection behind Replit's proxy:

```typescript
app.set("trust proxy", 1);
```

Without this, `req.ip` returns the proxy's IP, not the user's.

#### 5. Use Relative URLs in Frontend Code

```typescript
// CORRECT — works in both dev and production
fetch("/api/users")

// WRONG — breaks in production
fetch("http://localhost:5000/api/users")
```

#### 6. Use the Correct Domain Environment Variable

Replit provides different domain variables for dev vs production:

| Variable | Available In | Format | Example |
|----------|-------------|--------|---------|
| `REPLIT_DEV_DOMAIN` | Development only | `*.replit.dev` | `your-project-your-username.replit.dev` |
| `REPLIT_DOMAINS` | Production only | `*.replit.app` (or custom domain) | `your-app.replit.app` |

In code (e.g., for OAuth callbacks):
```typescript
const baseUrl = process.env.NODE_ENV === "production"
  ? `https://${process.env.REPLIT_DOMAINS?.split(",")[0] || "your-app.replit.app"}`
  : `https://${process.env.REPLIT_DEV_DOMAIN}`;
```

---

## 10. Deployment

### Deployment Targets

| Target | Use Case | Config |
|--------|----------|--------|
| **`vm`** | Full-stack apps with backend (Express, Flask, etc.) | `build` + `run` commands |
| **`autoscale`** | Stateless HTTP APIs that need auto-scaling | `build` + `run` commands |
| **`static`** | Frontend-only (React, Vue builds, static HTML) | `build` + `publicDir` |
| **`scheduled`** | Cron jobs, periodic tasks | `build` + `run` commands |

### VM Deployment (Most Common)

```toml
[deployment]
deploymentTarget = "vm"
build = ["bash", "build.sh"]
run = ["bash", "start-production.sh"]
```

- **`build`** runs once, creating compiled artifacts
- **`run`** starts the production server continuously
- The VM stays running 24/7

### Autoscale Deployment

```toml
[deployment]
deploymentTarget = "autoscale"
run = ["bash", "start-production.sh"]
build = ["bash", "build.sh"]
```

- Scales up/down based on traffic
- Must be stateless (no in-memory sessions)
- Best for pure REST APIs

### Static Deployment

```toml
[deployment]
deploymentTarget = "static"
build = ["npm", "run", "build"]
publicDir = "dist"
```

- No server process — Replit serves static files directly
- `publicDir` points to the build output directory

### Health Checks

For `vm` and `autoscale`, implement a health endpoint:

```typescript
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});
```

### Deployment Flow

```
1. User clicks "Publish"
2. Replit runs build command (build.sh)
3. Replit snapshots the filesystem
4. Replit starts run command (start-production.sh) in production container
5. Production container gets its own DATABASE_URL (separate from dev)
6. App is live at your-app.replit.app
```

### Dev vs Production Differences

| Aspect | Development | Production |
|--------|-------------|------------|
| `NODE_ENV` | `development` | `production` |
| Database | Dev PostgreSQL | Production PostgreSQL (separate) |
| `DATABASE_URL` | Auto-set (dev) | Auto-set (prod, different instance) |
| Domain env var | `REPLIT_DEV_DOMAIN` (*.replit.dev) | `REPLIT_DOMAINS` (*.replit.app or custom) |
| DB SSL | `sslmode=disable` (local) | SSL enabled |
| Secrets access | All scopes | `shared` + `production` only |

---

## 11. Post-Merge Hooks

When using Replit's task agents (isolated environments that merge back), you need a post-merge script to reconcile the environment.

### Configuration

```toml
[postMerge]
path = "scripts/post-merge.sh"
timeoutMs = 180000
```

### What It Must Do

1. Install any new dependencies added by the merged code
2. Rebuild client and server
3. Run new migrations

### Key Rules

- **Use `< /dev/null`** after npm install to prevent stdin hangs
- **Use `--no-audit --no-fund`** for faster installs
- **Set timeout high enough** (180000ms = 3 minutes) for full rebuilds
- **Clean dist before rebuild** (`rm -rf server/dist`) to avoid stale artifacts

---

## 12. Common Pitfalls & Debugging

### Pitfall 1: App Not Visible in Preview

**Symptom:** Blank preview pane or "can't connect" error.

**Fixes:**
1. Ensure server binds to `0.0.0.0:5000`, not `localhost:5000`
2. Add `allowedHosts: true` to Vite/webpack dev config
3. Restart the workflow after code changes
4. Check port mapping in `.replit`: `localPort = 5000, externalPort = 80`

### Pitfall 2: `DATABASE_URL` in Secrets Breaks Deployment

**Symptom:** Deployment fails with "External database detected" warning.

**Fix:** Remove `DATABASE_URL` from Replit Secrets. It is auto-managed by Replit.

### Pitfall 3: Wrong Compiled Path in TypeScript Monorepo

**Symptom:** `Cannot find module 'server/dist/src/index.js'`

**Cause:** When `rootDir: ".."` is set in server's `tsconfig.json`, TypeScript mirrors the full source path in the output.

**Fix:** Use the full path:
```bash
# With rootDir: ".."
node server/dist/server/src/index.js

# NOT
node server/dist/src/index.js
```

### Pitfall 4: `express-async-errors` Import Order

**Symptom:** Unhandled promise rejections crash the server.

**Fix:** Import `express-async-errors` BEFORE `express`:
```typescript
import "express-async-errors";  // MUST be first
import express from "express";
```

### Pitfall 5: Stale Build Artifacts

**Symptom:** Code changes don't take effect after rebuild.

**Fix:** Clean the dist directory before building:
```bash
rm -rf server/dist
cd server && npm run build && cd ..
```

### Pitfall 6: Migration Ordering Conflicts

**Symptom:** Migration fails because a table/column already exists.

**Fix:** Use `IF NOT EXISTS` / `IF EXISTS` guards:
```sql
CREATE TABLE IF NOT EXISTS users ( ... );
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
```

### Pitfall 7: Rate Limiter Returns Proxy IP

**Symptom:** All users get rate-limited together.

**Fix:** Add `app.set("trust proxy", 1)` before rate limiter middleware.

### Pitfall 8: Dev Dependencies Not Available in Build

**Symptom:** `tsc: command not found` or `vite: command not found` during build.

**Fix:** Always use `npm install --include=dev` in build scripts.

### Pitfall 9: Process Doesn't Handle SIGTERM

**Symptom:** Deployment restarts hang or time out.

**Fix:** Use `exec` in shell scripts so the Node/Python process receives signals directly:
```bash
exec node server/dist/server/src/index.js
```

### Pitfall 10: Relative Paths Break Across Contexts

**Symptom:** File not found errors that work in dev but fail in production.

**Fix:** Use `process.cwd()` for project-root-relative paths, not `__dirname`:
```typescript
const staticDir = path.join(process.cwd(), "client", "build");
```

---

## 13. Framework-Specific Examples

### Node.js + Express + React (Vite) — Full Stack

**Server entry (Express):**
```typescript
import "express-async-errors";
import express from "express";
import path from "path";
import helmet from "helmet";
import cors from "cors";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors());
app.use(express.json());

// API routes
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("/api/example", (req, res) => res.json({ data: "hello" }));

// Serve React build as static files
const clientBuildPath = path.join(process.cwd(), "client", "build");
app.use(express.static(clientBuildPath));

// SPA fallback — all non-API routes serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(clientBuildPath, "index.html"));
});

const PORT = parseInt(process.env.PORT || "5000");
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});
```

**Route order matters:**
1. Health check endpoint
2. Request logger middleware
3. Security middleware (helmet, cors)
4. Body parsers (express.json)
5. Rate limiting
6. API routes
7. Static file serving
8. SPA fallback
9. Error handler

### Python + Flask

**`app.py`:**
```python
import os
from flask import Flask, jsonify, send_from_directory

app = Flask(__name__, static_folder="client/build", static_url_path="")

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/api/example")
def example():
    return jsonify({"data": "hello"})

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve(path):
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
```

**`.replit`:**
```toml
modules = ["python-3.11", "nodejs-20"]
run = "python app.py"

[env]
PORT = "5000"

[deployment]
deploymentTarget = "vm"
build = ["bash", "build.sh"]
run = ["python", "app.py"]

[[ports]]
localPort = 5000
externalPort = 80
```

### Python + FastAPI

**`main.py`:**
```python
import os
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/example")
def example():
    return {"data": "hello"}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    uvicorn.run(app, host="0.0.0.0", port=port)
```

---

## 14. Step-by-Step Checklist

Follow this checklist from zero to deployed app on Replit.

### Phase 1: Project Setup

- [ ] 1. Choose project structure (monorepo, single-app, or static)
- [ ] 2. Create `.replit` with correct `modules`, `run`, and `entrypoint`
- [ ] 3. Set `[env]` variables: `PORT = "5000"`, `HOST = "0.0.0.0"`
- [ ] 4. Configure `[[ports]]`: `localPort = 5000`, `externalPort = 80`
- [ ] 5. Create `package.json` (root + per-package for monorepo)
- [ ] 6. Install dependencies with `--include=dev`

### Phase 2: Application Code

- [ ] 7. Create server entry point that binds to `0.0.0.0:5000`
- [ ] 8. Add `app.set("trust proxy", 1)` (Express) or equivalent
- [ ] 9. Implement `/health` endpoint returning `200 OK`
- [ ] 10. Add API routes under `/api/*`
- [ ] 11. Serve frontend build as static files with SPA fallback
- [ ] 12. Use relative URLs in frontend (`/api/...` not `http://localhost:5000/api/...`)

### Phase 3: Database

- [ ] 13. Add `postgresql-16` to `modules` in `.replit`
- [ ] 14. Create database connection using `DATABASE_URL` from env
- [ ] 15. Handle SSL: `sslmode=disable` check for dev, `rejectUnauthorized: false` for prod
- [ ] 16. Create numbered migration files in `server/migrations/`
- [ ] 17. Implement migration runner with `schema_migrations` tracking table
- [ ] 18. Add `npm run migrate` to scripts

### Phase 4: Dev Startup

- [ ] 19. Create `start.sh`: install → build → migrate → start
- [ ] 20. Configure workflow in `.replit` with `waitForPort = 5000`
- [ ] 21. Test: start workflow, verify preview shows the app
- [ ] 22. Verify health endpoint returns 200

### Phase 5: Frontend Dev Server (Vite/Webpack)

- [ ] 23. Add `host: true` and `allowedHosts: true` to dev server config
- [ ] 24. Configure proxy for `/api` routes to `http://localhost:5000`
- [ ] 25. Set build output directory (e.g., `outDir: "build"`)

### Phase 6: Environment & Secrets

- [ ] 26. Identify all required secrets (JWT_SECRET, API keys, etc.)
- [ ] 27. Add secrets through Replit Secrets UI (NOT in code or `.replit`)
- [ ] 28. Log secret presence at startup: `SECRET_NAME: ${val ? "OK" : "MISSING"}`
- [ ] 29. Verify: `DATABASE_URL` is NOT in Secrets (auto-managed)

### Phase 7: Deployment Prep

- [ ] 30. Create `build.sh`: install → build client → build server (no start)
- [ ] 31. Create `start-production.sh`: set NODE_ENV=production → verify artifacts → migrate → exec start
- [ ] 32. Configure `[deployment]` in `.replit`: target, build, run
- [ ] 33. Test build.sh locally: `bash build.sh`
- [ ] 34. Verify all build artifacts exist after build

### Phase 8: Deploy

- [ ] 35. Publish the app
- [ ] 36. Check deployment logs for errors
- [ ] 37. Verify production health endpoint: `https://your-app.replit.app/health`
- [ ] 38. Test core functionality in production

### Phase 9: Post-Merge (If Using Task Agents)

- [ ] 39. Create `scripts/post-merge.sh`: install → rebuild → migrate
- [ ] 40. Add `[postMerge]` to `.replit` with path and timeout
- [ ] 41. Test post-merge script: `bash scripts/post-merge.sh`

### Phase 10: Documentation

- [ ] 42. Create/update `replit.md` with project overview, structure, and running instructions
- [ ] 43. Document all environment variables (required vs optional)
- [ ] 44. Document migration numbering convention

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────┐
│  REPLIT QUICK REFERENCE                                 │
├─────────────────────────────────────────────────────────┤
│  Config file:        .replit (TOML)                     │
│  Port:               5000 (bind to 0.0.0.0)            │
│  Host:               0.0.0.0 (never localhost)          │
│  Database:           DATABASE_URL (auto-set, never      │
│                      add to Secrets manually)           │
│  Dev SSL:            sslmode=disable                    │
│  Prod SSL:           rejectUnauthorized: false          │
│                      (compatibility fallback)           │
│  Build script:       build.sh (deployment build phase)  │
│  Run script:         start-production.sh (prod run)     │
│  Dev script:         start.sh (workflow)                │
│  Post-merge:         scripts/post-merge.sh              │
│  Preview:            Via iframe proxy (not localhost)    │
│  Dev domain:         $REPLIT_DEV_DOMAIN (*.replit.dev)  │
│  Prod domain:        $REPLIT_DOMAINS (*.replit.app)     │
│  Vite must have:     allowedHosts: true, host: true     │
│  Express must have:  app.set("trust proxy", 1)          │
│  Final cmd in .sh:   exec node/python (for signals)     │
│  Avoid Docker:       Use Nix modules instead            │
│  Avoid venv:         Use system Python directly         │
└─────────────────────────────────────────────────────────┘
```
