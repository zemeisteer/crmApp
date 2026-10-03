#!/usr/bin/env bash
# Checks restore-rehearsal.sh's own logic without Docker: a fake `docker`
# answers like the real certbot image does. It proves that
#   - step 1 accepts certbot's real answers ("certbot X.Y.Z"; "No
#     certificates found." for a certificate that was copied in, not issued)
#     - the brand-name text check that failed in CI is gone;
#   - a renewal loop or a shell answering instead of certbot is caught;
#   - a failure names the step, the command status and the checks not run,
#     shows container logs with this run's secrets redacted, and writes the
#     same redacted report for CI.
# The full rehearsal (real containers) runs in CI: restore-rehearsal.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
failed=0
ok() { pass=$((pass + 1)); echo "  ok  $1"; }
bad() { failed=$((failed + 1)); echo "  FAIL $1"; }
check() { if grep -qF -- "$2" <<<"$3"; then ok "$1"; else bad "$1 (missing: $2)"; fi; }
absent() { if grep -qF -- "$2" <<<"$3"; then bad "$1 (found: $2)"; else ok "$1"; fi; }

mkdir -p "$TMP/bin"
# The fake docker. The scripts call it with a cleaned environment, so the
# mode (real | loop | shell) is read from a file next to it.
cat > "$TMP/bin/docker" <<'FAKE'
#!/usr/bin/env bash
CERTBOT_MODE="$(cat "$(dirname "$0")/mode")"
args=" $* "
envfile=""
prev=""
for a in "$@"; do [ "$prev" = "--env-file" ] && envfile="$a"; prev="$a"; done
case "$args" in
  *" --entrypoint certbot certbot --version "*)
    case "$CERTBOT_MODE" in
      shell) exit 0 ;;
      *) echo "certbot 2.11.0" ;;
    esac ;;
  *" --entrypoint certbot certbot certificates "*)
    case "$CERTBOT_MODE" in
      loop) printf 'Processing /etc/letsencrypt/renewal/x.conf\nCert not yet due for renewal\n' ;;
      *) printf 'Saving debug log to /var/log/letsencrypt/letsencrypt.log\n\n- - - - - - -\nNo certificates found.\n- - - - - - -\n' ;;
    esac ;;
  *" up -d --wait "*) echo "container talimcrm_backend is unhealthy" >&2; exit 1 ;;
  *" logs "*)
    pw="$( [ -n "$envfile" ] && sed -n 's/^POSTGRES_PASSWORD=//p' "$envfile")"
    echo "backend  | connecting with password $pw"
    echo "backend  | login body {\"email\":\"x@example.test\",\"password\":\"Reh-123-pass\"}" ;;
  *" image inspect "*) echo "certbot/dns-cloudflare@sha256:0000" ;;
  *" ps "*) echo "talimcrm_rehearsal_x_src-backend-1  Exited (1)" ;;
  *) exit 0 ;;
esac
FAKE
chmod +x "$TMP/bin/docker"

rehearse() { # mode -> output (exit status in $TMP/status)
  echo "$1" > "$TMP/bin/mode"
  set +e
  # MSYS2_ARG_CONV_EXCL: Git Bash on Windows would rewrite openssl's "/CN=..." as a path.
  # OPENSSL_CONF: some Windows machines point it at a file that does not exist.
  env -u OPENSSL_CONF MSYS2_ARG_CONV_EXCL="/CN=" CERTBOT_MODE="$1" REHEARSAL_DIAG_DIR="$TMP/diag-$1" PATH="$TMP/bin:$PATH" bash "$ROOT/scripts/production/restore-rehearsal.sh" >"$TMP/out-$1" 2>&1
  echo $? > "$TMP/status-$1"
  set -e
  cat "$TMP/out-$1"
}

echo "certbot answers as the real image does (a copied-in certificate)"
OUT="$(rehearse real)"
check "the certbot program is identified by its version" "certbot: certbot 2.11.0" "$OUT"
check "the image and digest are reported" "certbot/dns-cloudflare@sha256:0000" "$OUT"
absent "the old brand-name check no longer fails" "unexpected certbot output" "$OUT"
check "the run continues to the next check (stack start)" 'REHEARSAL FAILED at "1/7 the production stack, with HTTPS": (status 1) the stack did not become healthy' "$OUT"
check "later steps are listed as not run" "  - 7/7 the source is untouched" "$OUT"
check "the rest of the failing step is listed as not run" 'the rest of "1/7 the production stack, with HTTPS"' "$OUT"
check "container logs are shown" "backend  | connecting with password <redacted>" "$OUT"
absent "the database password never appears" "connecting with password $(printf '%s' "x")x" "$OUT"
if grep -qE 'connecting with password [0-9a-f]{48}' <<<"$OUT"; then bad "a generated password leaked"; else ok "no generated password in the output"; fi
absent "the synthetic login password never appears" "Reh-123-pass" "$OUT"
[ "$(cat "$TMP/status-real")" = "1" ] && ok "the rehearsal exits 1" || bad "exit status $(cat "$TMP/status-real")"
REPORT="$(cat "$TMP/diag-real/rehearsal-failure.txt" 2>/dev/null || true)"
check "the redacted report is written for CI" "checks not run:" "$REPORT"
if grep -qE '[0-9a-f]{48}' <<<"$REPORT"; then bad "the CI report holds a secret"; else ok "the CI report holds no secret"; fi
check "projects are named after the run" "projects talimcrm_rehearsal_" "$OUT"

echo "a renewal loop answers instead of 'certbot certificates'"
OUT="$(rehearse loop)"
check "it is caught, with certbot's output shown" "certbot certificates did not report the empty certificate store" "$OUT"
check "the output is in the message" "Cert not yet due for renewal" "$OUT"

echo "a shell runs instead of the certbot program"
OUT="$(rehearse shell)"
check "it is caught" "certbot --version printed something else" "$OUT"

echo
if [ "$failed" -gt 0 ]; then echo "rehearsal logic: $failed check(s) FAILED, $pass passed"; exit 1; fi
echo "rehearsal logic: all checks passed ($pass)"
