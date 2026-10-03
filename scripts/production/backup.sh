#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - make a backup of THIS stack now (the one described by ./.env).
#
#   bash scripts/production/backup.sh
#
# It runs the same program the nightly schedule runs
# (scripts/production/backup-core.sh, inside the db-backup container), so a
# manual backup and a scheduled one follow the same rules and produce the
# same thing: a recovery set
#
#   <BACKUP_DIR>/<stack>_<UTC time>Z/
#       db.sql.gz  uploads.tar.gz  manifest.json  SHA256SUMS
#
# - the database AND the uploaded files (homework, audio, images);
# - accepted only if pg_dump finished, the dump is complete and - unless
#   BACKUP_VERIFY_RESTORE=0 - it restored into a scratch database;
# - on any failure nothing is kept from this run and no older set is removed.
#
# A set on this server does not survive losing the server: copy the sets
# elsewhere (docs/DEPLOYMENT_GUIDE.md, "Off-server copies").
# Prove that a set restores:  bash scripts/production/restore.sh <set folder>
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
[ $# -eq 0 ] || die "Usage: $0   (no arguments; the stack is the one in this checkout's .env)"
load_stack
require_stack

echo "Stack: $STACK_NAME   database: $PGDB   sets: $BACKUP_ROOT"
if [ "${PG_LOCAL:-}" = "1" ]; then
  # Rehearsal without Docker: the same program, PostgreSQL's tools from this
  # machine. UPLOADS_DIR is the folder whose contents are the uploads.
  BACKUP_ROOT="$BACKUP_ROOT" UPLOADS_DIR="${UPLOADS_DIR:-/nonexistent}" STACK_NAME="$STACK_NAME" \
    PGUSER="$PGU" PGDATABASE="$PGDB" APP_REVISION="$(app_revision)" sh "$LIB_DIR/backup-core.sh" once
else
  # A one-off container of the db-backup service: same image, same mounts
  # (backups, uploads read-only), same lock as the nightly run.
  compose run --rm --no-deps db-backup once
fi
