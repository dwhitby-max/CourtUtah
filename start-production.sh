#!/usr/bin/env bash
set -e

export NODE_ENV=production

# Run migrations (non-fatal — server starts regardless)
npm run migrate 2>&1 || echo "⚠️  Migration had warnings"

# Start server
exec node server/dist/server/src/index.js
