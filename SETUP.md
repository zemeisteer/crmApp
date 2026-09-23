# TalimCRM — holat va o'rnatish

Bu arxivda ikkita alohida loyiha bor:

- `backend/` — NestJS 12 + Drizzle ORM + PostgreSQL (REST API, `/api` prefiksi bilan, port 4000)
- `frontend/` — Next.js 16 (App Router) (port 3000)

`node_modules`, `.next`, `dist` va boshqa build-fayllar arxivga kiritilmagan — ularni Claude Code/siz o'zingiz qayta o'rnatasiz.

## 1. Backend

```bash
cd backend
npm install --legacy-peer-deps
```

`--legacy-peer-deps` shart — NestJS 12 + Vitest shablonidagi peer-dependency grafida `npm`ning arborist bug'i bor, shusiz `npm install` xato beradi.

`.env` fayli allaqachon bor. Productionga chiqarishdan oldin `JWT_SECRET`ni albatta almashtiring. Fayl oxiridagi ixtiyoriy integratsiya bo'limi (Telegram, Click, Payme, SMTP, Sentry, AI) — har biri bo'sh qoldirilsa, o'sha xususiyat avtomatik o'chirilgan holda ishlaydi, xato bermaydi.

PostgreSQL 16+ kerak. Lokal yoki Docker orqali o'rnating, so'ng `.env`dagi `DATABASE_URL`ni moslang. Keyin bazani yarating:

```bash
createdb talimcrm
npm run db:push
```

Ishga tushirish:

```bash
npm run start:dev
```

Backend `http://localhost:4000/api` manzilida ishga tushadi.

### Migratsiyalar

Loyiha hozircha dev muhitda `drizzle-kit push` (sxemani to'g'ridan-to'g'ri bazaga surish) orqali ishlaydi — tez, lekin versiyalanmagan. Production uchun `drizzle/0000_*.sql` boshlang'ich migratsiya fayli allaqachon generatsiya qilingan. Yangi production bazani shu bilan ko'taring:

```bash
npm run db:migrate
```

Kelgusi sxema o'zgarishlari uchun: `schema.ts`ni tahrirlang → `npm run db:generate` (yangi migratsiya fayli yaratadi) → `npm run db:migrate` (production'ga qo'llaydi). Dev muhitda tezlik uchun hali ham `npm run db:push` ishlatishingiz mumkin.

### Zaxira nusxalash

```bash
npm run db:backup   # backups/talimcrm_<sana>.sql.gz yaratadi
```

Buni cron/Task Scheduler orqali kunlik ishga tushiring va nusxalarni bazadan alohida joyda (S3 va h.k.) saqlang — tafsilotlar `scripts/backup.sh` ichida.

### Testlar va tekshiruv

```bash
npm run test                   # unit testlar (18 test fayli, barcha guard va servicelar)
npm run test:e2e               # to'liq HTTP orqali multi-tenant izolyatsiyani tekshiradi
npx tsx scripts/e2e-verification.ts  # yangi auth, onboarding, taklifnoma va multi-membership E2E tekshiruvi
npx tsx scripts/migrate-memberships.ts # mavjud userlarni organization_memberships ga o'tkazish migratsiya skripti
```

### API va Arxitektura tuzilishi (qisqacha)

- **Auth & Onboarding:**
  - "Start for free" (qisqa ro'yxatdan o'tish) yangi markaz va OWNER foydalanuvchi yaratadi.
  - 8 bosqichli Onboarding (`/onboarding`, `OnboardingModule`): profil, yo'nalishlar, Workspace URL (subdomain), fanlar, kurslar, birinchi filial, jamoani taklif qilish.
  - Ko'p markazlilik: `organization_memberships` orqali bitta foydalanuvchi bir nechta ta'lim markaziga a'zo bo'lishi va kirishda ishchi maydonni tanlashi mumkin (`/api/auth/select-workspace`).
  - Xavfsiz taklifnomalar: `invitations` orqali o'qituvchi, talaba va xodimlar uchun bir martalik, muddati cheklangan (7 kun), 32-baytli kriptografik token bilan hisobni faollashtirish (`/invite/[token]`).
- **Fanlar va Kurslar:**
  - Qat'iy markaz yo'nalishidan voz kechilgan: fanlar (`subjects`) va kurslar (`courses`) to'liq moslashuvchan iyerarxiyada ishlaydi.
- **Asosiy CRM modullari:**
  - Tenant, guruh/o'quvchi/o'qituvchi CRUD (soft-delete + tiklash bilan), to'lov, davomat, maosh, uy vazifasi, filial, Excel export/import, PDF kvitansiya, faoliyat jurnali (audit log), AI tahlil/materiallar, Telegram bot, Click/Payme (markaz ↔ o'quvchi va markaz ↔ platforma), platform (superadmin) boshqaruvi. To'liq ro'yxat uchun `src/*/*.controller.ts` fayllariga qarang.

Barcha tenant-scoped so'rovlar JWT'dagi `tenantId` bo'yicha avtomatik filtrlaydi (multi-tenancy izolyatsiyasi) — bu backendning eng muhim xavfsizlik qatlami, o'zgartirganda ehtiyot bo'ling. Bu `test:e2e` va `scripts/e2e-verification.ts` bilan avtomatik tekshiriladi.

### Nima uchun Prisma emas, Drizzle?

Boshida Prisma bilan boshlangan edi, lekin build-sandbox muhitida Prisma'ning binary query-engine fayllarini yuklab olib bo'lmadi. Shuning uchun Drizzle ORM'ga o'tildi — u sof TypeScript, binary kerak emas.

## 2. Frontend

```bash
cd frontend
npm install
```

`.env.local` allaqachon bor: `NEXT_PUBLIC_API_URL=http://localhost:4000/api`.

```bash
npm run dev
```

Frontend `http://localhost:3000` da ishga tushadi.

## 3. Docker orqali ishga tushirish (ixtiyoriy)

```bash
docker compose up --build
```

Postgres + backend + frontend'ni birga ko'taradi. Birinchi marta ko'targandan keyin sxemani qo'llang:

```bash
docker compose exec backend npm run db:push
```

Ixtiyoriy integratsiya kalitlarini (Telegram, Click, Payme, SMTP...) `.env` fayliga yozib, `docker compose up` oldidan environment o'zgaruvchisi sifatida eksport qiling — `docker-compose.yml` ularni avtomatik backend konteyneriga uzatadi.

## 4. Loyihaning umumiy holati

Barcha asosiy funksiyalar (auth, tenant izolyatsiyasi, RBAC, guruh/o'quvchi/o'qituvchi/to'lov/davomat/maosh CRUD, soft-delete+tiklash, audit log, Excel export/import, PDF kvitansiya, uy vazifalari, filiallar, hisobotlar, sozlamalar, superadmin panel, parolni tiklash/email tasdiqlash/refresh token) **ishlab chiqilgan va sinovdan o'tgan** (backend: unit+e2e testlar; frontend: TypeScript + production build + brauzerda qo'lda tekshirilgan).

Uch integratsiya **kodi tayyor, lekin real kalitlarsiz ishlamaydi** (`.env`ga qiymat qo'yilishi kerak, keyin qayta ishga tushirilganda avtomatik yoqiladi):

- **Telegram bot** — @BotFather'dan token oling, `.env`ga yozing, so'ng Telegram'da `setWebhook` orqali `https://<domen>/api/telegram/webhook`ni ulang.
- **Click/Payme** (markaz o'z o'quvchilaridan, va markaz platformadan) — merchant kabinetdagi ID/kalitlarni `.env`ga yozing. **Real pul bilan ishlaydi — production'ga chiqarishdan oldin sandbox'da sinab ko'ring.**
- **AI xususiyatlar** (tahlil, materiallar) — `ANTHROPIC_API_KEY` kerak (console.anthropic.com).

Domen sotib olish va DNS sozlash (`*.talimcrm.uz` wildcard, HTTPS) — bu Claude Code tomonidan bajarib bo'lmaydigan yagona bosqich, qo'lda amalga oshirilishi kerak.

Dizayn-makketlar: `https://claude.ai/artifact/8KSxnc3d5eN1g71UTucyS5`.
