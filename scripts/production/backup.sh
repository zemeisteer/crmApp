#!/usr/bin/env bash
# ==============================================================================
# TalimCRM — Production Database Manual/Cron Backup Script
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
OUT_FILE="${BACKUP_DIR}/talimcrm_${TIMESTAMP}.sql.gz"

echo "=========================================================="
echo "TalimCRM zaxira nusxalash boshlandi: $TIMESTAMP"
echo "Fayl manzili: $OUT_FILE"
echo "=========================================================="

if ! docker ps --format '{{.Names}}' | grep -q 'talimcrm_postgres'; then
  echo "XATO: talimcrm_postgres konteyneri ishlamayapti!" >&2
  exit 1
fi

docker compose -f "${PROJECT_ROOT}/docker-compose.prod.yml" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$OUT_FILE"

FILE_SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo "✅ Zaxira nusxa muvaffaqiyatli saqlandi! Hajmi: $FILE_SIZE"

# 14 kundan eski zaxira nusxalarini tozalash
echo "Eski zaxira fayllari tozalanmoqda (14 kundan eski)..."
find "$BACKUP_DIR" -name "talimcrm_*.sql.gz" -type f -mtime +14 -delete
echo "Tozalash yakunlandi."
