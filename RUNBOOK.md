# TalimCRM — Runbook

Nosozlik yuz berganda nima qilish kerakligi bo'yicha qisqa qo'llanma.

## 1. Backend javob bermayapti

1. `curl http://localhost:4000/api/health` — DB ulanishini tekshiradi. `{"status":"ok"}` bo'lsa backend tirik.
2. Loglarni tekshiring (Docker: `docker compose logs backend`; PM2/systemd: shu jarayonning logi). Pino JSON formatida chiqadi — `level: 50` = error.
3. Agar DB xatosi bo'lsa: `DATABASE_URL` to'g'riligini va PostgreSQL ishlab turganini tekshiring (`pg_isready`).
4. Agar hech narsa yordam bermasa: backend'ni qayta ishga tushiring (`docker compose restart backend` yoki `pm2 restart backend`).

## 2. Ma'lumotlar bazasi muammosi

- **Baza to'la (disk)**: `df -h`, keraksiz eski backuplarni tozalang.
- **Migratsiya xato berdi**: `npm run db:generate` bilan yaratilgan SQL faylni `backend/drizzle/` papkasida qo'lda ko'rib chiqing, kerak bo'lsa qo'lda tuzating va qayta ishga tushiring.
- **Ma'lumot yo'qolgan/buzilgan**: eng so'nggi backup'dan tiklang: `gunzip -c backups/talimcrm_<sana>.sql.gz | psql "$DATABASE_URL"` (avval joriy bazani boshqa nomga saqlab qo'ying).

## 3. Tenant o'zining ma'lumotlariga kira olmayapti ("403 Forbidden")

- Bu odatda `TrialGuard` ishlagani: tenant holati `SUSPENDED` yoki sinov muddati tugagan. SuperAdmin sifatida kirib (`/admin`), o'sha tenant holatini `ACTIVE`ga o'zgartiring.

## 4. To'lov (Click/Payme) qabul qilinmayapti

1. `backend/.env` dagi `CLICK_*`/`PAYME_*` kalitlari to'g'ri ekanini tekshiring.
2. Webhook URL merchant kabinetda to'g'ri ko'rsatilganini tekshiring (`https://<domen>/api/billing/click/webhook`).
3. `billing_transactions` jadvalida status `CREATED`da qolib ketgan yozuvlar bo'lsa — webhook kelmagan degani; merchant kabinetdagi tranzaksiya logini tekshiring.

## 5. Telegram bot xabar yubormayapti

1. `GET /api/telegram/status` — `configured: true` bo'lishi kerak.
2. Telegram'da webhook o'rnatilganini tekshiring: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`.
3. O'quvchi/ota-ona botga `/start <studentId>` yubormagan bo'lsa, xabar yuborilmaydi (`telegram_chat_id` bo'sh).

## 6. Email yuborilmayapti (parolni tiklash va h.k.)

- `SMTP_*` sozlanmagan bo'lsa, xabar backend logiga yoziladi (dev fallback) — production uchun albatta SMTP sozlang.
- SMTP xatosi loglarda `EmailService` yorlig'i bilan ko'rinadi.

## 7. Yuqori yuklama / sekinlashish

- `scripts/load-test.js` (k6) bilan mahalliy sinab ko'ring: `k6 run -e BASE_URL=... -e EMAIL=... -e PASSWORD=... scripts/load-test.js`.
- Sekin so'rovlarni Pino loglaridagi `responseTime` maydoni orqali toping.
- Agar DB so'rovlari sekin bo'lsa, `EXPLAIN ANALYZE` bilan tekshiring — asosiy jadvallarda tenant_id bo'yicha indekslar allaqachon bor.

## 8. Zaxira nusxalash muvaffaqiyatsiz

- `npm run db:backup` qo'lda ishga tushirib xatoni ko'ring (odatda `pg_dump` yo'li yoki `DATABASE_URL` muammosi).
- Backup fayllari `backend/backups/` papkasida — bu papka bazadan alohida joyga (S3 va h.k.) ko'chirilishi kerak.

## 9. Superadmin hisobiga kirish yo'qolgan

- Birinchi SUPERADMIN'ni qo'lda bazada yaratish kerak (self-service yo'q, xavfsizlik uchun ataylab shunday):
  ```sql
  UPDATE users SET role = 'SUPERADMIN' WHERE email = 'sizning-email@domen.uz';
  ```

## 10. Workspace / Tashkilot a'zoligi muammosi ("Foydalanuvchida faol tashkilot a'zoligi topilmadi")

- Agar eski foydalanuvchi tizimga kirganda "Foydalanuvchida faol tashkilot a'zoligi topilmadi" xatosi chiqsa:
  Migratsiya skriptini ishga tushiring:
  ```bash
  cd backend && npx tsx scripts/migrate-memberships.ts
  ```
  Yoki alohida foydalanuvchini bazada a'zo qilib qo'shing:
  ```sql
  INSERT INTO organization_memberships (id, user_id, tenant_id, role, status)
  VALUES ('mem_' || substr(md5(random()::text), 1, 16), '<USER_ID>', '<TENANT_ID>', 'ADMIN', 'ACTIVE');
  ```

## 11. Taklifnoma xatolari ("Ushbu taklifnoma yaroqsiz yoki muddati tugagan")

- Taklifnomalar 7 kun muddatga ega va faqat 1 marta ishlatiladi (`invitation_status` = `PENDING`).
- Token bazada SHA-256 hash ko'rinishida (`token_hash`) saqlanadi.
- Agar foydalanuvchi taklifnomani yo'qotgan yoki muddati o'tgan bo'lsa, markaz administratori settings yoki onboarding orqali yangi taklifnoma yuborishi kerak (eski taklifnoma `REVOKED` yoki `EXPIRED` bo'ladi).

## 12. Onboarding bosqichida qolib ketish ("Onboarding reset")

- Agar markaz administratori onboarding bosqichini qayta o'tmoqchi bo'lsa yoki qolib ketgan bo'lsa:
  ```sql
  UPDATE tenants SET onboarding_step = 'PROFILE' WHERE id = '<TENANT_ID>';
  ```
  Onboarding yakunlanganda `onboarding_step = 'COMPLETED'` bo'ladi.

## 13. Umumiy tekshiruv tartibi (istalgan nosozlikda birinchi qadamlar)

1. `GET /api/health`
2. Backend va frontend loglarini oxirgi 5 daqiqa uchun ko'rish
3. `npm run test && npm run test:e2e` (backend) — asosiy funksiyalar buzilmaganini tasdiqlash
4. `npx tsx scripts/e2e-verification.ts` (backend) — auth, workspace va onboarding E2E tekshiruvi
5. So'nggi deploy/commit nima o'zgartirganini `git log` orqali ko'rish
