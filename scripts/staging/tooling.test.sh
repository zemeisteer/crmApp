#!/usr/bin/env bash
# Regression tests of the stack-selection rule (scripts/production/lib.sh)
# as used by down.sh, stack.sh and preflight-staging.sh.
#
#   bash scripts/staging/tooling.test.sh
#
# Docker is a fake that only records how it was called - nothing real is
# stopped or deleted, here or in CI.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A checkout of its own (so the tests never read a real .env), with the
# scripts and the compose file copied in.
STAGING="$WORK/crmapp-staging"
PRODLIKE="$WORK/crmapp"
for d in "$STAGING" "$PRODLIKE"; do
  mkdir -p "$d/scripts"
  cp -r "$REPO/scripts/production" "$REPO/scripts/staging" "$d/scripts/"
  cp "$REPO/docker-compose.prod.yml" "$d/"
done

cat > "$STAGING/.env" <<'EOF'
STACK_NAME=talimcrm_staging
COMPOSE_PROJECT_NAME=talimcrm_staging
DOMAIN=staging.school.uz
FRONTEND_URL=https://staging.school.uz
NEXT_PUBLIC_API_URL=/api
POSTGRES_USER=talimcrm_staging
POSTGRES_PASSWORD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
POSTGRES_DB=talimcrm_staging
REDIS_PASSWORD=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
JWT_SECRET=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
TELEGRAM_WEBHOOK_SECRET=dddddddddddddddddddddddddddddddddddddddddddddddd
REMINDER_SCAN_MS=0
EOF
# Production as it is deployed today: no STACK_NAME, no COMPOSE_PROJECT_NAME.
cat > "$PRODLIKE/.env" <<'EOF'
DOMAIN=school.uz
FRONTEND_URL=https://school.uz
POSTGRES_USER=talimcrm_admin
POSTGRES_PASSWORD=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
POSTGRES_DB=talimcrm_prod
REDIS_PASSWORD=ffffffffffffffffffffffffffffffffffffffffffffffff
JWT_SECRET=gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg
EOF

# The fake docker: one line per call - the arguments, and the stack
# variables it would have seen in its environment.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
{
  printf 'ARGS:'; printf ' %s' "$@"; printf '\n'
  printf 'ENV: COMPOSE_PROJECT_NAME=%s STACK_NAME=%s POSTGRES_DB=%s BACKUP_DIR=%s COMPOSE_FILE=%s\n' \
    "${COMPOSE_PROJECT_NAME-<unset>}" "${STACK_NAME-<unset>}" "${POSTGRES_DB-<unset>}" "${BACKUP_DIR-<unset>}" "${COMPOSE_FILE-<unset>}"
} >> "$DOCKER_CALLS"
exit 0
EOF
chmod +x "$WORK/bin/docker"
export DOCKER_CALLS="$WORK/docker-calls.log"

failures=0
pass() { echo "  ok  $1"; }
fail() { echo "  FAILED  $1" >&2; failures=$((failures + 1)); }
calls() { [ -f "$DOCKER_CALLS" ] && cat "$DOCKER_CALLS" || true; }
reset() { rm -f "$DOCKER_CALLS"; }
# run [VAR=value ...] -- command...   in a clean environment + the fake docker
run() {
  local vars=()
  while [ "$1" != "--" ]; do vars+=("$1"); shift; done
  shift
  OUT="$(env -i PATH="$WORK/bin:$PATH" HOME="${HOME:-/tmp}" DOCKER_CALLS="$DOCKER_CALLS" "${vars[@]}" "$@" 2>&1)"
  RC=$?
}
expect_rc() { [ "$RC" = "$1" ] && pass "$2 (exit $RC)" || { fail "$2: exit $RC, expected $1"; echo "$OUT" | sed 's/^/      /' >&2; }; }
expect_out() { [[ "$OUT" == *"$1"* ]] && pass "$2" || { fail "$2: output lacks \"$1\""; echo "$OUT" | sed 's/^/      /' >&2; }; }
expect_no_calls() { [ -z "$(calls)" ] && pass "$1" || { fail "$1: docker was called"; calls | sed 's/^/      /' >&2; }; }
expect_call() { [[ "$(calls)" == *"$1"* ]] && pass "$2" || { fail "$2: no docker call with \"$1\""; calls | sed 's/^/      /' >&2; }; }
expect_no_call() { [[ "$(calls)" != *"$1"* ]] && pass "$2" || { fail "$2: docker call contains \"$1\""; calls | sed 's/^/      /' >&2; }; }

echo "down.sh - a valid isolated staging configuration"
reset; run -- bash "$STAGING/scripts/staging/down.sh"
expect_rc 0 "ordinary down runs"
expect_call "compose -p talimcrm_staging " "the project is passed explicitly"
expect_call "--env-file $STAGING/.env" "only this checkout's .env is given to Compose"
expect_call " down --remove-orphans" "it is an ordinary down"
expect_no_call "--volumes" "no volume is removed without --purge"
expect_call "ENV: COMPOSE_PROJECT_NAME=<unset> STACK_NAME=<unset> POSTGRES_DB=<unset> BACKUP_DIR=<unset> COMPOSE_FILE=<unset>" "docker sees no stack variable from the shell"

echo "down.sh - a conflicting COMPOSE_PROJECT_NAME is inherited (the reported hole)"
reset; run COMPOSE_PROJECT_NAME=talimcrm -- bash "$STAGING/scripts/staging/down.sh"
expect_rc 1 "refused"
expect_out "COMPOSE_PROJECT_NAME: this shell has \"talimcrm\"" "the conflict is named"
expect_no_calls "docker was never invoked"
reset; run COMPOSE_PROJECT_NAME=talimcrm -- bash "$STAGING/scripts/staging/down.sh" --purge </dev/null
expect_rc 1 "purge is refused too, before any prompt"
expect_no_calls "docker was never invoked"

echo "down.sh - other inherited settings that disagree"
for pair in STACK_NAME=talimcrm POSTGRES_DB=talimcrm_prod POSTGRES_USER=talimcrm_admin BACKUP_DIR=/opt/crmapp/backups DOMAIN=school.uz COMPOSE_FILE=/opt/crmapp/docker-compose.prod.yml; do
  reset; run "$pair" -- bash "$STAGING/scripts/staging/down.sh"
  [ "$RC" = "1" ] && [ -z "$(calls)" ] && pass "inherited ${pair%%=*} is refused without calling docker" || fail "inherited ${pair%%=*}: exit $RC, calls: $(calls)"
done
reset; run COMPOSE_PROJECT_NAME=talimcrm_staging STACK_NAME=talimcrm_staging -- bash "$STAGING/scripts/staging/down.sh"
expect_rc 0 "inherited values that EQUAL the file's are fine"
expect_call "compose -p talimcrm_staging " "and the pinned project is still the file's"
reset; run JWT_SECRET=from-the-shell HTTP_PORT=9999 -- bash "$STAGING/scripts/staging/down.sh"
expect_rc 0 "other inherited variables do not stop it"
expect_no_call "from-the-shell" "and are not handed to docker"

echo "down.sh - purge"
reset; run -- bash -c "printf 'talimcrm_staging\n' | bash '$STAGING/scripts/staging/down.sh' --purge"
expect_rc 0 "purge with the stack name typed"
expect_call "compose -p talimcrm_staging " "the pinned project"
expect_call " down --volumes --remove-orphans" "volumes of that project only"
reset; run -- bash -c "printf 'talimcrm\n' | bash '$STAGING/scripts/staging/down.sh' --purge"
expect_rc 1 "purge with a wrong name typed is not confirmed"
expect_no_calls "nothing was removed"
reset; run -- bash -c "printf '\n' | bash '$STAGING/scripts/staging/down.sh' --purge"
expect_rc 1 "purge with nothing typed is not confirmed"
expect_no_calls "nothing was removed"

echo "down.sh - not staging"
reset; run -- bash "$PRODLIKE/scripts/staging/down.sh"
expect_rc 1 "production defaults are refused"
expect_out "not marked as staging" "with the reason"
expect_no_calls "docker was never invoked"
reset; run -- bash -c "printf 'talimcrm\n' | bash '$PRODLIKE/scripts/staging/down.sh' --purge"
expect_rc 1 "purge on production defaults is refused"
expect_no_calls "docker was never invoked"
mv "$STAGING/.env" "$STAGING/.env.away"
reset; run -- bash "$STAGING/scripts/staging/down.sh"
expect_rc 1 "a missing .env is refused"
expect_no_calls "docker was never invoked"
# A staging-looking shell must not make up for a missing or production file.
reset; run STACK_NAME=talimcrm_staging COMPOSE_PROJECT_NAME=talimcrm_staging -- bash "$STAGING/scripts/staging/down.sh"
expect_rc 1 "a missing .env is refused even when the shell says staging"
expect_no_calls "docker was never invoked"
mv "$STAGING/.env.away" "$STAGING/.env"
reset; run STACK_NAME=talimcrm_staging COMPOSE_PROJECT_NAME=talimcrm_staging -- bash "$PRODLIKE/scripts/staging/down.sh"
expect_rc 1 "production .env + a staging-looking shell is refused"
expect_no_calls "docker was never invoked"
cp "$STAGING/.env" "$WORK/half.env"; sed -i 's/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=/' "$WORK/half.env"
cp "$WORK/half.env" "$STAGING/.env.half"; mv "$STAGING/.env" "$STAGING/.env.full"; mv "$STAGING/.env.half" "$STAGING/.env"
reset; run -- bash "$STAGING/scripts/staging/down.sh"
expect_rc 1 "staging STACK_NAME without COMPOSE_PROJECT_NAME is refused"
expect_no_calls "docker was never invoked"
mv "$STAGING/.env.full" "$STAGING/.env"

echo "from a working directory outside the checkout"
mkdir -p "$WORK/elsewhere"
reset; run -- bash -c "cd '$WORK/elsewhere' && bash '$STAGING/scripts/staging/down.sh'"
expect_rc 0 "down.sh works from another directory"
expect_call "--project-directory $STAGING " "Compose is pointed at the checkout, not the current directory"
expect_call "-f $STAGING/docker-compose.prod.yml" "and at its compose file"
# Standing in the production folder while running the staging script.
reset; run -- bash -c "cd '$PRODLIKE' && bash '$STAGING/scripts/staging/down.sh'"
expect_rc 0 "run from inside the production folder"
expect_call "compose -p talimcrm_staging --project-directory $STAGING " "it still acts on staging only"
expect_no_call "$PRODLIKE/" "no production file appears in the call"
expect_no_call "$PRODLIKE " "nor the production folder itself"

echo "stack.sh - the same rule for everyday commands"
reset; run -- bash "$STAGING/scripts/production/stack.sh" ps
expect_rc 0 "passes a command through"
expect_call "compose -p talimcrm_staging --project-directory $STAGING --env-file $STAGING/.env -f $STAGING/docker-compose.prod.yml ps" "with the pinned project and file"
reset; run COMPOSE_PROJECT_NAME=talimcrm_staging -- bash "$PRODLIKE/scripts/production/stack.sh" up -d
expect_rc 1 "production checkout + inherited staging project is refused"
expect_no_calls "docker was never invoked"
reset; run -- bash "$PRODLIKE/scripts/production/stack.sh" up -d
expect_rc 0 "production with its defaults works"
expect_call "compose -p crmapp " "the project is the folder name, as Compose itself would choose"

echo "preflight-staging.sh"
reset; run -- bash "$STAGING/scripts/staging/preflight-staging.sh"
expect_rc 0 "a valid staging .env passes"
expect_call "compose -p talimcrm_staging " "the compose file is validated under the pinned project"
reset; run COMPOSE_PROJECT_NAME=talimcrm -- bash "$STAGING/scripts/staging/preflight-staging.sh"
expect_rc 1 "an inherited conflicting project fails the preflight"
expect_out "COMPOSE_PROJECT_NAME in this shell is \"talimcrm\"" "and is reported"
expect_no_calls "docker is not consulted with a conflicting shell"
reset; run -- bash "$STAGING/scripts/staging/preflight-staging.sh" --prod-env "$PRODLIKE/.env"
expect_rc 0 "compared with a separate production: passes"
expect_out "COMPOSE_PROJECT_NAME: \"talimcrm_staging\" here, \"crmapp\" in production" "the projects are compared as they resolve (production's is its folder name)"
expect_out "backup folders differ" "backup folders are compared"
[[ "$OUT" != *"cccccccc"* ]] && [[ "$OUT" != *"gggggggg"* ]] && pass "no secret value is printed" || fail "a secret value was printed"
# Same project as production.
cp "$PRODLIKE/.env" "$WORK/prod-same.env"; mkdir -p "$WORK/samecase"; cp "$PRODLIKE/.env" "$WORK/samecase/.env"
printf 'COMPOSE_PROJECT_NAME=talimcrm_staging\nSTACK_NAME=talimcrm_staging\nBACKUP_DIR=%s/backups\nJWT_SECRET=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\n' "$STAGING" >> "$WORK/samecase/.env"
reset; run -- bash "$STAGING/scripts/staging/preflight-staging.sh" --prod-env "$WORK/samecase/.env"
expect_rc 1 "a production that shares names with staging fails"
expect_out "COMPOSE_PROJECT_NAME resolves to \"talimcrm_staging\" for BOTH stacks" "shared Compose project (volumes) is caught"
expect_out "STACK_NAME resolves to \"talimcrm_staging\" for BOTH stacks" "shared container names are caught"
expect_out "both stacks write backups to" "a shared backup folder is caught"
expect_out "JWT_SECRET is the SAME as production's" "a shared secret is caught"
reset; run -- bash "$PRODLIKE/scripts/staging/preflight-staging.sh"
expect_rc 1 "production defaults are not a staging configuration"

echo
if [ "$failures" -gt 0 ]; then echo "$failures check(s) failed" >&2; exit 1; fi
echo "staging tooling: all checks passed"
