#!/usr/bin/env bash
# Tests of backup-core.sh with controlled failures. PostgreSQL's programs are
# fakes (their behaviour is chosen per test); gzip, tar, sha256sum and find
# are the real ones. The script under test is run with `sh`, as in the
# container.   bash scripts/production/backup-core.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="$HERE/backup-core.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REAL_TAR="$(command -v tar)"

mkdir -p "$WORK/bin" "$WORK/uploads/homework"
printf 'synthetic homework\n' > "$WORK/uploads/homework/hw-1.txt"
printf 'synthetic audio bytes\n' > "$WORK/uploads/listening-1.mp3"

# ---- fakes ------------------------------------------------------------------
cat > "$WORK/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
out=""; while [ $# -gt 0 ]; do [ "$1" = "-f" ] && { out="$2"; shift; }; shift; done
echo "pg_dump $out" >> "$FAKE_LOG"
full() { printf -- '-- PostgreSQL database dump\nCREATE TABLE app_migrations (tag text);\nCOPY tenants FROM stdin;\n1\n\\.\n--\n-- PostgreSQL database dump complete\n--\n'; }
case "${FAKE_PG_DUMP:-ok}" in
  ok) full | gzip > "$out"; exit 0 ;;
  fail-immediately) echo "pg_dump: error: connection to server failed" >&2; exit 1 ;;
  partial-then-fail) printf -- '-- PostgreSQL database dump\nCREATE TABLE app_migrations (tag text);\nCOPY tenants FROM stdin;\n1\n' | gzip > "$out"; echo "pg_dump: error: server closed the connection unexpectedly" >&2; exit 1 ;;
  truncated-but-exit-0) printf -- '-- PostgreSQL database dump\nCREATE TABLE app_migrations (tag text);\n' | gzip > "$out"; exit 0 ;;
  corrupt-gzip) full | gzip | head -c 40 > "$out"; exit 0 ;;
  disk-full) : > "$out"; echo "pg_dump: error: could not write to output file: No space left on device" >&2; exit 1 ;;
  empty-success) : > "$out"; exit 0 ;;
esac
EOF
cat > "$WORK/bin/psql" <<'EOF'
#!/usr/bin/env bash
echo "psql $*" >> "$FAKE_LOG"
args="$*"
case "$args" in
  *"-f "*) [ "${FAKE_RESTORE:-ok}" = "fail" ] && { echo 'psql:db.sql:3: ERROR:  relation "tenants" does not exist' >&2; exit 3; }; exit 0 ;;
  *"max(tag)"*) echo "0033_price_provenance.sql" ;;
  *"FROM app_migrations"*) case "$args" in *_bkcheck_*) echo "${FAKE_RESTORED_MIGRATIONS:-34}" ;; *) echo 34 ;; esac ;;
  *'FROM "'*) echo 4 ;;
esac
exit 0
EOF
for p in createdb dropdb; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "$FAKE_LOG"\n[ "${FAKE_%s:-ok}" = "fail" ] && exit 1\nexit 0\n' "$p" "$(echo "$p" | tr a-z A-Z)" > "$WORK/bin/$p"
done
cat > "$WORK/bin/tar" <<EOF
#!/usr/bin/env bash
if [ "\${FAKE_TAR:-ok}" = "fail" ] && [ "\$1" = "-czf" ]; then echo "tar: write error" >&2; : > "\$2"; exit 2; fi
exec "$REAL_TAR" "\$@"
EOF
chmod +x "$WORK"/bin/*
export FAKE_LOG="$WORK/fake.log"

failures=0
pass() { echo "  ok  $1"; }
fail() { echo "  FAILED  $1" >&2; failures=$((failures + 1)); }
check() { if "${@:2}"; then pass "$1"; else fail "$1"; fi; }
check_not() { if "${@:2}"; then fail "$1"; else pass "$1"; fi; }

ROOT=""
fresh() { ROOT="$WORK/backups-$RANDOM$RANDOM"; mkdir -p "$ROOT"; : > "$FAKE_LOG"; }
# run [VAR=value ...] -- mode
run() {
  local vars=()
  while [ "$1" != "--" ]; do vars+=("$1"); shift; done
  shift
  OUT="$(env PATH="$WORK/bin:$PATH" BACKUP_ROOT="$ROOT" UPLOADS_DIR="$WORK/uploads" STACK_NAME=talimcrm_test \
    POSTGRES_DB=talimcrm_test POSTGRES_PASSWORD=super-secret-db-password APP_REVISION=abc1234 "${vars[@]}" sh "$CORE" "$@" 2>&1)"
  RC=$?
}
sets() { find "$ROOT" -maxdepth 1 -type d -name 'talimcrm_test_*Z' | sort; }
count_sets() { sets | grep -c . ; }
leftovers() { find "$ROOT" -maxdepth 1 -name '.incomplete-*' | grep -c . ; }
# An older finished set, as a previous good run left it.
old_set() {
  local d="$ROOT/talimcrm_test_$1"
  mkdir -p "$d"; echo "good dump" | gzip > "$d/db.sql.gz"; echo '{"format":1}' > "$d/manifest.json"
  ( cd "$d" && sha256sum db.sql.gz > SHA256SUMS )
  touch -d "$2" "$d"
}
unharmed() { [ -f "$ROOT/talimcrm_test_$1/db.sql.gz" ] && ( cd "$ROOT/talimcrm_test_$1" && sha256sum -c SHA256SUMS >/dev/null 2>&1 ); }

echo "a successful backup"
fresh; run -- once
check "exit 0" [ "$RC" = "0" ]
check "exactly one set" [ "$(count_sets)" = "1" ]
SET="$(sets | head -n 1)"
check "the set holds the dump, the uploads, a manifest and checksums" [ -f "$SET/db.sql.gz" -a -f "$SET/uploads.tar.gz" -a -f "$SET/manifest.json" -a -f "$SET/SHA256SUMS" ]
check "the checksums match the files" bash -c "cd '$SET' && sha256sum -c SHA256SUMS >/dev/null 2>&1"
check "the name carries a UTC timestamp" bash -c "[[ '$(basename "$SET")' =~ ^talimcrm_test_[0-9]{8}T[0-9]{6}Z$ ]]"
M="$(cat "$SET/manifest.json")"
check "manifest: stack, revision, latest migration" bash -c "[[ '$M' == *'\"stack\": \"talimcrm_test\"'* && '$M' == *'\"application_revision\": \"abc1234\"'* && '$M' == *'0033_price_provenance.sql'* && '$M' == *'\"migrations_applied\": 34'* ]]"
check "manifest: the uploads are counted" bash -c "[[ '$M' == *'\"files\": 2'* && '$M' == *'\"state\": \"archived\"'* ]]"
check "manifest: says the dump was restored as a check" bash -c "[[ '$M' == *'restored into a scratch database'* ]]"
check "manifest is valid JSON" node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$SET/manifest.json"
check_not "no secret in the set's manifest or checksums" grep -rq "super-secret-db-password" "$SET/manifest.json" "$SET/SHA256SUMS"
check "the uploads archive really contains the files" bash -c "'$REAL_TAR' -tzf '$SET/uploads.tar.gz' | grep -q 'homework/hw-1.txt'"
check "the scratch database was created and dropped" bash -c "grep -q '^createdb talimcrm_test_bkcheck_' '$FAKE_LOG' && grep -q '^dropdb talimcrm_test_bkcheck_' '$FAKE_LOG'"
check "no work folder is left" [ "$(leftovers)" = "0" ]
check "the lock is released" [ ! -e "$ROOT/.backup.lock" ]
check "success is recorded" [ -f "$ROOT/.state/last-success" -a ! -f "$ROOT/.state/last-failure" ]
run -- healthcheck; check "healthcheck is green after a success" [ "$RC" = "0" ]

failing_case() { # name, expected message, env...
  local title="$1" msg="$2"; shift 2
  echo "$title"
  fresh
  old_set 20260901T220000Z "30 days ago"; old_set 20260925T220000Z "5 days ago"
  run "$@" -- once
  check "exit 1" [ "$RC" = "1" ]
  check "says it failed, and why" bash -c "[[ \"\$1\" == *'BACKUP FAILED'* && \"\$1\" == *\"\$2\"* ]]" _ "$OUT" "$msg"
  check_not "does not claim success" bash -c "[[ \"\$1\" == *complete\ -* ]]" _ "$OUT"
  check "no new set appears" [ "$(count_sets)" = "2" ]
  check "no partial file is left behind" [ "$(leftovers)" = "0" ]
  check "the 30-day-old good set is still there (a failure prunes nothing)" unharmed 20260901T220000Z
  check "the recent good set is untouched" unharmed 20260925T220000Z
  check "the lock is released" [ ! -e "$ROOT/.backup.lock" ]
  check "the failure is recorded" [ -f "$ROOT/.state/last-failure" ]
  run -- healthcheck; check "healthcheck is red" [ "$RC" = "1" ]
}
failing_case "pg_dump fails immediately" "pg_dump did not finish" FAKE_PG_DUMP=fail-immediately
failing_case "pg_dump writes partial output, then fails" "pg_dump did not finish" FAKE_PG_DUMP=partial-then-fail
failing_case "pg_dump exits 0 but the dump is cut short" "incomplete" FAKE_PG_DUMP=truncated-but-exit-0
failing_case "pg_dump exits 0 with an empty file" "not a valid gzip" FAKE_PG_DUMP=empty-success
failing_case "the compressed output is damaged" "not a valid gzip" FAKE_PG_DUMP=corrupt-gzip
failing_case "writing to the destination fails (disk full)" "pg_dump did not finish" FAKE_PG_DUMP=disk-full
failing_case "archiving the uploads fails" "could not archive the uploads" FAKE_TAR=fail
failing_case "the dump does not restore" "does not restore" FAKE_RESTORE=fail
check "the scratch database of the failed check was dropped" bash -c "grep -q '^dropdb --if-exists talimcrm_test_bkcheck_' '$FAKE_LOG'"
failing_case "the restored copy lacks migrations" "records 12 migrations" FAKE_RESTORED_MIGRATIONS=12
failing_case "the uploads folder is not mounted" "not a recovery set" UPLOADS_DIR=/nonexistent/uploads

echo "the scratch database could not be created: nothing is dropped"
fresh; run FAKE_CREATEDB=fail -- once
check "exit 1" [ "$RC" = "1" ]
check_not "dropdb is not called for a database this run did not create" grep -q '^dropdb' "$FAKE_LOG"

echo "uploads deliberately not part of the stack"
fresh; run UPLOADS_DIR=/nonexistent/uploads BACKUP_REQUIRE_UPLOADS=0 -- once
check "exit 0" [ "$RC" = "0" ]
check "the manifest says there are no uploads" grep -q '"state": "none"' "$(sets | head -n 1)/manifest.json"

echo "a successful backup, then normal retention"
fresh
old_set 20260801T220000Z "60 days ago"; old_set 20260815T220000Z "45 days ago"; old_set 20260901T220000Z "30 days ago"
old_set 20260920T220000Z "10 days ago"; old_set 20260928T220000Z "2 days ago"
run BACKUP_KEEP_DAYS=14 BACKUP_MIN_KEEP=3 -- once
check "exit 0" [ "$RC" = "0" ]
check_not "60-day-old set removed" [ -e "$ROOT/talimcrm_test_20260801T220000Z" ]
check_not "45-day-old set removed" [ -e "$ROOT/talimcrm_test_20260815T220000Z" ]
check_not "30-day-old set removed" [ -e "$ROOT/talimcrm_test_20260901T220000Z" ]
check "10-day-old set kept" unharmed 20260920T220000Z
check "2-day-old set kept" unharmed 20260928T220000Z
check "three sets remain (two recent + the new one)" [ "$(count_sets)" = "3" ]
echo "retention never goes below the minimum number of sets"
fresh
old_set 20260601T220000Z "120 days ago"; old_set 20260701T220000Z "90 days ago"; old_set 20260801T220000Z "60 days ago"
run BACKUP_KEEP_DAYS=14 BACKUP_MIN_KEEP=3 -- once
check "old sets beyond the minimum are removed, the newest three stay" bash -c "[ \"\$(find '$ROOT' -maxdepth 1 -type d -name 'talimcrm_test_*Z' | wc -l | tr -d ' ')\" = 3 ] && [ -e '$ROOT/talimcrm_test_20260801T220000Z' ] && [ -e '$ROOT/talimcrm_test_20260701T220000Z' ] && [ ! -e '$ROOT/talimcrm_test_20260601T220000Z' ]"
echo "with off-server copies configured, a set not yet copied off is never pruned"
fresh
old_set 20260801T220000Z "60 days ago"; old_set 20260815T220000Z "45 days ago"; old_set 20260901T220000Z "30 days ago"
mkdir -p "$ROOT/.state/offsite"; touch "$ROOT/.state/offsite/talimcrm_test_20260815T220000Z.ok"
run BACKUP_KEEP_DAYS=14 BACKUP_MIN_KEEP=1 BACKUP_OFFSITE_REQUIRED=1 -- once
check "exit 0" [ "$RC" = "0" ]
check "a copied-off old set is pruned" bash -c "[ ! -e '$ROOT/talimcrm_test_20260815T220000Z' ]"
check "old sets not yet copied off are kept" bash -c "[ -e '$ROOT/talimcrm_test_20260801T220000Z' ] && [ -e '$ROOT/talimcrm_test_20260901T220000Z' ]"
check "and it says why" grep -q "not yet copied off-server" <<<"$OUT"
echo "another stack's sets in the same folder are not this stack's to prune"
fresh; mkdir -p "$ROOT/talimcrm_20260101T220000Z"; echo '{}' > "$ROOT/talimcrm_20260101T220000Z/manifest.json"; touch -d "200 days ago" "$ROOT/talimcrm_20260101T220000Z"
old_set 20260601T220000Z "120 days ago"; old_set 20260701T220000Z "90 days ago"; old_set 20260801T220000Z "60 days ago"
run BACKUP_MIN_KEEP=1 -- once
check "the other stack's set is left alone" [ -e "$ROOT/talimcrm_20260101T220000Z/manifest.json" ]

echo "overlapping runs"
fresh; mkdir -p "$ROOT/.backup.lock"; date -u +%s > "$ROOT/.backup.lock/started"
run -- once
check "a second run exits without doing anything (exit 75)" [ "$RC" = "75" ]
check "it made no set and called no pg_dump" bash -c "[ \"$(count_sets)\" = 0 ] && ! grep -q pg_dump '$FAKE_LOG'"
check "it left the other run's lock in place" [ -d "$ROOT/.backup.lock" ]
echo $(( $(date -u +%s) - 90000 )) > "$ROOT/.backup.lock/started"
run -- once
check "a lock left by a dead run (25 h old) is taken over" [ "$RC" = "0" ]
check "and that run completes" [ "$(count_sets)" = "1" ]
fresh
( env PATH="$WORK/bin:$PATH" BACKUP_ROOT="$ROOT" UPLOADS_DIR="$WORK/uploads" STACK_NAME=talimcrm_test sh "$CORE" once >/dev/null 2>&1 & )
( env PATH="$WORK/bin:$PATH" BACKUP_ROOT="$ROOT" UPLOADS_DIR="$WORK/uploads" STACK_NAME=talimcrm_test sh "$CORE" once >/dev/null 2>&1 & )
sleep 6
check "two runs started together leave no damaged set" bash -c "for d in '$ROOT'/talimcrm_test_*Z; do [ -d \"\$d\" ] || continue; ( cd \"\$d\" && sha256sum -c SHA256SUMS >/dev/null 2>&1 ) || exit 1; done; [ \"\$(find '$ROOT' -maxdepth 1 -name '.incomplete-*' | wc -l | tr -d ' ')\" = 0 ]"

echo "healthcheck before any backup"
fresh; mkdir -p "$ROOT/.state"; date -u +%s > "$ROOT/.state/daemon-started"
run -- healthcheck; check "green while waiting for the first scheduled run" [ "$RC" = "0" ]
echo $(( $(date -u +%s) - 100000 )) > "$ROOT/.state/daemon-started"
run -- healthcheck; check "red when a day passed without any backup" [ "$RC" = "1" ]

echo
if [ "$failures" -gt 0 ]; then echo "$failures check(s) failed" >&2; exit 1; fi
echo "backup-core: all checks passed"
