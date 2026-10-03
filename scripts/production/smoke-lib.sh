#!/usr/bin/env bash
# Text checks for smoke-test.sh, written to be safe under `set -euo pipefail`.
#
# The trap they avoid:   echo "$LOGS" | grep -q "needle"
# `grep -q` exits at the first match; `echo` is then still writing, gets
# SIGPIPE ("write error: Broken pipe"), and with pipefail the pipeline is
# reported as FAILED although the text was found. The same goes for
# `... | head -1` and for `curl ... | grep -q`. None of the helpers below
# puts an early-exiting reader behind a pipe: the text is passed as a
# here-string, which bash writes out completely before the reader starts.
#
# Sourced by smoke-test.sh; tested by smoke-lib.test.sh.

# has_text NEEDLE TEXT - true when TEXT contains NEEDLE (a fixed string).
has_text() {
  grep -qF -- "$1" <<<"$2"
}

# count_lines REGEX TEXT - number of lines of TEXT matching REGEX (0 is an
# answer, not a failure; a real grep error still fails).
count_lines() {
  local n rc=0
  n="$(grep -cE -- "$1" <<<"$2")" || rc=$?
  [ "$rc" -le 1 ] || return "$rc"
  printf '%s\n' "$n"
}

# first_line REGEX TEXT / last_line REGEX TEXT - 1-based line number of the
# first / last matching line, or 0 when there is none. awk reads to the end.
first_line() {
  awk -v re="$1" '$0 ~ re && !n { n = NR } END { print n + 0 }' <<<"$2"
}
last_line() {
  awk -v re="$1" '$0 ~ re { n = NR } END { print n + 0 }' <<<"$2"
}

# json_string KEY JSON - the value of the first "KEY":"value" pair (enough
# for the flat fields the smoke test reads; no jq needed in the runner).
json_string() {
  sed -n 's/.*"'"$1"'":[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$2"
}
