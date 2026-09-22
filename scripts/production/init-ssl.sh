#!/usr/bin/env bash
# ==============================================================================
# TalimCRM — Production Initial SSL Certificate Setup (Let's Encrypt)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

if [ ! -f .env ]; then
  echo "XATO: .env fayli topilmadi! Avval '.env.production.example' dan nusxa olib sozlang." >&2
  exit 1
fi

DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d '=' -f2 | tr -d ' "' || true)
if [ -z "$DOMAIN" ]; then
  read -p "Domen nomingizni kiriting (masalan, crmapp.uz): " DOMAIN
fi

read -p "Let's Encrypt uchun administrator emailingizni kiriting: " ADMIN_EMAIL

echo "=========================================================="
echo "TalimCRM SSL sertifikatini sozlash"
echo "Domen: $DOMAIN"
echo "Email: $ADMIN_EMAIL"
echo "=========================================================="

# 1. Vaqtinchalik boshlang'ich HTTP konfiguratsiyani faollashtirish
echo "1. Vaqtinchalik HTTP konfiguratsiyani tayyorlash..."
cp nginx/conf.d/talimcrm-initial.conf.template nginx/conf.d/talimcrm.conf

# 2. Nginx konteynerini ko'tarish
echo "2. Nginx konteynerini ishga tushirish..."
docker compose -f docker-compose.prod.yml up -d nginx

# 3. Certbot orqali SSL sertifikat olish
echo "3. Let's Encrypt ACME sertifikati olinmoqda..."
docker compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$ADMIN_EMAIL" \
  --agree-tos \
  --no-eff-email \
  --cert-name talimcrm \
  -d "$DOMAIN" -d "www.$DOMAIN"

# 4. Doimiy HTTPS konfiguratsiyasini qayta tiklash
echo "4. To'liq HTTPS konfiguratsiyasini tiklash..."
git checkout nginx/conf.d/talimcrm.conf || true

# 5. Nginx'ni qayta yuklash
echo "5. Nginx qayta yuklanmoqda..."
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

echo "=========================================================="
echo "✅ SSL sertifikati muvaffaqiyatli o'rnatildi va faollashtirildi!"
echo "Manzil: https://$DOMAIN"
echo "=========================================================="
