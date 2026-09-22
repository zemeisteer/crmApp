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

## 5. SSL Sertifikatini O'rnatish (Let's Encrypt Certbot)

Avtomatlashtirilgan SSL sozlash skriptini ishga tushiring:

```bash
chmod +x scripts/production/*.sh
./scripts/production/init-ssl.sh
```

Ushbu skript:
1. Vaqtinchalik HTTP serverni ishga tushiradi.
2. Certbot orqali bepul Let's Encrypt SSL sertifikatini yuklab oladi.
3. Nginx'ni to'liq HTTPS va HTTP/2 rejimiga o'tkazadi.

---

## 6. Ma'lumotlar Bazasini Migratsiya Qilish & Ishga Tushirish

Barcha konteynerlarni yig'ish va fonda ishga tushirish:

```bash
# 1. Barcha xizmatlarni (Postgres, Redis, Backend, Frontend, Nginx, DB Backup) ko'tarish
docker compose -f docker-compose.prod.yml up -d --build

# 2. Ma'lumotlar bazasi jadvallarini yaratish (Migratsiya)
docker compose -f docker-compose.prod.yml exec backend npm run db:push
```

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

`docker-compose.prod.yml` tarkibidagi `talimcrm_backup` servisi **har kuni soat 03:00 da** avtomatik tarzda butun PostgreSQL bazasini arxivlaydi va `/opt/crmapp/backups/` jildida saqlaydi. 14 kundan oshgan eski nusxalar avtomatik o'chiriladi.

### Qo'lda zaxira olish:
```bash
./scripts/production/backup.sh
```

### Favqulodda holatda zaxiradan tiklash:
```bash
./scripts/production/restore.sh backups/talimcrm_2026-09-22_120000.sql.gz
```

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

# 3. Agar sxemada o'zgarish bo'lsa, migratsiyani surish
docker compose -f docker-compose.prod.yml exec backend npm run db:push
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
