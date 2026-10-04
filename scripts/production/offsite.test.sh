#!/usr/bin/env bash
# Tests of offsite.sh with LOCAL stand-ins for the remote storage: the "dir"
# driver on a temporary folder, and a fake rclone that keeps its "bucket" in
# a temporary folder. Faults are injected into the copy commands. These are
# simulations: they prove the rules (what is sent, when a remote set counts
# as usable, what a failure leaves behind), not a real provider.
#
#   bash scripts/production/offsite.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failures=0
pass() { echo "  ok  $1"; }
fail() { echo "  FAILED  $1" >&2; failures=$((failures + 1)); }
check() { if "${@:2}"; then pass "$1"; else fail "$1"; fi; }
has() { grep -qF -- "$2" <<<"$1"; }

# Fault injection: a cp/rclone in front of the real ones.
mkdir -p "$WORK/bin"
REAL_CP="$(command -v cp)"
cat > "$WORK/bin/cp" <<EOF
#!/usr/bin/env bash
# FAULT_FAIL=<name>: fail copying that file; FAULT_TRUNCATE=<name>: copy half of it and say "done".
for a in "\$@"; do last="\$a"; done
src="\${@: -2:1}"
case "\$src" in
  *"\${FAULT_FAIL:-@@}"*) echo "cp: write error (injected)" >&2; exit 1 ;;
  *"\${FAULT_TRUNCATE:-@@}"*) head -c \$(( \$(wc -c < "\$src") / 2 )) "\$src" > "\$last"; exit 0 ;;
esac
exec "$REAL_CP" "\$@"
EOF
chmod +x "$WORK/bin/cp"
# A fake rclone: "<remote>:<path>" lives under \$FAKE_BUCKET/<path>.
cat > "$WORK/bin/rclone" <<'EOF'
#!/usr/bin/env bash
map() { case "$1" in *:*) printf '%s/%s' "$FAKE_BUCKET" "${1#*:}" ;; *) printf '%s' "$1" ;; esac; }
cmd="$1"; shift
args=(); for a in "$@"; do case "$a" in --*) ;; '/*/COMPLETE'|COMPLETE) ;; *) args+=("$a") ;; esac; done
case "$cmd" in
  lsf) [ "${FAULT_RCLONE:-}" = lsf ] && exit 1
       root="$(map "${args[0]}")"; [ -d "$root" ] || exit 3
       for m in "$root"/*/COMPLETE; do if [ -f "$m" ]; then echo "$(basename "$(dirname "$m")")/COMPLETE"; fi; done ;;
  copyto) [ "${FAULT_RCLONE:-}" = copyto ] && { echo "rclone: upload failed (injected)" >&2; exit 1; }
          dst="$(map "${args[1]}")"; mkdir -p "$(dirname "$dst")"; command cp "${args[0]}" "$dst" ;;
  check) [ "${FAULT_RCLONE:-}" = check ] && exit 1
         l="${args[0]}"; r="$(map "${args[1]}")"; for f in "$l"/*; do cmp -s "$f" "$r/$(basename "$f")" || exit 1; done ;;
  copy) s="$(map "${args[0]}")"; mkdir -p "${args[1]}"; command cp "$s"/* "${args[1]}/" ;;
  *) echo "fake rclone: $cmd not supported" >&2; exit 2 ;;
esac
EOF
chmod +x "$WORK/bin/rclone"

CO=""; BK=""; REMOTE=""
checkout() { # $1 = driver lines for .env
  CO="$WORK/co-$RANDOM$RANDOM"; BK="$CO/backups"; REMOTE="$WORK/remote-$RANDOM$RANDOM"
  mkdir -p "$CO/scripts" "$BK"
  cp -r "$REPO/scripts/production" "$CO/scripts/"
  cp "$REPO/docker-compose.prod.yml" "$CO/"
  printf 'STACK_NAME=talimcrm_staging\nCOMPOSE_PROJECT_NAME=talimcrm_staging\nDOMAIN=staging.school.uz\nPOSTGRES_DB=talimcrm_staging\nPOSTGRES_PASSWORD=pw-that-must-not-leak-0123456789\nBACKUP_DIR=./backups\n%s\n' "$1" > "$CO/.env"
}
stamp() { date -u -d "$1" +%Y%m%dT%H%M%SZ; }
make_set() { # age -> a finished set in the local backup folder
  local d="$BK/talimcrm_staging_$(stamp "$1")"
  mkdir -p "$d"
  head -c 20000 /dev/urandom | gzip > "$d/db.sql.gz"
  head -c 30000 /dev/urandom > "$d/uploads.tar.gz"
  echo '{"format":1}' > "$d/manifest.json"
  ( cd "$d" && sha256sum db.sql.gz uploads.tar.gz manifest.json > SHA256SUMS )
  basename "$d"
}
run() { # [VAR=value ...] -- args
  local vars=()
  while [ "$1" != "--" ]; do vars+=("$1"); shift; done; shift
  OUT="$(env -i PATH="$WORK/bin:$PATH" HOME="${HOME:-/tmp}" FAKE_BUCKET="$WORK/bucket" "${vars[@]}" bash "$CO/scripts/production/offsite.sh" "$@" 2>&1 </dev/null)"
  RC=$?
}
complete() { [ -f "$REMOTE/$1/COMPLETE" ]; }

echo "not configured"
checkout ""
run -- push
check "push refuses, says what to set" bash -c "[ $RC = 1 ] && grep -q 'OFFSITE_DRIVER and OFFSITE_TARGET' <<<\"\$0\"" "$OUT"
run -- status --check
check "status names it and --check fails" bash -c "[ $RC = 1 ] && grep -q 'NOT CONFIGURED' <<<\"\$0\"" "$OUT"

echo "dir driver: finished sets are sent and marked usable; a set being written is not"
checkout "OFFSITE_DRIVER=dir
OFFSITE_TARGET=$WORK/remote-PLACEHOLDER"
sed -i "s#remote-PLACEHOLDER#$(basename "$REMOTE")#" "$CO/.env"
mkdir -p "$REMOTE"   # the mounted folder exists; offsite.sh never creates the mount point
S1="$(make_set '-30 hours')"; S2="$(make_set '-2 hours')"
mkdir -p "$BK/.incomplete-talimcrm_staging_x"; echo half > "$BK/.incomplete-talimcrm_staging_x/db.sql.gz"
run -- push
check "exit 0" [ "$RC" = 0 ]
check "both sets are usable remotely" bash -c "[ -f '$REMOTE/$S1/COMPLETE' ] && [ -f '$REMOTE/$S2/COMPLETE' ]"
check "every file arrived identical" bash -c "for f in db.sql.gz uploads.tar.gz manifest.json SHA256SUMS; do cmp -s '$BK/$S2/'\$f '$REMOTE/$S2/'\$f || exit 1; done"
check "the set being written was not sent" [ ! -e "$REMOTE/.incomplete-talimcrm_staging_x" ]
check "no temporary file is left remotely" bash -c "! find '$REMOTE' -name '*.part' | grep -q ."
check "the marker records the verified checksum file" grep -q "sha256sums=$(sha256sum "$BK/$S2/SHA256SUMS" | cut -c1-64)" "$REMOTE/$S2/COMPLETE"
check "remote and local status are recorded separately" bash -c "[ -f '$BK/.state/offsite-last-success' ] && [ ! -f '$BK/.state/last-success' ]"
check "no secret in the output" bash -c "! grep -q 'pw-that-must-not-leak' <<<\"\$0\"" "$OUT"
MT="$(stat -c %Y "$REMOTE/$S1/db.sql.gz")"
sleep 1
run -- push
check "a second push sends nothing again" bash -c "[ $RC = 0 ] && grep -q '0 set(s) sent' <<<\"\$0\" && [ \"\$(stat -c %Y '$REMOTE/$S1/db.sql.gz')\" = '$MT' ]" "$OUT"

echo "dir driver: an upload that fails half way"
S3="$(make_set '-1 hours')"
run FAULT_FAIL=uploads.tar.gz -- push
check "exit 1" [ "$RC" = 1 ]
check "the half-sent set is not usable" bash -c "[ ! -f '$REMOTE/$S3/COMPLETE' ]"
check "every local set is still there and intact" bash -c "for s in $S1 $S2 $S3; do (cd '$BK/'\$s && sha256sum -c --quiet SHA256SUMS) || exit 1; done"
check "the failure is recorded" grep -q "upload of $S3/uploads.tar.gz failed" "$BK/.state/offsite-last-failure-reason"
run -- status --check
check "status shows it, --check fails" bash -c "[ $RC = 1 ] && grep -q 'remote transfer:  LAST RUN FAILED' <<<\"\$0\"" "$OUT"
run -- push
check "the retry completes it" bash -c "[ $RC = 0 ] && [ -f '$REMOTE/$S3/COMPLETE' ] && [ ! -f '$BK/.state/offsite-last-failure' ]"

echo "dir driver: a transfer cut short that still says 'done'"
S4="$(make_set '-30 minutes')"
run FAULT_TRUNCATE=db.sql.gz -- push
check "it is caught: exit 1, no marker" bash -c "[ $RC = 1 ] && [ ! -f '$REMOTE/$S4/COMPLETE' ] && grep -q 'differs from the local set' <<<\"\$0\"" "$OUT"
run -- push
check "the retry replaces the damaged copy and marks it" bash -c "[ $RC = 0 ] && cmp -s '$BK/$S4/db.sql.gz' '$REMOTE/$S4/db.sql.gz' && [ -f '$REMOTE/$S4/COMPLETE' ]"

echo "a local set that does not match its own checksums is not sent"
S5="$(make_set '-10 minutes')"; echo tamper >> "$BK/$S5/uploads.tar.gz"
run -- push
check "exit 1, not sent" bash -c "[ $RC = 1 ] && [ ! -e '$REMOTE/$S5/COMPLETE' ]"
rm -rf "$BK/$S5"

echo "nothing remote is ever removed"
mkdir -p "$REMOTE/talimcrm_staging_20250101T220000Z"; echo old > "$REMOTE/talimcrm_staging_20250101T220000Z/COMPLETE"
run -- push
check "an older remote set the server no longer has stays" [ -f "$REMOTE/talimcrm_staging_20250101T220000Z/COMPLETE" ]

echo "fetch: from the remote copy into an empty folder"
run -- fetch latest "$WORK/fetched"
check "the newest usable set is downloaded and verified" bash -c "[ $RC = 0 ] && grep -q 'FETCHED $WORK/fetched/$S4' <<<\"\$0\" && cmp -s '$REMOTE/$S4/db.sql.gz' '$WORK/fetched/$S4/db.sql.gz'" "$OUT"
run -- fetch latest "$WORK/fetched"
check "a non-empty folder is refused" [ "$RC" = 1 ]
mkdir -p "$REMOTE/talimcrm_staging_20991231T220000Z"; cp "$BK/$S1/"* "$REMOTE/talimcrm_staging_20991231T220000Z/"
run -- fetch talimcrm_staging_20991231T220000Z "$WORK/f2"
check "a remote set without its COMPLETE marker is refused" bash -c "[ $RC = 1 ] && grep -q 'no usable (COMPLETE)' <<<\"\$0\"" "$OUT"
rm -rf "$REMOTE/talimcrm_staging_20991231T220000Z"
echo damaged >> "$REMOTE/$S2/uploads.tar.gz"
run -- fetch "$S2" "$WORK/f3"
check "a remote copy damaged after upload fails verification" bash -c "[ $RC = 1 ] && grep -q 'does not match its checksums' <<<\"\$0\"" "$OUT"

echo "status"
mkdir -p "$BK/.state"; date -u +%s > "$BK/.state/last-success"; echo "$S4" > "$BK/.state/last-set"
echo "2026-10-03T00:00:00Z  $S4 (copy outside the backup folder (e.g. fetched off-server)), loaded and consistent" > "$BK/.state/last-restore-check"
run -- status --check
check "all fresh: STATUS OK, exit 0" bash -c "[ $RC = 0 ] && grep -q 'STATUS OK' <<<\"\$0\" && grep -q 'remote usable:    newest $S4' <<<\"\$0\"" "$OUT"
check "local, remote and restore lines are separate" bash -c "grep -q '^local backup:' <<<\"\$0\" && grep -q '^remote transfer:' <<<\"\$0\" && grep -q '^restore check:' <<<\"\$0\"" "$OUT"
sed -i 's/^OFFSITE_TARGET=.*/&\nOFFSITE_MAX_AGE_HOURS=0/' "$CO/.env"
run -- status --check
check "a remote set older than the limit needs attention" bash -c "[ $RC = 1 ] && grep -q 'newest usable off-server set is' <<<\"\$0\"" "$OUT"

echo "rclone driver (fake rclone, local bucket)"
checkout "OFFSITE_DRIVER=rclone
OFFSITE_TARGET=backup:talimcrm/staging"
R1="$(make_set '-3 hours')"
run FAULT_RCLONE=lsf -- push
check "storage that cannot be listed: nothing is sent" bash -c "[ $RC = 1 ] && grep -q 'could not list the remote sets' <<<\"\$0\" && [ ! -e '$WORK/bucket/talimcrm/staging/$R1' ]" "$OUT"
run FAULT_RCLONE=check -- push
check "a failed remote comparison leaves the set unusable" bash -c "[ $RC = 1 ] && grep -q 'differs from the local set' <<<\"\$0\" && [ ! -f '$WORK/bucket/talimcrm/staging/$R1/COMPLETE' ]" "$OUT"
run FAULT_RCLONE=copyto -- push
check "a failed upload is reported" bash -c "[ $RC = 1 ] && grep -q 'upload of $R1' <<<\"\$0\"" "$OUT"
run -- push
check "the retry sends and marks it" bash -c "[ $RC = 0 ] && [ -f '$WORK/bucket/talimcrm/staging/$R1/COMPLETE' ]"
run -- fetch latest "$WORK/rfetched"
check "fetch through rclone verifies the download" bash -c "[ $RC = 0 ] && cmp -s '$BK/$R1/uploads.tar.gz' '$WORK/rfetched/$R1/uploads.tar.gz'"

echo
if [ "$failures" -gt 0 ]; then echo "$failures check(s) failed" >&2; exit 1; fi
echo "offsite: all checks passed"
