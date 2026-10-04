#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - copies of the recovery sets OFF this server, checked, and back.
#
#   bash scripts/production/offsite.sh push               send / re-check / repair this stack's sets
#   bash scripts/production/offsite.sh status [--check]   local, remote and restore-check status
#   bash scripts/production/offsite.sh verify <set>|all   full content check of remote sets
#   bash scripts/production/offsite.sh fetch <set|latest> <empty folder>
#   bash scripts/production/offsite.sh fetch --from-stack <stack> <set|latest> <empty folder>
#                         (disaster recovery from ANOTHER stack's sets - only when named)
#
# Configuration (this checkout's .env; secrets never in the repo):
#   OFFSITE_DRIVER            rclone | dir
#                             rclone: any storage rclone speaks (S3-compatible,
#                               B2, SFTP...); remote and credentials live in the
#                               operator's rclone.conf on this server.
#                             dir: a folder mounted from elsewhere (NFS, a disk).
#   OFFSITE_TARGET            rclone: "<remote>:<bucket>/<path>"; dir: absolute path
#   OFFSITE_MAX_AGE_HOURS     status --check: newest VERIFIED set may be this old (30)
#   OFFSITE_QUICK_TIMEOUT     seconds for one listing or small read (60)
#   OFFSITE_TRANSFER_TIMEOUT  seconds for one upload or download (1800)
#   OFFSITE_STATUS_SETS       how many of the newest remote sets status reports (7)
#
# What a remote set must be to count as usable:
#   - its folder is named <STACK_NAME>_YYYYMMDDTHHMMSSZ. Only THIS stack's sets
#     are listed, chosen, repaired or fetched; others are ignored, and a named
#     set of another stack is refused unless --from-stack names that stack;
#   - manifest.json (format 1, as backup-core.sh writes it) names the stack, a
#     creation time that fits the folder name, the database dump and - when
#     uploads were archived - the uploads archive, with sizes and sha256;
#   - SHA256SUMS lists exactly those data files and they match it;
#   - COMPLETE (written last) names the same stack and set and the sha256 of
#     SHA256SUMS and of manifest.json.
#
# Two checks, named for what they prove:
#   PRESENT  (metadata check) - COMPLETE, manifest.json and SHA256SUMS (small)
#            are read and agree, every data file is there with the size the
#            manifest gives. Catches missing, truncated or mismatched files
#            and markers. It does NOT read the data: same-size corruption
#            passes it.
#   VERIFIED (content check) - the whole set is downloaded into a work folder
#            and every file is checked against SHA256SUMS and the manifest.
#            Independent of whatever hashes a provider offers.
#   push:   content check for the newest set and everything it sends/repairs,
#           metadata check for older sets.
#   status: content check for the newest remote set - and, when it fails, for
#           older ones until one passes (the fallback, reported as such) -
#           metadata check for the rest.
#   verify: content check of one set or of all (run it weekly from cron).
#   A read that fails or times out is UNREADABLE: never counted as usable.
#
# Acknowledgements (.state/offsite/<destination id>/<set>.ok) tell the nightly
# backup a local set may be pruned. They are bound to OFFSITE_DRIVER and
# OFFSITE_TARGET: after a change of destination none of the old ones counts.
# A set that fails a check, or cannot be read, loses its acknowledgement, so
# its local copy is kept.
#
# Repair: when a remote set fails and the local set is healthy, push removes
# that set's COMPLETE marker (only that file), uploads the files again,
# downloads and checks them, and writes the marker last. A repair that stops
# half way leaves the set unusable and the local set untouched. Nothing else
# is ever deleted - remotely or locally (no sync, no prune).
#
# Locks: one push or verify at a time (.offsite.lock), working in
# .offsite-work; push and verify do not start while a backup runs
# (.backup.lock), and the backup does not prune while an off-server run
# holds its lock. status takes no lock: each run works in its own
# .offsite-status.XXXXXX folder, removed when it ends.
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
umask 077
load_stack

DRIVER="$(env_value OFFSITE_DRIVER)"
TARGET="$(env_value OFFSITE_TARGET)"
num() { local v; v="$(env_value "$1")"; if [[ "$v" =~ ^[0-9]+$ ]]; then printf '%s' "$v"; else printf '%s' "$2"; fi; }
MAX_AGE_H="$(num OFFSITE_MAX_AGE_HOURS 30)"
QUICK_T="$(num OFFSITE_QUICK_TIMEOUT 60)"
XFER_T="$(num OFFSITE_TRANSFER_TIMEOUT 1800)"
STATUS_SETS="$(num OFFSITE_STATUS_SETS 7)"
STATE="$BACKUP_ROOT/.state"
LOCK="$BACKUP_ROOT/.offsite.lock"
BACKUP_LOCK="$BACKUP_ROOT/.backup.lock"
WORKROOT="$BACKUP_ROOT/.offsite-work"
LOCK_STALE_S=21600
STACK_RE='^[A-Za-z0-9][A-Za-z0-9_-]*$'

[[ "$STACK_NAME" =~ $STACK_RE ]] || die "STACK_NAME \"$STACK_NAME\" is not a valid stack name"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
now() { date -u +%s; }
ago() { local s=$(( $(now) - $1 )); if [ "$s" -lt 7200 ]; then printf '%dm' $((s / 60)); else printf '%dh' $((s / 3600)); fi; }
utc() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }
sha() { sha256sum "$1" | cut -c1-64; }
if command -v timeout >/dev/null; then bounded() { timeout --kill-after=10 "$1" "${@:2}"; }; else bounded() { "${@:2}"; }; fi

# --- names -------------------------------------------------------------------
# A recovery set of STACK is <STACK>_YYYYMMDDTHHMMSSZ - nothing else, no paths.
valid_set() { [[ "$2" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*_[0-9]{8}T[0-9]{6}Z$ ]] && [ "${2%_*}" = "$1" ]; }
set_epoch() {
  local ts="${1##*_}" d
  d="${ts:0:4}-${ts:4:2}-${ts:6:2} ${ts:9:2}:${ts:11:2}:${ts:13:2}"
  date -u -d "$d" +%s 2>/dev/null || date -u -j -f '%Y-%m-%d %H:%M:%S' "$d" +%s
}
iso_epoch() { date -u -d "$1" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s; }
newest_first() { # names on stdin, sorted by the time in their name, newest first
  local n e
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    e="$(set_epoch "$n" 2>/dev/null)" || continue
    printf '%s %s\n' "$e" "$n"
  done | sort -rn | cut -d' ' -f2
}

# --- destination-bound acknowledgements ---------------------------------------
dest_id() { printf '%s|%s' "$DRIVER" "$TARGET" | sha256sum | cut -c1-16; }
ack_dir() { printf '%s/offsite/%s' "$STATE" "$(dest_id)"; }
ack() { # set level
  mkdir -p "$(ack_dir)"
  printf 'set=%s\ndestination=%s:%s\nlevel=%s\nverified_at=%s\n' "$1" "$DRIVER" "$TARGET" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$(ack_dir)/$1.ok"
}
unack() { rm -f "$(ack_dir)/$1.ok"; }

# --- the manifest backup-core.sh writes (format 1) ------------------------------
mf_top() { sed -n "s/^  \"$2\": \"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}\$/\1/p" "$1" | head -n 1; }
mf_in() { # file block key -> that key's value inside "block": { ... }
  awk -v b="\"$2\": {" -v k="\"$3\":" 'index($0, b) { inb = 1; next } inb && /^  }/ { inb = 0 } inb && index($0, k) { v = $0; sub(/^[^:]*: */, "", v); sub(/,$/, "", v); gsub(/"/, "", v); print v; exit }' "$1"
}
marker_field() { sed -n "s/^$2=//p" "$1" | head -n 1; }
set_files() { echo db.sql.gz; if [ "$(mf_in "$1" uploads state)" = "archived" ]; then echo uploads.tar.gz; fi; echo manifest.json; echo SHA256SUMS; }
data_files() { set_files "$1" | grep -v -e '^manifest.json$' -e '^SHA256SUMS$'; }
sums_entry() { sed -n "s/^\([0-9a-f]\{64\}\) [ *]$2\$/\1/p" "$1" | head -n 1; }

WHY=""
# check_marker FILE STACK NAME SUMS_SHA MANIFEST_SHA
check_marker() {
  WHY=""
  [ "$(marker_field "$1" set)" = "$3" ] || { WHY="COMPLETE names set \"$(marker_field "$1" set)\", not $3"; return 1; }
  [ "$(marker_field "$1" sha256sums)" = "$4" ] || { WHY="COMPLETE was written for another SHA256SUMS"; return 1; }
  if [ "$(marker_field "$1" format)" = "2" ]; then
    [ "$(marker_field "$1" stack)" = "$2" ] || { WHY="COMPLETE names stack \"$(marker_field "$1" stack)\", not $2"; return 1; }
    [ "$(marker_field "$1" manifest_sha256)" = "$5" ] || { WHY="COMPLETE was written for another manifest.json"; return 1; }
  else
    WHY="legacy COMPLETE marker (no stack or manifest identity)"; return 4
  fi
  return 0
}
# check_set DIR STACK NAME MARKER(yes|no) -> 0, or 1 with WHY. Reads every byte.
check_set() {
  local d="$1" st="$2" n="$3" mk="$4" fmt created c0 f files data rc
  WHY=""
  valid_set "$st" "$n" || { WHY="\"$n\" is not a recovery set name of stack $st"; return 1; }
  [ -f "$d/manifest.json" ] || { WHY="manifest.json is missing"; return 1; }
  fmt="$(mf_top "$d/manifest.json" format)"
  [ "$fmt" = "1" ] || { WHY="unsupported manifest format \"${fmt:-none}\""; return 1; }
  [ "$(mf_top "$d/manifest.json" stack)" = "$st" ] || { WHY="the manifest belongs to stack \"$(mf_top "$d/manifest.json" stack)\", not $st"; return 1; }
  created="$(mf_top "$d/manifest.json" created_utc)"
  c0="$(iso_epoch "$created" 2>/dev/null)" || c0=""
  if ! [[ "$c0" =~ ^[0-9]+$ ]] || [ "$c0" -lt "$(set_epoch "$n")" ] || [ $((c0 - $(set_epoch "$n"))) -ge 86400 ]; then
    WHY="the manifest's creation time (${created:-none}) does not belong to set $n"; return 1
  fi
  [ -f "$d/SHA256SUMS" ] || { WHY="SHA256SUMS is missing"; return 1; }
  files="$(set_files "$d/manifest.json")"
  data="$(data_files "$d/manifest.json")"
  for f in $files; do [ -f "$d/$f" ] || { WHY="$f is missing"; return 1; }; done
  [ "$(sed -n 's/^[0-9a-f]\{64\} [ *]\(.*\)$/\1/p' "$d/SHA256SUMS" | sort | tr '\n' ' ')" = "$(sort <<<"$data" | tr '\n' ' ')" ] \
    || { WHY="SHA256SUMS does not list exactly: $(tr '\n' ' ' <<<"$data")"; return 1; }
  for f in $data; do
    [ "$(sha "$d/$f")" = "$(sums_entry "$d/SHA256SUMS" "$f")" ] || { WHY="$f does not match SHA256SUMS"; return 1; }
  done
  [ "$(mf_in "$d/manifest.json" database sha256)" = "$(sums_entry "$d/SHA256SUMS" db.sql.gz)" ] || { WHY="the manifest and SHA256SUMS disagree about db.sql.gz"; return 1; }
  [ "$(mf_in "$d/manifest.json" database bytes)" = "$(wc -c < "$d/db.sql.gz" | tr -d ' ')" ] || { WHY="db.sql.gz has another size than the manifest says"; return 1; }
  if grep -qx uploads.tar.gz <<<"$data"; then
    [ "$(mf_in "$d/manifest.json" uploads sha256)" = "$(sums_entry "$d/SHA256SUMS" uploads.tar.gz)" ] || { WHY="the manifest and SHA256SUMS disagree about uploads.tar.gz"; return 1; }
  fi
  [ "$mk" = "yes" ] || return 0
  [ -f "$d/COMPLETE" ] || { WHY="no COMPLETE marker"; return 1; }
  rc=0; check_marker "$d/COMPLETE" "$st" "$n" "$(sha "$d/SHA256SUMS")" "$(sha "$d/manifest.json")" || rc=$?
  # A legacy marker is accepted only here, where every byte was checked.
  [ "$rc" = 0 ] || [ "$rc" = 4 ] || return 1
  return 0
}

need_config() {
  case "$DRIVER" in
    rclone) command -v rclone >/dev/null || die "OFFSITE_DRIVER=rclone but rclone is not installed (https://rclone.org/install/)" ;;
    dir) case "$TARGET" in /* | [A-Za-z]:[\\/]*) ;; *) die "OFFSITE_TARGET must be an absolute path for OFFSITE_DRIVER=dir" ;; esac ;;
    "") die "Off-server copies are not configured: set OFFSITE_DRIVER and OFFSITE_TARGET in .env (see docs/DEPLOYMENT_GUIDE.md)" ;;
    *) die "OFFSITE_DRIVER must be rclone or dir (got: $DRIVER)" ;;
  esac
  [ -n "$TARGET" ] || die "OFFSITE_TARGET is empty"
}

# --- remote primitives: bounded, non-zero on any failure ------------------------
r_dirs() {
  case "$DRIVER" in
    dir) [ -d "$TARGET" ] || return 1
         bounded "$QUICK_T" find "$TARGET" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' ;;
    # rclone exits 3 for a path that does not exist yet (nothing sent so far).
    rclone) local out rc=0
            out="$(bounded "$QUICK_T" rclone lsf --dirs-only "$TARGET" 2>/dev/null)" || rc=$?
            [ "$rc" = 0 ] || [ "$rc" = 3 ] || return 1
            sed 's#/$##' <<<"$out" ;;
  esac
}
r_files() { # SET -> "size name" per file
  case "$DRIVER" in
    dir) bounded "$QUICK_T" find "$TARGET/$1" -mindepth 1 -maxdepth 1 -type f -printf '%s %f\n' ;;
    rclone) bounded "$QUICK_T" rclone lsf --files-only --format sp --separator ' ' "$TARGET/$1" ;;
  esac
}
r_read() { # SET FILE DEST
  case "$DRIVER" in
    dir) bounded "$QUICK_T" cp "$TARGET/$1/$2" "$3" ;;
    rclone) bounded "$QUICK_T" rclone copyto "$TARGET/$1/$2" "$3" ;;
  esac
}
r_put() { # SET LOCAL_FILE NAME
  case "$DRIVER" in
    dir) mkdir -p "$TARGET/$1" && bounded "$XFER_T" cp "$2" "$TARGET/$1/$3.part" && mv -f "$TARGET/$1/$3.part" "$TARGET/$1/$3" ;;
    rclone) bounded "$XFER_T" rclone copyto "$2" "$TARGET/$1/$3" ;;
  esac
}
r_unmark() { # SET: remove only that set's COMPLETE marker
  case "$DRIVER" in
    dir) rm -f "$TARGET/$1/COMPLETE" && [ ! -e "$TARGET/$1/COMPLETE" ] ;;
    rclone) bounded "$QUICK_T" rclone deletefile "$TARGET/$1/COMPLETE" 2>/dev/null || ! r_files "$1" | grep -q ' COMPLETE$' ;;
  esac
}
r_get() { # SET DEST_FOLDER
  case "$DRIVER" in
    dir) mkdir -p "$2" && bounded "$XFER_T" cp -p "$TARGET/$1"/* "$2/" ;;
    rclone) bounded "$XFER_T" rclone copy "$TARGET/$1" "$2" ;;
  esac
}

# A stack's sets in the remote root, newest first. Fails (never "empty") when
# the storage cannot be listed.
remote_sets() { # [stack]
  local st="${1:-$STACK_NAME}" all n
  all="$(r_dirs)" || return 1
  while IFS= read -r n; do if valid_set "$st" "$n"; then printf '%s\n' "$n"; fi; done <<<"$all" | newest_first
}
local_sets() { # this stack's finished local sets, newest first
  local d n
  for d in "$BACKUP_ROOT/${STACK_NAME}_"*Z; do
    n="$(basename "$d")"
    if [ -d "$d" ] && [ -f "$d/manifest.json" ] && valid_set "$STACK_NAME" "$n"; then printf '%s\n' "$n"; fi
  done | newest_first
}

# quick_check SET [stack] -> 0 PRESENT, 1 DAMAGED, 2 UNREADABLE, 3 NOT COMPLETE, 4 LEGACY MARKER
quick_check() {
  local s="$1" st="${2:-$STACK_NAME}" files tmp f size want rc
  WHY=""
  files="$(r_files "$s")" || { WHY="the storage could not be read (or timed out)"; return 2; }
  grep -q ' COMPLETE$' <<<"$files" || { WHY="no COMPLETE marker (never finished, or being repaired)"; return 3; }
  tmp="$(mktemp -d "$WORKROOT/quick.XXXXXX")"
  for f in COMPLETE manifest.json SHA256SUMS; do
    grep -q " $f\$" <<<"$files" || { rm -rf "$tmp"; WHY="$f is missing"; return 1; }
    r_read "$s" "$f" "$tmp/$f" || { rm -rf "$tmp"; WHY="$f could not be read (or timed out)"; return 2; }
  done
  rc=0; check_marker "$tmp/COMPLETE" "$st" "$s" "$(sha "$tmp/SHA256SUMS")" "$(sha "$tmp/manifest.json")" || rc=$?
  if [ "$rc" != 0 ]; then rm -rf "$tmp"; return "$rc"; fi
  if [ "$(mf_top "$tmp/manifest.json" stack)" != "$st" ]; then WHY="the manifest belongs to stack \"$(mf_top "$tmp/manifest.json" stack)\""; rm -rf "$tmp"; return 1; fi
  for f in $(data_files "$tmp/manifest.json"); do
    size="$(sed -n "s/^\([0-9]*\) $f\$/\1/p" <<<"$files")"
    [ -n "$size" ] || { WHY="$f is missing"; rm -rf "$tmp"; return 1; }
    if [ "$f" = db.sql.gz ]; then want="$(mf_in "$tmp/manifest.json" database bytes)"; else want="$(mf_in "$tmp/manifest.json" uploads bytes)"; fi
    [ "$size" = "$want" ] || { WHY="$f is $size bytes, the manifest says $want"; rm -rf "$tmp"; return 1; }
  done
  [ -n "$(sums_entry "$tmp/SHA256SUMS" db.sql.gz)" ] || { WHY="SHA256SUMS has no entry for db.sql.gz"; rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  return 0
}
# full_check SET [stack] -> 0 VERIFIED, 1 DAMAGED, 2 UNREADABLE (WHY)
full_check() {
  local s="$1" st="${2:-$STACK_NAME}" tmp rc=0
  WHY=""
  tmp="$(mktemp -d "$WORKROOT/full.XXXXXX")"
  r_get "$s" "$tmp/$s" || { rm -rf "$tmp"; WHY="the set could not be downloaded (or timed out)"; return 2; }
  check_set "$tmp/$s" "$st" "$s" yes || rc=1
  rm -rf "$tmp"
  return "$rc"
}

take_lock() {
  mkdir -p "$BACKUP_ROOT"
  if [ -d "$LOCK" ] && [ $(( $(now) - $(cat "$LOCK/started" 2>/dev/null || echo 0) )) -gt "$LOCK_STALE_S" ]; then rm -rf "$LOCK"; fi
  mkdir "$LOCK" 2>/dev/null || { log "another off-server run is in progress ($LOCK); nothing done"; exit 75; }
  now > "$LOCK/started"
  trap 'rm -rf "$LOCK" "$WORKROOT" 2>/dev/null || true' EXIT
  if [ -d "$BACKUP_LOCK" ] && [ $(( $(now) - $(cat "$BACKUP_LOCK/started" 2>/dev/null || echo 0) )) -le "$LOCK_STALE_S" ]; then
    log "a backup is running ($BACKUP_LOCK); try again when it has finished"; exit 75
  fi
}

make_marker() { # SET -> marker text for the LOCAL set
  printf 'format=2\nstack=%s\nset=%s\nsha256sums=%s\nmanifest_sha256=%s\nfiles=%s\nverified_at=%s\n' \
    "$STACK_NAME" "$1" "$(sha "$BACKUP_ROOT/$1/SHA256SUMS")" "$(sha "$BACKUP_ROOT/$1/manifest.json")" \
    "$(set_files "$BACKUP_ROOT/$1/manifest.json" | tr '\n' ' ' | sed 's/ $//')" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
# send SET: (re)upload from the healthy local set, download and check, and
# only then write the marker. Until the end the set has no marker: unusable.
send() {
  local s="$1" f mk tmp
  unack "$s"
  if r_files "$s" 2>/dev/null | grep -q ' COMPLETE$'; then
    r_unmark "$s" || { WHY="its old COMPLETE marker could not be removed, so it cannot be repaired safely"; return 1; }
  fi
  for f in $(set_files "$BACKUP_ROOT/$s/manifest.json"); do
    r_put "$s" "$BACKUP_ROOT/$s/$f" "$f" || { WHY="upload of $f failed (or timed out)"; return 1; }
  done
  mk="$(mktemp "$WORKROOT/marker.XXXXXX")"; make_marker "$s" > "$mk"
  tmp="$(mktemp -d "$WORKROOT/sent.XXXXXX")"
  r_get "$s" "$tmp/$s" || { WHY="the uploaded copy could not be read back (or timed out)"; return 1; }
  rm -f "$tmp/$s/COMPLETE"; cp "$mk" "$tmp/$s/COMPLETE"
  check_set "$tmp/$s" "$STACK_NAME" "$s" yes || { WHY="the uploaded copy failed the content check: $WHY"; return 1; }
  r_put "$s" "$mk" COMPLETE || { WHY="the COMPLETE marker could not be written"; return 1; }
  quick_check "$s" || { WHY="after writing COMPLETE: $WHY"; return 1; }
  ack "$s" content
}
# remark SET: a legacy marker, after a content check passed, is replaced.
remark() {
  local mk; mk="$(mktemp "$WORKROOT/marker.XXXXXX")"; make_marker "$1" > "$mk"
  r_put "$1" "$mk" COMPLETE && quick_check "$1"
}

push() {
  need_config
  take_lock
  mkdir -p "$STATE" "$WORKROOT" "$(ack_dir)"
  local remote newest s rc problems=() sent=0 repaired=0 ok=0
  remote="$(remote_sets)" || fail_push "the remote sets at $TARGET could not be listed (storage unreachable or timed out); no set is considered off-server"
  newest="$(local_sets | head -n 1)"
  for s in $(local_sets | tac); do
    if ! check_set "$BACKUP_ROOT/$s" "$STACK_NAME" "$s" no; then
      problems+=("local set $s fails its own checks ($WHY): not sent")
      unack "$s"; continue
    fi
    if grep -qxF "$s" <<<"$remote"; then
      rc=0; quick_check "$s" || rc=$?
      # Content check for the newest set and for any set without a current
      # acknowledgement (e.g. one that `verify` or `status` found damaged).
      if [ "$rc" = 0 ] && { [ "$s" = "$newest" ] || [ ! -f "$(ack_dir)/$s.ok" ]; }; then full_check "$s" || rc=$?; fi
      if [ "$rc" = 4 ]; then
        rc=0; full_check "$s" || rc=$?
        if [ "$rc" = 0 ]; then remark "$s" || rc=1; fi
      fi
      case "$rc" in
        0) if [ "$s" = "$newest" ]; then ack "$s" content; else ack "$s" metadata; fi
           ok=$((ok + 1)); continue ;;
        2) unack "$s"; problems+=("$s: $WHY (not counted as off-server)"); continue ;;
        *) log "$s is not usable off-server ($WHY): repairing it from the healthy local set"
           if send "$s"; then repaired=$((repaired + 1)); log "$s repaired and verified"
           else problems+=("$s: repair failed - $WHY; the remote copy stays unusable, the local set is untouched"); fi
           continue ;;
      esac
    fi
    log "sending $s"
    if send "$s"; then sent=$((sent + 1)); log "$s is usable off-server (content verified)"
    else problems+=("$s: $WHY; it stays unusable remotely, the local set is untouched"); fi
  done
  # Remote sets with no local copy (older than local retention, or made
  # elsewhere): cannot be repaired from here, but must not hide damage.
  local seen=0
  for s in $remote; do
    grep -qxF "$s" <<<"$(local_sets)" && continue
    seen=$((seen + 1)); [ "$seen" -le "$STATUS_SETS" ] || break
    rc=0; quick_check "$s" || rc=$?
    case "$rc" in
      0|4) ;;
      *) problems+=("$s: not usable off-server ($WHY) and there is no local copy to repair it from") ;;
    esac
  done
  [ "${#problems[@]}" = 0 ] || fail_push "${problems[@]}"
  now > "$STATE/offsite-last-success"
  printf '%s\n' "${newest:-none}" > "$STATE/offsite-last-set"
  rm -f "$STATE/offsite-last-failure" "$STATE/offsite-last-failure-reason"
  log "OFFSITE OK: $sent sent, $repaired repaired, $ok already usable; newest local set ${newest:-none} is verified off-server"
}
fail_push() {
  mkdir -p "$STATE" && now > "$STATE/offsite-last-failure" && printf '%s\n' "$@" > "$STATE/offsite-last-failure-reason"
  local p; for p in "$@"; do log "OFFSITE FAILED: $p"; done
  log "(local sets untouched; the next push retries)"
  exit 1
}

status() {
  local check="${1:-}" attention=() t s rc fallback="" newest_remote="" newest_local seen=0 list
  echo "stack: $STACK_NAME   backups: $BACKUP_ROOT"
  if [ -f "$STATE/last-failure" ]; then
    echo "local backup:     LAST RUN FAILED $(utc "$(cat "$STATE/last-failure")"): $(cat "$STATE/last-failure-reason" 2>/dev/null)"
    attention+=("the last local backup failed")
  fi
  if [ -f "$STATE/last-success" ]; then
    t="$(cat "$STATE/last-success")"
    echo "local backup:     last success $(utc "$t") ($(ago "$t") ago), set $(cat "$STATE/last-set" 2>/dev/null)"
    [ $(( $(now) - t )) -lt 93600 ] || attention+=("no local backup for more than 26h")
  else
    echo "local backup:     no success recorded"; attention+=("no successful local backup")
  fi
  newest_local="$(local_sets | head -n 1)"
  if [ -z "$DRIVER" ]; then
    echo "remote transfer:  NOT CONFIGURED (OFFSITE_DRIVER, OFFSITE_TARGET)"; attention+=("off-server copies are not configured")
  else
    need_config
    # status takes no lock (it only reads), so it may run beside another
    # status, a push or a verify: it works in a folder of its own, made for
    # this run and removed when it ends - never the shared .offsite-work a
    # locked run is using (removing that broke the other run's checks).
    mkdir -p "$BACKUP_ROOT"
    WORKROOT="$(mktemp -d "$BACKUP_ROOT/.offsite-status.XXXXXX")"
    trap 'rm -rf "$WORKROOT" 2>/dev/null || true' EXIT
    if [ -f "$STATE/offsite-last-success" ]; then t="$(cat "$STATE/offsite-last-success")"; echo "remote transfer:  last success $(utc "$t") ($(ago "$t") ago)"
    else echo "remote transfer:  no success recorded"; fi
    if [ -f "$STATE/offsite-last-failure" ]; then
      echo "remote transfer:  LAST RUN FAILED $(utc "$(cat "$STATE/offsite-last-failure")"):"
      sed 's/^/                    /' "$STATE/offsite-last-failure-reason" 2>/dev/null || true
      attention+=("the last off-server transfer failed")
    fi
    if ! list="$(remote_sets)"; then
      echo "remote sets:      UNREADABLE - the storage could not be listed (unreachable or timed out); nothing can be confirmed"
      attention+=("the off-server storage cannot be read: no remote set is confirmed")
    elif [ -z "$list" ]; then
      echo "remote sets:      NONE for stack $STACK_NAME"; attention+=("no off-server set of this stack")
    else
      newest_remote="$(head -n 1 <<<"$list")"
      echo "remote sets of $STACK_NAME (newest first):"
      for s in $list; do
        seen=$((seen + 1)); [ "$seen" -le "$STATUS_SETS" ] || break
        rc=0
        if [ -z "$fallback" ]; then
          full_check "$s" || rc=$?
          case "$rc" in
            0) echo "  $s  VERIFIED (content check, now)"; fallback="$s" ;;
            2) echo "  $s  UNREADABLE: $WHY"; unack "$s" ;;
            *) echo "  $s  DAMAGED: $WHY"; unack "$s" ;;
          esac
        else
          quick_check "$s" || rc=$?
          case "$rc" in
            0) echo "  $s  PRESENT (metadata check only; content not read)" ;;
            2) echo "  $s  UNREADABLE: $WHY"; unack "$s"; attention+=("$s cannot be read") ;;
            3) echo "  $s  INCOMPLETE: $WHY"; unack "$s"; attention+=("$s is incomplete") ;;
            4) echo "  $s  PRESENT, legacy marker (content not checked)" ;;
            *) echo "  $s  DAMAGED: $WHY"; unack "$s"; attention+=("$s is damaged") ;;
          esac
        fi
      done
      if [ "$fallback" != "$newest_remote" ]; then
        attention+=("the newest off-server set $newest_remote is not usable")
        if [ -n "$fallback" ]; then echo "fallback:         $fallback is the newest VERIFIED set (older than $newest_remote)"
        else attention+=("no off-server set could be verified"); fi
      fi
      if [ -n "$newest_local" ] && ! grep -qxF "$newest_local" <<<"$list"; then
        attention+=("the newest local set $newest_local is not off-server yet")
      fi
      if [ -n "$fallback" ]; then
        t=$(( ( $(now) - $(set_epoch "$fallback") ) / 3600 ))
        echo "newest verified:  $fallback (${t}h old)"
        [ "$t" -lt "$MAX_AGE_H" ] || attention+=("the newest verified off-server set is ${t}h old (limit ${MAX_AGE_H}h)")
      fi
    fi
  fi
  if [ -f "$STATE/last-restore-check" ]; then echo "restore check:    $(cat "$STATE/last-restore-check")"
  else echo "restore check:    never recorded on this server"; attention+=("no restore check recorded"); fi
  if [ "${#attention[@]}" -gt 0 ]; then
    echo "STATUS ATTENTION:"; printf '  - %s\n' "${attention[@]}"
    [ "$check" = "--check" ] && exit 1
  else
    echo "STATUS OK"
  fi
  return 0
}

verify() {
  local want="${1:-}" list s rc bad=0
  [ -n "$want" ] || die "Usage: $0 verify <set>|all"
  need_config
  take_lock
  mkdir -p "$WORKROOT"
  list="$(remote_sets)" || die "the remote sets at $TARGET could not be listed (storage unreachable or timed out)"
  if [ "$want" != "all" ]; then
    valid_set "$STACK_NAME" "$want" || die "\"$want\" is not a recovery set of stack $STACK_NAME"
    grep -qxF "$want" <<<"$list" || die "no remote set named $want"
    list="$want"
  fi
  [ -n "$list" ] || die "no off-server set of stack $STACK_NAME"
  for s in $list; do
    rc=0; full_check "$s" || rc=$?
    case "$rc" in
      0) echo "$s  VERIFIED (content check)"; ack "$s" content ;;
      2) echo "$s  UNREADABLE: $WHY"; unack "$s"; bad=1 ;;
      *) echo "$s  DAMAGED: $WHY"; unack "$s"; bad=1 ;;
    esac
  done
  [ "$bad" = 0 ] || { echo "VERIFY FAILED"; exit 1; }
  echo "VERIFY OK"
}

fetch() {
  local src="$STACK_NAME" want dest list s rc tmp skipped=() w
  if [ "${1:-}" = "--from-stack" ]; then
    src="${2:-}"
    [[ "$src" =~ $STACK_RE ]] || die "--from-stack needs a stack name"
    shift 2
  fi
  want="${1:-}"; dest="${2:-}"
  [ -n "$want" ] && [ -n "$dest" ] || die "Usage: $0 fetch [--from-stack <stack>] <set|latest> <empty folder>"
  need_config
  [ ! -e "$dest" ] || [ -z "$(ls -A "$dest" 2>/dev/null)" ] || die "$dest is not empty: fetch into an empty folder"
  [ "$src" = "$STACK_NAME" ] || echo "NOTE: fetching a set of ANOTHER stack ($src) for stack $STACK_NAME, as asked with --from-stack."
  if [ "$want" != "latest" ]; then
    valid_set "$src" "$want" || die "\"$want\" is not a recovery set of stack $src (refused; another stack's set needs --from-stack <that stack>)"
  fi
  list="$(remote_sets "$src")" || die "the remote sets at $TARGET could not be listed (storage unreachable or timed out)"
  if [ "$want" != "latest" ]; then
    grep -qxF "$want" <<<"$list" || die "no remote set named $want"
    list="$want"
  fi
  [ -n "$list" ] || die "no off-server set of stack $src"
  mkdir -p "$dest"
  for s in $list; do
    tmp="$dest/.fetching-$s"
    rc=0
    r_get "$s" "$tmp" || { rc=2; WHY="the download failed (or timed out)"; }
    if [ "$rc" = 0 ]; then check_set "$tmp" "$src" "$s" yes || rc=1; fi
    if [ "$rc" = 0 ]; then
      mv "$tmp" "$dest/$s"
      for w in "${skipped[@]}"; do echo "WARNING: newer set $w"; done
      [ "${#skipped[@]}" = 0 ] || echo "WARNING: using the older VERIFIED set $s instead"
      echo "FETCHED $dest/$s (every file checked against SHA256SUMS, the manifest and COMPLETE)"
      if [ "$src" = "$STACK_NAME" ]; then echo "Restore it with: bash scripts/production/restore.sh $dest/$s --keep"
      else echo "Restore it with: bash scripts/production/restore.sh $dest/$s --keep --from-stack $src"; fi
      return 0
    fi
    rm -rf "$tmp"
    skipped+=("$s is not usable: $WHY")
    [ "$want" = "latest" ] || break
  done
  printf 'NOT FETCHED: %s\n' "${skipped[@]}" >&2
  die "no usable off-server set was fetched"
}

case "${1:-}" in
  push) push ;;
  status) status "${2:-}" ;;
  verify) verify "${2:-}" ;;
  fetch) shift; fetch "$@" ;;
  *) die "Usage: $0 push | status [--check] | verify <set>|all | fetch [--from-stack <stack>] <set|latest> <empty folder>" ;;
esac
