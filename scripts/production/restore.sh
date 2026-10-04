#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - restore a backup INTO A NEW, SEPARATE DATABASE and check it.
# The live database is never written to, dropped or renamed here.
#
#   bash scripts/production/restore.sh backups/<stack>_<time>Z            drill: restore, check, drop
#   bash scripts/production/restore.sh backups/<stack>_<time>Z --keep     restore, check, keep the copy
#   (a single older <name>.sql.gz file is accepted too; it has no checksums)
#
# It reports three different things, separately:
#   LOADED      the dump loaded into the new database without one error
#   CONSISTENT  the restored data passed the checks: migrations known to
#               this checkout, core tables present, money adds up
#   APPLICATION not checked here. That the application starts and works on
#               the copy is proven by scripts/production/restore-rehearsal.sh
#               (disposable containers) or by switching to the kept copy.
#
# The only database this script may drop is the one it created itself in
# this run: if creating it fails, or the name is taken, nothing is dropped.
# Switching the application to a kept copy is a separate, deliberate step:
# the exact commands are printed at the end, with the uploaded files.
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

SRC="${1:-}"
KEEP=0
[ "${2:-}" = "--keep" ] && KEEP=1
[ -n "$SRC" ] || die "Usage: $0 <recovery set folder | backup.sql.gz> [--keep]"
load_stack

if [ -d "$SRC" ]; then
  SET="$(cd "$SRC" && pwd)"
  DUMP="$SET/db.sql.gz"
  [ -f "$DUMP" ] && [ -f "$SET/SHA256SUMS" ] && [ -f "$SET/manifest.json" ] || die "ERROR: $SRC is not a complete recovery set (db.sql.gz, manifest.json, SHA256SUMS)."
  ( cd "$SET" && sha256sum -c SHA256SUMS >/dev/null 2>&1 ) || die "ERROR: the checksums of $SRC do not match - the set is damaged or was altered."
  CHECKSUMS="verified"
elif [ -f "$SRC" ]; then
  SET=""
  DUMP="$SRC"
  CHECKSUMS="none (a single file, not a recovery set)"
else
  die "ERROR: $SRC not found."
fi
gzip -t "$DUMP" || die "ERROR: $DUMP is not a valid gzip file."
require_stack

TARGET="${PGDB}_restore_$(date -u +%Y%m%d%H%M%S)"
safe_dbname "$TARGET" || die "ERROR: unusable database name \"$TARGET\"."
[ "$TARGET" != "$PGDB" ] || die "ERROR: the target would be the live database."

# Set only after createdb succeeded: the exit handler must never drop a
# database this run did not create (a name collision, a failed createdb).
CREATED=0
cleanup() {
  if [ "$CREATED" = "1" ] && [ "$KEEP_COPY" = "0" ]; then
    pg dropdb --if-exists "$TARGET" >/dev/null 2>&1 || echo "warning: could not drop $TARGET; remove it by hand: dropdb $TARGET" >&2
  fi
}
KEEP_COPY=0
trap cleanup EXIT
problem() { echo "RESTORE CHECK FAILED: $*" >&2; exit 1; }

echo "Stack: $STACK_NAME   live database: $PGDB (not touched)"
echo "Backup: $SRC ($(du -h "$DUMP" | cut -f1) database dump; checksums: $CHECKSUMS)"
if [ -n "$SET" ]; then
  echo "    made:     $(json_string created_utc "$(cat "$SET/manifest.json")")   revision: $(json_string application_revision "$(cat "$SET/manifest.json")")   latest migration: $(json_string latest_migration "$(cat "$SET/manifest.json")")"
fi

echo "1/4 creating $TARGET and loading the dump"
EXISTS="$(sql postgres "SELECT count(*) FROM pg_database WHERE datname = '$TARGET'")" || problem "could not query the server"
[ "$EXISTS" = "0" ] || problem "a database named $TARGET already exists; nothing was changed"
T0="$(now_s)"
pg createdb "$TARGET" || problem "could not create $TARGET; nothing was changed"
CREATED=1
# ON_ERROR_STOP: one failing statement fails the whole restore.
gunzip -c "$DUMP" | pg psql -d "$TARGET" -v ON_ERROR_STOP=1 -q -X >/dev/null || problem "the dump did not load cleanly"
LOAD_S=$(( $(now_s) - T0 ))
echo "    LOADED: yes, in ${LOAD_S}s"

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
echo "RESULT"
echo "  LOADED:      yes (${LOAD_S}s; total $(( $(now_s) - T0 ))s)"
if [ "$WARNINGS" = "0" ]; then echo "  CONSISTENT:  yes"; else echo "  CONSISTENT:  NO - $WARNINGS finding(s) above"; fi
# For offsite.sh status: when this server last proved a set restores.
if [ "$WARNINGS" = "0" ]; then
  case "$(cd "$(dirname "$SRC")" 2>/dev/null && pwd)" in
    "$BACKUP_ROOT"*) ORIGIN="local set" ;;
    *) ORIGIN="copy outside the backup folder (e.g. fetched off-server)" ;;
  esac
  { mkdir -p "$BACKUP_ROOT/.state" && printf '%s  %s (%s), loaded and consistent\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$SRC")" "$ORIGIN" > "$BACKUP_ROOT/.state/last-restore-check"; } 2>/dev/null \
    || echo "  (could not record the check in $BACKUP_ROOT/.state - run with sudo to record it)"
fi
echo "  APPLICATION: not checked by this script (see restore-rehearsal.sh)"
if [ "$KEEP" = "1" ]; then
  KEEP_COPY=1
  echo "RESTORED_DATABASE=$TARGET"
  cat <<EOF

The copy was kept as database "$TARGET". Nothing uses it yet.
To run the application on it (a deliberate step - the current data stays as "${PGDB}_before_<time>"):
  1. bash scripts/production/stack.sh stop backend
  2. bash scripts/production/stack.sh exec postgres psql -U $PGU -d postgres -c 'ALTER DATABASE "$PGDB" RENAME TO "${PGDB}_before_$(date -u +%Y%m%d%H%M)"'
  3. bash scripts/production/stack.sh exec postgres psql -U $PGU -d postgres -c 'ALTER DATABASE "$TARGET" RENAME TO "$PGDB"'
  4. bash scripts/production/stack.sh start backend      (applies any pending migration, then serves)
Uploaded files (homework, audio, images) are not in the database. From the same set, into the uploads volume:
  bash scripts/production/stack.sh exec -T backend tar -xzf - -C /app/uploads < <set folder>/uploads.tar.gz
To discard the copy instead:  bash scripts/production/stack.sh exec postgres dropdb -U $PGU "$TARGET"
EOF
else
  echo "The temporary copy $TARGET is being dropped (use --keep to keep it)."
fi
[ "$WARNINGS" = "0" ] || exit 3
