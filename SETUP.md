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
npm run db:migrate
```

Ishga tushirish:

```bash
npm run start:dev
```

Backend `http://localhost:4000/api` manzilida ishga tushadi.

### Migratsiyalar

Sxema faqat versiyalangan migratsiyalar bilan quriladi va yangilanadi. Yagona buyruq:

```bash
npm run db:migrate            # kutilayotgan migratsiyalarni qo'llaydi
npm run db:migrate:status     # qaysilari qo'llangan / kutilmoqda
```

Bu `scripts/migrate.cjs` — CI, Docker konteyneri (har ishga tushganda), E2E test bazasi va lokal o'rnatish ham aynan shuni ishlatadi. Har bir migratsiya o'z tranzaksiyasida bajariladi va `app_migrations` jadvalida qayd etiladi; qayta ishga tushirish xavfsiz.

- **`drizzle-kit migrate` ishlatilmaydi.** U barcha fayllarni bitta tranzaksiyada qo'llaydi, PostgreSQL esa bir migratsiya qo'shgan enum qiymatini shu tranzaksiyada ishlatishga ruxsat bermaydi (`unsafe use of new value "OWNER" of enum type role`).
- Sxemani o'zgartirish: `schema.ts`ni tahrirlang → `npm run db:generate` (migratsiya fayli va snapshot) → SQL'ni idempotent qilib ko'rib chiqing → `npm run db:migrate`.
- Tekshiruvlar: `npm run db:check-migrations` (jurnal = fayllar), `npm run db:check-drift` (baza = `schema.ts`), `npm run db:verify-migrations` (bo'sh baza va yangilanish yo'llari, vaqtinchalik bazalarda).
- **Jadvallari bor, lekin migratsiya yozuvi yo'q baza** (ilgari `db:push` bilan qurilgan): `db:migrate` to'xtaydi va so'raydi. Sxema qaysi migratsiyaga mosligini ko'rsating: `node scripts/migrate.cjs --baseline <teg>` (to'liq dolzarb bo'lsa tegsiz), keyin yana `npm run db:migrate`.
- `npm run db:push` faqat tashlab yuboriladigan tajriba bazasi uchun; u migratsiya yozuvini yaratmaydi.

## 3. Docker orqali ishga tushirish (ixtiyoriy)

```bash
docker compose up --build
```

Postgres + backend + frontend'ni birga ko'taradi. Backend konteyneri har ishga tushganda kutilayotgan migratsiyalarni o'zi qo'llaydi (`node scripts/migrate.cjs`), qo'shimcha buyruq kerak emas.

Ixtiyoriy integratsiya kalitlarini (Telegram, Click, Payme, SMTP...) `.env` fayliga yozib, `docker compose up` oldidan environment o'zgaruvchisi sifatida eksport qiling — `docker-compose.yml` ularni avtomatik backend konteyneriga uzatadi.

## 4. Loyihaning umumiy holati

Barcha asosiy funksiyalar (auth, tenant izolyatsiyasi, RBAC, guruh/o'quvchi/o'qituvchi/to'lov/davomat/maosh CRUD, soft-delete+tiklash, audit log, Excel export/import, PDF kvitansiya, uy vazifalari, filiallar, hisobotlar, sozlamalar, superadmin panel, parolni tiklash/email tasdiqlash/refresh token) **ishlab chiqilgan va sinovdan o'tgan** (backend: unit+e2e testlar; frontend: TypeScript + production build + brauzerda qo'lda tekshirilgan).

Uch integratsiya **kodi tayyor, lekin real kalitlarsiz ishlamaydi** (`.env`ga qiymat qo'yilishi kerak, keyin qayta ishga tushirilganda avtomatik yoqiladi):

- **Telegram bot** — @BotFather'dan token oling, `.env`ga yozing, so'ng Telegram'da `setWebhook` orqali `https://<domen>/api/telegram/webhook`ni ulang.
- **Click/Payme** (markaz o'z o'quvchilaridan, va markaz platformadan) — merchant kabinetdagi ID/kalitlarni `.env`ga yozing. **Real pul bilan ishlaydi — production'ga chiqarishdan oldin sandbox'da sinab ko'ring.**
- **AI xususiyatlar** (tahlil, materiallar, daraja testi) — `GEMINI_API_KEY` (bepul, aistudio.google.com) yoki `ANTHROPIC_API_KEY` (console.anthropic.com). Ikkalasi bo'lsa Claude ishlatiladi.

Domen sotib olish va DNS sozlash (`*.talimcrm.uz` wildcard, HTTPS) — bu Claude Code tomonidan bajarib bo'lmaydigan yagona bosqich, qo'lda amalga oshirilishi kerak.

Dizayn-makketlar: `https://claude.ai/artifact/8KSxnc3d5eN1g71UTucyS5`.
