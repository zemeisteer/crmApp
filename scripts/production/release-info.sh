#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - what is running, and is it what this checkout says?
#
#   bash scripts/production/release-info.sh
#
# For the stack of THIS checkout (its .env, see lib.sh) it prints:
#   - the checkout's commit ("-dirty" with uncommitted changes)
#   - the commit baked into the backend and frontend images (labels)
#   - the commit the running API reports (/api/health)
#   - the root domain and API address the frontend image was BUILT for
#     (NEXT_PUBLIC_* are fixed at build time) against DOMAIN in .env
#   - the migration status inside the running backend
# and ends with RELEASE OK (exit 0) when all of them agree, or RELEASE
# MISMATCH (exit 1) naming what differs. Nothing is changed.
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_stack
command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 2; }

problems=()
CHECKOUT="$(app_revision)"
DOMAIN_ENV="$(effective_value DOMAIN)"
API_ENV="$(effective_value NEXT_PUBLIC_API_URL)"; API_ENV="${API_ENV:-/api}"

label() { # service label -> value of a label of the service's image, or "-"
  local id
  id="$(compose images -q "$1" 2>/dev/null | head -n 1)" || true
  [ -n "$id" ] || { printf -- '-'; return; }
  docker image inspect --format "{{ index .Config.Labels \"$2\" }}" "$id" 2>/dev/null || printf -- '-'
}
BACKEND_IMG="$(label backend org.opencontainers.image.revision)"
FRONTEND_IMG="$(label frontend org.opencontainers.image.revision)"
FRONT_DOMAIN="$(label frontend uz.talimcrm.root-domain)"
FRONT_API="$(label frontend uz.talimcrm.api-url)"
HEALTH="$(compose exec -T backend wget -qO- http://127.0.0.1:4000/api/health 2>/dev/null || true)"
RUNNING="$(sed -n 's/.*"revision":"\([^"]*\)".*/\1/p' <<<"$HEALTH")"
STATUS="$(compose exec -T backend node scripts/migrate.cjs --status 2>/dev/null || true)"
APPLIED="$(grep -c '^applied' <<<"$STATUS" || true)"
PENDING="$(grep -c '^PENDING' <<<"$STATUS" || true)"

echo "stack:              $STACK_NAME (Compose project $PROJECT)"
echo "checkout:           $CHECKOUT"
echo "backend image:      $BACKEND_IMG"
echo "frontend image:     $FRONTEND_IMG"
echo "running API:        ${RUNNING:-not answering}"
echo "frontend built for: domain ${FRONT_DOMAIN}, API ${FRONT_API} (.env: ${DOMAIN_ENV}, ${API_ENV})"
echo "migrations:         ${APPLIED} applied, ${PENDING} pending"

case "$CHECKOUT" in *-dirty|unknown) problems+=("the checkout is not a clean commit ($CHECKOUT): the running build cannot be named") ;; esac
[ "$BACKEND_IMG" = "$CHECKOUT" ] || problems+=("backend image ($BACKEND_IMG) differs from the checkout ($CHECKOUT) - rebuild: stack.sh up -d --build")
[ "$FRONTEND_IMG" = "$CHECKOUT" ] || problems+=("frontend image ($FRONTEND_IMG) differs from the checkout ($CHECKOUT)")
[ "${RUNNING:-}" = "$CHECKOUT" ] || problems+=("the running API reports ${RUNNING:-nothing}, not $CHECKOUT")
[ "$FRONT_DOMAIN" = "$DOMAIN_ENV" ] || problems+=("the frontend was built for domain $FRONT_DOMAIN, .env says $DOMAIN_ENV")
[ "$FRONT_API" = "$API_ENV" ] || problems+=("the frontend was built for API $FRONT_API, .env says $API_ENV")
[ "${PENDING:-0}" = "0" ] && [ "${APPLIED:-0}" -gt 0 ] || problems+=("migrations: ${APPLIED} applied, ${PENDING} pending")

if [ "${#problems[@]}" -gt 0 ]; then
  echo "RELEASE MISMATCH:"
  printf '  - %s\n' "${problems[@]}"
  exit 1
fi
echo "RELEASE OK: $CHECKOUT is built, running and fully migrated"
