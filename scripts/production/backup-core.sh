#!/bin/sh
# ==============================================================================
# TalimCRM - the one implementation of "make a backup". POSIX sh: it runs
# inside the db-backup container (postgres:16-alpine) both for the nightly
# schedule and for a backup started by hand (scripts/production/backup.sh),
# so the two cannot behave differently.
#
#   backup-core.sh once          make one recovery set now
#   backup-core.sh daemon        make one every day at BACKUP_AT_UTC
#   backup-core.sh healthcheck   exit 0 while backups are succeeding
#
# A RECOVERY SET is a folder  <BACKUP_ROOT>/<stack>_<UTC time>Z/  holding
#   db.sql.gz        the database (plain SQL, gzip)
#   uploads.tar.gz   the uploaded files (homework, audio, images)
#   manifest.json    what this is: stack, time (UTC), application revision,
#                    latest migration, sizes, file counts, checks performed
#   SHA256SUMS       checksums of the two archives
# No secret is written into a set's manifest. The archives themselves hold
# the centers' data: the folder is created for its owner only (umask 077).
#
# Rules:
#   - Work happens in  .incomplete-<name>/  and the folder gets its final
#     name only when every step succeeded. Anything else is removed: a
#     partial backup is never left looking like a good one.
#   - pg_dump writes its own compressed file (no shell pipe that could hide
#     its failure); its exit status, the gzip stream, the "dump complete"
#     marker and - unless switched off - an actual restore into a scratch
#     database are checked before the set is accepted.
#   - Old sets are deleted ONLY after a new one was finalized, never after a
#     failure, and the newest BACKUP_MIN_KEEP sets are kept whatever their
#     age.
#   - One backup at a time per backup folder (a lock directory); a second
#     one started meanwhile exits without touching anything.
#   - All times are UTC and say so (the trailing Z); the daily run happens
#     at BACKUP_AT_UTC (default 22:00 UTC = 03:00 in Tashkent).
#
# Consistency: the database is dumped first (one consistent snapshot), the
# files after it. Every file the dump refers to already existed and is in
# the archive, unless it was deleted in the seconds between the two steps; a
# file uploaded in that window is in the archive without a database row,
# which is harmless.
# ==============================================================================
set -u
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"
STACK_NAME="${STACK_NAME:-talimcrm}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
MIN_KEEP="${BACKUP_MIN_KEEP:-3}"
AT_UTC="${BACKUP_AT_UTC:-22:00}"
VERIFY_RESTORE="${BACKUP_VERIFY_RESTORE:-1}"
REQUIRE_UPLOADS="${BACKUP_REQUIRE_UPLOADS:-1}"
LOCK_STALE_S="${BACKUP_LOCK_STALE_S:-21600}"
APP_REVISION="${APP_REVISION:-unknown}"
# Off-server copies (scripts/production/offsite.sh): when configured, a set
# is pruned only with an acknowledgement for THIS destination.
OFFSITE_DRIVER="${BACKUP_OFFSITE_DRIVER:-}"
OFFSITE_TARGET="${BACKUP_OFFSITE_TARGET:-}"
export PGHOST="${PGHOST:-${POSTGRES_HOST:-postgres}}"
export PGUSER="${PGUSER:-${POSTGRES_USER:-postgres}}"
export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"
DB="${PGDATABASE:-${POSTGRES_DB:-talimcrm}}"

LOCK="$BACKUP_ROOT/.backup.lock"
STATE="$BACKUP_ROOT/.state"
log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
now() { date -u +%s; }

WORK=""; SCRATCH_DB=""; HAVE_LOCK=0
cleanup() {
  [ -n "$WORK" ] && [ -d "$WORK" ] && rm -rf "$WORK"
  # Only a scratch database this run created.
  [ -n "$SCRATCH_DB" ] && dropdb --if-exists "$SCRATCH_DB" >/dev/null 2>&1
  [ "$HAVE_LOCK" = "1" ] && rm -rf "$LOCK"
  return 0
}
fail() {
  log "BACKUP FAILED: $*"
  mkdir -p "$STATE" 2>/dev/null && { now > "$STATE/last-failure"; printf '%s\n' "$*" > "$STATE/last-failure-reason"; }
  cleanup
  exit 1
}

take_lock() {
  mkdir -p "$BACKUP_ROOT" || { log "BACKUP FAILED: cannot create $BACKUP_ROOT"; exit 1; }
  if ! mkdir "$LOCK" 2>/dev/null; then
    started="$(cat "$LOCK/started" 2>/dev/null || echo 0)"
    age=$(( $(now) - started ))
    if [ "$started" -gt 0 ] && [ "$age" -lt "$LOCK_STALE_S" ]; then
      log "another backup has been running for ${age}s (lock $LOCK); this one does nothing"
      exit 75
    fi
    log "removing a stale lock (${age}s old)"
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || { log "BACKUP FAILED: could not take the lock"; exit 1; }
  fi
  HAVE_LOCK=1
  now > "$LOCK/started"
}

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

once() {
  take_lock
  trap 'cleanup; exit 130' INT TERM
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  name="${STACK_NAME}_${stamp}"
  final="$BACKUP_ROOT/$name"
  [ ! -e "$final" ] || fail "a set named $name already exists"
  # Leftovers of runs that died without cleaning up (never a finished set).
  find "$BACKUP_ROOT" -maxdepth 1 -type d -name '.incomplete-*' -mmin +60 -exec rm -rf {} + 2>/dev/null
  WORK="$BACKUP_ROOT/.incomplete-$name"
  mkdir "$WORK" || fail "cannot write to $BACKUP_ROOT"
  t0="$(now)"
  log "backup $name: database \"$DB\""

  # --- 1. database
  pg_dump --no-owner --no-privileges -Z 6 -f "$WORK/db.sql.gz" "$DB" || fail "pg_dump did not finish (exit $?)"
  gzip -t "$WORK/db.sql.gz" 2>/dev/null || fail "the database dump is not a valid gzip stream"
  # pg_dump ends a complete plain dump with this line.
  tail_text="$(gzip -dc "$WORK/db.sql.gz" | tail -n 8)"
  case "$tail_text" in
    *"PostgreSQL database dump complete"*) ;;
    *) fail "the database dump is incomplete (no completion marker)" ;;
  esac
  db_bytes="$(wc -c < "$WORK/db.sql.gz" | tr -d ' ')"
  latest_migration="$(psql -d "$DB" -AtX -c "SELECT coalesce(max(tag), '') FROM app_migrations" 2>/dev/null | tr -d '\r')" || latest_migration=""
  migrations="$(psql -d "$DB" -AtX -c "SELECT count(*) FROM app_migrations" 2>/dev/null | tr -d '\r')" || migrations=""
  t_db=$(( $(now) - t0 ))

  # --- 2. does it restore? (a gzip check cannot tell)
  restore_check="skipped"
  if [ "$VERIFY_RESTORE" = "1" ]; then
    t1="$(now)"
    scratch="${DB}_bkcheck_$(date -u +%H%M%S)_$$"
    createdb "$scratch" || fail "could not create the scratch database for the restore check"
    SCRATCH_DB="$scratch"
    gzip -dc "$WORK/db.sql.gz" > "$WORK/db.sql" || fail "could not unpack the dump for the restore check"
    psql -d "$scratch" -v ON_ERROR_STOP=1 -q -X -f "$WORK/db.sql" >/dev/null 2>"$WORK/restore.err" || fail "the dump does not restore: $(tail -n 2 "$WORK/restore.err" | tr '\n' ' ')"
    rm -f "$WORK/db.sql" "$WORK/restore.err"
    restored_migrations="$(psql -d "$scratch" -AtX -c "SELECT count(*) FROM app_migrations" | tr -d '\r')" || fail "the restored copy has no migration record"
    [ "$restored_migrations" = "$migrations" ] || fail "the restored copy records $restored_migrations migrations, the database $migrations"
    for t in tenants users students payments; do
      a="$(psql -d "$DB" -AtX -c "SELECT count(*) FROM \"$t\"" | tr -d '\r')"
      b="$(psql -d "$scratch" -AtX -c "SELECT count(*) FROM \"$t\"" | tr -d '\r')" || fail "table $t is missing from the restored copy"
      # The live database may have gained rows since the dump; it cannot have fewer... and the copy cannot have more.
      [ "$b" -le "$a" ] || fail "the restored copy has more rows in $t ($b) than the database ($a)"
    done
    dropdb "$scratch" || fail "could not drop the scratch database $scratch"
    SCRATCH_DB=""
    restore_check="restored into a scratch database and dropped ($(( $(now) - t1 ))s)"
  fi

  # --- 3. uploaded files
  uploads_files=0; uploads_bytes=0; uploads_state="none"
  if [ -d "$UPLOADS_DIR" ]; then
    tar -czf "$WORK/uploads.tar.gz" -C "$UPLOADS_DIR" . || fail "could not archive the uploads (exit $?)"
    gzip -t "$WORK/uploads.tar.gz" 2>/dev/null || fail "the uploads archive is not a valid gzip stream"
    listing="$(tar -tzf "$WORK/uploads.tar.gz")" || fail "the uploads archive cannot be listed"
    uploads_files="$(printf '%s\n' "$listing" | grep -vc '/$')"
    uploads_bytes="$(wc -c < "$WORK/uploads.tar.gz" | tr -d ' ')"
    uploads_state="archived"
  elif [ "$REQUIRE_UPLOADS" = "1" ]; then
    fail "the uploads folder $UPLOADS_DIR is not available (a set without the files is not a recovery set)"
  fi

  # --- 4. describe it
  ( cd "$WORK" && if [ -f uploads.tar.gz ]; then sha256sum db.sql.gz uploads.tar.gz; else sha256sum db.sql.gz; fi > SHA256SUMS ) || fail "could not compute the checksums"
  # ("hash  name" - some sha256sum builds write "hash *name")
  db_sha="$(sed -n 's/^\([0-9a-f]*\) [ *]db.sql.gz$/\1/p' "$WORK/SHA256SUMS")"
  up_sha="$(sed -n 's/^\([0-9a-f]*\) [ *]uploads.tar.gz$/\1/p' "$WORK/SHA256SUMS")"
  [ -n "$db_sha" ] || fail "no checksum for the database dump"
  cat > "$WORK/manifest.json" <<EOF
{
  "format": 1,
  "stack": "$(json_escape "$STACK_NAME")",
  "created_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "application_revision": "$(json_escape "$APP_REVISION")",
  "database": {
    "name": "$(json_escape "$DB")",
    "file": "db.sql.gz",
    "bytes": $db_bytes,
    "sha256": "$db_sha",
    "migrations_applied": ${migrations:-null},
    "latest_migration": "$(json_escape "$latest_migration")",
    "dump_seconds": $t_db,
    "restore_check": "$(json_escape "$restore_check")"
  },
  "uploads": {
    "state": "$uploads_state",
    "file": $( [ "$uploads_state" = "archived" ] && echo '"uploads.tar.gz"' || echo null ),
    "files": $uploads_files,
    "bytes": $uploads_bytes,
    "sha256": $( [ -n "$up_sha" ] && echo "\"$up_sha\"" || echo null )
  },
  "order": "database first, then uploads"
}
EOF
  [ -s "$WORK/manifest.json" ] || fail "could not write the manifest"

  # --- 5. accept it
  mv "$WORK" "$final" || fail "could not finalize the set"
  WORK=""
  mkdir -p "$STATE" && now > "$STATE/last-success" && printf '%s\n' "$name" > "$STATE/last-set" && rm -f "$STATE/last-failure" "$STATE/last-failure-reason"
  log "backup $name: complete - database ${db_bytes} bytes, uploads ${uploads_files} file(s) ${uploads_bytes} bytes, $(( $(now) - t0 ))s"

  # --- 6. retention: only now, after a good set exists
  prune
  cleanup
  trap - INT TERM
  return 0
}

# Finished sets of this stack, oldest first (the name sorts by time).
finished_sets() {
  for d in "$BACKUP_ROOT/${STACK_NAME}_"*Z; do
    [ -d "$d" ] && [ -f "$d/manifest.json" ] && printf '%s\n' "$d"
  done | sort
}

prune() {
  # An off-server run may be checking or repairing from these sets: wait.
  if [ -n "$OFFSITE_DRIVER" ] && [ -d "$BACKUP_ROOT/.offsite.lock" ] && [ $(( $(now) - $(cat "$BACKUP_ROOT/.offsite.lock/started" 2>/dev/null || echo 0) )) -le "$LOCK_STALE_S" ]; then
    log "pruning postponed: an off-server run is using the sets"
    return 0
  fi
  if [ -n "$OFFSITE_DRIVER" ]; then
    ACKS="$STATE/offsite/$(printf '%s|%s' "$OFFSITE_DRIVER" "$OFFSITE_TARGET" | sha256sum | cut -c1-16)"
  fi
  total="$(finished_sets | grep -c .)"
  removable=$(( total - MIN_KEEP ))
  [ "$removable" -gt 0 ] || return 0
  finished_sets | head -n "$removable" | while IFS= read -r d; do
    # With off-server copies configured, a set not yet copied off the
    # server is kept, however old (scripts/production/offsite.sh).
    if [ -n "$OFFSITE_DRIVER" ] && [ ! -f "$ACKS/$(basename "$d").ok" ]; then
      log "kept $(basename "$d"): not yet copied off-server (no acknowledgement for this destination)"
      continue
    fi
    if [ -n "$(find "$d" -maxdepth 0 -mtime +"$KEEP_DAYS" 2>/dev/null)" ]; then
      rm -rf "$d" && log "removed old set $(basename "$d") (older than $KEEP_DAYS days)"
    fi
  done
  return 0
}

daemon() {
  mkdir -p "$STATE" || { log "cannot write to $BACKUP_ROOT"; exit 1; }
  now > "$STATE/daemon-started"
  log "backup schedule: every day at $AT_UTC UTC; sets in $BACKUP_ROOT; kept $KEEP_DAYS days (at least $MIN_KEEP sets)"
  while :; do
    if [ "$(date -u +%H:%M)" = "$AT_UTC" ] && [ "$(cat "$STATE/last-attempt-day" 2>/dev/null)" != "$(date -u +%Y-%m-%d)" ]; then
      date -u +%Y-%m-%d > "$STATE/last-attempt-day"
      # In a subshell: a failed backup is reported and the schedule goes on.
      ( once ) || log "tonight's backup did not succeed; the earlier sets were left as they are"
    fi
    sleep 20 & wait $!
  done
}

healthcheck() {
  limit=93600 # 26 hours
  if [ -f "$STATE/last-failure" ]; then
    echo "last backup failed: $(cat "$STATE/last-failure-reason" 2>/dev/null)"
    exit 1
  fi
  if [ -f "$STATE/last-success" ]; then
    age=$(( $(now) - $(cat "$STATE/last-success") ))
    [ "$age" -lt "$limit" ] && { echo "last backup ${age}s ago"; exit 0; }
    echo "no successful backup for ${age}s"; exit 1
  fi
  started="$(cat "$STATE/daemon-started" 2>/dev/null || echo 0)"
  [ $(( $(now) - started )) -lt "$limit" ] && { echo "waiting for the first scheduled backup"; exit 0; }
  echo "no backup has ever succeeded"; exit 1
}

case "${1:-}" in
  once) once ;;
  daemon) trap 'exit 0' TERM INT; daemon ;;
  healthcheck) healthcheck ;;
  *) echo "usage: backup-core.sh once|daemon|healthcheck" >&2; exit 2 ;;
esac
