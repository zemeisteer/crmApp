#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - is this checkout's .env a safe STAGING configuration?
# Changes nothing. Prints names and verdicts only - never a secret's value.
#
#   ./scripts/staging/preflight-staging.sh
#   ./scripts/staging/preflight-staging.sh --prod-env /opt/crmapp/.env
#
# With --prod-env the secrets are compared with production's (by hash, in
# memory): staging must not share a single one. Without it, that comparison
# is reported as not done.
# ==============================================================================
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../production/lib.sh"

PROD_ENV=""
[ "${1:-}" = "--prod-env" ] && PROD_ENV="${2:-}"

FAIL=0; WARN=0
ok()   { echo "  ok    $1"; }
warn() { echo "  warn  $1"; WARN=$((WARN + 1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
is_test_name() { [[ "$1" =~ (staging|stage|stg|test) ]]; }
placeholder() { [[ "$1" == *"<"*">"* ]] || [[ "$1" == *"example"* ]]; }

echo "== file"
if [ ! -f "$ENV_FILE" ]; then bad "$ENV_FILE not found (cp .env.staging.example .env)"; exit 1; fi
ok "$ENV_FILE"

echo "== isolation from production"
STACK="$(env_value STACK_NAME)"; PROJECT="$(env_value COMPOSE_PROJECT_NAME)"
DB="$(env_value POSTGRES_DB)"; DOMAIN="$(env_value DOMAIN)"; FRONT="$(env_value FRONTEND_URL)"
if [ -z "$STACK" ] || [ "$STACK" = "talimcrm" ]; then bad "STACK_NAME is empty or the production default: containers would be named like production's"
elif is_test_name "$STACK"; then ok "STACK_NAME=$STACK"; else bad "STACK_NAME=$STACK does not say staging/test"; fi
if [ -z "$PROJECT" ]; then bad "COMPOSE_PROJECT_NAME is empty: volumes would be named after the folder, which may match production's"
elif is_test_name "$PROJECT"; then ok "COMPOSE_PROJECT_NAME=$PROJECT (own volumes and network)"; else bad "COMPOSE_PROJECT_NAME=$PROJECT does not say staging/test"; fi
if [ -z "$DB" ]; then bad "POSTGRES_DB is empty"
elif is_test_name "$DB"; then ok "POSTGRES_DB=$DB"; else bad "POSTGRES_DB=$DB does not say staging/test"; fi
if [ -z "$DOMAIN" ] || placeholder "$DOMAIN"; then bad "DOMAIN is still the placeholder"
elif is_test_name "$DOMAIN"; then ok "DOMAIN=$DOMAIN"; else warn "DOMAIN=$DOMAIN does not look like a staging domain - make sure it is not the live one"; fi
if [ "$FRONT" = "https://$DOMAIN" ]; then ok "FRONTEND_URL is https://DOMAIN"; else bad "FRONTEND_URL must be https://$DOMAIN (it is the extra allowed origin and the link base)"; fi
API_URL="$(env_value NEXT_PUBLIC_API_URL)"
[ "$API_URL" = "/api" ] && ok "NEXT_PUBLIC_API_URL=/api (same origin, through nginx)" || warn "NEXT_PUBLIC_API_URL=$API_URL (expected /api)"

echo "== secrets"
for k in POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET TELEGRAM_WEBHOOK_SECRET; do
  v="$(env_value "$k")"
  if [ -z "$v" ]; then bad "$k is empty"
  elif placeholder "$v"; then bad "$k is still the placeholder"
  elif [ "${#v}" -lt 24 ]; then bad "$k is short (${#v} characters)"
  else ok "$k is set (${#v} characters)"; fi
done
if [ -n "$PROD_ENV" ]; then
  if [ ! -f "$PROD_ENV" ]; then bad "--prod-env $PROD_ENV not found"
  else
    hash_of() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
    for k in POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET CLICK_SECRET_KEY CLICK_MERCHANT_ID PAYME_KEY PAYME_MERCHANT_ID PLATFORM_CLICK_SECRET_KEY PLATFORM_PAYME_KEY RESEND_API_KEY SMTP_PASS ESKIZ_API_TOKEN PLAYMOBILE_API_TOKEN SENTRY_DSN; do
      mine="$(env_value "$k")"
      theirs="$(ENV_FILE="$PROD_ENV" env_value "$k")"
      [ -n "$mine" ] || continue
      if [ -n "$theirs" ] && [ "$(hash_of "$mine")" = "$(hash_of "$theirs")" ]; then bad "$k is the SAME as production's"; else ok "$k differs from production's"; fi
    done
    for k in DOMAIN POSTGRES_DB STACK_NAME; do
      [ "$(env_value "$k")" != "$(ENV_FILE="$PROD_ENV" env_value "$k")" ] && ok "$k differs from production's" || bad "$k is the same as production's"
    done
  fi
else
  warn "secrets were not compared with production's (run with --prod-env <production .env> on a machine that has it)"
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
if command -v docker >/dev/null; then
  if compose config -q 2>/dev/null; then ok "docker-compose.prod.yml is valid with this .env"; else bad "docker compose config failed with this .env"; fi
  NAMES="$(docker ps -a --format '{{.Names}}' 2>/dev/null)" || NAMES=""
  if has_text "talimcrm_postgres" "$NAMES" && [ "$STACK" != "talimcrm" ]; then warn "a production stack (talimcrm_*) exists on this machine: staging on the same server needs its own ports (HTTP_PORT/HTTPS_PORT) and ideally its own server"; fi
else
  warn "docker is not installed here: the compose file was not validated"
fi

echo
if [ "$FAIL" -gt 0 ]; then echo "NOT SAFE as staging: $FAIL problem(s), $WARN warning(s)."; exit 1; fi
echo "Staging configuration looks isolated ($WARN warning(s) to read)."
