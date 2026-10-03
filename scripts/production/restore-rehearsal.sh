#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - recovery rehearsal in DISPOSABLE containers: the production
# compose file, the real backup and restore scripts, synthetic data.
#
#   bash scripts/production/restore-rehearsal.sh
#
# What it proves, in two throw-away Compose projects (talimcrm_rehearsal_src
# and talimcrm_rehearsal_dst - their own databases, volumes and network):
#   1. the production stack starts, with nginx serving HTTPS for the root
#      domain and a center subdomain (a self-signed certificate made here)
#      and redirecting HTTP to HTTPS; certbot can be run past the renewal
#      loop the way init-ssl.sh runs it
#   2. data is created through the API: two centers, staff memberships, a
#      student, group, enrollment, attendance, an invoice paid in two
#      payments with a discount, and an uploaded file the database refers to
#   3. a backup through the real Docker path (backup.sh -> db-backup service
#      -> backup-core.sh) gives a complete recovery set; a backup that cannot
#      succeed fails and leaves the earlier set alone
#   4. the set is restored into a SEPARATE database server and a SEPARATE
#      uploads volume, the application starts on them and works: migrations,
#      login and roles, records, balances, the uploaded file byte for byte
#   5. the source database and the source uploads are unchanged
# and it records the sizes and times it observed.
#
# It needs Docker and curl, about 2 GB of free memory, and touches nothing
# outside its two projects and a temporary folder. No external service is
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
HTTP_PORT=18080
HTTPS_PORT=18443
# The scripts under test get a clean environment plus the env file to use,
# exactly as an operator's shell would give them.
script() { local envfile="$1"; shift; env -i PATH="$PATH" HOME="${HOME:-/tmp}" ENV_FILE="$envfile" bash "$@"; }
src() { script "$SRC_ENV" scripts/production/stack.sh "$@"; }
dst() { script "$DST_ENV" scripts/production/stack.sh "$@"; }

STEP=""
step() { STEP="$1"; echo; echo "== $1"; }
fail() {
  echo "REHEARSAL FAILED at \"$STEP\": $*" >&2
  { src logs --no-color --tail=60 backend nginx db-backup || true; dst logs --no-color --tail=60 backend || true; } >&2 2>/dev/null
  exit 1
}
cleanup() {
  # Only the two rehearsal projects, by their pinned names.
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
make_env "$SRC_ENV" talimcrm_rehearsal_src talimcrm_rehearsal "$HTTP_PORT" "$HTTPS_PORT"
make_env "$DST_ENV" talimcrm_rehearsal_dst talimcrm_rehearsal_dst 18081 18444
mkdir -p "$WORK/backups-talimcrm_rehearsal_src" "$WORK/backups-talimcrm_rehearsal_dst" "$WORK/cert"

# ------------------------------------------------------------------ 1. stack
step "1/7 the production stack, with HTTPS"
openssl req -x509 -nodes -newkey rsa:2048 -days 2 -subj "/CN=$DOMAIN" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:*.$DOMAIN" \
  -keyout "$WORK/cert/privkey.pem" -out "$WORK/cert/fullchain.pem" >/dev/null 2>&1 || fail "could not make the self-signed certificate"
chmod 644 "$WORK/cert/"*.pem
src build backend frontend || fail "the images did not build"
# Into the stack's own certificate volume, where nginx reads it.
src run --rm --no-deps --entrypoint sh -v "$WORK/cert:/cert:ro" certbot -c \
  'mkdir -p /etc/letsencrypt/live/talimcrm && cp /cert/fullchain.pem /cert/privkey.pem /etc/letsencrypt/live/talimcrm/' || fail "could not place the certificate in the certbot volume"
# certbot runs when asked to (this is how init-ssl.sh calls it): the
# service's entrypoint is the renewal loop and must be replaced.
CERTBOT_OUT="$(src run --rm --no-deps --entrypoint certbot certbot certificates 2>&1)" || fail "certbot did not run through --entrypoint certbot"
has_text "certbot" "$(tr '[:upper:]' '[:lower:]' <<<"$CERTBOT_OUT")" || fail "unexpected certbot output"
src up -d --wait postgres redis backend frontend nginx db-backup || fail "the stack did not become healthy"
src exec -T nginx nginx -t >/dev/null 2>&1 || fail "nginx rejects the HTTPS configuration"

RESOLVE=(--resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" --resolve "$DOMAIN:$HTTP_PORT:127.0.0.1")
https_get() { curl --fail --silent --show-error --max-time 30 --cacert "$WORK/cert/fullchain.pem" "${RESOLVE[@]}" "$@"; }
HEALTH="$(https_get --retry 20 --retry-delay 3 --retry-all-errors "https://$DOMAIN:$HTTPS_PORT/api/health")" || fail "HTTPS on the root domain: $HEALTH"
PAGE="$(https_get --retry 20 --retry-delay 3 --retry-all-errors "https://$DOMAIN:$HTTPS_PORT/login")" || fail "the frontend through nginx"
has_text "<html" "$PAGE" || fail "the frontend did not return a page"
REDIRECT="$(curl --silent --max-time 20 -o /dev/null -w '%{http_code} %{redirect_url}' "${RESOLVE[@]}" "http://$DOMAIN:$HTTP_PORT/login")" || fail "HTTP request"
has_text "301 https://$DOMAIN" "$REDIRECT" || fail "HTTP is not redirected to HTTPS (got: $REDIRECT)"
HEADERS="$(https_get -D - -o /dev/null "https://$DOMAIN:$HTTPS_PORT/api/health")" || fail "reading the response headers"
has_text "strict-transport-security" "$(tr '[:upper:]' '[:lower:]' <<<"$HEADERS")" || fail "no HSTS header"
echo "    HTTPS on $DOMAIN (certificate verified against the name), HTTP -> HTTPS, HSTS: ok"

# ------------------------------------------------------------------- 2. data
step "2/7 synthetic data through the API"
SEED_OUT="$(src exec -T -e API=http://127.0.0.1:4000/api backend node --input-type=module - < scripts/production/rehearsal-seed.mjs)" || fail "seeding: $SEED_OUT"
SEED_JSON="$(sed -n 's/^SEED_RESULT=//p' <<<"$SEED_OUT")"
[ -n "$SEED_JSON" ] || fail "the seed script printed no result"
SUB="$(json_string sub "$SEED_JSON")"
UPLOAD_FILE="$(sed -n 's/.*"upload":{"file":"\([^"]*\)".*/\1/p' <<<"$SEED_JSON")"
[ -n "$SUB" ] && [ -n "$UPLOAD_FILE" ] || fail "could not read the seed result"
# A center subdomain through the wildcard certificate.
SUBRES=(--resolve "$SUB.$DOMAIN:$HTTPS_PORT:127.0.0.1")
curl --fail --silent --show-error --max-time 30 --cacert "$WORK/cert/fullchain.pem" "${SUBRES[@]}" "https://$SUB.$DOMAIN:$HTTPS_PORT/api/health" >/dev/null || fail "HTTPS on a center subdomain (wildcard)"
SITE="$(curl --fail --silent --show-error --max-time 30 --cacert "$WORK/cert/fullchain.pem" "${SUBRES[@]}" "https://$SUB.$DOMAIN:$HTTPS_PORT/login")" || fail "the center's login page on its subdomain"
has_text "<html" "$SITE" || fail "the center subdomain did not return a page"
curl --fail --silent --max-time 30 --cacert "$WORK/cert/fullchain.pem" "${RESOLVE[@]}" -o "$WORK/via-nginx.bin" "https://$DOMAIN:$HTTPS_PORT/uploads/$UPLOAD_FILE" || fail "the uploaded file through nginx"
echo "    two centers, staff, student, attendance, invoice + payments, an upload; subdomain HTTPS: ok"
verify() { # stack function name, label
  local out
  out="$("$1" exec -T -e API=http://127.0.0.1:4000/api -e SEED_JSON="$SEED_JSON" backend node --input-type=module - < scripts/production/rehearsal-verify.mjs)" || { echo "$out"; fail "$2: the application checks failed"; }
  echo "$out" | sed 's/^/    /'
}
verify src "source before the backup"

# ----------------------------------------------------- 3. source fingerprint
fingerprint() { # stack function, database
  "$1" exec -T postgres psql -U rehearsal -d "$2" -AtX -c "select md5(string_agg(t||':'||n, ',' order by t)) from (select 'tenants' t, count(*)::text n from tenants union all select 'users', count(*)::text from users union all select 'memberships', count(*)::text from organization_memberships union all select 'students', count(*)::text from students union all select 'enrollments', count(*)::text from enrollments union all select 'attendance', count(*)::text from attendance union all select 'invoices', count(*)||'/'||coalesce(sum(amount_paid),0) from invoices union all select 'payments', count(*)||'/'||coalesce(sum(amount),0)||'/'||coalesce(sum(discount),0) from payments union all select 'allocations', count(*)||'/'||coalesce(sum(amount),0) from payment_allocations) x"
}
uploads_fingerprint() { "$1" exec -T backend sh -c 'cd /app/uploads && find . -type f -exec sha256sum {} + | sort | sha256sum'; }
SRC_DB_BEFORE="$(fingerprint src talimcrm_rehearsal)" || fail "source fingerprint"
SRC_UP_BEFORE="$(uploads_fingerprint src)" || fail "source uploads fingerprint"

# ----------------------------------------------------------------- 4. backup
step "3/7 backup through the real Docker path"
B0="$(date +%s)"
script "$SRC_ENV" scripts/production/backup.sh || fail "backup.sh failed"
BACKUP_S=$(( $(date +%s) - B0 ))
# The sets are written by the backup container as root, for root only. On a
# server the operator reads them with sudo; here they are opened up so the
# checks below (and restore.sh) can read them without it.
readable() { docker run --rm -v "$WORK/backups-talimcrm_rehearsal_src:/b" alpine chmod -R a+rX /b >/dev/null || fail "could not make the sets readable"; }
PERMS="$(docker run --rm -v "$WORK/backups-talimcrm_rehearsal_src:/b" alpine sh -c 'stat -c %a /b/talimcrm_rehearsal_src_*Z /b/talimcrm_rehearsal_src_*Z/db.sql.gz')" || fail "could not read the set's permissions"
[ "$(tr '\n' ' ' <<<"$PERMS")" = "700 600 " ] || fail "the set is not private to its owner (modes: $(tr '\n' ' ' <<<"$PERMS"))"
readable
SETS=("$WORK/backups-talimcrm_rehearsal_src"/talimcrm_rehearsal_src_*Z)
[ "${#SETS[@]}" = "1" ] && [ -d "${SETS[0]}" ] || fail "expected exactly one recovery set"
SET="${SETS[0]}"
for f in db.sql.gz uploads.tar.gz manifest.json SHA256SUMS; do [ -s "$SET/$f" ] || fail "the set lacks $f"; done
( cd "$SET" && sha256sum -c SHA256SUMS >/dev/null ) || fail "the set's checksums do not match"
MANIFEST="$(cat "$SET/manifest.json")"
has_text '"restore_check": "restored into a scratch database' "$MANIFEST" || fail "the manifest does not record a restore check"
has_text '"state": "archived"' "$MANIFEST" || fail "the uploads were not archived"
[ "$(json_string application_revision "$MANIFEST")" != "unknown" ] || echo "    note: the application revision is unknown (not a git checkout?)"
SECRET="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$SRC_ENV")"
if grep -rqF "$SECRET" "$SET/manifest.json" "$SET/SHA256SUMS"; then fail "a secret is in the set's manifest"; fi
DB_BYTES="$(wc -c < "$SET/db.sql.gz" | tr -d ' ')"; UP_BYTES="$(wc -c < "$SET/uploads.tar.gz" | tr -d ' ')"
echo "    set $(basename "$SET"): database ${DB_BYTES} bytes, uploads ${UP_BYTES} bytes, ${BACKUP_S}s (including its own restore check)"
src exec -T db-backup sh /opt/talimcrm/backup-core.sh healthcheck >/dev/null || fail "the backup service is not healthy after a good backup"

step "4/7 a backup that cannot succeed"
# pg_dump of a database that does not exist: the real program, really failing.
if src run --rm --no-deps -e POSTGRES_DB=no_such_database db-backup once >"$WORK/failed-backup.log" 2>&1; then fail "a failing backup reported success"; fi
has_text "BACKUP FAILED" "$(cat "$WORK/failed-backup.log")" || fail "the failing backup did not say so"
readable
AFTER_FAIL=("$WORK/backups-talimcrm_rehearsal_src"/talimcrm_rehearsal_src_*Z)
[ "${#AFTER_FAIL[@]}" = "1" ] && [ "${AFTER_FAIL[0]}" = "$SET" ] || fail "the failed run changed the sets"
( cd "$SET" && sha256sum -c SHA256SUMS >/dev/null ) || fail "the good set was damaged by the failed run"
[ -z "$(find "$WORK/backups-talimcrm_rehearsal_src" -maxdepth 1 -name '.incomplete-*')" ] || fail "the failed run left a partial backup"
if src exec -T db-backup sh /opt/talimcrm/backup-core.sh healthcheck >/dev/null 2>&1; then fail "the backup service still reports healthy after a failed backup"; fi
echo "    failed as it should; the good set is intact; the service reports unhealthy"

# ---------------------------------------------------------------- 5. restore
step "5/7 restore into a separate database and a separate uploads volume"
R0="$(date +%s)"
dst up -d --wait postgres || fail "the second database server did not start"
RESTORE_OUT="$(script "$DST_ENV" scripts/production/restore.sh "$SET" --keep 2>&1)" || { echo "$RESTORE_OUT"; fail "restore.sh failed"; }
echo "$RESTORE_OUT" | grep -E "LOADED|CONSISTENT|APPLICATION|recorded:" | sed 's/^/    /'
has_text "LOADED:      yes" "$RESTORE_OUT" || fail "the dump did not load"
has_text "CONSISTENT:  yes" "$RESTORE_OUT" || fail "the restored data is not consistent"
RESTORED_DB="$(sed -n 's/^RESTORED_DATABASE=//p' <<<"$RESTORE_OUT")"
[ -n "$RESTORED_DB" ] && [ "$RESTORED_DB" != "talimcrm_rehearsal_dst" ] || fail "no separate restored database"
LOAD_S="$(sed -n 's/.*LOADED:      yes (\([0-9]*\)s.*/\1/p' <<<"$RESTORE_OUT")"
# The files, into the second stack's own uploads volume.
dst run --rm --no-deps --user root --entrypoint sh -v "$SET:/set:ro" backend -c \
  'tar -xzf /set/uploads.tar.gz -C /app/uploads && chown -R node:node /app/uploads' || fail "could not restore the uploads"
# The application of the second stack, on the restored database.
sed -i "s/^POSTGRES_DB=.*/POSTGRES_DB=$RESTORED_DB/" "$DST_ENV"
dst up -d --wait redis backend || fail "the application did not start on the restored copy"
RESTORE_S=$(( $(date +%s) - R0 ))
DST_LOG="$(dst logs --no-color backend)" || fail "reading the restored application's log"
has_text "migrate: database is up to date" "$DST_LOG" || fail "the restored copy needed migrations or the runner did not finish"
STATUS="$(dst exec -T backend node scripts/migrate.cjs --status)" || fail "migration status on the restored copy"
[ "$(count_lines '^PENDING' "$STATUS")" = "0" ] || fail "migrations are pending on the restored copy"
echo "    restored as \"$RESTORED_DB\"; ${RESTORE_S}s from an empty server to a running application (dump load ${LOAD_S:-?}s)"

step "6/7 the application works on the restored copy"
verify dst "restored copy"
DST_DB="$(fingerprint dst "$RESTORED_DB")" || fail "restored fingerprint"
[ "$DST_DB" = "$SRC_DB_BEFORE" ] || fail "the restored database differs from the source as it was backed up"
DST_UP="$(uploads_fingerprint dst)" || fail "restored uploads fingerprint"
[ "$DST_UP" = "$SRC_UP_BEFORE" ] || fail "the restored uploads differ from the source's"
echo "    database and uploads of the copy match the source as backed up"

step "7/7 the source is untouched"
[ "$(fingerprint src talimcrm_rehearsal)" = "$SRC_DB_BEFORE" ] || fail "the source database changed"
[ "$(uploads_fingerprint src)" = "$SRC_UP_BEFORE" ] || fail "the source uploads changed"
SRC_DBS="$(src exec -T postgres psql -U rehearsal -d postgres -AtX -c "select count(*) from pg_database where datname like 'talimcrm_rehearsal%'")"
[ "$(tr -d '[:space:]' <<<"$SRC_DBS")" = "1" ] || fail "the source server gained or lost a database"
verify src "source after the restore"

echo
echo "REHEARSAL OK"
echo "  data:    database dump ${DB_BYTES} bytes (gzip), uploads archive ${UP_BYTES} bytes - a tiny synthetic set"
echo "  backup:  ${BACKUP_S}s (dump, restore check, uploads, checksums)"
echo "  restore: ${RESTORE_S}s from an empty server to a running, verified application (dump load ${LOAD_S:-?}s)"
echo "  These times describe this small data set on this machine only."
