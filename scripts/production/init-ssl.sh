#!/usr/bin/env bash
# ==============================================================================
# TalimCRM — birinchi SSL sertifikat (Let's Encrypt), wildcard bilan:
#   DOMAIN va *.DOMAIN  (har bir markaz sayti <markaz>.DOMAIN da ochiladi)
#
# Wildcard sertifikat faqat DNS orqali tasdiqlanadi:
#   - .env da CLOUDFLARE_API_TOKEN bo'lsa: avtomatik, yangilanishi ham avtomatik
#     (domen DNS'i Cloudflare'da bo'lishi kerak; token huquqi: Zone > DNS > Edit)
#   - bo'lmasa: skript ko'rsatgan TXT yozuvni DNS panelga qo'lda qo'shasiz
#     (bu holda 90 kunda bir marta skriptni qayta ishga tushirish kerak)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

COMPOSE="docker compose -f docker-compose.prod.yml"

if [ ! -f .env ]; then
  echo "XATO: .env fayli topilmadi! Avval '.env.production.example' dan nusxa olib sozlang." >&2
  exit 1
fi

env_value() { grep -E "^$1=" .env | tail -n1 | cut -d '=' -f2- | tr -d ' "' || true; }

DOMAIN="$(env_value DOMAIN)"
if [ -z "$DOMAIN" ]; then
  read -r -p "Domen nomingizni kiriting (masalan, talimcrm.uz): " DOMAIN
fi
CF_TOKEN="$(env_value CLOUDFLARE_API_TOKEN)"

read -r -p "Let's Encrypt uchun administrator emailingiz: " ADMIN_EMAIL

echo "=========================================================="
echo "TalimCRM SSL: $DOMAIN va *.$DOMAIN"
if [ -n "$CF_TOKEN" ]; then echo "Usul: Cloudflare DNS (avtomatik)"; else echo "Usul: qo'lda TXT yozuv"; fi
echo "=========================================================="

# 1. Vaqtinchalik HTTP konfiguratsiya (sertifikat hali yo'q)
echo "1. Vaqtinchalik HTTP konfiguratsiya..."
cp nginx/conf.d/talimcrm-initial.conf.template nginx/conf.d/talimcrm.conf
$COMPOSE up -d nginx

# 2. Sertifikat
echo "2. Let's Encrypt sertifikati olinmoqda..."
if [ -n "$CF_TOKEN" ]; then
  # Token faqat certbot volume ichida saqlanadi (yangilash uchun kerak).
  # (-e CF_TOKEN without a value passes it from this shell, off the command line)
  CF_TOKEN="$CF_TOKEN" $COMPOSE run --rm -e CF_TOKEN --entrypoint sh certbot -c \
    'umask 077; printf "dns_cloudflare_api_token = %s\n" "$CF_TOKEN" > /etc/letsencrypt/cloudflare.ini'
  $COMPOSE run --rm certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 30 \
    --email "$ADMIN_EMAIL" --agree-tos --no-eff-email \
    --cert-name talimcrm \
    -d "$DOMAIN" -d "*.$DOMAIN"
else
  echo "   Certbot _acme-challenge.$DOMAIN uchun TXT yozuv(lar)ni ko'rsatadi."
  echo "   Ularni DNS panelga qo'shing, 1-2 daqiqa kuting va Enter bosing."
  $COMPOSE run --rm -it certbot certonly \
    --manual --preferred-challenges dns \
    --email "$ADMIN_EMAIL" --agree-tos --no-eff-email \
    --cert-name talimcrm \
    -d "$DOMAIN" -d "*.$DOMAIN"
fi

# 3. To'liq HTTPS konfiguratsiya
echo "3. HTTPS konfiguratsiyani tiklash..."
git checkout nginx/conf.d/talimcrm.conf || true
$COMPOSE exec nginx nginx -s reload

echo "=========================================================="
echo "✅ SSL tayyor: https://$DOMAIN va https://<markaz>.$DOMAIN"
echo "=========================================================="
