# TalimCRM — Phase 1 (Auth + asosiy CRM)

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

`.env` fayli allaqachon bor (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT=4000`). Productionga chiqarishdan oldin `JWT_SECRET`ni albatta almashtiring.

PostgreSQL 16 kerak. Lokal yoki Docker orqali o'rnating, so'ng `.env`dagi `DATABASE_URL`ni moslang (standart: `postgresql://postgres:postgres@localhost:5432/talimcrm`). Keyin bazani yarating:

```bash
createdb talimcrm   # yoki: psql -U postgres -c "CREATE DATABASE talimcrm;"
npx drizzle-kit push --force
```

Bu Drizzle sxemasini (`src/db/schema.ts`) to'g'ridan-to'g'ri bazaga push qiladi (migratsiya fayllarisiz — hozircha shu tarzda ishlatilgan).

Ishga tushirish:

```bash
npm run start:dev
```

Backend `http://localhost:4000/api` manzilida ishga tushadi.

### Nima uchun Prisma emas, Drizzle?

Boshida Prisma bilan boshlangan edi, lekin build-sandbox muhitida Prisma'ning binary query-engine fayllarini yuklab olib bo'lmadi (tarmoq cheklovi — `binaries.prisma.sh` bloklangan edi). Shuning uchun Drizzle ORM'ga o'tildi — u sof TypeScript, binary kerak emas. Sizning muhitingizda tarmoq cheklovi bo'lmasa, xohlasangiz Prisma'ga qaytarishingiz ham mumkin, lekin buning uchun `src/db/`dagi barcha service'larni qayta yozish kerak bo'ladi.

### API tuzilishi (Phase 1)

- `POST /api/auth/register` — markaz + admin yaratadi (tenant + user birga)
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET/POST/PATCH/DELETE /api/groups`
- `GET/POST/PATCH/DELETE /api/students`, `POST/DELETE /api/students/:id/enroll/:groupId`
- `GET/POST/PATCH/DELETE /api/teachers`
- `GET/POST /api/payments`, `GET /api/payments/summary`
- `GET /api/tenants` (faqat SUPERADMIN), `GET /api/tenants/by-subdomain/:subdomain` (ochiq)

Barcha tenant-scoped so'rovlar JWT'dagi `tenantId` bo'yicha avtomatik filtrlaydi (multi-tenancy izolyatsiyasi) — bu backendning eng muhim xavfsizlik qatlami, o'zgartirganda ehtiyot bo'ling.

## 2. Frontend

```bash
cd frontend
npm install
```

`.env.local` allaqachon bor: `NEXT_PUBLIC_API_URL=http://localhost:4000/api` — agar backend boshqa portda/domainda bo'lsa, shu yerni o'zgartiring.

```bash
npm run dev
```

Frontend `http://localhost:3000` da ishga tushadi. `/`, `/login`, `/register`, `/dashboard`, `/groups`, `/students`, `/teachers`, `/payments` sahifalari bor.

### Diqqat: shrift yuklanishi

`app/layout.tsx` Google Fonts'ni (Manrope, Inter) `<link>` orqali yuklaydi — build vaqtida emas, brauzerda. Agar sizning ishlab chiqish muhitingiz internetga to'liq ochiq bo'lsa, muammo bo'lmaydi.

## 3. Loyihaning umumiy holati

- Dizayn-makketlar (barcha sahifalarning UI dizayni) alohida Claude Artifact'da: `https://claude.ai/artifact/8KSxnc3d5eN1g71UTucyS5` — frontend shu dizaynlarga asoslanib qurilgan, lekin hozircha faqat Login/Register/Dashboard/Groups/Students/Teachers/Payments haqiqiy backend'ga ulangan. Qolgan sahifalar (GroupDetail, StudentDetail, AIInsights, AIMaterials, Homework, StudentAI, Reports, Pricing, PublicSite, Settings, AdminPanel) hali faqat dizayn-makket, real funksional emas.
- Backend'da Phase 1 (auth + asosiy CRUD) to'liq ishlaydi va sinovdan o'tgan: tenant izolyatsiyasi, rol tekshiruvi (RBAC), JWT autentifikatsiya.
- Keyingi bosqichlar (hali boshlanmagan): AI xususiyatlari, sub-domen ochiq sayt, Click/Payme to'lov integratsiyasi, Telegram bot, Super Admin platform-boshqaruv backend'i.
