#!/usr/bin/env bash
# Smoke test of the production images (docker-compose.smoke.yml): build,
# start on a throw-away database, check that migrations finish before the
# API answers, that both services are healthy and can talk, and that a
# restart does not apply any migration again. Tears everything down at the
# end, also on failure.
#
#   bash scripts/production/smoke-test.sh
#
# Needs Docker with the compose plugin. Uses no real credentials, no real
# data and no external service.
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE="docker compose -f docker-compose.smoke.yml"
API=http://127.0.0.1:14000/api
WEB=http://127.0.0.1:13000

fail() { echo "SMOKE FAILED: $*" >&2; $COMPOSE logs --no-color --tail=80 backend frontend >&2 || true; exit 1; }
cleanup() { $COMPOSE down --volumes --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null || { echo "Docker is not installed: this check cannot run here." >&2; exit 2; }

echo "1/6 building production images"
$COMPOSE build

echo "2/6 starting the stack (waits for health checks)"
$COMPOSE up -d --wait || fail "the stack did not become healthy"

echo "3/6 migrations ran, and finished before the API started"
LOGS="$($COMPOSE logs --no-color backend)"
echo "$LOGS" | grep -q "migrate: applied 0000_" || fail "no migration output on first start"
LATEST="$(ls backend/drizzle/*.sql | sort | tail -1 | xargs basename)"
echo "$LOGS" | grep -q "migrate: applied ${LATEST}" || fail "the latest migration (${LATEST}) was not applied"
LAST_MIGRATION_LINE="$(echo "$LOGS" | grep -n "migrate: applied" | tail -1 | cut -d: -f1)"
FIRST_APP_LINE="$(echo "$LOGS" | grep -n "Nest application successfully started\|backend running on" | head -1 | cut -d: -f1)"
[ -n "$FIRST_APP_LINE" ] || fail "the API never reported that it started"
[ "$LAST_MIGRATION_LINE" -lt "$FIRST_APP_LINE" ] || fail "the API started before migrations finished"
APPLIED="$($COMPOSE exec -T backend node scripts/migrate.cjs --status | grep -c '^applied')"
PENDING="$($COMPOSE exec -T backend node scripts/migrate.cjs --status | grep -c '^PENDING' || true)"
TOTAL="$(ls backend/drizzle/*.sql | wc -l | tr -d ' ')"
[ "$APPLIED" = "$TOTAL" ] && [ "$PENDING" = "0" ] || fail "applied ${APPLIED}/${TOTAL}, pending ${PENDING}"
echo "    ${APPLIED}/${TOTAL} migrations applied"

echo "4/6 health and basic connectivity"
curl -fsS "$API/health" >/dev/null || fail "backend /api/health"
curl -fsS -o /dev/null "$WEB/login" || fail "frontend /login"
# A real round trip through the API and the database: register a center,
# then read it back with the token.
SUFFIX="$(date +%s)"
REG="$(curl -fsS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"centerName\":\"Smoke ${SUFFIX}\",\"subdomain\":\"smoke-${SUFFIX}\",\"email\":\"smoke-${SUFFIX}@example.test\",\"password\":\"Smoke-pass-${SUFFIX}\",\"fullName\":\"Smoke Owner\"}")" \
  || fail "register through the API"
TOKEN="$(echo "$REG" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
[ -n "$TOKEN" ] || fail "no access token after register"
curl -fsS "$API/auth/me" -H "Authorization: Bearer $TOKEN" | grep -q "smoke-${SUFFIX}" || fail "/auth/me after register"
curl -fsS "$API/tenants/by-subdomain/smoke-${SUFFIX}" >/dev/null || fail "public center lookup (what the frontend calls)"

echo "5/6 restart: completed migrations are not applied again"
$COMPOSE restart backend >/dev/null
$COMPOSE up -d --wait backend || fail "backend did not come back healthy"
AFTER="$($COMPOSE logs --no-color backend)"
echo "$AFTER" | grep -q "migrate: database is up to date" || fail "restart did not report an up-to-date database"
[ "$(echo "$AFTER" | grep -c "migrate: applied 0000_")" = "1" ] || fail "a migration was applied twice"
[ "$(echo "$AFTER" | grep -c "migrate: applied")" = "$TOTAL" ] || fail "the number of applied migrations changed after the restart"
curl -fsS "$API/auth/me" -H "Authorization: Bearer $TOKEN" | grep -q "smoke-${SUFFIX}" || fail "data did not survive the restart"

echo "6/6 nothing external is configured"
$COMPOSE exec -T backend sh -c 'for v in ANTHROPIC_API_KEY GEMINI_API_KEY TELEGRAM_BOT_TOKEN ESKIZ_API_TOKEN PLAYMOBILE_API_TOKEN RESEND_API_KEY SMTP_HOST CLICK_SECRET_KEY PAYME_KEY SENTRY_DSN; do eval "x=\${$v:-}"; [ -z "$x" ] || { echo "$v is set"; exit 1; }; done' \
  || fail "an external integration is configured in the smoke stack"

echo "SMOKE OK"
