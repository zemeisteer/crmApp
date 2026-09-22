#!/usr/bin/env bash
# ==============================================================================
# TalimCRM — Production Database Restore Script
# DIQQAT: Ushbu skript mavjud ma'lumotlarni zaxira faylidagisi bilan almashtiradi!
# ==============================================================================
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Foydalanish: $0 <zaxira_fayl_yo'li.sql.gz>"
  echo "Misol: $0 backups/talimcrm_2026-09-22_120000.sql.gz"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "XATO: '$BACKUP_FILE' fayli topilmadi!" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=========================================================="
echo "⚠️  DIQQAT: MA'LUMOTLAR BAZASINI TIKLASH (RESTORE)"
echo "Fayl: $BACKUP_FILE"
echo "Bu amal joriy bazadagi ma'lumotlarni o'chirib, zaxiradagi bilan almashtiradi!"
echo "=========================================================="
read -p "Haqiqatan ham davom etmoqchimisiz? (tasdiqlash uchun 'TIKLA' deb yozing): " CONFIRM

if [ "$CONFIRM" != "TIKLA" ]; then
  echo "Amal bekor qilindi."
  exit 0
fi

echo "PostgreSQL konteyneri tekshirilmoqda..."
if ! docker ps --format '{{.Names}}' | grep -q 'talimcrm_postgres'; then
  echo "XATO: talimcrm_postgres konteyneri ishlamayapti!" >&2
  exit 1
fi

echo "Ma'lumotlar tiklanmoqda..."
gunzip -c "$BACKUP_FILE" | docker compose -f "${PROJECT_ROOT}/docker-compose.prod.yml" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

echo "✅ Ma'lumotlar bazasi muvaffaqiyatli tiklandi!"
