#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - connect the Telegram bot of THIS stack to its server (webhook).
# Updates arrive at https://DOMAIN/api/telegram/webhook; Telegram sends
# TELEGRAM_WEBHOOK_SECRET with every request and the backend checks it.
# The token and the secret are never printed.
#
#   ./scripts/production/set-telegram-webhook.sh
#   ./scripts/production/set-telegram-webhook.sh --replace   (move a webhook
#                                    that currently points at another host)
#
# A bot has ONE webhook. Pointing a bot at this server takes it away from
# wherever it pointed before - so the script first shows which bot the token
# belongs to and where it points now, and refuses to move it from another
# host unless --replace is given. Staging must use its own bot.
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

REPLACE=0
[ "${1:-}" = "--replace" ] && REPLACE=1

DOMAIN="$(env_value DOMAIN)"
TOKEN="$(env_value TELEGRAM_BOT_TOKEN)"
SECRET="$(env_value TELEGRAM_WEBHOOK_SECRET)"
EXPECTED_BOT="$(env_value TELEGRAM_BOT_USERNAME)"

if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ] || [ -z "$SECRET" ]; then
  echo "ERROR: .env needs DOMAIN, TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET." >&2
  echo "       A secret: openssl rand -hex 24" >&2
  exit 1
fi
TARGET="https://${DOMAIN}/api/telegram/webhook"
API="https://api.telegram.org/bot${TOKEN}"

# curl's own errors can contain the URL (and so the token): keep them quiet.
ME="$(curl --fail --silent --max-time 20 "$API/getMe")" || { echo "ERROR: Telegram did not accept the token (getMe failed)." >&2; exit 1; }
BOT="$(json_string username "$ME")"
[ -n "$BOT" ] || { echo "ERROR: could not read the bot's name from Telegram." >&2; exit 1; }
echo "Bot: @$BOT   stack: $STACK_NAME   target: $TARGET"
if [ -n "$EXPECTED_BOT" ] && [ "${EXPECTED_BOT#@}" != "$BOT" ]; then
  echo "REFUSED: the token belongs to @$BOT, but TELEGRAM_BOT_USERNAME in .env is @${EXPECTED_BOT#@}." >&2
  echo "         Fix .env so that both describe the bot meant for this stack." >&2
  exit 1
fi

INFO="$(curl --fail --silent --max-time 20 "$API/getWebhookInfo")" || { echo "ERROR: could not read the current webhook." >&2; exit 1; }
CURRENT="$(json_string url "$INFO")"
if [ -z "$CURRENT" ]; then
  echo "Current webhook: none"
elif [ "$CURRENT" = "$TARGET" ]; then
  echo "Current webhook: already this server (it will be refreshed)"
else
  CURRENT_HOST="${CURRENT#https://}"; CURRENT_HOST="${CURRENT_HOST%%/*}"
  echo "Current webhook: another host ($CURRENT_HOST)"
  if [ "$REPLACE" != "1" ]; then
    echo "REFUSED: @$BOT is connected to $CURRENT_HOST. Moving it here would disconnect it there." >&2
    echo "         If @$BOT really is this stack's own bot, run again with --replace." >&2
    exit 1
  fi
fi

ANSWER="$(curl --fail --silent --max-time 20 "$API/setWebhook" \
  --data-urlencode "url=${TARGET}" \
  --data-urlencode "secret_token=${SECRET}" \
  --data-urlencode 'allowed_updates=["message","callback_query"]' \
  --data-urlencode "drop_pending_updates=true")" || { echo "ERROR: Telegram did not accept the webhook." >&2; exit 1; }
has_text '"ok":true' "$ANSWER" || { echo "ERROR: Telegram did not accept the webhook." >&2; exit 1; }
echo "Webhook connected: @$BOT -> $TARGET"
