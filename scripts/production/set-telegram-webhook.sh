#!/usr/bin/env bash
# ==============================================================================
# TalimCRM — Telegram botni serverga ulash (webhook).
# Bot xabarlari https://DOMAIN/api/telegram/webhook ga keladi; Telegram har
# so'rovda TELEGRAM_WEBHOOK_SECRET ni yuboradi, backend uni tekshiradi.
# Token va kalit ekranga chiqarilmaydi.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

env_value() { grep -E "^$1=" .env | tail -n1 | cut -d '=' -f2- | tr -d ' "' || true; }

DOMAIN="$(env_value DOMAIN)"
TOKEN="$(env_value TELEGRAM_BOT_TOKEN)"
SECRET="$(env_value TELEGRAM_WEBHOOK_SECRET)"

if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ] || [ -z "$SECRET" ]; then
  echo "XATO: .env da DOMAIN, TELEGRAM_BOT_TOKEN va TELEGRAM_WEBHOOK_SECRET bo'lishi kerak." >&2
  echo "      Kalit yaratish: openssl rand -hex 24" >&2
  exit 1
fi

curl -fsS "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  --data-urlencode "url=https://${DOMAIN}/api/telegram/webhook" \
  --data-urlencode "secret_token=${SECRET}" \
  --data-urlencode 'allowed_updates=["message"]' \
  --data-urlencode "drop_pending_updates=true" | grep -q '"ok":true' \
  && echo "✅ Webhook ulandi: https://${DOMAIN}/api/telegram/webhook" \
  || { echo "XATO: Telegram webhookni qabul qilmadi." >&2; exit 1; }
