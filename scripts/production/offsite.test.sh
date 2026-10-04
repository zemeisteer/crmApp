#!/usr/bin/env bash
# Tests of offsite.sh. The recovery sets are made by the REAL backup-core.sh
# (PostgreSQL's programs are fakes; gzip, tar and sha256sum are real), so
# their manifest and checksums are exactly what production writes.
#
# The "remote" is a LOCAL SIMULATION: the dir driver on a temporary folder,
# and a fake rclone that keeps its bucket in a temporary folder. Faults are
# injected into cp and rclone. This proves the rules (what counts as usable,
# what a failure leaves behind, which stack is chosen), not a real provider.
#
#   bash scripts/production/offsite.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'chmod -R u+rwX "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT
failures=0
pass() { echo "  ok  $1"; }
fail() { echo "  FAILED  $1" >&2; failures=$((failures + 1)); }
check() { if "${@:2}"; then pass "$1"; else fail "$1"; fi; }

mkdir -p "$WORK/bin" "$WORK/fakepg" "$WORK/uploads/homework"
printf 'synthetic homework\n' > "$WORK/uploads/homework/hw-1.txt"
head -c 4000 /dev/urandom > "$WORK/uploads/logo.png"
# --- PostgreSQL fakes for backup-core.sh (the dump is a complete plain dump)
cat > "$WORK/fakepg/pg_dump" <<'EOF'
#!/usr/bin/env bash
out=""; while [ $# -gt 0 ]; do [ "$1" = "-f" ] && { out="$2"; shift; }; shift; done
{ printf -- '-- PostgreSQL database dump\nCREATE TABLE app_migrations (tag text);\n'; head -c 3000 /dev/urandom | base64; printf -- '\n-- PostgreSQL database dump complete\n--\n'; } | gzip > "$out"
EOF
cat > "$WORK/fakepg/psql" <<'EOF'
#!/usr/bin/env bash
case "$*" in *"max(tag)"*) echo "0034_create_idempotency.sql" ;; *"FROM app_migrations"*) echo 35 ;; esac
EOF
# --- fault injection in front of cp
REAL_CP="$(command -v cp)"
cat > "$WORK/bin/cp" <<EOF
#!/usr/bin/env bash
# FAULT_FAIL=<text>: fail a copy whose source contains it.
src="\${@: -2:1}"
case "\$src" in *"\${FAULT_FAIL:-@@}"*) echo "cp: write error (injected)" >&2; exit 1 ;; esac
exec "$REAL_CP" "\$@"
EOF
# --- a fake rclone: "<remote>:<path>" lives in \$FAKE_BUCKET/<path>
cat > "$WORK/bin/rclone" <<'EOF'
#!/usr/bin/env bash
map() { case "$1" in *:*) printf '%s/%s' "$FAKE_BUCKET" "${1#*:}" ;; *) printf '%s' "$1" ;; esac; }
[ "${FAULT_RCLONE:-}" = sleep ] && sleep 30
cmd="$1"; shift
[ "${FAULT_RCLONE:-}" = "$cmd" ] && { echo "rclone: $cmd failed (injected)" >&2; exit 1; }
# upload: only copies FROM this machine TO the bucket fail.
[ "${FAULT_RCLONE:-}" = upload ] && [ "$cmd" = copyto ] && case "$1" in *:*) ;; *) echo "rclone: upload failed (injected)" >&2; exit 1 ;; esac
args=(); fmt=""; while [ $# -gt 0 ]; do case "$1" in --format|--separator) [ "$1" = --format ] && fmt="$2"; shift 2 ;; --*) shift ;; *) args+=("$1"); shift ;; esac; done
case "$cmd" in
  lsf) p="$(map "${args[0]}")"; [ -d "$p" ] || exit 3
       if [ "$fmt" = sp ]; then find "$p" -mindepth 1 -maxdepth 1 -type f -printf '%s %f\n'; else find "$p" -mindepth 1 -maxdepth 1 -type d -printf '%f/\n'; fi ;;
  copyto) s="$(map "${args[0]}")"; d="$(map "${args[1]}")"; [ -f "$s" ] || exit 3; mkdir -p "$(dirname "$d")"; command cp "$s" "$d" ;;
  copy) s="$(map "${args[0]}")"; d="$(map "${args[1]}")"; [ -d "$s" ] || exit 3; mkdir -p "$d"; command cp "$s"/* "$d/" ;;
  deletefile) rm -f "$(map "${args[0]}")" ;;
  *) echo "fake rclone: $cmd not supported" >&2; exit 2 ;;
esac
EOF
chmod +x "$WORK/bin/"* "$WORK/fakepg/"*

# --- a checkout with its .env --------------------------------------------------
CO=""; BK=""; REMOTE=""
checkout() { # stack driver target
  CO="$WORK/co-$RANDOM$RANDOM"; BK="$CO/backups"
  mkdir -p "$CO/scripts" "$BK"
  cp -r "$REPO/scripts/production" "$CO/scripts/"
  cp "$REPO/docker-compose.prod.yml" "$CO/"
  printf 'STACK_NAME=%s\nCOMPOSE_PROJECT_NAME=%s\nDOMAIN=staging.school.uz\nPOSTGRES_DB=%s\nPOSTGRES_PASSWORD=pw-that-must-not-leak-0123456789\nBACKUP_DIR=./backups\nOFFSITE_DRIVER=%s\nOFFSITE_TARGET=%s\nOFFSITE_QUICK_TIMEOUT=5\n' \
    "$1" "$1" "$1" "$2" "$3" > "$CO/.env"
}
setenv() { sed -i "/^$1=/d" "$CO/.env"; printf '%s=%s\n' "$1" "$2" >> "$CO/.env"; }
# A real recovery set, made by backup-core.sh. Distinct names need distinct seconds.
mkset() { # [VAR=value ...]
  sleep 1
  env PATH="$WORK/fakepg:$PATH" BACKUP_ROOT="$BK" UPLOADS_DIR="$WORK/uploads" STACK_NAME="$(sed -n 's/^STACK_NAME=//p' "$CO/.env")" \
    PGDATABASE=x POSTGRES_PASSWORD=x APP_REVISION=abc123 BACKUP_VERIFY_RESTORE=0 "$@" sh "$CO/scripts/production/backup-core.sh" once >/dev/null 2>&1 \
    || { echo "fixture: backup-core.sh failed" >&2; return 1; }
  sed -n 1p "$BK/.state/last-set"
}
run() { # [VAR=value ...] -- args
  local vars=()
  while [ "$1" != "--" ]; do vars+=("$1"); shift; done; shift
  OUT="$(env -i PATH="$WORK/bin:$PATH" HOME="${HOME:-/tmp}" FAKE_BUCKET="$WORK/bucket" "${vars[@]}" bash "$CO/scripts/production/offsite.sh" "$@" 2>&1 </dev/null)"
  RC=$?
}
dest_ack_dir() { printf '%s/.state/offsite/%s' "$BK" "$(printf '%s|%s' "$(sed -n 's/^OFFSITE_DRIVER=//p' "$CO/.env")" "$(sed -n 's/^OFFSITE_TARGET=//p' "$CO/.env")" | sha256sum | cut -c1-16)"; }
says() { grep -q -- "$1" <<<"$OUT"; }
usable() { [ -f "$REMOTE/$1/COMPLETE" ] && grep -qx 'format=2' "$REMOTE/$1/COMPLETE"; }
local_intact() { ( cd "$BK/$1" && sha256sum -c --quiet SHA256SUMS >/dev/null 2>&1 ) && [ -f "$BK/$1/manifest.json" ]; }
same_as_local() { local f; for f in db.sql.gz uploads.tar.gz manifest.json SHA256SUMS; do [ ! -e "$BK/$1/$f" ] || cmp -s "$BK/$1/$f" "$REMOTE/$1/$f" || return 1; done; }
acked() { [ -f "$(dest_ack_dir)/$1.ok" ]; }
restore_check() { mkdir -p "$BK/.state"; echo "2026-10-04T00:00:00Z  test, loaded and consistent" > "$BK/.state/last-restore-check"; }

# ===================================================================== dir driver
REMOTE="$WORK/remote"; mkdir -p "$REMOTE"
checkout talimcrm_staging dir "$REMOTE"
OLD="$(mkset)"; NEW="$(mkset)"; restore_check

echo "baseline: real sets are sent, content-checked and marked"
run -- push
check "push exit 0" [ "$RC" = 0 ]
check "both sets carry a format-2 COMPLETE marker" eval 'usable "$OLD" && usable "$NEW"'
check "remote files are identical to the local sets" eval 'same_as_local "$OLD" && same_as_local "$NEW"'
check "both are acknowledged for this destination" eval 'acked "$OLD" && acked "$NEW"'
check "the newest is acknowledged by content check" grep -qx 'level=content' "$(dest_ack_dir)/$NEW.ok"
run -- status --check
check "status --check: exit 0, newest VERIFIED, older PRESENT (metadata)" eval '[ $RC = 0 ] && says "$NEW  VERIFIED (content check" && says "$OLD  PRESENT (metadata check only"'
check "no secret in the output" eval '! says pw-that-must-not-leak'

echo "1. uploads.tar.gz deleted from the newest remote set (COMPLETE left in place)"
rm "$REMOTE/$NEW/uploads.tar.gz"
run -- status --check
check "status --check exits 1" [ "$RC" = 1 ]
check "the newest set is reported DAMAGED, with the reason" eval 'says "$NEW  DAMAGED: .*uploads.tar.gz"'
check "8. the older VERIFIED set is reported as the fallback" eval 'says "fallback: *$OLD is the newest VERIFIED set"'
check "11. its acknowledgement is withdrawn" eval '! acked "$NEW"'
echo "9. a healthy local set repairs it"
run -- push
check "push exit 0, says repaired" eval '[ $RC = 0 ] && says "$NEW repaired and verified"'
check "the remote copy is complete, identical and marked" eval 'same_as_local "$NEW" && usable "$NEW"'
check "acknowledged again; the local set untouched" eval 'acked "$NEW" && local_intact "$NEW"'
run -- status --check
check "status OK again" [ "$RC" = 0 ]

echo "2. db.sql.gz deleted from an OLDER remote set"
rm "$REMOTE/$OLD/db.sql.gz"
run -- status --check
check "status --check exits 1, names it DAMAGED (metadata check)" eval '[ $RC = 1 ] && says "$OLD  DAMAGED: db.sql.gz is missing"'
check "its acknowledgement is withdrawn" eval '! acked "$OLD"'
run -- push
check "push repairs it" eval '[ $RC = 0 ] && cmp -s "$BK/$OLD/db.sql.gz" "$REMOTE/$OLD/db.sql.gz" && acked "$OLD"'

echo "3. same-size corruption of a completed archive"
printf 'X' | dd of="$REMOTE/$NEW/db.sql.gz" bs=1 seek=100 conv=notrunc 2>/dev/null
run -- status --check
check "the content check of the newest set catches it" eval '[ $RC = 1 ] && says "$NEW  DAMAGED: db.sql.gz does not match SHA256SUMS"'
run -- push
check "push repairs it" eval '[ $RC = 0 ] && cmp -s "$BK/$NEW/db.sql.gz" "$REMOTE/$NEW/db.sql.gz"'
printf 'X' | dd of="$REMOTE/$OLD/uploads.tar.gz" bs=1 seek=50 conv=notrunc 2>/dev/null
run -- status --check
check "on an OLDER set the metadata check cannot see it - and is labelled so" eval 'says "$OLD  PRESENT (metadata check only; content not read)"'
run -- verify all
check "verify all (content) finds it: exit 1, acknowledgement withdrawn" eval '[ $RC = 1 ] && says "$OLD  DAMAGED: uploads.tar.gz does not match" && ! acked "$OLD"'
run -- push
check "the next push content-checks the unacknowledged set and repairs it" eval '[ $RC = 0 ] && cmp -s "$BK/$OLD/uploads.tar.gz" "$REMOTE/$OLD/uploads.tar.gz"'

echo "4. SHA256SUMS modified or missing"
echo "0000000000000000000000000000000000000000000000000000000000000000  extra.bin" >> "$REMOTE/$NEW/SHA256SUMS"
run -- status --check
check "modified: DAMAGED (SHA256SUMS no longer lists exactly the data files)" eval '[ $RC = 1 ] && says "$NEW  DAMAGED: SHA256SUMS does not list exactly"'
run -- push; check "repaired" eval '[ $RC = 0 ] && same_as_local "$NEW"'
rm "$REMOTE/$OLD/SHA256SUMS"
run -- status --check
check "missing: DAMAGED" eval '[ $RC = 1 ] && says "$OLD  DAMAGED: SHA256SUMS is missing"'
run -- push; check "repaired" eval '[ $RC = 0 ] && same_as_local "$OLD"'

echo "5. manifest or COMPLETE identity mismatch"
sed -i 's/"stack": "talimcrm_staging"/"stack": "talimcrm"/' "$REMOTE/$NEW/manifest.json"
run -- status --check
check "manifest changed: DAMAGED (it names another stack)" eval '[ $RC = 1 ] && says "$NEW  DAMAGED: the manifest belongs to stack \"talimcrm\""'
run -- push; check "repaired" eval '[ $RC = 0 ] && same_as_local "$NEW"'
sed -i "s/^set=.*/set=talimcrm_staging_20200101T000000Z/" "$REMOTE/$OLD/COMPLETE"
run -- status --check
check "COMPLETE names another set: DAMAGED" eval '[ $RC = 1 ] && says "$OLD  DAMAGED: COMPLETE names set"'
sed -i "s/^stack=.*/stack=zzz_production/; s/^set=.*/set=$OLD/" "$REMOTE/$OLD/COMPLETE"
run -- status --check
check "COMPLETE names another stack: DAMAGED" eval '[ $RC = 1 ] && says "$OLD  DAMAGED: COMPLETE names stack"'
run -- push; check "repaired" eval '[ $RC = 0 ] && grep -qx stack=talimcrm_staging "$REMOTE/$OLD/COMPLETE"'

echo "6. the storage cannot be read"
mv "$REMOTE" "$REMOTE.away"
run -- status --check
check "status: UNREADABLE, exit 1 - never OK" eval '[ $RC = 1 ] && says "remote sets:      UNREADABLE" && ! says "STATUS OK"'
run -- push
check "push: exit 1, nothing counted as off-server" eval '[ $RC = 1 ] && says "could not be listed"'
check "local sets untouched" eval 'local_intact "$OLD" && local_intact "$NEW"'
mv "$REMOTE.away" "$REMOTE"
run -- push; check "storage back: push OK" [ "$RC" = 0 ]

echo "7. a marker-only folder named as a newer set (no local copy)"
GHOST="talimcrm_staging_$(date -u -d '+1 hour' +%Y%m%dT%H%M%SZ)"
mkdir -p "$REMOTE/$GHOST"; cp "$REMOTE/$NEW/COMPLETE" "$REMOTE/$GHOST/COMPLETE"
run -- status --check
check "it is the newest and DAMAGED; exit 1" eval '[ $RC = 1 ] && says "$GHOST  DAMAGED: "'
check "8. the older healthy set is reported as the fallback" eval 'says "fallback: *$NEW is the newest VERIFIED set"'
run -- push
check "push cannot repair it (no local copy): exit 1, says so" eval '[ $RC = 1 ] && says "$GHOST: not usable off-server .* no local copy"'
run -- fetch latest "$WORK/f-ghost"
check "fetch latest skips it LOUDLY and takes the older verified set" eval '[ $RC = 0 ] && says "WARNING: newer set $GHOST is not usable" && [ -f "$WORK/f-ghost/$NEW/COMPLETE" ]'
rm -rf "$REMOTE/$GHOST"

echo "10. a repair that fails half way"
rm "$REMOTE/$NEW/uploads.tar.gz"
run FAULT_FAIL="$NEW/uploads.tar.gz" -- push
check "exit 1" [ "$RC" = 1 ]
check "no COMPLETE marker remains on the half-repaired set" eval '[ ! -e "$REMOTE/$NEW/COMPLETE" ]'
check "no acknowledgement; the local set intact" eval '! acked "$NEW" && local_intact "$NEW"'
run -- status --check
check "status: not usable, fallback named, exit 1" eval '[ $RC = 1 ] && says "$NEW  DAMAGED: " && says "fallback: *$OLD"'
run -- push
check "the retry completes the repair" eval '[ $RC = 0 ] && same_as_local "$NEW" && usable "$NEW" && acked "$NEW"'

echo "13. no push while a backup (which may prune) is running"
mkdir -p "$BK/.backup.lock"; date -u +%s > "$BK/.backup.lock/started"
run -- push
check "push exits 75 and does nothing" eval '[ $RC = 75 ] && says "a backup is running"'
rm -rf "$BK/.backup.lock"

echo "12. another destination: the old acknowledgements do not count"
OLD_ACKS="$(dest_ack_dir)"
REMOTE2="$WORK/remote2"; mkdir -p "$REMOTE2"; setenv OFFSITE_TARGET "$REMOTE2"
check "nothing acknowledged for the new destination yet" eval '[ "$(dest_ack_dir)" != "$OLD_ACKS" ] && ! acked "$NEW" && ! acked "$OLD"'
run -- push
check "push sends everything to the new destination" eval '[ $RC = 0 ] && [ -f "$REMOTE2/$NEW/COMPLETE" ] && [ -f "$REMOTE2/$OLD/COMPLETE" ] && acked "$NEW"'
setenv OFFSITE_TARGET "$REMOTE"

echo "15-17. stacks sharing one destination"
ST_CO="$CO"; ST_BK="$BK"
checkout zzz_production dir "$REMOTE"
PROD_SET="$(mkset)"   # newer than every staging set, and sorts after them
run -- push
check "fixture: another stack pushed a newer, valid set to the same folder" eval '[ $RC = 0 ] && [ -f "$REMOTE/$PROD_SET/COMPLETE" ]'
CO="$ST_CO"; BK="$ST_BK"
run -- status --check
check "16. staging status lists only staging sets" eval '! says zzz_production && says "$NEW  VERIFIED"'
run -- fetch latest "$WORK/f-latest"
check "15. fetch latest takes staging's newest, not the newer foreign set" eval '[ $RC = 0 ] && [ -d "$WORK/f-latest/$NEW" ] && [ ! -e "$WORK/f-latest/$PROD_SET" ]'
run -- fetch "$PROD_SET" "$WORK/f-foreign"
check "17. a named foreign set is refused" eval '[ $RC = 1 ] && says "not a recovery set of stack talimcrm_staging" && [ ! -e "$WORK/f-foreign/$PROD_SET" ]'
run -- fetch --from-stack zzz_production latest "$WORK/f-cross"
check "    ...unless the source stack is named (--from-stack)" eval '[ $RC = 0 ] && says "ANOTHER stack (zzz_production)" && [ -d "$WORK/f-cross/$PROD_SET" ] && says "from-stack zzz_production"'
OUT="$(env -i PATH="$PATH" HOME="${HOME:-/tmp}" bash "$CO/scripts/production/restore.sh" "$WORK/f-cross/$PROD_SET" 2>&1)"; RC=$?
check "    restore.sh refuses the foreign set without --from-stack" eval '[ $RC = 1 ] && says "belongs to stack \"zzz_production\""'

echo "18. directory, manifest and marker disagree"
FAKE_NAME="talimcrm_staging_20200101T000000Z"
cp -r "$REMOTE/$NEW" "$REMOTE/$FAKE_NAME"
sed -i "s/^set=.*/set=$FAKE_NAME/" "$REMOTE/$FAKE_NAME/COMPLETE"
run -- verify "$FAKE_NAME"
check "a renamed set (marker edited to match) fails: the manifest time does not fit the name" eval '[ $RC = 1 ] && says "does not belong to set $FAKE_NAME"'
rm -rf "$REMOTE/$FAKE_NAME"
MIX="talimcrm_staging_${PROD_SET##*_}"
cp -r "$REMOTE/$PROD_SET" "$REMOTE/$MIX"
run -- fetch "$MIX" "$WORK/f-mix"
check "another stack's set under this stack's name is refused" eval '[ $RC = 1 ] && [ ! -e "$WORK/f-mix/$MIX" ]'
rm -rf "$REMOTE/$MIX"

echo "19. malformed names and unsafe paths"
for bad in "../$NEW" "$NEW/../$OLD" "talimcrm_staging_2026" "talimcrm_staging_20261003T000000" "/etc" "talimcrm_staging_20261003T000000Z;rm"; do
  rm -rf "$WORK/f-bad"
  run -- fetch "$bad" "$WORK/f-bad"
  check "fetch \"$bad\" is refused, nothing written" eval '[ $RC = 1 ] && [ -z "$(ls -A "$WORK/f-bad" 2>/dev/null)" ]'
done
mkdir -p "$REMOTE/talimcrm_staging_backup-old" "$REMOTE/talimcrm_staging_20261003T000000Z.bak"
run -- status --check
check "malformed remote folders are ignored, not listed" eval '! says "backup-old" && ! says ".bak"'

echo "20. sets as they exist today stay usable"
run -- fetch "$OLD" "$WORK/f-old"
check "a correctly named existing set is fetched and verified" eval '[ $RC = 0 ] && ( cd "$WORK/f-old/$OLD" && sha256sum -c --quiet SHA256SUMS )'
# A marker written before stack checks existed (set, verified_at, sha256sums only).
printf 'set=%s\nverified_at=2026-10-01T00:00:00Z\nsha256sums=%s\n' "$OLD" "$(sha256sum "$REMOTE/$OLD/SHA256SUMS" | cut -c1-64)" > "$REMOTE/$OLD/COMPLETE"
rm -f "$(dest_ack_dir)/$OLD.ok"
run -- push
check "a legacy marker is accepted after a content check and rewritten (format 2)" eval '[ $RC = 0 ] && usable "$OLD" && grep -qx stack=talimcrm_staging "$REMOTE/$OLD/COMPLETE"'
NOUP="$(mkset UPLOADS_DIR=/nonexistent BACKUP_REQUIRE_UPLOADS=0)"
run -- push
check "a set made without uploads (uploads state none) is sent and usable" eval '[ $RC = 0 ] && usable "$NOUP" && [ ! -e "$REMOTE/$NOUP/uploads.tar.gz" ]'
run -- fetch latest "$WORK/f-noup"
check "and fetched" eval '[ $RC = 0 ] && [ -f "$WORK/f-noup/$NOUP/db.sql.gz" ]'

# ================================================================= rclone driver
echo "rclone driver (fake rclone - a simulation; bucket in a local folder)"
REMOTE="$WORK/bucket/talimcrm/staging"
checkout talimcrm_staging rclone "backup:talimcrm/staging"; restore_check
R1="$(mkset)"; R2="$(mkset)"
run FAULT_RCLONE=lsf -- push
check "listing fails: push exit 1, nothing acknowledged" eval '[ $RC = 1 ] && ! acked "$R2"'
run -- push
check "push sends both, content-checked" eval '[ $RC = 0 ] && usable "$R1" && usable "$R2"'
rm "$REMOTE/$R2/uploads.tar.gz"
run -- status --check
check "deletion detected through rclone: DAMAGED, fallback named, exit 1" eval '[ $RC = 1 ] && says "$R2  DAMAGED" && says "fallback: *$R1"'
run FAULT_RCLONE=upload -- push
check "a repair that cannot upload: exit 1, no marker, local intact" eval '[ $RC = 1 ] && [ ! -e "$REMOTE/$R2/COMPLETE" ] && local_intact "$R2"'
run -- push
check "the retry repairs it" eval '[ $RC = 0 ] && same_as_local "$R2" && usable "$R2"'
T0=$(date +%s)
run FAULT_RCLONE=sleep -- status --check
T1=$(date +%s)
check "a storage that hangs: UNREADABLE, exit 1, bounded (<25s)" eval '[ $RC = 1 ] && says UNREADABLE && [ $((T1 - T0)) -lt 25 ]'
run -- fetch latest "$WORK/r-fetched"
check "fetch through rclone verifies the download" eval '[ $RC = 0 ] && cmp -s "$BK/$R2/db.sql.gz" "$WORK/r-fetched/$R2/db.sql.gz"'

echo
if [ "$failures" -gt 0 ]; then echo "$failures check(s) failed" >&2; exit 1; fi
echo "offsite: all checks passed"
