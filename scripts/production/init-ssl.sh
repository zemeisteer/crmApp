#!/usr/bin/env bash
# ==============================================================================
# TalimCRM - the first TLS certificate (Let's Encrypt), with the wildcard:
#   DOMAIN and *.DOMAIN   (every center opens at <center>.DOMAIN)
# for the stack of THIS checkout (its .env decides the domain, the Compose
# project and so the certificate volume: staging gets its own).
#
#   bash scripts/production/init-ssl.sh [--test-cert]
#
#   --test-cert   use Let's Encrypt's STAGING authority: a certificate
#                 browsers do not trust, without the rate limits. For
#                 rehearsing this script.
#
# A wildcard certificate is validated through DNS only:
#   - CLOUDFLARE_API_TOKEN in .env: automatic, and renewal is automatic too
#     (the domain's DNS must be at Cloudflare; token right: Zone > DNS > Edit)
#   - otherwise: add the TXT record(s) certbot shows by hand (then this
#     script has to be run again every 90 days - there is no auto-renewal)
# LETSENCRYPT_EMAIL in .env (or typed when asked) receives expiry notices.
#
# Steps, and what is left behind if one fails:
#   1. nginx is switched to an HTTP-only configuration; the HTTPS one is put
#      aside as talimcrm.conf.https-pending.
#   2. certbot obtains the certificate. On failure the site keeps answering
#      on HTTP, the HTTPS configuration is still in the pending file, and
#      running the script again continues from here.
#   3. The HTTPS configuration is put back and TESTED (nginx -t) before
#      nginx reloads. If the test fails, the HTTP configuration is restored
#      and nginx keeps running.
# ==============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

TEST_CERT=()
[ "${1:-}" = "--test-cert" ] && TEST_CERT=(--test-cert)
[ -z "${1:-}" ] || [ "${1:-}" = "--test-cert" ] || die "Usage: $0 [--test-cert]"

load_stack
command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 2; }

DOMAIN="$(env_value DOMAIN)"
[ -n "$DOMAIN" ] || die "ERROR: DOMAIN is empty in $ENV_FILE."
[[ "$DOMAIN" != *"example"* ]] || die "ERROR: DOMAIN in $ENV_FILE is still the placeholder ($DOMAIN)."
CF_TOKEN="$(env_value CLOUDFLARE_API_TOKEN)"
ADMIN_EMAIL="$(env_value LETSENCRYPT_EMAIL)"
if [ -z "$ADMIN_EMAIL" ]; then read -r -p "E-mail for Let's Encrypt expiry notices: " ADMIN_EMAIL; fi
[ -n "$ADMIN_EMAIL" ] || die "ERROR: an e-mail address is required."

CONF="$PROJECT_ROOT/nginx/conf.d/talimcrm.conf"
PENDING="$PROJECT_ROOT/nginx/conf.d/talimcrm.conf.https-pending"
INITIAL="$PROJECT_ROOT/nginx/conf.d/talimcrm-initial.conf.template"
[ -f "$INITIAL" ] || die "ERROR: $INITIAL is missing."

echo "=========================================================="
echo "TLS for: $DOMAIN and *.$DOMAIN"
echo "Stack:   $STACK_NAME (Compose project \"$PROJECT\" - its own certificate volume)"
if [ -n "$CF_TOKEN" ]; then echo "Method:  Cloudflare DNS (automatic)"; else echo "Method:  TXT record added by hand"; fi
[ "${#TEST_CERT[@]}" -eq 0 ] || echo "Authority: Let's Encrypt STAGING (not trusted by browsers)"
echo "=========================================================="

# --- 1. HTTP-only while there is no certificate
echo "1/3 switching nginx to the HTTP-only configuration"
# An earlier, interrupted run already put the HTTPS configuration aside.
if [ ! -f "$PENDING" ]; then
  [ -f "$CONF" ] || die "ERROR: $CONF is missing."
  cp "$CONF" "$PENDING"
fi
cp "$INITIAL" "$CONF"
compose up -d nginx || die "ERROR: could not start nginx (and the services it needs). The HTTPS configuration is in $PENDING; fix the problem and run this script again."

# --- 2. the certificate
echo "2/3 requesting the certificate"
failed_cert() {
  echo "ERROR: no certificate was issued." >&2
  echo "       The site keeps answering on HTTP. The HTTPS configuration is in $PENDING." >&2
  echo "       Check the DNS records / the token and run this script again." >&2
  exit 1
}
# `--entrypoint certbot`: the service's own entrypoint is the renewal loop,
# which would ignore these arguments.
if [ -n "$CF_TOKEN" ]; then
  # The token goes into the certificate volume (renewal needs it), passed
  # through the environment, never on a command line.
  CF_TOKEN="$CF_TOKEN" compose run --rm -e CF_TOKEN --entrypoint sh certbot -c \
    'umask 077; printf "dns_cloudflare_api_token = %s\n" "$CF_TOKEN" > /etc/letsencrypt/cloudflare.ini' || failed_cert
  compose run --rm --entrypoint certbot certbot certonly \
    --non-interactive \
    --dns-cloudflare \
    --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 30 \
    --email "$ADMIN_EMAIL" --agree-tos --no-eff-email \
    --cert-name talimcrm \
    "${TEST_CERT[@]}" \
    -d "$DOMAIN" -d "*.$DOMAIN" || failed_cert
else
  echo "    certbot will show TXT record(s) for _acme-challenge.$DOMAIN."
  echo "    Add them at your DNS provider, wait a minute or two, then press Enter."
  compose run --rm -it --entrypoint certbot certbot certonly \
    --manual --preferred-challenges dns \
    --email "$ADMIN_EMAIL" --agree-tos --no-eff-email \
    --cert-name talimcrm \
    "${TEST_CERT[@]}" \
    -d "$DOMAIN" -d "*.$DOMAIN" || failed_cert
fi
compose run --rm --entrypoint sh certbot -c 'test -s /etc/letsencrypt/live/talimcrm/fullchain.pem && test -s /etc/letsencrypt/live/talimcrm/privkey.pem' || failed_cert

# --- 3. HTTPS, tested before it is used
echo "3/3 switching nginx to HTTPS"
cp "$PENDING" "$CONF"
if ! compose exec -T nginx nginx -t; then
  cp "$INITIAL" "$CONF"
  compose exec -T nginx nginx -s reload || true
  echo "ERROR: nginx rejected the HTTPS configuration (see its message above)." >&2
  echo "       The HTTP configuration was put back and nginx keeps running. The certificate IS issued;" >&2
  echo "       fix $PENDING and run this script again (it will not ask Let's Encrypt for a new one unless needed)." >&2
  exit 1
fi
compose exec -T nginx nginx -s reload || die "ERROR: nginx did not reload."
rm -f "$PENDING"
echo "=========================================================="
echo "TLS is ready: https://$DOMAIN and https://<center>.$DOMAIN"
if [ -z "$CF_TOKEN" ]; then echo "No automatic renewal with the manual method: run this script again within 90 days."; else echo "Renewal: the certbot service checks twice a day; nginx reloads every 12 hours."; fi
echo "=========================================================="
