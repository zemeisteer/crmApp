#!/usr/bin/env bash
# Smoke test of the production images (docker-compose.smoke.yml): build,
# start on a throw-away database, check that migrations finish before the
# API answers, that both services are ready and can talk, and that a
# restart does not apply any migration again. Tears everything down at the
# end, also on failure.
#
#   bash scripts/production/smoke-test.sh
#
# Needs Docker with the compose plugin. Uses no real credentials, no real
# data and no external service.
#
# Text is never piped into an early-exiting reader (grep -q, head): see
# smoke-lib.sh for why, and for the helpers used instead.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/production/smoke-lib.sh
source scripts/production/smoke-lib.sh

# Overridable only so the script's own logic can be exercised without Docker.
API="${SMOKE_API:-http://127.0.0.1:14000/api}"
WEB="${SMOKE_WEB:-http://127.0.0.1:13000}"

compose() { docker compose -f docker-compose.smoke.yml "$@"; }

fail() {
  echo "SMOKE FAILED: $*" >&2
  compose logs --no-color --tail=80 backend frontend >&2 || echo "(could not read container logs)" >&2
  exit 1
}
cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || echo "warning: could not remove the smoke stack; run: docker compose -f docker-compose.smoke.yml down --volumes" >&2
}
trap cleanup EXIT

# http_get NAME URL [curl args...] - prints the body; fails the test (with
# the HTTP status or curl's own error) when the request does not succeed.
http_get() {
  local name="$1" url="$2" body
  shift 2
  body="$(curl --fail --silent --show-error --max-time 20 "$@" "$url" 2>&1)" || fail "$name: $url -> $body"
  printf '%s' "$body"
}

command -v docker >/dev/null || { echo "Docker is not installed: this check cannot run here." >&2; exit 2; }
command -v curl >/dev/null || { echo "curl is not installed: this check cannot run here." >&2; exit 2; }

MIGRATIONS=(backend/drizzle/[0-9][0-9][0-9][0-9]_*.sql)
TOTAL="${#MIGRATIONS[@]}"
LATEST="$(basename "${MIGRATIONS[$((TOTAL - 1))]}")"
[ "$TOTAL" -gt 0 ] || { echo "no migration files found under backend/drizzle" >&2; exit 2; }

echo "1/6 building production images"
compose build || fail "the images did not build"

echo "2/6 starting the stack (waits for the health checks of postgres, redis, backend and frontend)"
compose up -d --wait || fail "the stack did not become healthy"

echo "3/6 migrations ran, and finished before the API started"
LOGS="$(compose logs --no-color backend)" || fail "could not read the backend log"
has_text "migrate: applied 0000_" "$LOGS" || fail "no migration output on first start"
has_text "migrate: applied ${LATEST}" "$LOGS" || fail "the latest migration (${LATEST}) was not applied"
APPLIED_IN_LOG="$(count_lines 'migrate: applied [0-9]{4}_' "$LOGS")"
[ "$APPLIED_IN_LOG" = "$TOTAL" ] || fail "the log shows ${APPLIED_IN_LOG} applied migrations, expected ${TOTAL}"
LAST_MIGRATION_LINE="$(last_line 'migrate: applied' "$LOGS")"
FIRST_APP_LINE="$(first_line 'Nest application successfully started|backend running on' "$LOGS")"
[ "$FIRST_APP_LINE" -gt 0 ] || fail "the API never reported that it started"
[ "$LAST_MIGRATION_LINE" -lt "$FIRST_APP_LINE" ] || fail "the API started (log line ${FIRST_APP_LINE}) before migrations finished (line ${LAST_MIGRATION_LINE})"
STATUS="$(compose exec -T backend node scripts/migrate.cjs --status)" || fail "could not read the migration status"
APPLIED="$(count_lines '^applied' "$STATUS")"
PENDING="$(count_lines '^PENDING' "$STATUS")"
[ "$APPLIED" = "$TOTAL" ] && [ "$PENDING" = "0" ] || fail "applied ${APPLIED}/${TOTAL}, pending ${PENDING}"
echo "    ${APPLIED}/${TOTAL} migrations applied, 0 pending, all before the API started"

echo "4/6 readiness and basic connectivity"
http_get "backend health" "$API/health" >/dev/null
# The frontend really serves a page (not just a running container): retried
# for up to a minute, then the page itself is checked.
PAGE="$(http_get "frontend /login" "$WEB/login" --retry 30 --retry-delay 2 --retry-all-errors)"
has_text "<html" "$PAGE" || fail "frontend /login did not return an HTML page"
# A real round trip through the API and the database: register a center,
# then read it back with the token.
SUFFIX="$(date +%s)"
REG="$(http_get "register through the API" "$API/auth/register" -X POST -H 'Content-Type: application/json' \
  -d "{\"centerName\":\"Smoke ${SUFFIX}\",\"subdomain\":\"smoke-${SUFFIX}\",\"email\":\"smoke-${SUFFIX}@example.test\",\"password\":\"Smoke-pass-${SUFFIX}\",\"fullName\":\"Smoke Owner\"}")"
TOKEN="$(json_string accessToken "$REG")"
[ -n "$TOKEN" ] || fail "no access token after register"
ME="$(http_get "/auth/me after register" "$API/auth/me" -H "Authorization: Bearer $TOKEN")"
has_text "smoke-${SUFFIX}" "$ME" || fail "/auth/me does not name the new center"
CENTER="$(http_get "public center lookup (what the frontend calls)" "$API/tenants/by-subdomain/smoke-${SUFFIX}")"
has_text "smoke-${SUFFIX}" "$CENTER" || fail "the public center lookup does not return the new center"

echo "5/6 restart: completed migrations are not applied again"
compose restart backend >/dev/null || fail "could not restart the backend"
compose up -d --wait backend || fail "backend did not come back healthy"
AFTER="$(compose logs --no-color backend)" || fail "could not read the backend log after the restart"
has_text "migrate: database is up to date" "$AFTER" || fail "restart did not report an up-to-date database"
[ "$(count_lines 'migrate: applied 0000_' "$AFTER")" = "1" ] || fail "a migration was applied twice"
[ "$(count_lines 'migrate: applied [0-9]{4}_' "$AFTER")" = "$TOTAL" ] || fail "the number of applied migrations changed after the restart"
STATUS="$(compose exec -T backend node scripts/migrate.cjs --status)" || fail "could not read the migration status after the restart"
[ "$(count_lines '^PENDING' "$STATUS")" = "0" ] || fail "migrations are pending after the restart"
ME="$(http_get "/auth/me after the restart" "$API/auth/me" -H "Authorization: Bearer $TOKEN")"
has_text "smoke-${SUFFIX}" "$ME" || fail "data did not survive the restart"

echo "6/6 nothing external is configured"
SET="$(compose exec -T backend sh -c 'for v in ANTHROPIC_API_KEY GEMINI_API_KEY TELEGRAM_BOT_TOKEN ESKIZ_API_TOKEN PLAYMOBILE_API_TOKEN RESEND_API_KEY SMTP_HOST CLICK_MERCHANT_ID CLICK_SECRET_KEY PAYME_MERCHANT_ID PAYME_KEY SENTRY_DSN; do eval "x=\${$v:-}"; [ -z "$x" ] || echo "$v"; done')" \
  || fail "could not read the backend environment"
[ -z "$SET" ] || fail "external integrations are configured in the smoke stack: $(tr '\n' ' ' <<<"$SET")"

echo "SMOKE OK"
