#!/usr/bin/env bash
set -e

npm --prefix client install --include=dev 2>&1
npm --prefix server install --include=dev 2>&1
npm --prefix client run build 2>&1
npm --prefix server run build 2>&1

npm run migrate 2>&1 || echo "Migration had warnings"

exec node server/dist/server/src/index.js
