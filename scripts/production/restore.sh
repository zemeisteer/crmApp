#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - restore a database backup INTO A NEW, SEPARATE DATABASE and
# check it. The live database is never written to, dropped or renamed here.
#
#   ./scripts/production/restore.sh backups/<stack>_<time>.sql.gz          drill: restore, check, drop
#   ./scripts/production/restore.sh backups/<stack>_<time>.sql.gz --keep   restore, check, keep the copy
#
# What it checks on the restored copy:
#   - the dump loads without a single error
#   - migrations: every migration file of this checkout is recorded as
#     applied, none is unknown (so the app can start on it as it is)
#   - the core tables are there and readable; their row counts are printed
#     next to the live database's (the live one may have moved on since)
#   - money adds up: no invoice paid past its amount, no payment allocated
#     past its amount, every allocation points at an existing payment/invoice
#
# Switching the application to a kept copy is a separate, deliberate step:
# the exact commands are printed at the end. Uploaded files are restored
# separately (see the end of the output).
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FILE="${1:-}"
KEEP=0
[ "${2:-}" = "--keep" ] && KEEP=1
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: $0 <backup.sql.gz> [--keep]" >&2
  exit 1
fi
gzip -t "$FILE" || { echo "ERROR: $FILE is not a valid gzip file." >&2; exit 1; }
require_stack

TARGET="${PGDB}_restore_$(date +%Y%m%d%H%M%S)"
safe_dbname "$TARGET" || { echo "ERROR: unusable database name \"$TARGET\"." >&2; exit 1; }
[ "$TARGET" != "$PGDB" ] || { echo "ERROR: the target would be the live database." >&2; exit 1; }
EXISTS="$(sql postgres "SELECT count(*) FROM pg_database WHERE datname = '$TARGET'")"
[ "$EXISTS" = "0" ] || { echo "ERROR: database $TARGET already exists." >&2; exit 1; }

DROP_ON_EXIT=1
cleanup() {
  if [ "$DROP_ON_EXIT" = "1" ]; then
    pg dropdb --if-exists "$TARGET" >/dev/null 2>&1 || echo "warning: could not drop $TARGET; remove it by hand: dropdb $TARGET" >&2
  fi
}
trap cleanup EXIT
problem() { echo "RESTORE CHECK FAILED: $*" >&2; exit 1; }

echo "Stack: $STACK_NAME   live database: $PGDB (not touched)"
echo "Backup: $FILE ($(du -h "$FILE" | cut -f1))"
echo "1/4 creating $TARGET and loading the dump"
T0="$(now_s)"
pg createdb "$TARGET" || problem "could not create $TARGET"
# ON_ERROR_STOP: one failing statement fails the whole restore.
gunzip -c "$FILE" | pg psql -d "$TARGET" -v ON_ERROR_STOP=1 -q -X >/dev/null || problem "the dump did not load cleanly"
LOAD_S=$(( $(now_s) - T0 ))
echo "    loaded in ${LOAD_S}s"

echo "2/4 migrations"
FILES=("$PROJECT_ROOT"/backend/drizzle/[0-9][0-9][0-9][0-9]_*.sql)
TOTAL="${#FILES[@]}"
HAS_JOURNAL="$(sql "$TARGET" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_migrations'")"
[ "$HAS_JOURNAL" = "1" ] || problem "the backup has no app_migrations table (not a database of this application?)"
APPLIED="$(sql "$TARGET" "SELECT tag FROM app_migrations ORDER BY tag")"
PENDING=0; UNKNOWN=0
for f in "${FILES[@]}"; do has_text "$(basename "$f")" "$APPLIED" || PENDING=$((PENDING + 1)); done
while IFS= read -r tag; do
  [ -z "$tag" ] || [ -f "$PROJECT_ROOT/backend/drizzle/$tag" ] || UNKNOWN=$((UNKNOWN + 1))
done <<<"$APPLIED"
echo "    recorded: $(count_lines '.' "$APPLIED") of $TOTAL files; pending here: $PENDING; unknown to this checkout: $UNKNOWN"
[ "$UNKNOWN" = "0" ] || problem "the backup is from a NEWER version than this checkout ($UNKNOWN migrations unknown here); restore with that version"
[ "$PENDING" = "0" ] || echo "    note: $PENDING migration(s) will be applied when the application starts on this copy"

echo "3/4 contents (restored / live now)"
for t in tenants users organization_memberships students groups enrollments attendance invoices payments payment_allocations; do
  R="$(sql "$TARGET" "SELECT count(*) FROM \"$t\"")" || problem "table $t is missing or unreadable"
  L="$(sql "$PGDB" "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo "?")"
  printf '    %-26s %8s / %s\n' "$t" "$R" "$L"
done

echo "4/4 consistency of the money"
# These describe the data, not the restore: a finding is reported loudly but
# does not throw the copy away - in an emergency it is still the best there is.
WARNINGS=0
check_zero() {
  local n
  n="$(sql "$TARGET" "$2")" || problem "could not check: $1"
  if [ "$n" = "0" ]; then echo "    ok  $1"; else echo "    WARNING  $1: $n row(s)"; WARNINGS=$((WARNINGS + 1)); fi
}
check_zero "invoices where paid + remaining exceeds the amount" "SELECT count(*) FROM invoices WHERE amount_paid + remaining_amount > amount OR amount_paid < 0 OR remaining_amount < 0"
check_zero "invoices whose paid sum differs from their allocations" "SELECT count(*) FROM invoices i WHERE i.amount_paid <> (SELECT coalesce(sum(a.amount), 0) FROM payment_allocations a WHERE a.invoice_id = i.id)"
check_zero "payments allocated past their amount" "SELECT count(*) FROM payments p WHERE (SELECT coalesce(sum(a.amount), 0) FROM payment_allocations a WHERE a.payment_id = p.id) > p.amount"
check_zero "allocations without their payment or invoice" "SELECT count(*) FROM payment_allocations a LEFT JOIN payments p ON p.id = a.payment_id LEFT JOIN invoices i ON i.id = a.invoice_id WHERE p.id IS NULL OR i.id IS NULL"
check_zero "enrollments without their student or group" "SELECT count(*) FROM enrollments e LEFT JOIN students s ON s.id = e.student_id LEFT JOIN groups g ON g.id = e.group_id WHERE s.id IS NULL OR g.id IS NULL"
check_zero "active memberships without their user or center" "SELECT count(*) FROM organization_memberships m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN tenants t ON t.id = m.tenant_id WHERE u.id IS NULL OR t.id IS NULL"

echo
if [ "$WARNINGS" = "0" ]; then
  echo "RESTORE OK: the backup loads and is consistent (load ${LOAD_S}s, total $(( $(now_s) - T0 ))s)."
else
  echo "RESTORE LOADED WITH $WARNINGS WARNING(S): the dump restores, but the data has the inconsistencies listed above (load ${LOAD_S}s)."
fi
if [ "$KEEP" = "1" ]; then
  DROP_ON_EXIT=0
  cat <<EOF

The copy was kept as database "$TARGET". Nothing uses it yet.
To run the application on it (a deliberate step - the current data stays as "${PGDB}_before_<time>"):
  1. docker compose -f docker-compose.prod.yml stop backend
  2. docker compose -f docker-compose.prod.yml exec postgres psql -U $PGU -d postgres -c 'ALTER DATABASE "$PGDB" RENAME TO "${PGDB}_before_$(date +%Y%m%d%H%M)"'
  3. docker compose -f docker-compose.prod.yml exec postgres psql -U $PGU -d postgres -c 'ALTER DATABASE "$TARGET" RENAME TO "$PGDB"'
  4. docker compose -f docker-compose.prod.yml start backend      (applies any pending migration, then serves)
Uploaded files (homework, audio, images) are not in the database dump. From the matching archive:
  docker compose -f docker-compose.prod.yml exec -T backend tar -xzf - -C /app < backups/<stack>_<time>_uploads.tar.gz
To discard the copy instead:  docker compose -f docker-compose.prod.yml exec postgres dropdb -U $PGU "$TARGET"
EOF
else
  echo "The temporary copy $TARGET is being dropped (use --keep to keep it)."
fi
[ "$WARNINGS" = "0" ] || exit 3
