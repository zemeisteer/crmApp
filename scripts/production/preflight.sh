#!/usr/bin/env bash
# ==============================================================================
# TalimCRM — ishga tushirishdan oldin tekshiruv: .env, DNS, Docker.
# Hech narsani o'zgartirmaydi; maxfiy qiymatlarni ko'rsatmaydi (faqat bor/yo'q).
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

FAIL=0
ok()   { echo "  ✅ $1"; }
warn() { echo "  ⚠️  $1"; }
bad()  { echo "  ❌ $1"; FAIL=1; }

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d '=' -f2- | tr -d ' "' || true; }

echo "== .env"
if [ ! -f .env ]; then bad ".env yo'q (cp .env.production.example .env)"; echo; exit 1; fi
for k in DOMAIN POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET; do
  [ -n "$(env_value $k)" ] && ok "$k" || bad "$k bo'sh"
done
JWT_LEN="$(env_value JWT_SECRET | tr -d '\n' | wc -c)"
[ "$JWT_LEN" -ge 32 ] && ok "JWT_SECRET yetarlicha uzun" || bad "JWT_SECRET juda qisqa (openssl rand -hex 32)"
for k in TELEGRAM_BOT_TOKEN TELEGRAM_BOT_USERNAME TELEGRAM_WEBHOOK_SECRET; do
  [ -n "$(env_value $k)" ] && ok "$k" || warn "$k bo'sh — Telegram bot ishlamaydi"
done
if [ -n "$(env_value GEMINI_API_KEY)" ] || [ -n "$(env_value ANTHROPIC_API_KEY)" ]; then ok "AI kaliti"; else warn "GEMINI_API_KEY / ANTHROPIC_API_KEY bo'sh — AI funksiyalar o'chiq"; fi
[ -n "$(env_value CLOUDFLARE_API_TOKEN)" ] && ok "CLOUDFLARE_API_TOKEN (SSL avtomatik yangilanadi)" || warn "CLOUDFLARE_API_TOKEN bo'sh — SSL TXT yozuv bilan qo'lda, 90 kunda yangilash kerak"
if [ -z "$(env_value SMTP_USER)" ] && [ -z "$(env_value RESEND_API_KEY)" ]; then warn "Email sozlanmagan — parolni tiklash xatlari ketmaydi"; else ok "Email"; fi

DOMAIN="$(env_value DOMAIN)"
echo "== DNS ($DOMAIN)"
if [ -n "$DOMAIN" ]; then
  MYIP="$(curl -fsS -4 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$MYIP" ] && echo "  Server IP: $MYIP"
  for h in "$DOMAIN" "www.$DOMAIN" "tekshiruv-$RANDOM.$DOMAIN"; do
    if command -v dig >/dev/null; then ip="$(dig +short A "$h" | tail -n1)"; else ip="$(getent ahostsv4 "$h" 2>/dev/null | awk 'NR==1{print $1}')"; fi
    label="$h"; case "$h" in tekshiruv-*) label="*.$DOMAIN (wildcard)";; esac
    if [ -z "$ip" ]; then bad "$label — A yozuv yo'q"
    elif [ -n "$MYIP" ] && [ "$ip" != "$MYIP" ]; then
      # Cloudflare proxy (orange cloud) shows Cloudflare's IP, not ours.
      warn "$label → $ip (server IP emas; Cloudflare proxy yoqilgan bo'lsa normal)"
    else ok "$label → $ip"; fi
  done
fi

echo "== Docker"
command -v docker >/dev/null && ok "docker" || bad "docker o'rnatilmagan"
docker compose version >/dev/null 2>&1 && ok "docker compose" || bad "docker compose yo'q"
# The same pinned project and .env the other scripts use (lib.sh).
if ( source "$SCRIPT_DIR/lib.sh" && load_stack && compose config -q ) 2>/dev/null; then ok "docker-compose.prod.yml to'g'ri (shu papkaning .env fayli bilan)"; else bad "docker-compose.prod.yml xato yoki shell'dagi o'zgaruvchilar .env ga zid (bash scripts/production/stack.sh config)"; fi

echo
if [ "$FAIL" -eq 0 ]; then echo "✅ Tayyor. Keyingi: ./scripts/production/init-ssl.sh"; else echo "❌ Yuqoridagi xatolarni tuzating."; fi
exit $FAIL
