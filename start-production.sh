#!/usr/bin/env bash
set -e

export NODE_ENV=production

echo "=== Starting production server ==="
echo "CWD: $(pwd)"
echo "Node: $(node --version)"

if [ ! -f "client/build/index.html" ]; then
  echo "client/build/index.html not found! Running build..."
  bash build.sh
fi

if [ ! -f "server/dist/server/src/index.js" ]; then
  echo "server/dist/server/src/index.js not found! Running build..."
  bash build.sh
fi

echo "Build artifacts verified"

echo "Environment check:"
echo "  NODE_ENV: $NODE_ENV"
echo "  GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:+OK}"
echo "  GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:+OK}"
echo "  GOOGLE_REDIRECT_URI: $GOOGLE_REDIRECT_URI"
echo "  DATABASE_URL: ${DATABASE_URL:+OK}"

npm run migrate 2>&1 || echo "Migration had warnings"

exec node server/dist/server/src/index.js
