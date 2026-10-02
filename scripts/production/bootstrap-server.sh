#!/usr/bin/env bash
# ==============================================================================
# TalimCRM — yangi Ubuntu serverni bir marta tayyorlash (22.04 / 24.04).
#
#   curl -fsSL https://raw.githubusercontent.com/zemeisteer/crmApp/dev/scripts/production/bootstrap-server.sh -o bootstrap.sh
#   sudo bash bootstrap.sh talimcrm.uz
#
# Qiladi: Docker + Compose, firewall (22/80/443), 2 GB swap (RAM kam bo'lsa),
# loyihani /opt/crmapp ga yuklash va .env ni tasodifiy maxfiy kalitlar bilan
# yaratish. Maxfiy kalitlar ekranga chiqarilmaydi — faqat .env da turadi.
# ==============================================================================
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/zemeisteer/crmApp.git}"
BRANCH="${BRANCH:-dev}"
DIR="${DIR:-/opt/crmapp}"

if [ "$(id -u)" -ne 0 ]; then echo "sudo bilan ishga tushiring: sudo bash $0 <domen>" >&2; exit 1; fi
if [ -z "$DOMAIN" ]; then read -r -p "Asosiy domen (masalan talimcrm.uz): " DOMAIN; fi
DOMAIN="$(echo "$DOMAIN" | tr 'A-Z' 'a-z' | sed 's#^https\?://##; s#/.*##; s#^www\.##')"

echo "== 1/5 Paketlar va Docker"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw openssl dnsutils >/dev/null
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y -qq docker.io >/dev/null
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-v2 >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null

echo "== 2/5 Firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== 3/5 Swap (RAM 3 GB dan kam bo'lsa)"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 3000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "   2 GB swap qo'shildi"
fi

echo "== 4/5 Loyiha: $DIR ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" pull -q --ff-only
else
  git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi
chmod +x "$DIR"/scripts/production/*.sh

echo "== 5/5 .env"
cd "$DIR"
if [ -f .env ]; then
  echo "   .env allaqachon bor — tegilmadi"
else
  # ENV_TEMPLATE=.env.staging.example for a staging server (see docs/STAGING.md).
  cp "${ENV_TEMPLATE:-.env.production.example}" .env
  set_env() { # key value — value never printed
    if grep -qE "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >> .env; fi
  }
  set_env DOMAIN "$DOMAIN"
  set_env FRONTEND_URL "https://$DOMAIN"
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env REDIS_PASSWORD "$(openssl rand -hex 24)"
  set_env JWT_SECRET "$(openssl rand -hex 32)"
  set_env TELEGRAM_WEBHOOK_SECRET "$(openssl rand -hex 24)"
  set_env SMTP_FROM "\"TalimCRM <no-reply@$DOMAIN>\""
  chmod 600 .env
  echo "   .env yaratildi (parollar va kalitlar tasodifiy)"
fi

cat <<EOF

==========================================================
✅ Server tayyor.

Keyingi qadamlar ($DIR ichida):
  1. nano .env      — TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME,
                      GEMINI_API_KEY, CLOUDFLARE_API_TOKEN (ixtiyoriy) ...
  2. ./scripts/production/preflight.sh      — sozlamalar va DNS tekshiruvi
  3. ./scripts/production/init-ssl.sh       — SSL ($DOMAIN va *.$DOMAIN)
  4. docker compose -f docker-compose.prod.yml up -d --build
  5. ./scripts/production/set-telegram-webhook.sh
==========================================================
EOF
