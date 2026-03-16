#!/usr/bin/env bash
set -e

echo "=== Installing dependencies ==="
npm install --include=dev 2>&1
npm --prefix client install --include=dev 2>&1
npm --prefix server install --include=dev 2>&1

echo "=== Building client ==="
npm --prefix client run build 2>&1

echo "=== Building server ==="
npm --prefix server run build 2>&1

echo "=== Running migrations ==="
npm run migrate 2>&1 || echo "⚠️  Migration had warnings"

echo "=== Verifying build artifacts ==="
ls -la client/build/index.html server/dist/server/src/index.js

echo "=== Starting server ==="
exec node server/dist/server/src/index.js
