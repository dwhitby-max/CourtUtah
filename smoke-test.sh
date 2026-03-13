#!/usr/bin/env bash
# ============================================================
# SMOKE TEST — Utah Court Calendar Tracker
# Run after deploying to Replit to verify everything works.
#
# Usage:
#   bash smoke-test.sh                     # defaults to http://localhost:5000
#   bash smoke-test.sh https://yourapp.repl.co  # test against deployed URL
# ============================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:5000}"
PASS=0
FAIL=0
WARN=0

green() { echo -e "\033[32m✅ $1\033[0m"; }
red()   { echo -e "\033[31m❌ $1\033[0m"; }
yellow(){ echo -e "\033[33m⚠️  $1\033[0m"; }

check() {
  local desc="$1" url="$2" expect="$3"
  local status body
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  body=$(curl -s "$url" 2>/dev/null || echo "")

  if [ "$status" = "$expect" ]; then
    green "$desc (HTTP $status)"
    PASS=$((PASS + 1))
  else
    red "$desc — expected HTTP $expect, got $status"
    FAIL=$((FAIL + 1))
  fi
}

check_contains() {
  local desc="$1" url="$2" needle="$3"
  local body
  body=$(curl -s "$url" 2>/dev/null || echo "")

  if echo "$body" | grep -qi "$needle"; then
    green "$desc (contains '$needle')"
    PASS=$((PASS + 1))
  else
    red "$desc — response missing '$needle'"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "🔍 Smoke Testing: $BASE_URL"
echo "================================================"

# --- Health ---
echo ""
echo "📡 Health & Status"
check "GET /health" "$BASE_URL/health" "200"
check_contains "Health returns JSON status" "$BASE_URL/health" '"status"'
check "GET /api/status" "$BASE_URL/api/status" "200"

# --- Security Headers ---
echo ""
echo "🔒 Security"
headers=$(curl -s -I "$BASE_URL/health" 2>/dev/null || echo "")
if echo "$headers" | grep -qi "x-content-type-options"; then
  green "Helmet security headers present"
  PASS=$((PASS + 1))
else
  red "Missing Helmet security headers"
  FAIL=$((FAIL + 1))
fi

if echo "$headers" | grep -qi "x-correlation-id"; then
  green "Correlation ID header present"
  PASS=$((PASS + 1))
else
  yellow "Correlation ID not on /health (expected — health is before requestLogger)"
  WARN=$((WARN + 1))
fi

# --- Auth gates ---
echo ""
echo "🔐 Auth Protection"
check "GET /api/search without token → 401" "$BASE_URL/api/search?defendant_name=test" "401"
check "GET /api/watched-cases without token → 401" "$BASE_URL/api/watched-cases" "401"
check "GET /api/notifications without token → 401" "$BASE_URL/api/notifications" "401"
check "GET /api/calendar/connections without token → 401" "$BASE_URL/api/calendar/connections" "401"
check "GET /api/admin/scrape-jobs without token → 401" "$BASE_URL/api/admin/scrape-jobs" "401"

# --- Auth validation ---
echo ""
echo "📝 Auth Input Validation"
register_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"","password":"short"}' 2>/dev/null || echo "000")
if [ "$register_status" = "400" ] || [ "$register_status" = "503" ]; then
  green "POST /api/auth/register validates input (HTTP $register_status)"
  PASS=$((PASS + 1))
else
  red "POST /api/auth/register unexpected status: $register_status"
  FAIL=$((FAIL + 1))
fi

# --- Rate Limiting ---
echo ""
echo "⏱️  Rate Limiting"
rate_headers=$(curl -s -I -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123456"}' 2>/dev/null || echo "")
if echo "$rate_headers" | grep -qi "ratelimit-limit"; then
  green "Rate limit headers present on auth routes"
  PASS=$((PASS + 1))
else
  yellow "Rate limit headers not visible (may be behind proxy)"
  WARN=$((WARN + 1))
fi

# --- SPA Fallback ---
echo ""
echo "🌐 SPA & Static Files"
spa_status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/some-random-path" 2>/dev/null || echo "000")
if [ "$spa_status" = "200" ]; then
  green "SPA fallback returns 200 for unknown paths"
  PASS=$((PASS + 1))
else
  yellow "SPA fallback returned $spa_status (client may not be built yet)"
  WARN=$((WARN + 1))
fi

# --- Database (if configured) ---
echo ""
echo "💾 Database"
health_body=$(curl -s "$BASE_URL/health" 2>/dev/null || echo "")
if echo "$health_body" | grep -qi '"db"'; then
  if echo "$health_body" | grep -qi '"connected"'; then
    green "Database connected"
    PASS=$((PASS + 1))
  else
    yellow "Database not connected (check DATABASE_URL)"
    WARN=$((WARN + 1))
  fi
else
  yellow "Health doesn't report DB status"
  WARN=$((WARN + 1))
fi

# --- Pool Stats ---
if echo "$health_body" | grep -qi '"poolStats"'; then
  green "Pool stats in health response"
  PASS=$((PASS + 1))
else
  yellow "Pool stats not in health response (DB may not be connected)"
  WARN=$((WARN + 1))
fi

# --- Summary ---
echo ""
echo "================================================"
TOTAL=$((PASS + FAIL + WARN))
echo "Results: $PASS passed, $FAIL failed, $WARN warnings (out of $TOTAL checks)"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  red "SMOKE TEST FAILED — $FAIL issue(s) need attention"
  exit 1
else
  echo ""
  green "SMOKE TEST PASSED"
  exit 0
fi
