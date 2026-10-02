# TalimCRM — Production Deployment & Server Boshqaruv Qo'llanmasi

Ushbu hujjat TalimCRM tizimini haqiqiy Linux VPS/Cloud serverida (Ubuntu 22.04/24.04 LTS) 0 dan to'liq ishga tushirish, xavfsizlik choralarini ko'rish, SSL sertifikatlarini o'rnatish va avtomatik zaxira nusxalarini boshqarish bo'yicha bosqichma-bosqich qo'llanmadir.

---

## 1. Serverga Qo'yiladigan Talablar

| Resurs | Minimal Talab | Tavsiya Etiladigan (Tavsiya) |
|---|---|---|
| **Operatsion Tizim** | Ubuntu 22.04 / 24.04 LTS | Ubuntu 24.04 LTS (x64) |
| **Protsessor (CPU)** | 2 Core | 4 Core |
| **Tezkor Xotira (RAM)**| 4 GB | 8 GB |
| **Disk (NVMe SSD)** | 30 GB | 60+ GB |
| **Tarmoq Portlari** | 80 (HTTP), 443 (HTTPS), 22 (SSH) | UFW xavfsizlik devori bilan |

---

## 2. Serverni Dastlabki Sozlash (Firewall & Docker)

Serverga SSH orqali kiring va tizimni yangilang:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git ufw htop ca-certificates gnupg lsb-release
```

### 2.1. UFW Xavfsizlik Devorini Yoqish
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 2.2. Docker va Docker Compose O'rnatish
```bash
# Docker rasmiy GPG kalitini qo'shish
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Docker omborini qo'shish
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Joriy foydalanuvchiga docker huquqini berish
sudo usermod -aG docker $USER
newgrp docker
```

---

## 3. Domen va DNS Sozlamalari (Multi-Tenant Wildcard)

TalimCRM har bir o'quv markaz uchun alohida subdomen ochish imkoniyatiga ega (masalan, `center1.crmapp.uz`). Shuning uchun DNS panelingizda quyidagi 3 ta **A record** ni server IP manziliga yo'naltiring:

- `@` ➔ `SERVER_IP` (asosiy domen, masalan: `crmapp.uz`)
- `www` ➔ `SERVER_IP` (`www.crmapp.uz`)
- `*` ➔ `SERVER_IP` (barcha markaz subdomenlari uchun wildcard)

---

## 4. Loyihani Serverga Yuklash va Muhit Sozlamalari

**Tez yo'l (yangi Ubuntu server):** bitta skript Docker, firewall, swap, loyiha va tasodifiy parollar bilan `.env` ni tayyorlaydi:

```bash
curl -fsSL https://raw.githubusercontent.com/zemeisteer/crmApp/dev/scripts/production/bootstrap-server.sh -o bootstrap.sh
sudo bash bootstrap.sh talimcrm.uz
cd /opt/crmapp && nano .env          # Telegram, Gemini, Cloudflare kalitlari
./scripts/production/preflight.sh    # .env, DNS va Docker tekshiruvi
```

So'ng 5-bo'limdan davom eting. Qo'lda sozlash:

```bash
# Loyihani klon qilish
git clone https://github.com/zemeisteer/crmApp.git /opt/crmapp
cd /opt/crmapp

# Production konfiguratsiyasini yaratish
cp .env.production.example .env
nano .env
```

`.env` faylida quyidagi asosiy o'zgaruvchilarni o'zgartiring:
1. `DOMAIN`: O'zingizning domeningiz (masalan, `crmapp.uz`).
2. `POSTGRES_PASSWORD`: Murakkab maxfiy parol.
3. `JWT_SECRET`: Kuchli tasodifiy kalit (`openssl rand -hex 32` orqali generatsiya qiling).
4. `REDIS_PASSWORD`: Redis maxfiy paroli.
5. Agar Click, Payme, Eskiz SMS yoki Telegram bot ishlatmoqchi bo'lsangiz, ularning kalitlarini kiriting.

---

## 5. SSL Sertifikatini O'rnatish (Let's Encrypt, wildcard)

Har bir markaz sayti o'z subdomenida ochiladi (`<markaz>.DOMAIN`), shuning uchun sertifikat `DOMAIN` va `*.DOMAIN` uchun olinadi. Wildcard sertifikat faqat DNS orqali tasdiqlanadi:

- **Tavsiya:** domen DNS'ini Cloudflare'ga (bepul) o'tkazing, Cloudflare'da *Zone → DNS → Edit* huquqli API token yarating va `.env` ga `CLOUDFLARE_API_TOKEN=` qilib yozing. Sertifikat avtomatik olinadi va avtomatik yangilanadi.
- Token bo'lmasa, skript `_acme-challenge.DOMAIN` uchun TXT yozuvni ko'rsatadi — uni DNS panelga qo'lda qo'shasiz. Bu holda sertifikat 90 kunda tugaydi va skriptni qayta ishga tushirish kerak.

```bash
chmod +x scripts/production/*.sh
./scripts/production/init-ssl.sh
```

Nginx har 12 soatda qayta yuklanadi, yangilangan sertifikat o'zi ulanadi.

---

## 6. Ishga Tushirish (Migratsiyalar avtomatik)

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Backend har ishga tushganda `backend/drizzle/*.sql` dagi hali qo'llanmagan migratsiyalarni tartib bilan qo'llaydi (`app_migrations` jadvalida qayd etiladi). Yangi versiyani chiqarish:

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Holatni ko'rish: `docker compose -f docker-compose.prod.yml exec backend node scripts/migrate.cjs --status`

> Agar baza avval `db:push` bilan yaratilgan bo'lsa (jadvallar bor, `app_migrations` yo'q), backend ishga tushmaydi va ogohlantiradi. Sxema dolzarb bo'lsa, bir marta: `docker compose -f docker-compose.prod.yml run --rm backend node scripts/migrate.cjs --baseline`

### Telegram bot

`.env` da `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` va `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 24`) bo'lsin, so'ng:

```bash
./scripts/production/set-telegram-webhook.sh
```

Production'da `TELEGRAM_WEBHOOK_SECRET` majburiy — usiz bot xabarlari qabul qilinmaydi.

### AI (o'qituvchi materiallari va o'quvchilar uchun AI ustoz)

`.env` ga `GEMINI_API_KEY` (bepul, aistudio.google.com) yoki `ANTHROPIC_API_KEY` yozing. O'quvchi kuniga nechta savol berishini har bir markaz Sozlamalar'da belgilaydi.

---

## 7. Birinchi SuperAdmin Akkauntini Tayinlash

Xavfsizlik nuqtai nazaridan birinchi SuperAdmin tizim ichida qo'lda faollashtiriladi:

1. Brauzerda saytingizga kiring: `https://crmapp.uz/register` va ro'yxatdan o'ting (masalan: `admin@crmapp.uz`).
2. Server terminalida ushbu foydalanuvchiga `SUPERADMIN` maqomini bering:

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U talimcrm_admin -d talimcrm_prod -c "UPDATE users SET role = 'SUPERADMIN' WHERE email = 'admin@crmapp.uz';"
```

Endi `https://crmapp.uz/admin` orqali barcha o'quv markazlarini va to'lovlarni boshqarishingiz mumkin!

---

## 8. Avtomatik Zaxira Nusxalash (Backups & Restore)

`docker-compose.prod.yml` tarkibidagi `db-backup` servisi **har kuni soat 03:00 da** PostgreSQL bazasini arxivlaydi va `backups/` jildida saqlaydi (`<stack>_<sana>.sql.gz`). `BACKUP_KEEP_DAYS` kundan (standart 14) eski nusxalar o'chiriladi.

> **Baza zaxirasi to'liq zaxira emas.** Yuklangan uy vazifalari, Listening audiolari va rasmlar `uploads` volume'ida turadi va tungi avtomatik zaxiraga **kirmaydi**. Ularni `backup.sh` arxivlaydi.

### Qo'lda zaxira olish (baza + yuklangan fayllar):
```bash
./scripts/production/backup.sh              # backups/<stack>_<sana>.sql.gz va ..._uploads.tar.gz
./scripts/production/backup.sh --db-only
```
Ikkala faylni ham serverdan tashqariga ko'chiring.

### Zaxira tiklanishini tekshirish (mashq — jonli bazaga tegmaydi):
```bash
./scripts/production/restore.sh backups/<stack>_<sana>.sql.gz
```
Zaxirani **alohida vaqtinchalik bazaga** tiklaydi, tekshiradi (dump xatosiz yuklanishi, migratsiyalar, asosiy jadvallar, pul mosligi) va o'chiradi. Buni muntazam (masalan oyda bir marta) yuriting.

### Favqulodda holatda tiklash:
```bash
./scripts/production/restore.sh backups/<stack>_<sana>.sql.gz --keep
```
Tekshirilgan nusxa alohida baza sifatida qoladi; skript ilovani unga o'tkazishning aniq buyruqlarini chiqaradi (backend to'xtatiladi, joriy baza `..._before_<vaqt>` deb qayta nomlanadi, nusxa uning o'rniga keladi). Joriy baza hech qachon o'chirilmaydi yoki ustidan yozilmaydi. Yuklangan fayllar: `docker compose -f docker-compose.prod.yml exec -T backend tar -xzf - -C /app < backups/<stack>_<sana>_uploads.tar.gz`.

Staging muhiti: `docs/STAGING.md`.

---

## 9. Yangilanishlarni O'rnatish (Zero-Downtime Deployment)

Loyiha kodi o'zgarganda yangi versiyani serverga chiqarish:

```bash
cd /opt/crmapp

# 1. Yangi kodni yuklab olish
git pull origin main

# 2. Yangi imidjlarni yig'ish va yangilash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d --no-deps backend frontend

# 3. Migratsiyalar: backend konteyneri ishga tushganda o'zi qo'llaydi
#    (node scripts/migrate.cjs). Holatini ko'rish:
docker compose -f docker-compose.prod.yml exec backend node scripts/migrate.cjs --status
```

---

## 10. Monitoring va Nosozliklarni Aniqlash (Troubleshooting)

```bash
# Konteynerlar holatini ko'rish
docker compose -f docker-compose.prod.yml ps

# Backend jonli loglarini ko'rish (Pino JSON)
docker compose -f docker-compose.prod.yml logs -f --tail=100 backend

# Frontend loglari
docker compose -f docker-compose.prod.yml logs -f --tail=100 frontend

# Nginx so'rovlari va xatolari
docker compose -f docker-compose.prod.yml logs -f nginx

# Server resurslari sarfi
docker stats
```
