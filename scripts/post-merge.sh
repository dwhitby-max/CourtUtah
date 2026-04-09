#!/usr/bin/env bash
set -e

echo "=== Post-merge setup ==="

echo "Installing root dependencies..."
npm install --no-audit --no-fund < /dev/null

echo "Installing client dependencies..."
cd client && npm install --no-audit --no-fund < /dev/null && cd ..

echo "Installing server dependencies..."
cd server && npm install --no-audit --no-fund < /dev/null && cd ..

echo "Building client..."
cd client && npm run build && cd ..

echo "Building server..."
rm -rf server/dist
cd server && npm run build && cd ..

echo "Running migrations..."
npm run migrate 2>&1 || echo "Migration had warnings"

echo "=== Post-merge setup complete ==="
