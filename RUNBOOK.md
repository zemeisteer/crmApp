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
- **Xato to'lov — storno:** Hisobotlar → Oylik maosh → o'qituvchi qatoridagi "To'lovlar" (yoki "Qoldiqni to'lash") → to'lov yonidagi "Storno", sababi bilan (API: `POST /api/salary-payments/<id>/reverse {reason}`). Bitta tranzaksiyada: to'lov "storno qilingan" bo'lib qoladi (kim, qachon, nima uchun), uning xarajati o'chadi, oy uchun shu summa yana to'lanadigan bo'ladi. Qayta storno hech narsani o'zgartirmaydi. Audit jurnalida `salary.disburse` / `salary.reverse` / `salary.link_expense`.
- **0035 dan oldingi yozuvlar:** Hisobotlar → Oylik maosh pastidagi "Eski maosh yozuvlari" bloki (API: `GET /api/salary-payments/reconciliation?forMonth=YYYY-MM`, faqat o'qiydi). `LIKELY_DOUBLE_COUNTED` — moliya hisobotida shu pul ikki marta sanalgan bo'lishi mumkin; `AMOUNT_MISMATCH` — bir necha to'lov eski qatorni ustidan yozgan; `NO_EXPENSE` — xarajat yozilmagan. Hisobotning o'zi hech narsani o'zgartirmaydi. `LIKELY_DOUBLE_COUNTED` qatorida bitta, summasi aynan teng xarajat bo'lsa, "Xarajatga bog'lash" tugmasi chiqadi (`POST /api/salary-payments/<id>/link-expense {expenseId}`): bog'langandan keyin pul faqat xarajatdan bir marta sanaladi, kerak bo'lsa storno ham qilinadi. Summasi farq qiladigan yozuvni bog'lab bo'lmaydi — uni buxgalter qo'lda tuzatadi.

## 10. Kunlik kassa (To'lovlar → Kassa (kun))

- Kun markaz vaqtida (tenant timezone) olinadi: shu kunda `paidAt` bo'lgan `PAID` to'lovlar va shu sanadagi xarajatlar (maosh to'lovlari ham xarajat). "Kassada bo'lishi kerak" = naqd kirim − naqd xarajat; Click/Payme/bank kassadan o'tmaydi.
- "Kim qabul qildi": `payments.recorded_by_id` (migratsiya 0037 dan). Eski va onlayn to'lovlar "Onlayn / yozilmagan".
- Yopish: egasi, admin yoki hisobchi sanalgan naqd pulni kiritadi (`POST /api/cash/day/close {date, countedCash, note}`). Kun **bir marta** yopiladi va o'zgarmaydi (ikkinchi urinish 409). Kelajakdagi kunni yopib bo'lmaydi.
- Yopilgandan keyin shu kunga kiritilgan to'lov/xarajat "yopilgandan keyin" belgisi bilan ko'rinadi; yopilgan kun kartasida "Yopilgandan keyin naqd o'zgarishi" ogohlantirishi chiqadi. Bunday holda pulni sanab, farqni izohda yoki keyingi kun yopilishida hisobga oling.
- Tarix: `GET /api/cash/closings?month=YYYY-MM`; audit jurnalida `cash.close`.

## 11. Excel'dan import (yangi markazni to'ldirish)

- Tartib: **o'qituvchilar → guruhlar → o'quvchilar** (guruh o'qituvchini, o'quvchi guruhni ismi bo'yicha topadi). Har bir sahifada "Excel'dan import" (faqat egasi va admin); shablon ("Shablonni yuklab olish") ustunlar va izohlar bilan.
- Fayl tanlanganda faqat tekshiriladi (`POST /api/import/<teachers|groups|students>?dryRun=1`): har bir qator "Yangi", "Bor" (o'tkazib yuboriladi) yoki "Xato" (sababi bilan). Birorta xato bo'lsa, import qilish tugmasi chiqmaydi va server ham hech narsa saqlamaydi.
- Tekshiriladi: majburiy ustunlar, telefon, sana (YYYY-MM-DD), vaqt (HH:MM), kunlar (Du/Cho/Ju, Dushanba, Mon, пн...), maosh turi, faylning o'zidagi takror qatorlar, o'qituvchi va filial nomi, o'qituvchining dars vaqti to'qnashuvi (mavjud guruhlar va fayl ichida), guruhda bo'sh joy.
- "Bor" qoidasi: o'qituvchi — telefon (telefonsiz bo'lsa ism); guruh — nom; o'quvchi — ism + telefon + ota-ona telefoni. Shuning uchun bir faylni qayta yuklash hech narsa qo'shmaydi.
- Import yaratish formalaridagi servislar orqali (narx tarixi, haftalik darslar, guruhga yozish, audit). Agar import o'rtada to'xtasa (server xatosi), xabarda nechta saqlangani aytiladi — faylni qayta yuklang, saqlanganlari o'tkazib yuboriladi.
- Bir faylda ko'pi bilan 2000 qator, 5 MB. Eski `POST /api/export/students/import` olib tashlandi.

## 12. Qarzdorlarga eslatma (To'lovlar → Qarzdorlar ro'yxati → "Qarzdorlarga eslatma")

- Faqat egasi, admin va buxgalter. Tugma avval ro'yxatni ko'rsatadi (`GET /api/notifications/debtor-reminders/preview?forMonth=YYYY-MM`) — hech narsa yuborilmaydi: kimga, qaysi kanal (SMS / Telegram), kim bugun olgan, kimda aloqa yo'q.
- Yuborish (`POST /api/notifications/debtor-reminders`): bir o'quvchiga bir oy uchun **bir kunda bitta** eslatma (markaz kuni, `debtor_reminders` jadvali). Avval yozuv olinadi, keyin yuboriladi — ikki marta bosish yoki ikki xodim bir vaqtda bossa ham bitta xabar ketadi. Natija: "Yuborildi / Bugun allaqachon / Aloqa yo'q".
- Faqat hozir o'qiyotganlar (ACTIVE). Telefoni ham, Telegram'i ham yo'q o'quvchi "aloqa yo'q" deb sanaladi, "yuborildi" deb emas. Telegram bot sozlanmagan bo'lsa Telegram kanali "ulanmagan".
- Xabar oxirida markaz nomi turadi (avval "TalimCRM" edi).
- Productionda SMS token (markaz sozlamasi yoki `ESKIZ_API_TOKEN` / `PLAYMOBILE_API_TOKEN`) bo'lmasa SMS "ulanmagan" ko'rinadi va yuborilmaydi; provayder ham xabarni FAILED deb yozadi (ilgari "yuborildi" deb yozardi). Local/testda tokensiz SMS faqat logga yoziladi.
- Har bir xabarning holati Sozlamalar sahifasidagi bildirishnomalar jurnalida (`GET /api/notifications/logs`).

## 13. Superadmin hisobiga kirish yo'qolgan

- Birinchi SUPERADMIN'ni qo'lda bazada yaratish kerak (self-service yo'q, xavfsizlik uchun ataylab shunday):
  ```sql
  UPDATE users SET role = 'SUPERADMIN' WHERE email = 'sizning-email@domen.uz';
  ```

## 14. Workspace / Tashkilot a'zoligi muammosi ("Foydalanuvchida faol tashkilot a'zoligi topilmadi")

- Agar eski foydalanuvchi tizimga kirganda "Foydalanuvchida faol tashkilot a'zoligi topilmadi" xatosi chiqsa:
  Markazga kirish faqat faol a'zolikdan keladi. A'zoligi yo'q akkaunt — ataylab o'chirilgan xodim ham bo'lishi mumkin, shuning uchun a'zolik **ommaviy tiklanmaydi**.
  1. Kimlar kira olmasligini ko'ring (faqat o'qiydi): `cd backend && node scripts/list-unlinked-accounts.cjs`
  2. Ishlashi kerak bo'lgan odamni markaz rahbari **Xodimlar → qo'shish** orqali (o'sha email bilan) qayta qo'shadi.
  3. Markazda birorta ham a'zo qolmagan bo'lsa, platforma admini (SUPERADMIN) o'sha markazga kirib, rahbarni Xodimlar bo'limidan qo'shadi.
  `scripts/migrate-memberships.ts` ishlatilmaydi: u barcha akkauntlarga a'zolik berib, o'chirilgan xodimlarni ham qaytarar edi.

## 15. Taklifnoma xatolari ("Ushbu taklifnoma yaroqsiz yoki muddati tugagan")

- Taklifnomalar 7 kun muddatga ega va faqat 1 marta ishlatiladi (`invitation_status` = `PENDING`).
- Token bazada SHA-256 hash ko'rinishida (`token_hash`) saqlanadi.
- Agar foydalanuvchi taklifnomani yo'qotgan yoki muddati o'tgan bo'lsa, markaz administratori settings yoki onboarding orqali yangi taklifnoma yuborishi kerak (eski taklifnoma `REVOKED` yoki `EXPIRED` bo'ladi).

## 16. Onboarding bosqichida qolib ketish ("Onboarding reset")

- Agar markaz administratori onboarding bosqichini qayta o'tmoqchi bo'lsa yoki qolib ketgan bo'lsa:
  ```sql
  UPDATE tenants SET onboarding_step = 'PROFILE' WHERE id = '<TENANT_ID>';
  ```
  Onboarding yakunlanganda `onboarding_step = 'COMPLETED'` bo'ladi.

## 17. Umumiy tekshiruv tartibi (istalgan nosozlikda birinchi qadamlar)

1. `GET /api/health`
2. Backend va frontend loglarini oxirgi 5 daqiqa uchun ko'rish
3. `npm run test && npm run test:e2e` (backend) — asosiy funksiyalar buzilmaganini tasdiqlash; brauzer yo'nalishlari: `e2e-browser/README.md`
4. Serverda: `bash scripts/production/stack.sh exec backend node scripts/migrate.cjs --status` — kutilayotgan migratsiya yo'qligi
5. So'nggi deploy/commit nima o'zgartirganini `git log` orqali ko'rish
