#!/usr/bin/env bash
# TalimCRM database backup.
#
# Usage:
#   ./scripts/backup.sh              # dump to backups/talimcrm_<timestamp>.sql.gz
#   ./scripts/backup.sh /path/to/dir # dump into a custom directory
#
# Restore with:
#   gunzip -c backups/talimcrm_2026-09-19_120000.sql.gz | psql "$DATABASE_URL"
#
# Schedule this daily with cron (Linux/Mac) or Task Scheduler (Windows):
#   0 3 * * * cd /path/to/backend && ./scripts/backup.sh >> backup.log 2>&1
# Keep backups off the same disk as the database (S3, another server, etc.)
# — a local-only backup doesn't survive a disk failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Load DATABASE_URL from .env if not already set in the environment.
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  export "$(grep -E '^DATABASE_URL=' .env | xargs)"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set (checked env and .env). Aborting." >&2
  exit 1
fi

OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"

TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT_FILE="$OUT_DIR/talimcrm_${TIMESTAMP}.sql.gz"

echo "Backing up to $OUT_FILE ..."
pg_dump "$DATABASE_URL" | gzip > "$OUT_FILE"
echo "Done: $(du -h "$OUT_FILE" | cut -f1)"

# Keep the last 14 local backups; prune older ones. Adjust to taste, and
# remember this only protects against accidental deletes/bugs, not disk
# failure — pair it with an off-box copy (S3 sync, rsync to another host).
ls -1t "$OUT_DIR"/talimcrm_*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
