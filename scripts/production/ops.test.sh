#!/usr/bin/env bash
# Command-level tests of init-ssl.sh, backup.sh and restore.sh: which Docker
# commands they issue, in what order, and what they leave behind when a step
# fails. Docker is a fake that records calls and fails on request.
#
#   bash scripts/production/ops.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
# Records every call (arguments only), answers the few queries the scripts
# make, and fails where FAKE_FAIL says so.
line="$*"
printf '%s\n' "$line" >> "$DOCKER_CALLS"
case "$line" in
  *"${FAKE_FAIL:-@@never@@}"*) echo "fake docker: failing \"${FAKE_FAIL}\"" >&2; exit 1 ;;
esac
case "$line" in
  *" ps --status running --services") echo postgres; echo backend ;;
  *"FROM pg_database"*) echo "${FAKE_DB_EXISTS:-0}" ;;
  *"information_schema.tables"*) echo 1 ;;
  *"SELECT tag FROM app_migrations"*) for f in "$FAKE_REPO"/backend/drizzle/[0-9][0-9][0-9][0-9]_*.sql; do basename "$f"; done ;;
  *" psql -d "*" -q -X") cat >/dev/null ;;
  *"SELECT count(*)"*) echo 0 ;;
esac
exit 0
EOF
chmod +x "$WORK/bin/docker"
export DOCKER_CALLS="$WORK/calls.log"

failures=0
pass() { echo "  ok  $1"; }
fail() { echo "  FAILED  $1" >&2; failures=$((failures + 1)); }
check() { if "${@:2}"; then pass "$1"; else fail "$1"; fi; }
check_not() { if "${@:2}"; then fail "$1"; else pass "$1"; fi; }
calls() { [ -f "$DOCKER_CALLS" ] && cat "$DOCKER_CALLS" || true; }
has_call() { grep -qF -- "$1" "$DOCKER_CALLS" 2>/dev/null; }
line_of() { grep -nF -- "$1" "$DOCKER_CALLS" | head -n 1 | cut -d: -f1; }

CO=""
checkout() { # a fresh checkout with a staging .env
  CO="$WORK/co-$RANDOM$RANDOM/crmapp-staging"
  mkdir -p "$CO/scripts" "$CO/nginx/conf.d" "$CO/backend"
  cp -r "$REPO/scripts/production" "$CO/scripts/"
  cp "$REPO/docker-compose.prod.yml" "$CO/"
  cp "$REPO/nginx/conf.d/talimcrm.conf" "$REPO/nginx/conf.d/talimcrm-initial.conf.template" "$CO/nginx/conf.d/"
  cp -r "$REPO/backend/drizzle" "$CO/backend/"
  cat > "$CO/.env" <<'EOF'
STACK_NAME=talimcrm_staging
COMPOSE_PROJECT_NAME=talimcrm_staging
DOMAIN=staging.school.uz
POSTGRES_USER=talimcrm_staging
POSTGRES_PASSWORD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
POSTGRES_DB=talimcrm_staging
JWT_SECRET=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
LETSENCRYPT_EMAIL=ops@school.uz
CLOUDFLARE_API_TOKEN=cf-token-value-that-must-not-leak
EOF
  rm -f "$DOCKER_CALLS"
}
run() { # [VAR=value ...] -- command
  local vars=()
  while [ "$1" != "--" ]; do vars+=("$1"); shift; done
  shift
  OUT="$(env -i PATH="$WORK/bin:$PATH" HOME="${HOME:-/tmp}" DOCKER_CALLS="$DOCKER_CALLS" FAKE_REPO="$REPO" "${vars[@]}" "$@" 2>&1 </dev/null)"
  RC=$?
}
same() { cmp -s "$1" "$2"; }
HTTPS_CONF="$REPO/nginx/conf.d/talimcrm.conf"
HTTP_CONF="$REPO/nginx/conf.d/talimcrm-initial.conf.template"

# ------------------------------------------------------------------ init-ssl
echo "init-ssl.sh - first certificate, Cloudflare DNS"
checkout; run -- bash "$CO/scripts/production/init-ssl.sh"
check "exit 0" [ "$RC" = "0" ]
check "every call is pinned to this stack's project" bash -c "! grep -v '^compose -p talimcrm_staging --project-directory $CO --env-file $CO/.env -f $CO/docker-compose.prod.yml ' '$DOCKER_CALLS' | grep -q ."
check "nginx (and what it needs) is started" has_call " up -d nginx"
check "certbot itself runs, not the service's renewal loop" has_call " run --rm --entrypoint certbot certbot certonly "
check "the root and the wildcard names are requested" has_call " -d staging.school.uz -d *.staging.school.uz"
check "non-interactive, DNS challenge, fixed certificate name" bash -c "grep -F ' certonly ' '$DOCKER_CALLS' | grep -F -- '--non-interactive' | grep -F -- '--dns-cloudflare ' | grep -qF -- '--cert-name talimcrm'"
check_not "the production authority is used unless --test-cert" has_call "--test-cert"
check_not "the Cloudflare token is never on a command line" has_call "cf-token-value-that-must-not-leak"
check_not "nor in the script's output" bash -c "[[ \"\$1\" == *cf-token-value* ]]" _ "$OUT"
check "the issued files are verified" has_call "test -s /etc/letsencrypt/live/talimcrm/fullchain.pem"
check "nginx -t runs before the reload" bash -c "[ \"$(line_of ' exec -T nginx nginx -t')\" -lt \"$(line_of ' exec -T nginx nginx -s reload')\" ]"
check "the certificate is requested before HTTPS is switched on" bash -c "[ \"$(line_of ' certonly ')\" -lt \"$(line_of ' exec -T nginx nginx -t')\" ]"
check "the HTTPS configuration is back in place" same "$CO/nginx/conf.d/talimcrm.conf" "$HTTPS_CONF"
check "nothing is left pending" [ ! -e "$CO/nginx/conf.d/talimcrm.conf.https-pending" ]

echo "init-ssl.sh - --test-cert and the manual TXT method"
checkout; run -- bash "$CO/scripts/production/init-ssl.sh" --test-cert
check "--test-cert reaches certbot" has_call " --test-cert -d staging.school.uz -d *.staging.school.uz"
checkout; sed -i '/^CLOUDFLARE_API_TOKEN=/d' "$CO/.env"; run -- bash "$CO/scripts/production/init-ssl.sh"
check "without a token: the manual DNS challenge, still through --entrypoint certbot" has_call " run --rm -it --entrypoint certbot certbot certonly --manual --preferred-challenges dns "
check "and it says there is no automatic renewal" bash -c "[[ \"\$1\" == *'No automatic renewal'* ]]" _ "$OUT"

echo "init-ssl.sh - the certificate is not issued"
checkout; run FAKE_FAIL=" certonly " -- bash "$CO/scripts/production/init-ssl.sh"
check "exit 1" [ "$RC" = "1" ]
check "says no certificate was issued, and what to do" bash -c "[[ \"\$1\" == *'no certificate was issued'* && \"\$1\" == *'run this script again'* ]]" _ "$OUT"
check "nginx is left on the HTTP-only configuration" same "$CO/nginx/conf.d/talimcrm.conf" "$HTTP_CONF"
check "the HTTPS configuration is kept aside, intact" same "$CO/nginx/conf.d/talimcrm.conf.https-pending" "$HTTPS_CONF"
check_not "HTTPS is not switched on" has_call " exec -T nginx nginx -t"
# ...and running it again after fixing DNS finishes the job.
rm -f "$DOCKER_CALLS"; run -- bash "$CO/scripts/production/init-ssl.sh"
check "a second run completes" [ "$RC" = "0" ]
check "with the real HTTPS configuration (the pending copy, not the HTTP one)" same "$CO/nginx/conf.d/talimcrm.conf" "$HTTPS_CONF"

echo "init-ssl.sh - nginx rejects the HTTPS configuration"
checkout; run FAKE_FAIL=" nginx -t" -- bash "$CO/scripts/production/init-ssl.sh"
check "exit 1" [ "$RC" = "1" ]
check "nginx is put back on the working HTTP configuration" same "$CO/nginx/conf.d/talimcrm.conf" "$HTTP_CONF"
check "and reloaded with it" has_call " exec -T nginx nginx -s reload"
check "the HTTPS configuration is still available to fix" same "$CO/nginx/conf.d/talimcrm.conf.https-pending" "$HTTPS_CONF"
check "it does not declare success" bash -c "[[ \"\$1\" != *'TLS is ready'* ]]" _ "$OUT"

echo "init-ssl.sh - the issued files are missing"
checkout; run FAKE_FAIL="test -s /etc/letsencrypt" -- bash "$CO/scripts/production/init-ssl.sh"
check "exit 1 and HTTPS is not switched on" bash -c "[ '$RC' = 1 ] && ! grep -qF ' nginx -t' '$DOCKER_CALLS'"

echo "init-ssl.sh - refusals"
checkout; sed -i 's/^DOMAIN=.*/DOMAIN=staging.example.uz/' "$CO/.env"; run -- bash "$CO/scripts/production/init-ssl.sh"
check "a placeholder domain is refused before Docker is touched" bash -c "[ '$RC' = 1 ] && [ ! -s '$DOCKER_CALLS' ]"
checkout; run COMPOSE_PROJECT_NAME=talimcrm -- bash "$CO/scripts/production/init-ssl.sh"
check "an inherited production project is refused" bash -c "[ '$RC' = 1 ] && [ ! -s '$DOCKER_CALLS' ]"
check "and the nginx configuration is untouched" same "$CO/nginx/conf.d/talimcrm.conf" "$HTTPS_CONF"

# -------------------------------------------------------------------- backup
echo "backup.sh - the manual backup is the scheduled one"
checkout; run -- bash "$CO/scripts/production/backup.sh"
check "exit 0" [ "$RC" = "0" ]
check "it runs the db-backup service's own program once" has_call "compose -p talimcrm_staging --project-directory $CO --env-file $CO/.env -f $CO/docker-compose.prod.yml run --rm --no-deps db-backup once"
check "the compose service runs the same script on a schedule" bash -c "grep -A40 '^  db-backup:' '$CO/docker-compose.prod.yml' | grep -q 'backup-core.sh' && grep -A40 '^  db-backup:' '$CO/docker-compose.prod.yml' | grep -q 'command: \[\"daemon\"\]'"
check_not "no shell pipeline that could hide a pg_dump failure remains in the compose file" grep -q 'pg_dump.*|.*gzip' "$CO/docker-compose.prod.yml"
check "the uploads are mounted into the backup service (read-only)" grep -q 'uploads_prod_data:/uploads:ro' "$CO/docker-compose.prod.yml"
checkout; run FAKE_FAIL=" db-backup once" -- bash "$CO/scripts/production/backup.sh"
check "a failing backup makes the script fail" [ "$RC" != "0" ]
checkout; run POSTGRES_DB=talimcrm_prod -- bash "$CO/scripts/production/backup.sh"
check "an inherited database name is refused, nothing runs" bash -c "[ '$RC' = 1 ] && [ ! -s '$DOCKER_CALLS' ]"

# ------------------------------------------------------------------- restore
SET="$WORK/set/talimcrm_staging_20261002T220000Z"
mkdir -p "$SET"
printf -- '-- PostgreSQL database dump\nSELECT 1;\n-- PostgreSQL database dump complete\n' | gzip > "$SET/db.sql.gz"
echo "files" | gzip > "$SET/uploads.tar.gz"
echo '{"format":1,"created_utc":"2026-10-02T22:00:00Z","application_revision":"abc1234","latest_migration":"0033_price_provenance.sql"}' > "$SET/manifest.json"
( cd "$SET" && sha256sum db.sql.gz uploads.tar.gz > SHA256SUMS )
created() { grep -oE 'createdb -U talimcrm_staging [a-z_0-9]+' "$DOCKER_CALLS" | awk '{print $4}' | head -n 1; }

echo "restore.sh - a drill"
checkout; run -- bash "$CO/scripts/production/restore.sh" "$SET"
check "exit 0" [ "$RC" = "0" ]
T="$(created)"
check "a NEW database is created, named after the live one" bash -c "[[ '$T' =~ ^talimcrm_staging_restore_[0-9]{14}$ ]]"
check_not "the live database is never the target of createdb / dropdb / the load" bash -c "grep -E '(createdb|dropdb) -U talimcrm_staging (--if-exists )?talimcrm_staging\$|psql -d talimcrm_staging -v ON_ERROR_STOP=1 -q -X' '$DOCKER_CALLS' | grep -q ."
check "the three results are reported separately" bash -c "[[ \"\$1\" == *'LOADED:      yes'* && \"\$1\" == *'CONSISTENT:  yes'* && \"\$1\" == *'APPLICATION: not checked'* ]]" _ "$OUT"
check "the drill's copy is dropped at the end" has_call "dropdb -U talimcrm_staging --if-exists $T"
check "the set's checksums were verified and its origin shown" bash -c "[[ \"\$1\" == *'checksums: verified'* && \"\$1\" == *'abc1234'* ]]" _ "$OUT"

echo "restore.sh - --keep"
checkout; run -- bash "$CO/scripts/production/restore.sh" "$SET" --keep
check "exit 0 and the copy's name is printed" bash -c "[ '$RC' = 0 ] && [[ \"\$1\" == *'RESTORED_DATABASE=talimcrm_staging_restore_'* ]]" _ "$OUT"
check_not "nothing is dropped" has_call "dropdb"
check "the switch-over is printed, not performed" bash -c "[[ \"\$1\" == *'ALTER DATABASE'* ]] && ! grep -q 'ALTER DATABASE' '$DOCKER_CALLS'" _ "$OUT"

echo "restore.sh - cleanup only drops what this run created"
checkout; run FAKE_DB_EXISTS=1 -- bash "$CO/scripts/production/restore.sh" "$SET"
check "a name that is already taken: refused" [ "$RC" = "1" ]
check_not "no createdb" has_call "createdb"
check_not "and NO dropdb (the existing database is someone else's)" has_call "dropdb"
checkout; run FAKE_FAIL="createdb" -- bash "$CO/scripts/production/restore.sh" "$SET"
check "createdb fails: refused" [ "$RC" = "1" ]
check_not "and no dropdb follows" has_call "dropdb"
checkout; run FAKE_FAIL=" -q -X" -- bash "$CO/scripts/production/restore.sh" "$SET"
T="$(created)"
check "the dump fails to load: exit 1" [ "$RC" = "1" ]
check "the half-loaded copy this run created is removed" has_call "dropdb -U talimcrm_staging --if-exists $T"
check "exactly one database is dropped" [ "$(grep -c 'dropdb' "$DOCKER_CALLS")" = "1" ]
checkout; run FAKE_FAIL=" -q -X" -- bash "$CO/scripts/production/restore.sh" "$SET" --keep
check "a failed load is not kept even with --keep" has_call "dropdb -U talimcrm_staging --if-exists"

echo "restore.sh - a damaged set"
BAD="$WORK/set/talimcrm_staging_20261003T220000Z"; cp -r "$SET" "$BAD"; echo "tampered" | gzip > "$BAD/db.sql.gz"
checkout; run -- bash "$CO/scripts/production/restore.sh" "$BAD"
check "checksum mismatch is refused" bash -c "[ '$RC' = 1 ] && [[ \"\$1\" == *'checksums'* ]]" _ "$OUT"
check "before anything is created" bash -c "! grep -q 'createdb' '$DOCKER_CALLS' 2>/dev/null"
HALF="$WORK/set/talimcrm_staging_20261004T220000Z"; mkdir -p "$HALF"; cp "$SET/db.sql.gz" "$HALF/"
checkout; run -- bash "$CO/scripts/production/restore.sh" "$HALF"
check "a folder without manifest and checksums is not a recovery set" [ "$RC" = "1" ]
checkout; run -- bash "$CO/scripts/production/restore.sh" /nonexistent/set
check "a missing set is refused" [ "$RC" = "1" ]
checkout; run STACK_NAME=talimcrm -- bash "$CO/scripts/production/restore.sh" "$SET"
check "an inherited production stack name is refused, nothing runs" bash -c "[ '$RC' = 1 ] && [ ! -s '$DOCKER_CALLS' ]"

echo
if [ "$failures" -gt 0 ]; then echo "$failures check(s) failed" >&2; exit 1; fi
echo "ops scripts: all checks passed"
