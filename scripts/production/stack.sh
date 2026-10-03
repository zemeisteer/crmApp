#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - `docker compose` for the stack of THIS checkout, and only it.
#
#   bash scripts/production/stack.sh up -d --build
#   bash scripts/production/stack.sh ps
#   bash scripts/production/stack.sh logs -f backend
#   bash scripts/production/stack.sh exec backend node scripts/migrate.cjs --status
#
# The same as `docker compose -f docker-compose.prod.yml ...`, with the rule
# every script here follows (scripts/production/lib.sh): the configuration
# comes from this checkout's .env, the Compose project is passed explicitly,
# and a stack variable inherited from the shell that names another stack
# stops the command instead of redirecting it. Works from any directory.
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
[ $# -gt 0 ] || die "Usage: $0 <docker compose arguments>"
load_stack
command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 2; }
compose "$@"
