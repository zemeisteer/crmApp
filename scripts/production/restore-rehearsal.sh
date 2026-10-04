#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - recovery rehearsal in DISPOSABLE containers: the production
# compose file, the real backup and restore scripts, synthetic data.
#
#   bash scripts/production/restore-rehearsal.sh
#
# What it proves, in two throw-away Compose projects named after this run
# (talimcrm_rehearsal_<run>_src and _dst - their own databases, volumes and
# network, on free ports picked at start), so two rehearsals or an existing
# stack on the same machine cannot collide:
#   1. the production stack starts, with nginx serving HTTPS for the root
#      domain and a center subdomain (a self-signed certificate made here)
#      and redirecting HTTP to HTTPS; the certbot service can run the certbot
#      program itself past its renewal loop, the way init-ssl.sh runs it
#      (the certificate here is copied in, so certbot has no record of it)
#   2. data is created through the API: two centers, staff memberships, a
#      student, group, enrollment, attendance, an invoice paid in two
#      payments with a discount, and an uploaded file the database refers to
#   3. a backup through the real Docker path (backup.sh -> db-backup service
#      -> backup-core.sh) gives a complete recovery set; a backup that cannot
#      succeed fails and leaves the earlier set alone
#      and it is copied off-server (offsite.sh, "dir" driver: a folder that
#      stands in for the remote storage) and marked usable there
#   4. the set is DOWNLOADED from that off-server copy into an empty folder
#      and restored from there into a SEPARATE database server and a SEPARATE
#      uploads volume, the application starts on them and works: migrations,
#      login and roles, records, balances, the uploaded file byte for byte
#   5. the source database and the source uploads are unchanged
# and it records the sizes and times it observed.
#
# It needs Docker and curl, about 2 GB of free memory, and touches nothing
# outside its two projects and a temporary folder.
#
# On failure it names the step, the command status and the checks that did
# not run, and prints the containers' recent logs with this run's secrets
# replaced by <redacted>. With REHEARSAL_DIAG_DIR set, the same (redacted)
# text is also written there before cleanup - CI keeps it as an artifact.
# No env file, dump, token or password is ever written there. No external service is
# configured; nothing leaves the machine. The numbers are for a tiny
# synthetic data set - they are not a recovery-time promise for real data.
# ==============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/production/smoke-lib.sh"
cd "$ROOT"

command -v docker >/dev/null || { echo "Docker is not installed: this rehearsal cannot run here." >&2; exit 2; }
command -v curl >/dev/null || { echo "curl is not installed." >&2; exit 2; }
command -v openssl >/dev/null || { echo "openssl is not installed." >&2; exit 2; }

WORK="$(mktemp -d)"
SRC_ENV="$WORK/src.env"
DST_ENV="$WORK/dst.env"
DOMAIN="rehearsal.localhost"
# Everything this run creates carries its id; cleanup touches nothing else.
RUN="$(date -u +%m%d%H%M%S)$((RANDOM % 900 + 100))"
SRC_PROJECT="talimcrm_rehearsal_${RUN}_src"
DST_PROJECT="talimcrm_rehearsal_${RUN}_dst"
SRC_DB="talimcrm_rehearsal_${RUN}"
DST_DB_NAME="talimcrm_rehearsal_${RUN}_dst"
# A port nobody listens on (bash's /dev/tcp: no extra tool needed).
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
TAKEN_PORTS=""
free_port() {
  local p tries=0
  while :; do
    p=$(( 20000 + RANDOM % 20000 ))
    if port_free "$p" && [[ " $TAKEN_PORTS " != *" $p "* ]]; then echo "$p"; return; fi
    tries=$((tries + 1)); [ "$tries" -lt 50 ] || { echo "no free port found" >&2; exit 2; }
  done
}
HTTP_PORT="$(free_port)"; TAKEN_PORTS="$HTTP_PORT"
HTTPS_PORT="$(free_port)"; TAKEN_PORTS="$TAKEN_PORTS $HTTPS_PORT"
DST_HTTP_PORT="$(free_port)"; TAKEN_PORTS="$TAKEN_PORTS $DST_HTTP_PORT"
DST_HTTPS_PORT="$(free_port)"
# Bounded: a container that hangs (say, a renewal loop by mistake) fails the
# step instead of the whole CI job.
if command -v timeout >/dev/null; then bounded() { timeout --kill-after=10 "$1" "${@:2}"; }; else bounded() { "${@:2}"; }; fi
# The scripts under test get a clean environment plus the env file to use,
# exactly as an operator's shell would give them.
script() { local envfile="$1"; shift; env -i PATH="$PATH" HOME="${HOME:-/tmp}" ENV_FILE="$envfile" bash "$@"; }
src() { script "$SRC_ENV" scripts/production/stack.sh "$@"; }
dst() { script "$DST_ENV" scripts/production/stack.sh "$@"; }

STEPS=("1/7 the production stack, with HTTPS" "2/7 synthetic data through the API" "3/7 backup through the real Docker path"
  "4/7 a backup that cannot succeed" "5/7 restore into a separate database and a separate uploads volume"
  "6/7 the application works on the restored copy" "7/7 the source is untouched")
STEP=""
STEP_NO=0
step() { STEP="$1"; STEP_NO=$((STEP_NO + 1)); echo; echo "== $1"; }
# This run's secrets (and the synthetic login password) never reach the log.
redact() {
  local f k v args=()
  for f in "$SRC_ENV" "$DST_ENV"; do
    [ -f "$f" ] || continue
    for k in POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET TELEGRAM_WEBHOOK_SECRET; do
      v="$(sed -n "s/^$k=//p" "$f")"
      [ -n "$v" ] && args+=(-e "s/$v/<redacted>/g")
    done
  done
  args+=(-e 's/"password":"[^"]*"/"password":"<redacted>"/g' -e 's/Bearer [A-Za-z0-9._-]*/Bearer <redacted>/g' -e 's/Reh-[0-9]*-pass/<redacted>/g')
  sed "${args[@]}"
}
diagnostics() {
  local i
  echo "REHEARSAL FAILED at \"$STEP\": $1"
  echo "checks not run:"
  echo "  - the rest of \"$STEP\" after the failing check"
  for ((i = STEP_NO; i < ${#STEPS[@]}; i++)); do echo "  - ${STEPS[$i]}"; done
  echo "--- containers of this run"
  docker ps -a --filter "label=com.docker.compose.project=$SRC_PROJECT" --format '{{.Names}}  {{.Status}}' 2>&1 || true
  docker ps -a --filter "label=com.docker.compose.project=$DST_PROJECT" --format '{{.Names}}  {{.Status}}' 2>&1 || true
  echo "--- source stack logs (last 80 lines per service)"
  src logs --no-color --tail=80 backend nginx db-backup frontend postgres 2>&1 || true
  echo "--- restored stack logs (last 80 lines per service)"
  dst logs --no-color --tail=80 backend postgres 2>&1 || true
}
fail() {
  local report
  report="$(diagnostics "$*" 2>&1 | redact)"
  echo "$report" >&2
  if [ -n "${REHEARSAL_DIAG_DIR:-}" ]; then
    mkdir -p "$REHEARSAL_DIAG_DIR" && printf '%s\n' "$report" > "$REHEARSAL_DIAG_DIR/rehearsal-failure.txt" || true
  fi
  exit 1
}
cleanup() {
  # Only this run's two projects, by name.
  src down --volumes --remove-orphans >/dev/null 2>&1 || true
  dst down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK" 2>/dev/null || docker run --rm -v "$WORK:/w" alpine sh -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
}
trap cleanup EXIT

rand() { openssl rand -hex "$1"; }
make_env() { # file, stack/project name, database, ports?
  cat > "$1" <<EOF
STACK_NAME=$2
COMPOSE_PROJECT_NAME=$2
HTTP_PORT=$4
HTTPS_PORT=$5
BACKUP_DIR=$WORK/backups-$2
BACKUP_KEEP_DAYS=7
BACKUP_AT_UTC=23:59
DOMAIN=$DOMAIN
FRONTEND_URL=https://$DOMAIN
NEXT_PUBLIC_API_URL=/api
POSTGRES_USER=rehearsal
POSTGRES_PASSWORD=$(rand 24)
POSTGRES_DB=$3
REDIS_PASSWORD=$(rand 24)
JWT_SECRET=$(rand 32)
JWT_EXPIRES_IN=15m
REMINDER_SCAN_MS=0
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=$(rand 24)
EOF
}
make_env "$SRC_ENV" "$SRC_PROJECT" "$SRC_DB" "$HTTP_PORT" "$HTTPS_PORT"
make_env "$DST_ENV" "$DST_PROJECT" "$DST_DB_NAME" "$DST_HTTP_PORT" "$DST_HTTPS_PORT"
SRC_BACKUPS="$WORK/backups-$SRC_PROJECT"
mkdir -p "$SRC_BACKUPS" "$WORK/backups-$DST_PROJECT" "$WORK/cert"
echo "run $RUN: projects $SRC_PROJECT and $DST_PROJECT, ports $HTTP_PORT/$HTTPS_PORT"

# ------------------------------------------------------------------ 1. stack
step "1/7 the production stack, with HTTPS"
openssl req -x509 -nodes -newkey rsa:2048 -days 2 -subj "/CN=$DOMAIN" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:*.$DOMAIN" \
  -keyout "$WORK/cert/privkey.pem" -out "$WORK/cert/fullchain.pem" >/dev/null 2>&1 || fail "(status $?) could not make the self-signed certificate"
chmod 644 "$WORK/cert/"*.pem
src build backend frontend || fail "(status $?) the images did not build"
# Into the stack's own certificate volume, where nginx reads it.
src run --rm --no-deps --entrypoint sh -v "$WORK/cert:/cert:ro" certbot -c \
  'mkdir -p /etc/letsencrypt/live/talimcrm && cp /cert/fullchain.pem /cert/privkey.pem /etc/letsencrypt/live/talimcrm/' || fail "(status $?) could not place the certificate in the certbot volume"
# The certbot program runs when asked to (this is how init-ssl.sh calls it):
# the service's own entrypoint is the renewal loop and must be replaced.
# Bounded, so a loop by mistake fails here instead of hanging.
certbot_run() { bounded 180 env -i PATH="$PATH" HOME="${HOME:-/tmp}" ENV_FILE="$SRC_ENV" bash scripts/production/stack.sh run --rm --no-deps --entrypoint certbot certbot "$@"; }
CERTBOT_IMAGE="$(awk '/^  certbot:/{f=1} f && /image:/{print $2; exit}' docker-compose.prod.yml)"
CERTBOT_VERSION="$(certbot_run --version 2>&1)" || fail "(status $?) certbot --version through --entrypoint certbot: $CERTBOT_VERSION"
# "certbot X.Y.Z": the program answered, not the renewal loop or a shell.
[[ "$(tail -n 1 <<<"$CERTBOT_VERSION")" =~ ^certbot\ [0-9]+\.[0-9]+ ]] || fail "(status $?) certbot --version printed something else: $CERTBOT_VERSION"
CERTBOT_DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' "$CERTBOT_IMAGE" 2>/dev/null || echo "digest unknown")"
# It reads its configuration in the stack's certificate volume. The
# self-signed certificate was copied in, not issued, so certbot has no
# record of it: "No certificates found" is the expected, successful answer.
CERTBOT_CERTS="$(certbot_run certificates 2>&1)" || fail "(status $?) certbot certificates: $CERTBOT_CERTS"
has_text "No certificates found" "$CERTBOT_CERTS" || fail "(status $?) certbot certificates did not report the empty certificate store: $CERTBOT_CERTS"
echo "    certbot: $(tail -n 1 <<<"$CERTBOT_VERSION"), image $CERTBOT_IMAGE ($CERTBOT_DIGEST); runs past the renewal loop and reads the certificate volume"
src up -d --wait --wait-timeout 600 postgres redis backend frontend nginx db-backup || fail "(status $?) the stack did not become healthy"
src exec -T nginx nginx -t >/dev/null 2>&1 || fail "(status $?) nginx rejects the HTTPS configuration"

RESOLVE=(--resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" --resolve "$DOMAIN:$HTTP_PORT:127.0.0.1")
https_get() { curl --fail --silent --show-error --max-time 30 --cacert "$WORK/cert/fullchain.pem" "${RESOLVE[@]}" "$@"; }
HEALTH="$(https_get --retry 20 --retry-delay 3 --retry-all-errors "https://$DOMAIN:$HTTPS_PORT/api/health")" || fail "(status $?) HTTPS on the root domain: $HEALTH"
PAGE="$(https_get --retry 20 --retry-delay 3 --retry-all-errors "https://$DOMAIN:$HTTPS_PORT/login")" || fail "(status $?) the frontend through nginx"
has_text "<html" "$PAGE" || fail "(status $?) the frontend did not return a page"
REDIRECT="$(curl --silent --max-time 20 -o /dev/null -w '%{http_code} %{redirect_url}' "${RESOLVE[@]}" "http://$DOMAIN:$HTTP_PORT/login")" || fail "(status $?) HTTP request"
has_text "301 https://$DOMAIN" "$REDIRECT" || fail "(status $?) HTTP is not redirected to HTTPS (got: $REDIRECT)"
HEADERS="$(https_get -D - -o /dev/null "https://$DOMAIN:$HTTPS_PORT/api/health")" || fail "(status $?) reading the response headers"
has_text "strict-transport-security" "$(tr '[:upper:]' '[:lower:]' <<<"$HEADERS")" || fail "(status $?) no HSTS header"
echo "    HTTPS on $DOMAIN (certificate verified against the name), HTTP -> HTTPS, HSTS: ok"

# ------------------------------------------------------------------- 2. data
step "2/7 synthetic data through the API"
SEED_OUT="$(src exec -T -e API=http://127.0.0.1:4000/api backend node --input-type=module - < scripts/production/rehearsal-seed.mjs)" || fail "(status $?) seeding: $SEED_OUT"
SEED_JSON="$(sed -n 's/^SEED_RESULT=//p' <<<"$SEED_OUT")"
[ -n "$SEED_JSON" ] || fail "(status $?) the seed script printed no result"
SUB="$(json_string sub "$SEED_JSON")"
UPLOAD_FILE="$(sed -n 's/.*"upload":{"file":"\([^"]*\)".*/\1/p' <<<"$SEED_JSON")"
[ -n "$SUB" ] && [ -n "$UPLOAD_FILE" ] || fail "(status $?) could not read the seed result"
# A center subdomain through the wildcard certificate.
SUBRES=(--resolve "$SUB.$DOMAIN:$HTTPS_PORT:127.0.0.1")
curl --fail --silent --show-error --max-time 30 --cacert "$WORK/cert/fullchain.pem" "${SUBRES[@]}" "https://$SUB.$DOMAIN:$HTTPS_PORT/api/health" >/dev/null || fail "(status $?) HTTPS on a center subdomain (wildcard)"
SITE="$(curl --fail --silent --show-error --max-time 30 --cacert "$WORK/cert/fullchain.pem" "${SUBRES[@]}" "https://$SUB.$DOMAIN:$HTTPS_PORT/login")" || fail "(status $?) the center's login page on its subdomain"
has_text "<html" "$SITE" || fail "(status $?) the center subdomain did not return a page"
curl --fail --silent --max-time 30 --cacert "$WORK/cert/fullchain.pem" "${RESOLVE[@]}" -o "$WORK/via-nginx.bin" "https://$DOMAIN:$HTTPS_PORT/uploads/$UPLOAD_FILE" || fail "(status $?) the uploaded file through nginx"
echo "    two centers, staff, student, attendance, invoice + payments, an upload; subdomain HTTPS: ok"
verify() { # stack function name, label
  local out
  out="$("$1" exec -T -e API=http://127.0.0.1:4000/api -e SEED_JSON="$SEED_JSON" backend node --input-type=module - < scripts/production/rehearsal-verify.mjs)" || { rc=$?; echo "$out" | redact; fail "(status $rc) $2: the application checks failed"; }
  echo "$out" | sed 's/^/    /'
}
verify src "source before the backup"

# ----------------------------------------------------- 3. source fingerprint
fingerprint() { # stack function, database
  "$1" exec -T postgres psql -U rehearsal -d "$2" -AtX -c "select md5(string_agg(t||':'||n, ',' order by t)) from (select 'tenants' t, count(*)::text n from tenants union all select 'users', count(*)::text from users union all select 'memberships', count(*)::text from organization_memberships union all select 'students', count(*)::text from students union all select 'enrollments', count(*)::text from enrollments union all select 'attendance', count(*)::text from attendance union all select 'invoices', count(*)||'/'||coalesce(sum(amount_paid),0) from invoices union all select 'payments', count(*)||'/'||coalesce(sum(amount),0)||'/'||coalesce(sum(discount),0) from payments union all select 'allocations', count(*)||'/'||coalesce(sum(amount),0) from payment_allocations) x"
}
uploads_fingerprint() { "$1" exec -T backend sh -c 'cd /app/uploads && find . -type f -exec sha256sum {} + | sort | sha256sum'; }
SRC_DB_BEFORE="$(fingerprint src "$SRC_DB")" || fail "(status $?) source fingerprint"
SRC_UP_BEFORE="$(uploads_fingerprint src)" || fail "(status $?) source uploads fingerprint"

# ----------------------------------------------------------------- 4. backup
step "3/7 backup through the real Docker path"
B0="$(date +%s)"
script "$SRC_ENV" scripts/production/backup.sh || fail "(status $?) backup.sh failed"
BACKUP_S=$(( $(date +%s) - B0 ))
# The sets are written by the backup container as root, for root only. On a
# server the operator reads them with sudo; here they are opened up so the
# checks below (and restore.sh) can read them without it.
readable() { docker run --rm -v "$SRC_BACKUPS:/b" alpine chmod -R a+rX /b >/dev/null || fail "(status $?) could not make the sets readable"; }
PERMS="$(docker run --rm -v "$SRC_BACKUPS:/b" alpine sh -c "stat -c %a /b/${SRC_PROJECT}_*Z /b/${SRC_PROJECT}_*Z/db.sql.gz")" || fail "(status $?) could not read the set's permissions"
[ "$(tr '\n' ' ' <<<"$PERMS")" = "700 600 " ] || fail "(status $?) the set is not private to its owner (modes: $(tr '\n' ' ' <<<"$PERMS"))"
readable
SETS=("$SRC_BACKUPS"/"${SRC_PROJECT}"_*Z)
[ "${#SETS[@]}" = "1" ] && [ -d "${SETS[0]}" ] || fail "(status $?) expected exactly one recovery set"
SET="${SETS[0]}"
for f in db.sql.gz uploads.tar.gz manifest.json SHA256SUMS; do [ -s "$SET/$f" ] || fail "(status $?) the set lacks $f"; done
( cd "$SET" && sha256sum -c SHA256SUMS >/dev/null ) || fail "(status $?) the set's checksums do not match"
MANIFEST="$(cat "$SET/manifest.json")"
has_text '"restore_check": "restored into a scratch database' "$MANIFEST" || fail "(status $?) the manifest does not record a restore check"
has_text '"state": "archived"' "$MANIFEST" || fail "(status $?) the uploads were not archived"
[ "$(json_string application_revision "$MANIFEST")" != "unknown" ] || echo "    note: the application revision is unknown (not a git checkout?)"
SECRET="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$SRC_ENV")"
if grep -rqF "$SECRET" "$SET/manifest.json" "$SET/SHA256SUMS"; then fail "a secret is in the set's manifest"; fi
DB_BYTES="$(wc -c < "$SET/db.sql.gz" | tr -d ' ')"; UP_BYTES="$(wc -c < "$SET/uploads.tar.gz" | tr -d ' ')"
echo "    set $(basename "$SET"): database ${DB_BYTES} bytes, uploads ${UP_BYTES} bytes, ${BACKUP_S}s (including its own restore check)"
src exec -T db-backup sh /opt/talimcrm/backup-core.sh healthcheck >/dev/null || fail "(status $?) the backup service is not healthy after a good backup"
# Off-server: offsite.sh with the "dir" driver; the folder stands in for the
# remote storage. Its state goes into the backup folder's .state, which the
# backup container created for root - opened up here like the sets are.
REMOTE_DIR="$WORK/offsite-remote"
mkdir -p "$REMOTE_DIR"
printf 'OFFSITE_DRIVER=dir\nOFFSITE_TARGET=%s\n' "$REMOTE_DIR" >> "$SRC_ENV"
docker run --rm -v "$SRC_BACKUPS:/b" alpine sh -c 'mkdir -p /b/.state && chmod -R a+rwX /b/.state' >/dev/null || fail "(status $?) could not open the backup state folder"
P0="$(date +%s)"
OFFSITE_OUT="$(script "$SRC_ENV" scripts/production/offsite.sh push 2>&1)" || fail "(status $?) offsite.sh push: $OFFSITE_OUT"
PUSH_S=$(( $(date +%s) - P0 ))
[ -f "$REMOTE_DIR/$(basename "$SET")/COMPLETE" ] || fail "the set is not marked usable off-server: $OFFSITE_OUT"
echo "    copied off-server and verified there in ${PUSH_S}s"
# A damaged off-server copy must never look healthy, and must be repaired.
rm -f "$REMOTE_DIR/$(basename "$SET")/uploads.tar.gz"
if STATUS_OUT="$(script "$SRC_ENV" scripts/production/offsite.sh status --check 2>&1)"; then fail "status --check called a damaged off-server set healthy: $STATUS_OUT"; fi
has_text "$(basename "$SET")  DAMAGED" "$STATUS_OUT" || fail "status did not name the damaged set: $STATUS_OUT"
REPAIR_OUT="$(script "$SRC_ENV" scripts/production/offsite.sh push 2>&1)" || fail "(status $?) push could not repair the off-server copy: $REPAIR_OUT"
has_text "repaired and verified" "$REPAIR_OUT" || fail "push did not repair the damaged copy: $REPAIR_OUT"
VERIFY_OUT="$(script "$SRC_ENV" scripts/production/offsite.sh verify "$(basename "$SET")" 2>&1)" || fail "(status $?) the repaired copy does not verify: $VERIFY_OUT"
echo "    a damaged off-server copy was reported DAMAGED, repaired from the local set, and verifies again"

step "4/7 a backup that cannot succeed"
# pg_dump of a database that does not exist: the real program, really failing.
if src run --rm --no-deps -e POSTGRES_DB=no_such_database db-backup once >"$WORK/failed-backup.log" 2>&1; then fail "a failing backup reported success"; fi
has_text "BACKUP FAILED" "$(cat "$WORK/failed-backup.log")" || fail "(status $?) the failing backup did not say so"
readable
AFTER_FAIL=("$SRC_BACKUPS"/"${SRC_PROJECT}"_*Z)
[ "${#AFTER_FAIL[@]}" = "1" ] && [ "${AFTER_FAIL[0]}" = "$SET" ] || fail "(status $?) the failed run changed the sets"
( cd "$SET" && sha256sum -c SHA256SUMS >/dev/null ) || fail "(status $?) the good set was damaged by the failed run"
[ -z "$(find "$SRC_BACKUPS" -maxdepth 1 -name '.incomplete-*')" ] || fail "(status $?) the failed run left a partial backup"
if src exec -T db-backup sh /opt/talimcrm/backup-core.sh healthcheck >/dev/null 2>&1; then fail "the backup service still reports healthy after a failed backup"; fi
echo "    failed as it should; the good set is intact; the service reports unhealthy"

# ---------------------------------------------------------------- 5. restore
step "5/7 restore into a separate database and a separate uploads volume"
# From the OFF-SERVER copy only: downloaded into an empty folder, verified.
F0="$(date +%s)"
FETCH_OUT="$(script "$SRC_ENV" scripts/production/offsite.sh fetch latest "$WORK/fetched" 2>&1)" || fail "(status $?) offsite.sh fetch: $FETCH_OUT"
FETCH_S=$(( $(date +%s) - F0 ))
REMOTE_SET="$WORK/fetched/$(basename "$SET")"
[ -f "$REMOTE_SET/COMPLETE" ] && [ "$REMOTE_SET" != "$SET" ] || fail "the fetched set is missing or is the local one"
echo "    downloaded the off-server copy into an empty folder and verified it in ${FETCH_S}s"
R0="$(date +%s)"
dst up -d --wait --wait-timeout 600 postgres || fail "(status $?) the second database server did not start"
RESTORE_OUT="$(script "$DST_ENV" scripts/production/restore.sh "$REMOTE_SET" --keep --from-stack "$SRC_PROJECT" 2>&1)" || { rc=$?; echo "$RESTORE_OUT" | redact; fail "(status $rc) restore.sh failed"; }
echo "$RESTORE_OUT" | grep -E "LOADED|CONSISTENT|APPLICATION|recorded:" | sed 's/^/    /'
has_text "LOADED:      yes" "$RESTORE_OUT" || fail "(status $?) the dump did not load"
has_text "CONSISTENT:  yes" "$RESTORE_OUT" || fail "(status $?) the restored data is not consistent"
RESTORED_DB="$(sed -n 's/^RESTORED_DATABASE=//p' <<<"$RESTORE_OUT")"
[ -n "$RESTORED_DB" ] && [ "$RESTORED_DB" != "$DST_DB_NAME" ] || fail "(status $?) no separate restored database"
LOAD_S="$(sed -n 's/.*LOADED:      yes (\([0-9]*\)s.*/\1/p' <<<"$RESTORE_OUT")"
# The files, into the second stack's own uploads volume.
dst run --rm --no-deps --user root --entrypoint sh -v "$REMOTE_SET:/set:ro" backend -c \
  'tar -xzf /set/uploads.tar.gz -C /app/uploads && chown -R node:node /app/uploads' || fail "(status $?) could not restore the uploads"
# The application of the second stack, on the restored database.
sed -i "s/^POSTGRES_DB=.*/POSTGRES_DB=$RESTORED_DB/" "$DST_ENV"
dst up -d --wait --wait-timeout 600 redis backend || fail "(status $?) the application did not start on the restored copy"
RESTORE_S=$(( $(date +%s) - R0 ))
DST_LOG="$(dst logs --no-color backend)" || fail "(status $?) reading the restored application's log"
has_text "migrate: database is up to date" "$DST_LOG" || fail "(status $?) the restored copy needed migrations or the runner did not finish"
STATUS="$(dst exec -T backend node scripts/migrate.cjs --status)" || fail "(status $?) migration status on the restored copy"
[ "$(count_lines '^PENDING' "$STATUS")" = "0" ] || fail "(status $?) migrations are pending on the restored copy"
echo "    restored as \"$RESTORED_DB\"; ${RESTORE_S}s from an empty server to a running application (dump load ${LOAD_S:-?}s)"

step "6/7 the application works on the restored copy"
verify dst "restored copy"
DST_DB="$(fingerprint dst "$RESTORED_DB")" || fail "(status $?) restored fingerprint"
[ "$DST_DB" = "$SRC_DB_BEFORE" ] || fail "(status $?) the restored database differs from the source as it was backed up"
DST_UP="$(uploads_fingerprint dst)" || fail "(status $?) restored uploads fingerprint"
[ "$DST_UP" = "$SRC_UP_BEFORE" ] || fail "(status $?) the restored uploads differ from the source's"
echo "    database and uploads of the copy match the source as backed up"

step "7/7 the source is untouched"
[ "$(fingerprint src "$SRC_DB")" = "$SRC_DB_BEFORE" ] || fail "(status $?) the source database changed"
[ "$(uploads_fingerprint src)" = "$SRC_UP_BEFORE" ] || fail "(status $?) the source uploads changed"
SRC_DBS="$(src exec -T postgres psql -U rehearsal -d postgres -AtX -c "select count(*) from pg_database where datname like '${SRC_DB}%'")"
[ "$(tr -d '[:space:]' <<<"$SRC_DBS")" = "1" ] || fail "(status $?) the source server gained or lost a database"
verify src "source after the restore"

echo
echo "REHEARSAL OK"
echo "  data:    database dump ${DB_BYTES} bytes (gzip), uploads archive ${UP_BYTES} bytes - a tiny synthetic set"
echo "  backup:  ${BACKUP_S}s (dump, restore check, uploads, checksums)"
echo "  off-server: copy + verify ${PUSH_S}s, download + verify ${FETCH_S}s (a local folder standing in for the remote storage)"
echo "  restore: ${RESTORE_S}s from an empty server to a running, verified application (dump load ${LOAD_S:-?}s)"
echo "  These times describe this small data set on this machine only."
