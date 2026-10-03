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
bash scripts/production/preflight.sh    # .env, DNS va Docker tekshiruvi
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

### Qaysi stack bilan ishlayapman? (`stack.sh` qoidasi)

Barcha buyruqlar `bash scripts/production/stack.sh <docker compose buyrug'i>` orqali yuritiladi (masalan `stack.sh up -d --build`, `stack.sh ps`, `stack.sh logs -f backend`). Qoida bitta: **stack'ni faqat shu papkadagi `.env` belgilaydi.** Compose loyihasi har doim aniq ko'rsatiladi (`-p`); terminaldan meros qolgan `COMPOSE_PROJECT_NAME`, `STACK_NAME`, `POSTGRES_DB`, `POSTGRES_USER`, `BACKUP_DIR`, `DOMAIN` yoki `COMPOSE_FILE` `.env` dagidan farq qilsa, skript `REFUSED` deb to'xtaydi — boshqa stack'ga tegib ketmaydi. Skriptlar boshqa papkadan chaqirilganda ham o'z papkasidagi stack bilan ishlaydi. To'g'ridan-to'g'ri `docker compose ...` yozmang.

## 5. SSL Sertifikatini O'rnatish (Let's Encrypt, wildcard)

Har bir markaz sayti o'z subdomenida ochiladi (`<markaz>.DOMAIN`), shuning uchun sertifikat `DOMAIN` va `*.DOMAIN` uchun olinadi. Wildcard sertifikat faqat DNS orqali tasdiqlanadi:

- **Tavsiya:** domen DNS'ini Cloudflare'ga (bepul) o'tkazing, Cloudflare'da *Zone → DNS → Edit* huquqli API token yarating va `.env` ga `CLOUDFLARE_API_TOKEN=` qilib yozing. Sertifikat avtomatik olinadi va avtomatik yangilanadi.
- Token bo'lmasa, skript `_acme-challenge.DOMAIN` uchun TXT yozuvni ko'rsatadi — uni DNS panelga qo'lda qo'shasiz. Bu holda sertifikat 90 kunda tugaydi va skriptni qayta ishga tushirish kerak.

```bash
bash scripts/production/init-ssl.sh              # haqiqiy sertifikat
bash scripts/production/init-ssl.sh --test-cert  # mashq: Let's Encrypt sinov markazi (brauzer ishonmaydi, limitlarsiz)
```

`LETSENCRYPT_EMAIL` (`.env`) — muddati tugashi haqidagi xabarlar uchun.

Skript nima qiladi va xato bo'lsa nima qoladi:
1. nginx vaqtincha faqat HTTP sozlamasiga o'tadi; HTTPS sozlamasi `talimcrm.conf.https-pending` nomi bilan saqlanadi.
2. certbot `DOMAIN` va `*.DOMAIN` uchun sertifikat oladi. Xato bo'lsa sayt HTTP'da javob berishda davom etadi; skriptni qayta yuritsangiz shu yerdan davom etadi.
3. HTTPS sozlamasi qaytariladi va nginx qayta yuklanishidan **oldin** tekshiriladi (`nginx -t`). Tekshiruv o'tmasa HTTP sozlamasi tiklanadi.

**Yangilanish.** `certbot` konteyneri har 12 soatda `certbot renew` yuritadi, nginx har 12 soatda sozlamani qayta yuklaydi. Cloudflare tokeni bilan olingan sertifikat o'zi yangilanadi; TXT yozuvi qo'lda qo'shilgan bo'lsa **avtomatik yangilanmaydi** — 90 kun ichida skriptni qayta yuriting. Tekshirish: `bash scripts/production/stack.sh run --rm --entrypoint certbot certbot renew --dry-run`.

---

## 6. Ishga Tushirish (Migratsiyalar avtomatik)

```bash
bash scripts/production/stack.sh up -d --build
```

Backend har ishga tushganda `backend/drizzle/*.sql` dagi hali qo'llanmagan migratsiyalarni tartib bilan qo'llaydi (`app_migrations` jadvalida qayd etiladi). Yangi versiyani chiqarish:

```bash
git pull && bash scripts/production/stack.sh up -d --build
```

Holatni ko'rish: `bash scripts/production/stack.sh exec backend node scripts/migrate.cjs --status`

> Agar baza avval `db:push` bilan yaratilgan bo'lsa (jadvallar bor, `app_migrations` yo'q), backend ishga tushmaydi va ogohlantiradi. Sxema dolzarb bo'lsa, bir marta: `bash scripts/production/stack.sh run --rm backend node scripts/migrate.cjs --baseline`

### Telegram bot

`.env` da `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` va `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 24`) bo'lsin, so'ng:

```bash
bash scripts/production/set-telegram-webhook.sh
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
bash scripts/production/stack.sh exec postgres psql -U talimcrm_admin -d talimcrm_prod -c "UPDATE users SET role = 'SUPERADMIN' WHERE email = 'admin@crmapp.uz';"
```

Endi `https://crmapp.uz/admin` orqali barcha o'quv markazlarini va to'lovlarni boshqarishingiz mumkin!

---

## 8. Zaxira va tiklash (Backups & Restore)

### Nima zaxiralanadi: "tiklash to'plami"

Tungi jadval ham, qo'lda olingan zaxira ham **bitta dastur** (`scripts/production/backup-core.sh`, `db-backup` konteynerida) orqali ishlaydi va bir xil narsa beradi:

```
<BACKUP_DIR>/<stack>_<UTC vaqt>Z/
    db.sql.gz        PostgreSQL bazasi (pg_dump)
    uploads.tar.gz   yuklangan fayllar: uy vazifalari, audio, rasmlar, logotiplar
    manifest.json    olingan vaqt (UTC), stack nomi, ilova versiyasi (git commit), migratsiyalar soni, hajmlar
    SHA256SUMS       yuqoridagi fayllarning nazorat yig'indilari
```

- To'plamda **sirlar yo'q** (`.env`, parollar, tokenlar kirmaydi). `.env` ni alohida, xavfsiz joyda saqlang — usiz tiklangan baza ishga tushmaydi.
- To'plam faqat hammasi muvaffaqiyatli bo'lsa paydo bo'ladi: `pg_dump` xatosiz tugagan, dump oxirigacha yozilgan, (`BACKUP_VERIFY_RESTORE=1` bo'lsa) vaqtinchalik bazaga haqiqatan tiklangan, fayllar arxivlangan. Xato bo'lsa bu yurishdan hech narsa qolmaydi va **eski to'plamlar o'chirilmaydi**.
- Eski to'plamlar faqat muvaffaqiyatli zaxiradan keyin tozalanadi: `BACKUP_KEEP_DAYS` kundan eski, lekin hech qachon `BACKUP_MIN_KEEP` tadan kam emas.
- Bir vaqtda ikkita zaxira yurmaydi (qulf). Vaqt: har kuni `BACKUP_AT_UTC` (standart `22:00` UTC = Toshkent 03:00).
- `backups/` papkasi va fayllar faqat egasi (root) uchun ochiq; ko'rish uchun `sudo` kerak.
- Holat: `bash scripts/production/stack.sh ps db-backup` — oxirgi muvaffaqiyatli zaxira 26 soatdan eski bo'lsa konteyner `unhealthy` bo'ladi.

**Izchillik chegarasi.** Baza dump'i bitta tranzaksiya ko'rinishida olinadi (o'zaro izchil). Fayllar bazadan *keyin* arxivlanadi, shuning uchun bazada tilga olingan har bir fayl arxivda bo'ladi; zaxira paytida yuklangan yangi fayl arxivda bo'lib, bazada bo'lmasligi mumkin (zararsiz ortiqcha fayl). Zaxira va nosozlik orasidagi o'zgarishlar yo'qoladi — kuniga bir marta zaxirada bu 24 soatgacha.

### Qo'lda zaxira
```bash
sudo bash scripts/production/backup.sh
```

### Zaxira tiklanishini tekshirish (mashq — jonli bazaga tegmaydi)
```bash
sudo bash scripts/production/restore.sh backups/<stack>_<vaqt>Z
```
Nazorat yig'indilarini tekshiradi, bazani **alohida yangi bazaga** tiklaydi va uchta narsani alohida aytadi: `LOADED` (dump xatosiz yuklandi), `CONSISTENT` (migratsiyalar, asosiy jadvallar, pul mosligi), `APPLICATION` (bu skript tekshirmaydi). Mashq tugagach faqat **o'zi yaratgan** bazani o'chiradi. Oyda bir marta yuriting.

Ilova tiklangan nusxada haqiqatan ishlashini `bash scripts/production/restore-rehearsal.sh` isbotlaydi: bir martalik konteynerlarda sintetik ma'lumot yaratadi, zaxira oladi, alohida baza va alohida fayl volume'iga tiklaydi, ilovani shu nusxada ishga tushirib login, yozuvlar, balans va fayl nazorat yig'indisini tekshiradi. Docker kerak; CI'da `recovery` ishi sifatida yuradi.

### Favqulodda holatda tiklash
```bash
sudo bash scripts/production/restore.sh backups/<stack>_<vaqt>Z --keep
```
Tekshirilgan nusxa alohida baza sifatida qoladi; skript ilovani unga o'tkazishning aniq buyruqlarini chiqaradi (backend to'xtatiladi, joriy baza `..._before_<vaqt>` deb qayta nomlanadi, nusxa uning o'rniga keladi). Joriy baza hech qachon o'chirilmaydi yoki ustidan yozilmaydi. Yuklangan fayllar shu to'plamdan: `bash scripts/production/stack.sh exec -T backend tar -xzf - -C /app/uploads < backups/<stack>_<vaqt>Z/uploads.tar.gz`.

### Serverdan tashqaridagi nusxa (Off-server copies) — **hali sozlanmagan**

Shu serverdagi to'plam server yo'qolsa birga yo'qoladi. Har tun to'plamlarni boshqa joyga ko'chiring. Namuna (qiymatlar — to'ldiriladigan joylar; haqiqiy manzil va kalit hali berilmagan, shuning uchun bu qadam **tekshirilmagan**):

```bash
# /etc/cron.d/talimcrm-offsite  (root), zaxiradan 1 soat keyin
0 23 * * * root rsync -a --ignore-existing /opt/crmapp/backups/ <BACKUP_USER>@<BACKUP_HOST>:<BACKUP_PATH>/
# yoki S3-mos saqlash:  aws s3 sync /opt/crmapp/backups/ s3://<BUCKET>/<PREFIX>/ --exclude ".*"
```

Sozlangach tekshirish: (1) masofadagi papkada bugungi `<stack>_<vaqt>Z/` borligi; (2) uni boshqa mashinaga yuklab, `sha256sum -c SHA256SUMS`; (3) o'sha nusxadan `restore.sh` mashqi. Masofadagi saqlashda o'chirishdan himoya (versioning / append-only) va shifrlash yoqilsin: to'plamda shaxsiy ma'lumotlar bor.

Staging muhiti: `docs/STAGING.md`.

---

## 9. Yangilanishlarni O'rnatish (Zero-Downtime Deployment)

Loyiha kodi o'zgarganda yangi versiyani serverga chiqarish:

```bash
cd /opt/crmapp

# 1. Yangi kodni yuklab olish
git pull origin main

# 2. Yangi imidjlarni yig'ish va yangilash
bash scripts/production/stack.sh build
bash scripts/production/stack.sh up -d --no-deps backend frontend

# 3. Migratsiyalar: backend konteyneri ishga tushganda o'zi qo'llaydi
#    (node scripts/migrate.cjs). Holatini ko'rish:
bash scripts/production/stack.sh exec backend node scripts/migrate.cjs --status
```

---

## 10. Monitoring va Nosozliklarni Aniqlash (Troubleshooting)

```bash
# Konteynerlar holatini ko'rish
bash scripts/production/stack.sh ps

# Backend jonli loglarini ko'rish (Pino JSON)
bash scripts/production/stack.sh logs -f --tail=100 backend

# Frontend loglari
bash scripts/production/stack.sh logs -f --tail=100 frontend

# Nginx so'rovlari va xatolari
bash scripts/production/stack.sh logs -f nginx

# Server resurslari sarfi
docker stats
```
