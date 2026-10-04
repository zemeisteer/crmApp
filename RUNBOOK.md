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
- **Ma'lumot yo'qolgan/buzilgan**: zaxirani **alohida** bazaga tiklang va tekshiring — joriy bazaning ustiga emas: `bash scripts/production/restore.sh backups/<stack>_<vaqt>Z --keep`. Skript nusxani tekshiradi va ilovani unga o'tkazish buyruqlarini chiqaradi (joriy baza `..._before_<vaqt>` nomi bilan saqlanib qoladi). Yuklangan fayllar (uy vazifasi, audio, rasm) shu to'plam ichida: `uploads.tar.gz`.

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

- Serverda: `bash scripts/production/backup.sh` — baza **va** yuklangan fayllar; xato bo'lsa yarim fayl qoldirmaydi va sababini aytadi. (Lokal ishlab chiqishda: `npm run db:backup`.)
- Zaxira haqiqatan tiklanishini tekshirish: `sudo bash scripts/production/restore.sh backups/<stack>_<vaqt>Z` (nazorat yig'indilari, alohida vaqtinchalik bazaga tiklash, tekshirish; faqat o'zi yaratgan bazani o'chiradi).
- Tungi zaxira holati: `bash scripts/production/stack.sh ps db-backup` (`unhealthy` = 26 soatdan beri muvaffaqiyatli zaxira yo'q); sababi: `bash scripts/production/stack.sh logs --tail=50 db-backup`. Muvaffaqiyatsiz yurish eski to'plamlarni o'chirmaydi.
- Hammasining holati bir joyda: `sudo bash scripts/production/offsite.sh status --check` — oxirgi lokal zaxira, oxirgi uzatish, har bir masofaviy to'plam holati (`VERIFIED` = tarkibi tekshirildi, `PRESENT` = faqat metadata, `DAMAGED`, `INCOMPLETE`, `UNREADABLE`), eng yangi tekshirilgan to'plam (`fallback:`), oxirgi tiklash tekshiruvi; muammo bo'lsa exit 1.
- Masofaviy to'plam `DAMAGED`: lokal nusxa bo'lsa `sudo bash scripts/production/offsite.sh push` uni tuzatadi (belgi oxirida yoziladi). Lokal nusxa bo'lmasa, tiklash uchun `fallback:` dagi to'plamni ishlating (`offsite.sh fetch latest` uni o'zi tanlaydi va buni aytadi).
- `UNREADABLE`: xotira yoki tarmoq ishlamayapti — hech bir masofaviy nusxa tasdiqlanmagan; ulanishni tuzating va `status` ni qayta yuriting.
- Tashqariga uzatish yiqilgan (`remote transfer: LAST RUN FAILED`): sababi shu qatorda. Tarmoq yoki kalitni tuzatib, `sudo bash scripts/production/offsite.sh push` ni qayta yuriting — qayta yuritish xavfsiz, lokal to'plamlar o'chmaydi, chala yuborilgan to'plam belgisiz (ishlatilmaydi) qoladi va qayta yuboriladi.
- Server yo'qolgan: `docs/DEPLOYMENT_GUIDE.md` → "Server yo'qolganda — masofaviy nusxadan tiklash".
- `status` qulf olmaydi: uni `push` yoki `verify` yurayotganda ham, bir vaqtda bir necha marta ham yuritish xavfsiz — har biri o'z vaqtinchalik papkasida (`backups/.offsite-status.XXXXXX`) ishlaydi va tugaganda faqat shuni o'chiradi. `push`/`verify` `.offsite-work` da, qulf ostida ishlaydi. Jarayon o'ldirilib qolgan `.offsite-status.*` papkalarni, hech bir `offsite.sh` yurmayotganda, qo'lda o'chirish mumkin.

## 9. O'qituvchi maoshi (Hisobotlar → Oylik maosh)

- Bir oy bir necha qismda to'lanishi mumkin. Har bir to'lov bitta `salary_payments` qatori va **o'sha tranzaksiyada** yozilgan bitta `SALARY` xarajati (`expense_id`). Ikki marta bosish yoki javob yo'qolgandan keyingi qayta yuborish (`Idempotency-Key`) — bitta to'lov. Bir oy uchun to'lovlar jami hisoblangan maoshdan oshmaydi.
- "Summa qoldiqdan katta" / "to'lanadigan maosh qolmagan": hisoblangan maosh (stavka, davomat, chegirmalar) o'zgargan bo'lishi mumkin — avval o'qituvchi sozlamalari va davomatni tekshiring.
- Maosh to'lovining xarajatini Xarajatlar bo'limidan o'chirish yoki summasi/turi/sanasini o'zgartirish 409 qaytaradi — bu ataylab: to'lov va xarajat birga turadi. Izohni o'zgartirish mumkin.
- **0035 dan oldingi yozuvlar:** Hisobotlar → Oylik maosh pastidagi "Eski maosh yozuvlari" bloki (API: `GET /api/salary-payments/reconciliation?forMonth=YYYY-MM`, faqat o'qiydi). `LIKELY_DOUBLE_COUNTED` — moliya hisobotida shu pul ikki marta sanalgan bo'lishi mumkin; `AMOUNT_MISMATCH` — bir necha to'lov eski qatorni ustidan yozgan; `NO_EXPENSE` — xarajat yozilmagan. Hisobot hech narsani o'zgartirmaydi; tuzatish qarorini buxgalter qiladi (masalan, takroriy xarajatni qo'lda o'chirish).

## 10. Superadmin hisobiga kirish yo'qolgan

- Birinchi SUPERADMIN'ni qo'lda bazada yaratish kerak (self-service yo'q, xavfsizlik uchun ataylab shunday):
  ```sql
  UPDATE users SET role = 'SUPERADMIN' WHERE email = 'sizning-email@domen.uz';
  ```

## 11. Workspace / Tashkilot a'zoligi muammosi ("Foydalanuvchida faol tashkilot a'zoligi topilmadi")

- Agar eski foydalanuvchi tizimga kirganda "Foydalanuvchida faol tashkilot a'zoligi topilmadi" xatosi chiqsa:
  Markazga kirish faqat faol a'zolikdan keladi. A'zoligi yo'q akkaunt — ataylab o'chirilgan xodim ham bo'lishi mumkin, shuning uchun a'zolik **ommaviy tiklanmaydi**.
  1. Kimlar kira olmasligini ko'ring (faqat o'qiydi): `cd backend && node scripts/list-unlinked-accounts.cjs`
  2. Ishlashi kerak bo'lgan odamni markaz rahbari **Xodimlar → qo'shish** orqali (o'sha email bilan) qayta qo'shadi.
  3. Markazda birorta ham a'zo qolmagan bo'lsa, platforma admini (SUPERADMIN) o'sha markazga kirib, rahbarni Xodimlar bo'limidan qo'shadi.
  `scripts/migrate-memberships.ts` ishlatilmaydi: u barcha akkauntlarga a'zolik berib, o'chirilgan xodimlarni ham qaytarar edi.

## 12. Taklifnoma xatolari ("Ushbu taklifnoma yaroqsiz yoki muddati tugagan")

- Taklifnomalar 7 kun muddatga ega va faqat 1 marta ishlatiladi (`invitation_status` = `PENDING`).
- Token bazada SHA-256 hash ko'rinishida (`token_hash`) saqlanadi.
- Agar foydalanuvchi taklifnomani yo'qotgan yoki muddati o'tgan bo'lsa, markaz administratori settings yoki onboarding orqali yangi taklifnoma yuborishi kerak (eski taklifnoma `REVOKED` yoki `EXPIRED` bo'ladi).

## 13. Onboarding bosqichida qolib ketish ("Onboarding reset")

- Agar markaz administratori onboarding bosqichini qayta o'tmoqchi bo'lsa yoki qolib ketgan bo'lsa:
  ```sql
  UPDATE tenants SET onboarding_step = 'PROFILE' WHERE id = '<TENANT_ID>';
  ```
  Onboarding yakunlanganda `onboarding_step = 'COMPLETED'` bo'ladi.

## 14. Umumiy tekshiruv tartibi (istalgan nosozlikda birinchi qadamlar)

1. `GET /api/health`
2. Backend va frontend loglarini oxirgi 5 daqiqa uchun ko'rish
3. `npm run test && npm run test:e2e` (backend) — asosiy funksiyalar buzilmaganini tasdiqlash; brauzer yo'nalishlari: `e2e-browser/README.md`
4. Serverda: `bash scripts/production/stack.sh exec backend node scripts/migrate.cjs --status` — kutilayotgan migratsiya yo'qligi
5. So'nggi deploy/commit nima o'zgartirganini `git log` orqali ko'rish
