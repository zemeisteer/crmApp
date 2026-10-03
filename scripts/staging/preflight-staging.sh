#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - is this checkout's .env a safe STAGING configuration?
# Changes nothing. Prints names and verdicts only - never a secret's value.
#
#   bash scripts/staging/preflight-staging.sh
#   bash scripts/staging/preflight-staging.sh --prod-env /opt/crmapp/.env
#
# With --prod-env the two stacks are compared: no shared secret (by hash, in
# memory), and no shared resource name - Compose project (volumes, network),
# container prefix, database, backup folder, published ports.
# Without it, that comparison is reported as not done.
#
# It checks the same effective configuration the other scripts use
# (scripts/production/lib.sh): values come from the .env; a variable
# inherited from the shell that disagrees is reported as a failure here and
# stops the scripts that act.
# ==============================================================================
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../production/lib.sh"

PROD_ENV=""
[ "${1:-}" = "--prod-env" ] && PROD_ENV="${2:-}"

FAIL=0; WARN=0
ok()   { echo "  ok    $1"; }
warn() { echo "  warn  $1"; WARN=$((WARN + 1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
placeholder() { [[ "$1" == *"<"*">"* ]] || [[ "$1" == *"example"* ]]; }

echo "== file"
if [ ! -f "$ENV_FILE" ]; then bad "$ENV_FILE not found (cp .env.staging.example .env)"; exit 1; fi
ok "$ENV_FILE"

echo "== the shell does not override the file"
CONFLICT=0
for v in "${IDENTITY_VARS[@]}" COMPOSE_FILE; do
  inherited="${!v:-}"
  [ -n "$inherited" ] || continue
  if [ "$v" = "COMPOSE_FILE" ]; then bad "COMPOSE_FILE is set in this shell: Compose would read another file"; CONFLICT=1; continue; fi
  expected="$(effective_value "$v")"
  if [ "$inherited" = "$expected" ]; then ok "$v in this shell equals the file's"; else bad "$v in this shell is \"$inherited\" but the file means \"$expected\" - unset it"; CONFLICT=1; fi
done
[ "$CONFLICT" = "0" ] && ok "no conflicting stack variables are inherited"

echo "== isolation from production"
STACK="$(env_value STACK_NAME)"; DECLARED_PROJECT="$(env_value COMPOSE_PROJECT_NAME)"
DB="$(env_value POSTGRES_DB)"; DOMAIN="$(env_value DOMAIN)"; FRONT="$(env_value FRONTEND_URL)"
if [ -z "$STACK" ] || [ "$STACK" = "talimcrm" ]; then bad "STACK_NAME is empty or the production default: containers would be named like production's"
elif is_test_name "$STACK"; then ok "STACK_NAME=$STACK"; else bad "STACK_NAME=$STACK does not say staging/test"; fi
if [ -z "$DECLARED_PROJECT" ]; then bad "COMPOSE_PROJECT_NAME is empty: volumes would be named after the folder, which may match production's"
elif is_test_name "$DECLARED_PROJECT"; then ok "COMPOSE_PROJECT_NAME=$DECLARED_PROJECT (own volumes and network)"; else bad "COMPOSE_PROJECT_NAME=$DECLARED_PROJECT does not say staging/test"; fi
if [ -z "$DB" ]; then bad "POSTGRES_DB is empty"
elif is_test_name "$DB"; then ok "POSTGRES_DB=$DB"; else bad "POSTGRES_DB=$DB does not say staging/test"; fi
if [ -z "$DOMAIN" ] || placeholder "$DOMAIN"; then bad "DOMAIN is still the placeholder"
elif is_test_name "$DOMAIN"; then ok "DOMAIN=$DOMAIN"; else warn "DOMAIN=$DOMAIN does not look like a staging domain - make sure it is not the live one"; fi
if [ "$FRONT" = "https://$DOMAIN" ]; then ok "FRONTEND_URL is https://DOMAIN"; else bad "FRONTEND_URL must be https://$DOMAIN (it is the extra allowed origin and the link base)"; fi
API_URL="$(env_value NEXT_PUBLIC_API_URL)"
[ "$API_URL" = "/api" ] && ok "NEXT_PUBLIC_API_URL=/api (same origin, through nginx)" || warn "NEXT_PUBLIC_API_URL=$API_URL (expected /api)"
MY_BACKUPS="$(abs_path "$(effective_value BACKUP_DIR)" "$PROJECT_ROOT")"
ok "backups are written to $MY_BACKUPS"

echo "== secrets"
for k in POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET TELEGRAM_WEBHOOK_SECRET; do
  v="$(env_value "$k")"
  if [ -z "$v" ]; then bad "$k is empty"
  elif placeholder "$v"; then bad "$k is still the placeholder"
  elif [ "${#v}" -lt 24 ]; then bad "$k is short (${#v} characters)"
  else ok "$k is set (${#v} characters)"; fi
done

echo "== compared with production"
if [ -n "$PROD_ENV" ]; then
  if [ ! -f "$PROD_ENV" ]; then bad "--prod-env $PROD_ENV not found"
  else
    PROD_DIR="$(cd "$(dirname "$PROD_ENV")" && pwd)"
    hash_of() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
    for k in POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET CLICK_SECRET_KEY CLICK_MERCHANT_ID PAYME_KEY PAYME_MERCHANT_ID PLATFORM_CLICK_SECRET_KEY PLATFORM_PAYME_KEY RESEND_API_KEY SMTP_PASS ESKIZ_API_TOKEN PLAYMOBILE_API_TOKEN SENTRY_DSN CLOUDFLARE_API_TOKEN; do
      mine="$(env_value "$k")"
      theirs="$(env_value "$k" "$PROD_ENV")"
      [ -n "$mine" ] || continue
      if [ -n "$theirs" ] && [ "$(hash_of "$mine")" = "$(hash_of "$theirs")" ]; then bad "$k is the SAME as production's"; else ok "$k differs from production's"; fi
    done
    # Resource names, as each stack really resolves them (defaults included).
    for k in COMPOSE_PROJECT_NAME STACK_NAME POSTGRES_DB DOMAIN; do
      mine="$(effective_value "$k")"; theirs="$(effective_value "$k" "$PROD_ENV")"
      case "$k" in
        COMPOSE_PROJECT_NAME) what="Compose project (volumes: ${mine}_postgres_prod_data, ${mine}_uploads_prod_data; network)" ;;
        STACK_NAME) what="container names (${mine}_postgres, ${mine}_backend, ...)" ;;
        POSTGRES_DB) what="database name" ;;
        DOMAIN) what="domain" ;;
      esac
      if [ "$mine" = "$theirs" ]; then bad "$k resolves to \"$mine\" for BOTH stacks: same $what"; else ok "$k: \"$mine\" here, \"$theirs\" in production - separate $what"; fi
    done
    THEIR_BACKUPS="$(abs_path "$(effective_value BACKUP_DIR "$PROD_ENV")" "$PROD_DIR")"
    if [ "$MY_BACKUPS" = "$THEIR_BACKUPS" ]; then bad "both stacks write backups to $MY_BACKUPS"; else ok "backup folders differ ($THEIR_BACKUPS in production)"; fi
    if [ "$PROD_DIR" = "$PROJECT_ROOT" ]; then bad "--prod-env is this checkout's own folder: staging needs its own checkout"; else ok "separate checkout folders"; fi
    for k in HTTP_PORT HTTPS_PORT; do
      mine="$(env_value "$k")"; theirs="$(env_value "$k" "$PROD_ENV")"
      mine="${mine:-$([ "$k" = HTTP_PORT ] && echo 80 || echo 443)}"; theirs="${theirs:-$([ "$k" = HTTP_PORT ] && echo 80 || echo 443)}"
      if [ "$mine" = "$theirs" ]; then warn "$k is $mine for both stacks: they cannot run on the same server (fine on separate servers)"; else ok "$k differs ($mine / $theirs)"; fi
    done
  fi
else
  warn "not compared with production (run with --prod-env <production .env> on a machine that has it): secrets, project, containers, database, backups"
fi

echo "== messaging and payments"
SCAN="$(env_value REMINDER_SCAN_MS)"
[ "$SCAN" = "0" ] && ok "automatic reminders are off (REMINDER_SCAN_MS=0)" || warn "REMINDER_SCAN_MS=${SCAN:-unset}: reminders will be sent by themselves - only with an approved test recipient"
if [ -z "$(env_value TELEGRAM_BOT_TOKEN)" ]; then ok "Telegram: no bot configured (nothing can be sent)"
else warn "Telegram bot configured (@$(env_value TELEGRAM_BOT_USERNAME)): it must be a bot made for staging, never the production bot"; fi
for k in ESKIZ_API_TOKEN PLAYMOBILE_API_TOKEN; do
  [ -z "$(env_value "$k")" ] && ok "$k empty (no SMS)" || warn "$k is set: SMS will reach real phone numbers"
done
if [ -z "$(env_value RESEND_API_KEY)" ] && [ -z "$(env_value SMTP_HOST)" ]; then ok "e-mail not configured (messages are logged only)"; else warn "e-mail is configured: use a sandbox inbox, not real addresses"; fi
if [ -z "$(env_value CLICK_SECRET_KEY)" ] && [ -z "$(env_value PAYME_KEY)" ]; then ok "payment providers not configured"
else warn "payment keys are set: they must be the providers' TEST merchants"; fi

echo "== docker"
if [ "$CONFLICT" = "1" ]; then
  warn "docker was not consulted: fix the inherited variables above first"
elif command -v docker >/dev/null; then
  load_stack
  if compose config -q 2>/dev/null; then ok "docker-compose.prod.yml is valid with this .env (project \"$PROJECT\")"; else bad "docker compose config failed with this .env"; fi
  NAMES="$(docker ps -a --format '{{.Names}}' 2>/dev/null)" || NAMES=""
  if has_text "talimcrm_postgres" "$NAMES" && [ "$STACK" != "talimcrm" ]; then warn "a production stack (talimcrm_*) exists on this machine: staging on the same server needs its own ports (HTTP_PORT/HTTPS_PORT) and ideally its own server"; fi
else
  warn "docker is not installed here: the compose file was not validated"
fi

echo
if [ "$FAIL" -gt 0 ]; then echo "NOT SAFE as staging: $FAIL problem(s), $WARN warning(s)."; exit 1; fi
echo "Staging configuration looks isolated ($WARN warning(s) to read)."
