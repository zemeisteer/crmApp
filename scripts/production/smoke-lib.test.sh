#!/usr/bin/env bash
# Tests of smoke-lib.sh under the same shell options smoke-test.sh uses.
# No Docker needed:   bash scripts/production/smoke-lib.test.sh
set -euo pipefail
cd "$(dirname "$0")"
source ./smoke-lib.sh

failures=0
ok() { echo "  ok  $1"; }
bad() { echo "  FAILED  $1" >&2; failures=$((failures + 1)); }
check() { if "${@:2}"; then ok "$1"; else bad "$1"; fi; }
check_not() { if "${@:2}"; then bad "$1"; else ok "$1"; fi; }

# A backend log like the one CI produced: the migration lines come first,
# then far more output than a pipe buffer holds (about 9 MB here).
filler="$(printf 'backend-1  | [Nest] 1  - LOG [RouterExplorer] Mapped {/api/some/long/route/number/%06d, GET} route +0ms\n' $(seq 1 90000))"
LOG="backend-1  | migrate: applied 0000_init_full_baseline.sql (120 statements)
backend-1  | migrate: applied 0001_invoices_and_payment_gateways.sql (30 statements)
backend-1  | migrate: applied 0033_price_provenance.sql (5 statements)
backend-1  | TalimCRM backend running on http://localhost:4000/api
${filler}
backend-1  | migrate: database is up to date"
echo "log under test: $(wc -c <<<"$LOG") bytes, $(wc -l <<<"$LOG") lines"

echo "the old pattern (what failed in CI)"
# With pipefail, `echo | grep -q` on a large text whose match is early fails
# although the text is there: echo is killed by SIGPIPE.
old_rc=0
( set -o pipefail; echo "$LOG" | grep -q "migrate: applied 0000_" ) 2>/dev/null || old_rc=$?
if [ "$old_rc" -ne 0 ]; then
  ok "echo | grep -q reports failure (exit $old_rc) on an early match in a large log - the bug"
else
  # Timing-dependent on some systems: not an error of the new code.
  echo "  note  echo | grep -q happened to succeed on this machine (the race did not trigger)"
fi

echo "has_text"
check "an early match in a large log is found" has_text "migrate: applied 0000_" "$LOG"
check "a match on the last line is found" has_text "migrate: database is up to date" "$LOG"
check_not "a missing text is reported as missing" has_text "migrate: applied 0099_" "$LOG"
check_not "nothing is found in an empty log" has_text "migrate: applied 0000_" ""
check "a needle that looks like an option or a regex is taken literally" has_text "-q .* [x]" "a -q .* [x] b"
check_not "regex characters do not match loosely" has_text "a.c" "abc"
# Repeated, so a timing-dependent failure would show.
stable=0
for _ in $(seq 1 25); do has_text "migrate: applied 0000_" "$LOG" && stable=$((stable + 1)); done
check "25 of 25 repeated early-match checks succeed" [ "$stable" -eq 25 ]

echo "count_lines"
check "counts matching lines" [ "$(count_lines 'migrate: applied [0-9]{4}_' "$LOG")" = "3" ]
check "zero matches is the answer 0, not a failure" [ "$(count_lines '^PENDING' "$LOG")" = "0" ]
check "counts exactly one baseline line" [ "$(count_lines 'migrate: applied 0000_' "$LOG")" = "1" ]
check_not "an invalid pattern is an error, not 0" count_lines '(' "$LOG"

echo "first_line / last_line"
check "last applied migration is line 3" [ "$(last_line 'migrate: applied' "$LOG")" = "3" ]
check "the API start is line 4" [ "$(first_line 'Nest application successfully started|backend running on' "$LOG")" = "4" ]
check "no match is 0" [ "$(first_line 'never there' "$LOG")" = "0" ]
check "first match wins when there are several" [ "$(first_line 'migrate:' "$LOG")" = "1" ]
check "last match is the last line" [ "$(last_line 'migrate:' "$LOG")" = "$(wc -l <<<"$LOG" | tr -d ' ')" ]

echo "json_string"
check "reads a token" [ "$(json_string accessToken '{"accessToken":"abc.def","refreshToken":"zzz"}')" = "abc.def" ]
check "missing key is empty" [ -z "$(json_string accessToken '{"message":"no"}')" ]

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "smoke-lib: all checks passed"
