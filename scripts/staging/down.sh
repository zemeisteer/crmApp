#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - stop (and, on request, erase) the STAGING stack of this checkout.
#
#   ./scripts/staging/down.sh            stop the containers; data is kept
#   ./scripts/staging/down.sh --purge    also delete its volumes (database,
#                                        uploads, certificates) - asks you to
#                                        type the stack name
#
# It refuses to act on anything that is not clearly staging: STACK_NAME and
# COMPOSE_PROJECT_NAME in ./.env must both contain "staging" or "test". With
# the production defaults (or an empty .env) nothing is touched.
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../production/lib.sh"

PROJECT="$(env_value COMPOSE_PROJECT_NAME)"
is_test_name() { [[ "$1" =~ (staging|stage|stg|test) ]]; }

[ -f "$ENV_FILE" ] || { echo "REFUSED: $ENV_FILE not found - cannot tell which stack this is." >&2; exit 1; }
if ! is_test_name "$STACK_NAME" || [ -z "$PROJECT" ] || ! is_test_name "$PROJECT"; then
  echo "REFUSED: this checkout is not marked as staging (STACK_NAME=\"$STACK_NAME\", COMPOSE_PROJECT_NAME=\"$PROJECT\")." >&2
  echo "         Both must contain staging/test. Nothing was stopped or removed." >&2
  exit 1
fi
command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 2; }

if [ "${1:-}" = "--purge" ]; then
  echo "This deletes the staging database, uploads and certificates of stack \"$STACK_NAME\" (project \"$PROJECT\")."
  read -r -p "Type the stack name to confirm: " TYPED
  [ "$TYPED" = "$STACK_NAME" ] || { echo "Not confirmed. Nothing was removed."; exit 1; }
  compose down --volumes --remove-orphans
  echo "Staging stack \"$STACK_NAME\" and its volumes were removed. Backups in $(env_value BACKUP_DIR) were kept."
else
  compose down --remove-orphans
  echo "Staging stack \"$STACK_NAME\" stopped. Its data is kept; start again with: docker compose -f docker-compose.prod.yml up -d"
fi
