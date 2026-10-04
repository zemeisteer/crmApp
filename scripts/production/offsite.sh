#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - copies of the recovery sets OFF this server, and back.
#
#   bash scripts/production/offsite.sh push            copy finished sets that are not there yet
#   bash scripts/production/offsite.sh status [--check] local, remote and restore-check status
#   bash scripts/production/offsite.sh fetch <set|latest> <empty folder>
#                                                       download a usable set, verify it
#
# Configuration (this checkout's .env; secrets never in the repo):
#   OFFSITE_DRIVER      rclone | dir
#                       rclone: any storage rclone speaks (S3-compatible, B2,
#                         SFTP, ...). The remote and its credentials live in
#                         the operator's rclone.conf (RCLONE_CONFIG), not here.
#                       dir: a folder mounted on this server from elsewhere
#                         (NFS, an external disk) - also what the tests use.
#   OFFSITE_TARGET      rclone: "<remote>:<bucket>/<path>"; dir: an absolute path
#   OFFSITE_MAX_AGE_HOURS  status --check fails when the newest usable remote
#                       set is older than this (default 30)
#
# Rules it keeps:
#   - Only finished sets (with manifest.json and SHA256SUMS) are sent; a set
#     being written (.incomplete-*) never is.
#   - A remote set is USABLE only when it has a COMPLETE marker, written last,
#     after every file was compared with the local copy byte for byte. A
#     transfer that fails or is cut off leaves no marker: it is not usable
#     and the next push sends it again.
#   - Nothing is ever deleted - not remotely (no sync, no prune: remote
#     retention is the storage's own lifecycle rule) and not locally. A
#     failed transfer leaves every local set where it is.
#   - One push at a time (a lock in the backup folder).
#   - Local status (.state/last-*) and remote status (.state/offsite-*) are
#     kept apart. status --check exits 1 when something needs attention.
#
# Run it after the nightly backup, e.g. from root's crontab one hour later:
#   0 23 * * * cd /opt/crmapp && bash scripts/production/offsite.sh push >> /var/log/talimcrm-offsite.log 2>&1
# See docs/DEPLOYMENT_GUIDE.md ("Serverdan tashqaridagi nusxa").
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
umask 077
load_stack

DRIVER="$(env_value OFFSITE_DRIVER)"
TARGET="$(env_value OFFSITE_TARGET)"
MAX_AGE_H="$(env_value OFFSITE_MAX_AGE_HOURS)"; MAX_AGE_H="${MAX_AGE_H:-30}"
STATE="$BACKUP_ROOT/.state"
LOCK="$BACKUP_ROOT/.offsite.lock"
FILES=(db.sql.gz uploads.tar.gz manifest.json SHA256SUMS)

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
now() { date -u +%s; }
ago() { local s=$(( $(now) - $1 )); if [ "$s" -lt 7200 ]; then printf '%dm' $((s / 60)); else printf '%dh' $((s / 3600)); fi; }
utc() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }
# The time a set was made, from its name: <stack>_YYYYMMDDTHHMMSSZ
set_epoch() {
  local ts="${1##*_}" d
  d="${ts:0:4}-${ts:4:2}-${ts:6:2} ${ts:9:2}:${ts:11:2}:${ts:13:2}"
  date -u -d "$d" +%s 2>/dev/null || date -u -j -f '%Y-%m-%d %H:%M:%S' "$d" +%s
}
sha() { sha256sum "$1" | sed 's/[ *].*//'; }
checksums_ok() { (cd "$1" && sed 's/ \*/  /' SHA256SUMS | sha256sum -c --quiet - >/dev/null 2>&1); }

need_config() {
  case "$DRIVER" in
    rclone) command -v rclone >/dev/null || die "OFFSITE_DRIVER=rclone but rclone is not installed (https://rclone.org/install/)" ;;
    dir) case "$TARGET" in /* | [A-Za-z]:[\\/]*) ;; *) die "OFFSITE_TARGET must be an absolute path for OFFSITE_DRIVER=dir" ;; esac ;;
    "") die "Off-server copies are not configured: set OFFSITE_DRIVER and OFFSITE_TARGET in .env (see docs/DEPLOYMENT_GUIDE.md)" ;;
    *) die "OFFSITE_DRIVER must be rclone or dir (got: $DRIVER)" ;;
  esac
  [ -n "$TARGET" ] || die "OFFSITE_TARGET is empty"
}

# --- the two drivers: the same five operations -------------------------------
# r_complete_sets   names of remote sets that have a COMPLETE marker
# r_put SET FILE    upload one file of a local set
# r_verify SET      every local file of the set is identical remotely
# r_mark SET FILE   write the marker (last)
# r_get SET DEST    download a remote set into DEST/SET
r_complete_sets() {
  case "$DRIVER" in
    dir) [ -d "$TARGET" ] || return 1
         for m in "$TARGET"/*/COMPLETE; do if [ -f "$m" ]; then basename "$(dirname "$m")"; fi; done | sort ;;
    # rclone exits 3 for a path that does not exist yet (nothing sent so far).
    rclone) local out rc=0
            out="$(rclone lsf --recursive --files-only --include '/*/COMPLETE' "$TARGET" 2>/dev/null)" || rc=$?
            [ "$rc" = 0 ] || [ "$rc" = 3 ] || return 1
            sed -n 's#/COMPLETE$##p' <<<"$out" | sort ;;
  esac
}
r_put() {
  case "$DRIVER" in
    dir) mkdir -p "$TARGET/$1" && cp "$BACKUP_ROOT/$1/$2" "$TARGET/$1/$2.part" && mv -f "$TARGET/$1/$2.part" "$TARGET/$1/$2" ;;
    rclone) rclone copyto "$BACKUP_ROOT/$1/$2" "$TARGET/$1/$2" ;;
  esac
}
r_verify() {
  case "$DRIVER" in
    dir) local f; for f in "${FILES[@]}"; do cmp -s "$BACKUP_ROOT/$1/$f" "$TARGET/$1/$f" || return 1; done ;;
    # --download: compare the content itself, whatever hashes the storage offers.
    rclone) rclone check --one-way --download --exclude 'COMPLETE' "$BACKUP_ROOT/$1" "$TARGET/$1" >/dev/null 2>&1 ;;
  esac
}
r_mark() {
  case "$DRIVER" in
    dir) cp "$2" "$TARGET/$1/COMPLETE.part" && mv -f "$TARGET/$1/COMPLETE.part" "$TARGET/$1/COMPLETE" ;;
    rclone) rclone copyto "$2" "$TARGET/$1/COMPLETE" ;;
  esac
}
r_get() {
  case "$DRIVER" in
    dir) mkdir -p "$2/$1" && cp "$TARGET/$1"/* "$2/$1/" ;;
    rclone) rclone copy "$TARGET/$1" "$2/$1" ;;
  esac
}

finished_sets() {
  local d
  for d in "$BACKUP_ROOT/${STACK_NAME}_"*Z; do
    if [ -d "$d" ] && [ -f "$d/manifest.json" ] && [ -f "$d/SHA256SUMS" ]; then basename "$d"; fi
  done | sort
}

push() {
  need_config
  mkdir -p "$STATE/offsite"
  if ! mkdir "$LOCK" 2>/dev/null; then log "another off-server copy is running ($LOCK); nothing done"; exit 75; fi
  trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
  local remote sent=0 s f marker
  remote="$(r_complete_sets)" || fail_push "could not list the remote sets at $TARGET (not reachable or not mounted?)"
  for s in $(finished_sets); do
    if grep -qxF "$s" <<<"$remote"; then touch "$STATE/offsite/$s.ok"; continue; fi
    checksums_ok "$BACKUP_ROOT/$s" || { fail_push "local set $s does not match its own checksums - not sent"; }
    log "sending $s"
    for f in "${FILES[@]}"; do r_put "$s" "$f" || fail_push "upload of $s/$f failed"; done
    r_verify "$s" || fail_push "$s: the remote copy differs from the local set (incomplete or damaged transfer); it stays unusable"
    marker="$(mktemp)"
    printf 'set=%s\nverified_at=%s\nsha256sums=%s\n' "$s" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(sha "$BACKUP_ROOT/$s/SHA256SUMS")" > "$marker"
    r_mark "$s" "$marker" || { rm -f "$marker"; fail_push "$s: could not write the COMPLETE marker"; }
    rm -f "$marker"
    touch "$STATE/offsite/$s.ok"
    sent=$((sent + 1))
    log "$s is usable off-server"
  done
  now > "$STATE/offsite-last-success"
  latest="$(finished_sets | tail -n 1)"
  printf '%s\n' "$latest" > "$STATE/offsite-last-set"
  rm -f "$STATE/offsite-last-failure" "$STATE/offsite-last-failure-reason"
  log "OFFSITE OK: $sent set(s) sent; newest local set ${latest:-none} is off-server"
}
fail_push() {
  mkdir -p "$STATE" && now > "$STATE/offsite-last-failure" && printf '%s\n' "$*" > "$STATE/offsite-last-failure-reason"
  log "OFFSITE FAILED: $* (local sets untouched; the next push retries)"
  exit 1
}

status() {
  local check="${1:-}" attention=() t latest age
  echo "stack: $STACK_NAME   backups: $BACKUP_ROOT"
  # Local.
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
  # Remote.
  if [ -z "$DRIVER" ]; then
    echo "remote transfer:  NOT CONFIGURED (OFFSITE_DRIVER, OFFSITE_TARGET)"; attention+=("off-server copies are not configured")
  else
    need_config
    if [ -f "$STATE/offsite-last-success" ]; then
      t="$(cat "$STATE/offsite-last-success")"
      echo "remote transfer:  last success $(utc "$t") ($(ago "$t") ago)"
    else
      echo "remote transfer:  no success recorded"
    fi
    if [ -f "$STATE/offsite-last-failure" ]; then
      t="$(cat "$STATE/offsite-last-failure")"
      echo "remote transfer:  LAST RUN FAILED $(utc "$t"): $(cat "$STATE/offsite-last-failure-reason" 2>/dev/null)"
      attention+=("the last off-server transfer failed")
    fi
    if latest="$(r_complete_sets | tail -n 1)" && [ -n "$latest" ]; then
      age=$(( ( $(now) - $(set_epoch "$latest") ) / 3600 ))
      echo "remote usable:    newest $latest (${age}h old)"
      [ "$age" -lt "$MAX_AGE_H" ] || attention+=("the newest usable off-server set is ${age}h old (limit ${MAX_AGE_H}h)")
    else
      echo "remote usable:    NONE"; attention+=("no usable off-server set")
    fi
  fi
  # Restore checks (restore.sh records them).
  if [ -f "$STATE/last-restore-check" ]; then
    echo "restore check:    $(cat "$STATE/last-restore-check")"
  else
    echo "restore check:    never recorded on this server"; attention+=("no restore check recorded")
  fi
  if [ "${#attention[@]}" -gt 0 ]; then
    echo "STATUS ATTENTION:"; printf '  - %s\n' "${attention[@]}"
    [ "$check" = "--check" ] && exit 1
  else
    echo "STATUS OK"
  fi
  return 0
}

fetch() {
  local want="${1:-}" dest="${2:-}" sets s
  [ -n "$want" ] && [ -n "$dest" ] || die "Usage: $0 fetch <set|latest> <empty folder>"
  need_config
  [ ! -e "$dest" ] || [ -z "$(ls -A "$dest" 2>/dev/null)" ] || die "$dest is not empty: fetch into an empty folder"
  sets="$(r_complete_sets)"
  if [ "$want" = "latest" ]; then s="$(tail -n 1 <<<"$sets")"; else s="$want"; fi
  [ -n "$s" ] && grep -qxF "$s" <<<"$sets" || die "no usable (COMPLETE) off-server set named ${want}"
  mkdir -p "$dest"
  r_get "$s" "$dest" || die "download of $s failed"
  for f in "${FILES[@]}" COMPLETE; do [ -s "$dest/$s/$f" ] || die "the downloaded set lacks $f"; done
  checksums_ok "$dest/$s" || die "the downloaded set does not match its checksums"
  [ "$(sed -n 's/^sha256sums=//p' "$dest/$s/COMPLETE")" = "$(sha "$dest/$s/SHA256SUMS")" ] || die "the downloaded SHA256SUMS is not the one that was verified at upload"
  echo "FETCHED $dest/$s (checksums verified)"
  echo "Restore it with: bash scripts/production/restore.sh $dest/$s --keep"
}

case "${1:-}" in
  push) push ;;
  status) status "${2:-}" ;;
  fetch) fetch "${2:-}" "${3:-}" ;;
  *) die "Usage: $0 push | status [--check] | fetch <set|latest> <empty folder>" ;;
esac
