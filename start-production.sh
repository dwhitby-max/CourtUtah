#!/usr/bin/env bash
set -e

export NODE_ENV=production

echo "=== Starting production server ==="
echo "CWD: $(pwd)"
echo "Node: $(node --version)"

# Verify build artifacts exist
if [ ! -f "client/build/index.html" ]; then
  echo "❌ client/build/index.html not found! Running build..."
  bash build.sh
fi

if [ ! -f "server/dist/server/src/index.js" ]; then
  echo "❌ server/dist/server/src/index.js not found! Running build..."
  bash build.sh
fi

echo "✅ Build artifacts verified"

# Run migrations (non-fatal — server starts regardless)
npm run migrate 2>&1 || echo "⚠️  Migration had warnings"

# Start server
exec node server/dist/server/src/index.js
