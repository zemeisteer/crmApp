#!/usr/bin/env bash
# Shared pieces of the production / staging scripts. Sourced, never run.
#
# One checkout = one stack: the scripts act on the stack described by the
# .env next to docker-compose.prod.yml (STACK_NAME, COMPOSE_PROJECT_NAME,
# POSTGRES_DB, ...). Staging has its own checkout and its own .env, so a
# script run there cannot reach production, and the other way round.

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$LIB_DIR/../.." && pwd)"
# shellcheck source=scripts/production/smoke-lib.sh
source "$LIB_DIR/smoke-lib.sh"

ENV_FILE="${ENV_FILE:-$PROJECT_ROOT/.env}"

# env_value KEY - the value from .env, never echoed by callers that handle
# secrets. Empty when the key or the file is missing.
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" || [ $? -eq 1 ])"
  line="${line##*$'\n'}"
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line#\"}"; line="${line%\"}"
  printf '%s' "$line"
}

STACK_NAME="${STACK_NAME:-$(env_value STACK_NAME)}"
STACK_NAME="${STACK_NAME:-talimcrm}"
PGU="${POSTGRES_USER:-$(env_value POSTGRES_USER)}"; PGU="${PGU:-postgres}"
PGDB="${POSTGRES_DB:-$(env_value POSTGRES_DB)}"; PGDB="${PGDB:-talimcrm}"

compose() { docker compose --project-directory "$PROJECT_ROOT" -f "$PROJECT_ROOT/docker-compose.prod.yml" --env-file "$ENV_FILE" "$@"; }

# pg CMD ARGS... - a PostgreSQL client program (psql, pg_dump, createdb,
# dropdb) run inside this stack's postgres container. PG_LOCAL=1 runs the
# programs on this machine instead (PGHOST / PGPASSWORD from the
# environment) - used to rehearse the scripts without Docker.
pg() {
  local cmd="$1"
  shift
  if [ "${PG_LOCAL:-}" = "1" ]; then
    "$cmd" -U "$PGU" "$@"
  else
    compose exec -T postgres "$cmd" -U "$PGU" "$@"
  fi
}

# sql DB QUERY - one value / rows, unaligned, no headers; stops on error.
# (tr reads to the end, so the pipe is safe under pipefail; it only removes
# the carriage returns a Windows psql adds.)
sql() { pg psql -d "$1" -v ON_ERROR_STOP=1 -AtX -c "$2" | tr -d '\r'; }

require_stack() {
  if [ "${PG_LOCAL:-}" = "1" ]; then
    command -v psql >/dev/null || { echo "psql is not on PATH" >&2; exit 2; }
    return
  fi
  command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 2; }
  [ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found." >&2; exit 2; }
  local running
  running="$(compose ps --status running --services)" || { echo "Could not query the stack." >&2; exit 2; }
  has_text "postgres" "$running" || { echo "The postgres service of stack \"$STACK_NAME\" is not running." >&2; exit 1; }
}

# A database name is used unquoted in a few places: keep it boring.
safe_dbname() { [[ "$1" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]]; }

now_s() { date +%s; }
