#!/usr/bin/env bash
# Shared pieces of the production / staging scripts. Sourced, never run.
#
# WHICH STACK A SCRIPT ACTS ON - one rule, used by every script here:
#
#   The .env next to docker-compose.prod.yml is the ONLY source of the
#   stack's configuration. One checkout = one stack.
#
#   1. Identity (COMPOSE_PROJECT_NAME, STACK_NAME, POSTGRES_DB,
#      POSTGRES_USER, BACKUP_DIR, DOMAIN) is read from that file. If the
#      shell that runs the script carries a DIFFERENT value for one of them,
#      the script stops: an inherited variable must never redirect a
#      validated command to another stack.
#   2. Every other variable the compose file interpolates is removed from
#      Docker's environment before it runs, so Compose can only take it
#      from the file. (`--env-file` alone does not do that: for Compose a
#      shell variable beats the file.)
#   3. The Compose project is always passed explicitly (`-p`): what was
#      validated is what is used - for containers, volumes and networks.
#
# So the guard in down.sh, the database a backup reads, the folder it
# writes to and the project Compose operates on all come from one place.

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$LIB_DIR/../.." && pwd)"
COMPOSE_YML="$PROJECT_ROOT/docker-compose.prod.yml"
# shellcheck source=scripts/production/smoke-lib.sh
source "$LIB_DIR/smoke-lib.sh"

ENV_FILE="${ENV_FILE:-$PROJECT_ROOT/.env}"

die() { echo "$*" >&2; exit 1; }

# env_value KEY [FILE] - the value from the env file. Empty when the key or
# the file is missing. Callers never echo values of secret keys.
env_value() {
  local file="${2:-$ENV_FILE}" line
  [ -f "$file" ] || return 0
  line="$(grep -E "^$1=" "$file" || [ $? -eq 1 ])"
  line="${line##*$'\n'}"
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line#\"}"; line="${line%\"}"
  printf '%s' "$line"
}

# What `docker compose` would call the project of a folder when nothing
# names it: the folder name, lower-cased, without characters it rejects.
default_project_name() {
  local n
  n="$(basename "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
  n="${n#"${n%%[a-z0-9]*}"}"
  printf '%s' "$n"
}

# effective_value KEY [FILE] - the value the stack really runs with: from the
# file, else the default the compose file applies.
effective_value() {
  local key="$1" file="${2:-$ENV_FILE}" v
  v="$(env_value "$key" "$file")"
  if [ -z "$v" ]; then
    case "$key" in
      STACK_NAME) v="talimcrm" ;;
      POSTGRES_USER) v="postgres" ;;
      POSTGRES_DB) v="talimcrm" ;;
      BACKUP_DIR) v="./backups" ;;
      COMPOSE_PROJECT_NAME) v="$(default_project_name "$(cd "$(dirname "$file")" && pwd)")" ;;
    esac
  fi
  printf '%s' "$v"
}

# abs_path PATH BASE - PATH made absolute against BASE (no need to exist).
abs_path() {
  case "$1" in
    /* | [A-Za-z]:[\\/]*) printf '%s' "$1" ;;
    *) printf '%s/%s' "$2" "${1#./}" ;;
  esac
}

IDENTITY_VARS=(COMPOSE_PROJECT_NAME STACK_NAME POSTGRES_DB POSTGRES_USER BACKUP_DIR DOMAIN)

# Names Compose would read from the shell: everything the file interpolates,
# plus Compose's own switches.
compose_var_names() {
  local names
  names="$(grep -oE '\$\{[A-Z_][A-Z0-9_]*' "$COMPOSE_YML" | tr -d '${' | sort -u)"
  printf '%s\n' "$names" COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES COMPOSE_PROJECT_DIRECTORY
}

# load_stack - resolves the stack of this checkout into STACK_NAME, PROJECT,
# PGDB, PGU, BACKUP_ROOT, and refuses inherited values that disagree.
load_stack() {
  # Rehearsal without Docker and without a .env: the caller describes the
  # database through the environment (PG_LOCAL=1). No Compose is involved.
  if [ "${PG_LOCAL:-}" = "1" ] && [ ! -f "$ENV_FILE" ]; then
    STACK_NAME="${STACK_NAME:-talimcrm}"
    PROJECT=""
    PGU="${POSTGRES_USER:-postgres}"
    PGDB="${POSTGRES_DB:-talimcrm}"
    BACKUP_ROOT="$(abs_path "${BACKUP_DIR:-./backups}" "$PROJECT_ROOT")"
    return 0
  fi
  [ -f "$ENV_FILE" ] || die "REFUSED: $ENV_FILE not found - cannot tell which stack this is."

  local v inherited expected conflicts=""
  for v in "${IDENTITY_VARS[@]}"; do
    inherited="${!v:-}"
    [ -n "$inherited" ] || continue
    expected="$(effective_value "$v")"
    [ "$inherited" = "$expected" ] || conflicts="${conflicts}  $v: this shell has \"$inherited\", $ENV_FILE means \"$expected\""$'\n'
  done
  if [ -n "${COMPOSE_FILE:-}" ]; then conflicts="${conflicts}  COMPOSE_FILE is set in this shell (\"$COMPOSE_FILE\")"$'\n'; fi
  if [ -n "$conflicts" ]; then
    echo "REFUSED: the shell carries settings that point at another stack than this checkout's .env:" >&2
    printf '%s' "$conflicts" >&2
    echo "Nothing was done. Unset them (or open a clean shell) and run again." >&2
    exit 1
  fi

  STACK_NAME="$(effective_value STACK_NAME)"
  PROJECT="$(effective_value COMPOSE_PROJECT_NAME)"
  PGU="$(effective_value POSTGRES_USER)"
  PGDB="$(effective_value POSTGRES_DB)"
  BACKUP_ROOT="$(abs_path "$(effective_value BACKUP_DIR)" "$PROJECT_ROOT")"
  [ -n "$PROJECT" ] || die "REFUSED: could not work out the Compose project name."
}

# compose ARGS... - docker compose for THIS stack and nothing else: project
# pinned, only the .env of this checkout, the shell's own copies of the
# stack's variables left out.
compose() {
  [ -n "${PROJECT:-}" ] || die "internal error: load_stack was not called"
  local n unset_args=()
  while IFS= read -r n; do [ -n "$n" ] && unset_args+=(-u "$n"); done < <(compose_var_names)
  # The one value that is NOT in .env: which revision of the application
  # this checkout is (written into each backup's manifest).
  env "${unset_args[@]}" APP_REVISION="$(app_revision)" docker compose -p "$PROJECT" --project-directory "$PROJECT_ROOT" --env-file "$ENV_FILE" -f "$COMPOSE_YML" "$@"
}

# The checkout's commit, "-dirty" when tracked files have uncommitted changes:
# such a build is not any commit, and says so.
app_revision() {
  local rev
  rev="$(git -C "$PROJECT_ROOT" rev-parse --short=12 HEAD 2>/dev/null)" || { printf 'unknown'; return; }
  if git -C "$PROJECT_ROOT" diff --quiet HEAD -- 2>/dev/null; then printf '%s' "$rev"; else printf '%s-dirty' "$rev"; fi
}

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
  local running
  running="$(compose ps --status running --services)" || { echo "Could not query the stack." >&2; exit 2; }
  has_text "postgres" "$running" || { echo "The postgres service of stack \"$STACK_NAME\" (project \"$PROJECT\") is not running." >&2; exit 1; }
}

is_test_name() { [[ "$1" =~ (^|[-_.])(staging|stage|stg|test|rehearsal)([-_.]|$) ]]; }

# A database name is used unquoted in a few places: keep it boring.
safe_dbname() { [[ "$1" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]]; }

now_s() { date +%s; }
