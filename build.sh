#!/usr/bin/env bash
set -e

echo "=== Installing root dependencies ==="
npm install --include=dev

echo "=== Installing client dependencies ==="
cd client && npm install --include=dev && cd ..

echo "=== Installing server dependencies ==="
cd server && npm install --include=dev && cd ..

echo "=== Building client ==="
cd client && npm run build && cd ..

echo "=== Building server ==="
cd server && npm run build && cd ..

echo "=== Build complete ==="
ls -la client/build/index.html server/dist/server/src/index.js
