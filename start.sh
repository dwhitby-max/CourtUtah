#!/usr/bin/env bash
set -e

npm --prefix client install --include=dev
npm --prefix server install --include=dev
npm --prefix client run build
npm --prefix server run build

# Migrations (idempotent — safe to re-run)
npm run migrate 2>&1 || echo "⚠️  Migration had warnings"

node server/dist/server/src/index.js
