#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - backup of THIS stack (the one described by ./.env): the database
# and the uploaded files. Run by hand or from cron; the db-backup service
# also dumps the database every night.
#
#   ./scripts/production/backup.sh             database + uploads
#   ./scripts/production/backup.sh --db-only   database only
#
# Output (BACKUP_DIR, default ./backups):
#   <stack>_<time>.sql.gz           the database (plain SQL, gzip)
#   <stack>_<time>_uploads.tar.gz   homework files, audio, images
#
# A database dump alone is NOT a full backup: uploaded homework, Listening
# audio and pictures live in the uploads volume. Copy both files off the
# server (another machine / object storage); a backup on the same disk does
# not survive losing the disk.
# Check that a backup really restores:  ./scripts/production/restore.sh <file>
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

DB_ONLY=0
[ "${1:-}" = "--db-only" ] && DB_ONLY=1

BACKUP_DIR="${BACKUP_DIR:-$(env_value BACKUP_DIR)}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-$(env_value BACKUP_KEEP_DAYS)}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
require_stack

STAMP="$(date +%Y-%m-%d_%H%M%S)"
DB_FILE="$BACKUP_DIR/${STACK_NAME}_${STAMP}.sql.gz"
UP_FILE="$BACKUP_DIR/${STACK_NAME}_${STAMP}_uploads.tar.gz"

echo "Stack: $STACK_NAME   database: $PGDB"
T0="$(now_s)"
# A failed dump must not leave a file that looks like a backup.
if ! pg pg_dump --no-owner --no-privileges "$PGDB" | gzip > "$DB_FILE.part"; then
  rm -f "$DB_FILE.part"
  echo "ERROR: pg_dump failed; no backup was written." >&2
  exit 1
fi
gzip -t "$DB_FILE.part" || { rm -f "$DB_FILE.part"; echo "ERROR: the dump is not a valid gzip file." >&2; exit 1; }
mv "$DB_FILE.part" "$DB_FILE"
echo "Database: $DB_FILE ($(du -h "$DB_FILE" | cut -f1), $(( $(now_s) - T0 ))s)"

if [ "$DB_ONLY" = "0" ]; then
  T1="$(now_s)"
  if [ "${PG_LOCAL:-}" = "1" ]; then
    # Rehearsal without Docker: UPLOADS_DIR is the folder that holds uploads/.
    if [ -n "${UPLOADS_DIR:-}" ] && [ -d "$UPLOADS_DIR/uploads" ]; then
      tar --force-local -czf "$UP_FILE.part" -C "$UPLOADS_DIR" uploads
    else
      echo "Uploads: skipped (PG_LOCAL without UPLOADS_DIR)"; UP_FILE=""
    fi
  else
    if ! compose exec -T backend tar -czf - -C /app uploads > "$UP_FILE.part"; then
      rm -f "$UP_FILE.part"
      echo "ERROR: could not archive the uploads; the database dump above is complete, the uploads are NOT backed up." >&2
      exit 1
    fi
  fi
  if [ -n "$UP_FILE" ]; then
    gzip -t "$UP_FILE.part" || { rm -f "$UP_FILE.part"; echo "ERROR: the uploads archive is not valid." >&2; exit 1; }
    mv "$UP_FILE.part" "$UP_FILE"
    echo "Uploads:  $UP_FILE ($(du -h "$UP_FILE" | cut -f1), $(( $(now_s) - T1 ))s)"
  fi
fi

# Old backups of this stack only.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "${STACK_NAME}_*.sql.gz" -o -name "${STACK_NAME}_*_uploads.tar.gz" \) -mtime +"$KEEP_DAYS" -delete
echo "Done. Backups older than $KEEP_DAYS days were removed."
