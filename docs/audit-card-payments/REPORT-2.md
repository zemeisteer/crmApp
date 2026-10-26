# Karta to'lovlari: audit, 2-bosqich — hisobot

## Boshlang'ich va yakuniy holat

- **Boshlanish:** `claude/platform-card-pay` @ `50319dffecdcd9be26f76297d1af24c32f166e7e`. `git fetch` dan keyin yangi commit yo'q edi, ishchi papka toza edi.
- **Tugash:** o'sha branch, lokal commitlar (`git log 50319df..HEAD`). Oxirgi SHA hisobotning oxirgi commiti (`git log -1`).
- **Muhit:** Claude Code cloud konteyneri. PostgreSQL 16 lokal, Node 22, Chromium (Playwright).
- **Qilinmaganlar (talab bo'yicha):** push, PR, merge, production deploy.
- **Ma'lumotlar:** faqat sintetik. Testlar `_e2e` bazalarda, qo'lda tekshiruv alohida `talimcrm` dev bazada (demo markaz).
- **Tashqi xizmatlar:** haqiqiy pul, email, SMS yoki Telegram ishlatilmadi. Telegram/email testlarda almashtirildi, Click/Payme test kalitlari bilan chaqirildi, Google soxta server/mock bilan tekshirildi.

## Tuzatilgan muammolar (pul va izchillik birinchi)

### 1. O'quvchi chekini tasdiqlash: to'lov va chek bir tranzaksiyada (P1)

**Oldin (PostgreSQL'da qayta hosil qilindi):**
- `CardPaymentsService.confirm` to'lovni `PaymentsService.create` orqali alohida tranzaksiyada saqlardi.
- Chekni belgilash bosqichida xato kiritildi (trigger). Natija: to'lov `PAID/150000` saqlanib qoldi, chek `PENDING` bo'lib qoldi.
- Keyin boshqa admin rad etdi (201): chek `REJECTED`, to'lov esa `PAID`.
- Uzilishdan keyin boshqa summa bilan qayta urinish 409 berardi va chek abadiy "osilib" qolardi.

**Keyin:**
- `PaymentsService.createInTx`: to'lov, invoysga taqsimlash va to'lovning audit qatori chaqiruvchining tranzaksiyasida yoziladi.
- `confirm` bitta tranzaksiyada bajaradi: chek qatorini bloklash, to'lov, taqsimlash, chek holati, ikkala audit qatori va o'quvchiga xabar (outbox).
- Biror qadam yiqilsa, hech narsa qolmaydi. Rad etish faqat hech narsa to'lanmagan chekni ko'radi.
- Webhook va SMS faqat commit'dan keyin yuboriladi.
- **Eski koddan qolgan holat** (to'lov bor, chek `PENDING`):
  - tasdiqlash o'sha to'lovni bog'laydi (`adopted`, to'lov summasi o'zgarmaydi);
  - rad etish 409 `PAYMENT_EXISTS` qaytaradi.
- `card-claim:` bilan boshlanadigan kalitni qo'lda to'lovda ishlatib bo'lmaydi (400).
- To'lovning audit yozuvi endi "fire-and-forget" emas: u tranzaksiya ichida.

**Fayllar:**
- `backend/src/card-payments/card-payments.service.ts`
- `backend/src/payments/payments.service.ts`
- `backend/src/files/files.service.ts`
- `frontend/components/payments/CardClaims.tsx`
- `frontend/lib/api.ts`, `frontend/lib/i18n.ts`

**Test (`card-payments.e2e-spec.ts`, 12/12):**
- tasdiq va rad bir vaqtda;
- ikki admin bir vaqtda tasdiqlaydi;
- 5 ta parallel tasdiq: bitta to'lov, bitta taqsimlash;
- to'lovdan keyin xato: hech narsa saqlanmaydi;
- uzilishdan keyin rad etish;
- uzilishdan keyin boshqa summa bilan qayta urinish;
- audit yozuvi yiqilsa (chek va to'lov qatori uchun alohida);
- commit'dan keyin to'xtash: xabar outbox'da qoladi va keyingi o'tishda yuboriladi;
- eski holat (bog'lash va rad etishning poygasi);
- faqat-o'qiydigan tekshiruv.

**Tekshiruv skripti:** `backend/scripts/check-platform-billing.ts` ga 7 ta faqat o'qiydigan tekshiruv qo'shildi:
- `student_receipt_rejected_with_payment`
- `student_receipt_pending_with_payment`
- `student_receipt_confirmed_without_payment`
- `student_receipt_payment_mismatch`
- `student_receipt_two_payments`
- `payment_allocated_beyond_amount`
- `payment_messages_failed`

Skript hech narsani o'zgartirmaydi. Dev bazada (demo ma'lumotlar) 15 ta tekshiruvning hammasi 0 ta topildi.

### 2. Platforma cheki: Idempotency-Key mazmunga bog'landi (P1/P2)

**Oldin:**
- Bir xil kalit boshqa fayl yoki tarif bilan kelsa, eski chek "yuborildi" deb qaytarilardi.
- Frontend kalitni fayl yoki izoh o'zgarganda ham saqlab qolardi.

**Keyin:**
- Serverda `request_hash = sha256([tarif, izoh, faylning o'z sha256'i])`. Tasodifiy fayl nomi hisobga olinmaydi.
- Bir xil kalit va bir xil mazmun: o'sha chek qaytadi (`replay`).
- Bir xil kalit, boshqa mazmun: 409 `KEY_REUSED`.
- Oy uchun chek allaqachon kutilayotgan bo'lsa (yangi kalit): 409 `PENDING`, matnda "avvalgi yuborish yetib kelgan" deyiladi.
- Ortiqcha yuklangan fayl o'chiriladi. Ishlatilayotgan chek fayliga hech qachon tegilmaydi.
- **Frontend:** kalit mazmun izi (fayl sha256 + tarif + izoh) bilan bog'langan.
  - Oddiy qayta urinishda kalit saqlanadi.
  - Mazmun o'zgarsa, yangi kalit olinadi.
  - Eski tabdan rad etilgan chek qaytsa, "rad etilgan, yangisini yuboring" deb ko'rsatiladi, "yuborildi" emas.
- Platforma chekiga oid xabarlar ham endi outbox orqali boradi.

**Fayllar:**
- `backend/src/platform-billing/platform-card.service.ts`, `platform-card.controller.ts`
- `frontend/components/billing/PlatformCardPay.tsx`, `frontend/lib/api.ts`, `frontend/lib/i18n.ts`
- migratsiya `0077` (`request_hash`, `receipt_sha256`)

**Test:**
- API, `platform-card.e2e-spec.ts` 16/16: replay; boshqa fayl, tarif yoki izoh → 409; yangi kalit → `PENDING`; rad etilgandan keyin yangi chek; eski kalit rad etilgan chekni `REJECTED` holatida qaytaradi; diskda faqat ishlatilayotgan fayl qoladi.
- Brauzer, `platform-card-retry.spec.ts` 3/3:
  - javob yo'qoladi (so'rov serverga yetadi, javob uziladi) → o'sha fayl bilan qayta yuborish → bitta chek, "yuborildi";
  - javob yo'qoladi → boshqa fayl → aniq rad xabari, "yuborildi" emas;
  - ikki tab bir vaqtda → bitta chek, ikkinchi tab "allaqachon yetib kelgan" deydi.

### 3. To'lov xabarlari uchun outbox

**Qilingan ish:**
- Trial-notice outbox'i (`trial_notices`) faqat trial uchun yozilgan, shuning uchun uning sxemasi (claim, `lockedUntil`, urinishlar, FAILED) asosida umumiy `notice_outbox` jadvali va `NoticeOutboxService` yaratildi.
- Xabar chek yaratish, tasdiqlash yoki rad etish bilan bitta tranzaksiyada yoziladi. Rollback bo'lsa xabar ham bo'lmaydi.
- Har bir qabul qiluvchi va kanal uchun alohida qator. Birining xatosi boshqalarini to'xtatmaydi.
- **Worker:**
  - har 15 soniyada va har commit'dan keyin ishga tushadi (`kick`);
  - `FOR UPDATE SKIP LOCKED` ishlatadi, shuning uchun ikki worker bitta qatorni olmaydi;
  - 5 daqiqalik ushlab turish muddati bor; o'lgan worker'ning qatori shu muddatdan keyin qayta olinadi;
  - qayta urinish 30 s × 2^n (1 soatgacha), jami 6 urinish, keyin `FAILED`;
  - Telegram 400/403 (bot bloklangan) darhol `FAILED` bo'ladi.
- **Ko'rish:** `GET /api/platform/notice-outbox?status=FAILED` va `POST /api/platform/notice-outbox/:id/retry` (faqat SUPERADMIN). Ro'yxatda matn va qabul qiluvchi ko'rsatilmaydi.
- **Provayder kaliti:** email `Idempotency-Key: outbox-<id>` bilan yuboriladi (Resend qo'llaydi).
- **Kafolat chegarasi:**
  - Telegram va SMTP'da idempotentlik kaliti yo'q, shuning uchun yetkazish "kamida bir marta".
  - Worker yuborgan zahoti, natijani yozishdan oldin o'lsa, xabar ikki marta borishi mumkin.
- **Loglarda** faqat id, tur, kanal va xato kodi. Matn, qabul qiluvchi, manzil va token yo'q (test bilan tekshirilgan).
- **Fayllar:** `backend/src/notice-outbox/*`, `backend/src/telegram/telegram.service.ts` (`deliverMessage`), `backend/src/app.module.ts`.

**Test (`notice-outbox.e2e-spec.ts`, 7/7):**
- rollback bo'lsa qator yo'q;
- restart: yangi worker commit qilinganni yuboradi;
- osilib qolgan qulf;
- timeout va 503 o'sib boruvchi kechikish bilan;
- urinishlar chegarasi → `FAILED` → admin ro'yxati va qayta urinish;
- doimiy xato faqat bitta qabul qiluvchiga ta'sir qiladi;
- ikki worker → har xabar bir marta;
- loglarda shaxsiy ma'lumot yo'q.

### 4. Click/Payme callback va invoys o'zgarishi poygasi

**Oldin** (deterministik test: test invoys qatorini bloklab turadi, callback kutayotganini `pg_blocking_pids` bilan kutadi, tarif/summani o'zgartirib commit qiladi). 4 ta test yiqildi:
- Click complete PREMIUM tarifni STANDARD summasiga faollashtirdi;
- Payme `CreateTransaction` eski summaga tranzaksiya ochdi;
- bitta id bilan parallel `CreateTransaction` qayta urinishlarga -31051 qaytardi;
- ochiq Payme tranzaksiyasi bor invoysga Click prepare/complete o'tdi va Payme id'sini ustidan yozdi.

**Keyin:**
- `lockInvoiceForCallback`: avval markazning to'lov qulfi, keyin invoys qatori.
- Summa, holat va tranzaksiya id tekshiruvi hamda yozish bitta tranzaksiyada. Bu Click prepare/complete va Payme create/perform/cancel uchun amal qiladi.
- Payme faqat Payme id'lari bo'yicha qidiradi.
- Boshqa invoysda turgan provayder id'si rad etiladi.
- Ochiq Payme tranzaksiyasi bor invoysga Click tegmaydi.
- `applyPayment` provayderni yozadi.

**Fayllar:** `backend/src/platform-billing/platform-billing.service.ts`, `billing-period.ts`.

**Test (`platform-billing-race.e2e-spec.ts`, 7/7, ketma-ket 3 marta):**
- yuqoridagi to'rt holat;
- prepare va complete orasida yangi havola;
- parallel Click complete;
- karta tasdig'i, admin qo'lda yozgan to'lov va Click complete bir oyga: bittasi yutadi.

## To'rt funksiya: chuqur tekshiruv

Har funksiya uchun alohida markazlar (kamida ikkita) va yangi akkauntlar ishlatildi: OWNER, ADMIN, MANAGER, RECEPTIONIST, ACCOUNTANT, TEACHER, PARENT, o'quvchi kabineti, SUPERADMIN.

| Funksiya | Topilgani | Tuzatilgani | Dalil |
|---|---|---|---|
| Kalendar | Xato topilmadi. Yoz/qish vaqti (New York, 2026-11-01): ICS va Google mock'da har dars o'z UTC vaqtida. Markaz vaqt zonasini almashtirish: hodisalar o'z joyida yangilanadi, nusxa yaratilmaydi | — (yangi test) | `calendar.e2e-spec.ts` 14/14. Mavjud: takroriy dars va bitta istisno (bekor qilish, ko'chirish), takroriy sinxronizatsiya, retry, muddati o'tgan token, uzish/qayta ulash, tenant izolyatsiyasi (`calendar-google*.e2e-spec.ts`). Brauzer: `calendar.spec.ts`, fake Google bilan `tests-google` 1/1 |
| Custom maydonlar | Xato topilmadi | — (yangi test) | `custom-fields.e2e-spec.ts` 14/14: RECEPTIONIST/ACCOUNTANT ta'rif yarata olmaydi; label va qiymatdagi belgilash (markup) ma'lumot sifatida saqlanadi; qidiruv ishlaydi; boshqa markaz ko'rmaydi. Mavjud: turlar, majburiy maydon, eski qiymatlar, import/eksport, atomiklik. Brauzer: `markup-safety.spec.ts` (sahifada matn bo'lib chiqadi, kod ishlamaydi), `custom-fields.spec.ts` |
| Make-up | Xato topilmadi | — (yangi test) | `makeups.e2e-spec.ts` 12/12: qayta-qayta ko'chirishda tarix saqlanadi (`CANCELLED` qatorlar, bitta `BOOKED`); takroriy so'rov 409; ACCOUNTANT va TEACHER boshqara olmaydi. Mavjud: xona, o'qituvchi va o'quvchi to'qnashuvi, oxirgi o'rin uchun poyga, davomat kreditni bir marta ishlatadi, asl dars va maosh o'zgarmaydi |
| Chat | Xato topilmadi | — (yangi test) | `chat.e2e-spec.ts` 12/12: guruhdan chiqqan o'quvchining ochiq oqimiga guruh xabari kelmaydi; 10 ta parallel yuborish → ketma-ket raqamlar, qayta yuborishda takror yo'q, ikki tomonga sahifalash; belgilash matn sifatida qaytadi. Mavjud: huquq bekor bo'lishi, sessiya, PIN, ota-ona, qayta ulanish, o'qilmaganlar, ko'p instansiya. Chatda fayl biriktirish yo'q (kodda tekshirildi), shuning uchun "fayl huquqi" bandi tegishli emas |

**Tekshirilmagan (bloklangan) qism:**
- Haqiqiy Google Calendar: `calendar-google-live.e2e-spec.ts` **skip**, chunki `GOOGLE_LIVE_*` kalitlari yo'q.
- Bu "o'tdi" deb hisoblanmaydi. Mock va soxta server natijalari yuqorida alohida ko'rsatilgan.

## Saytni bulutda ishga tushirish

**Preview URL yo'q.** Bu bulut konteyneri tashqariga ochiq vaqtinchalik manzil (preview URL) bermaydi, shuning uchun manzil keltirilmagan. Sayt konteyner ichida ishga tushirildi va brauzer (Chromium) ham shu yerda yurgizildi. Skrinshotlar ishlayotgan saytning o'rnini bosmaydi; ular faqat dalil.

**Ishga tushirilgan stek:**
- **Qo'lda tekshirish uchun:** `talimcrm` baza (demo markaz "Bilimdon", `npm run demo:seed`), backend production build `:4000`, frontend `next dev` `:3000`.
- **Brauzer to'plami uchun:** o'z bazasi, backend va frontend production build'lari `:4300` / `:3300`.

**Checklist** (Playwright skripti `/tmp/claude-0/run/crawl.cjs`, natija `/tmp/claude-0/run/crawl/report.json`):
- **Rollar:** OWNER, ADMIN, MANAGER, RECEPTIONIST, ACCOUNTANT, TEACHER. Har biri kirish formasi orqali kirdi va 21 ta sahifani ochdi: bosh sahifa, o'quvchilar, guruhlar, o'qituvchilar, jadval, kalendar, to'lovlar, qoplash darslari, xabarlar, lidlar, hisobotlar, sozlamalar, e'lonlar, uy vazifalari, imtihonlar, audit, tariflar, signallar, ishga olish, sertifikatlar, mock testlar.
- **Telefon ekrani (390 px):** OWNER, TEACHER va RECEPTIONIST uchun ham shu sahifalar ochildi.
- **Natija (189 sahifa):**
  - sessiya yo'qolmadi;
  - konsolda JS xatosi yo'q;
  - 5xx javob yo'q;
  - telefon ekranida gorizontal siljish yo'q;
  - `/signals` ataylab `/ai-insights?tab=signals` ga o'tadi.
- **Sessiyasiz kirish:** `/dashboard`, `/payments`, `/settings`, `/admin` sahifalari `/login` ga qaytaradi.
- **Topilgan kamchilik (tuzatilmadi, kichik):** `/pricing` (Tariflar) sahifasini OWNER/ADMIN bo'lmagan xodim URL orqali ochsa:
  - sahifa `GET /api/platform-billing/card` ni chaqiradi va 403 oladi;
  - "Faollashtirish" tugmalari ko'rinib turadi, lekin to'lov API'si ularga ruxsat bermaydi;
  - menyuda bu sahifa ularga ko'rsatilmaydi.
- **Birinchi urinish haqida:** dastlabki yurish noto'g'ri edi. Skript dashboard to'liq yuklanishini kutmagan va API'ning bir IP uchun 100 so'rov/daqiqa chegarasiga urilgan. Skript tuzatildi (kirishni kutadi, 429 bo'lsa oynani kutib sahifani qayta ochadi) va qayta yurgizildi. Yuqoridagi natija ikkinchi yurishniki.

**Brauzerda qilingan amallar (qo'lda ishlayotgan stekda va brauzer to'plamida):**
- **Yangi markaz va foydalanuvchi:** forma orqali (`/register`: markaz nomi, ism, email, telefon, "Kod olish" (dev rejimida kod javobda keladi), parol) → `/onboarding` ochildi.
- **O'quvchi to'lovi va chek qarori** (`student-card-payment.spec.ts`): kabinet ikki chek yuboradi; ega biri uchun to'lovni chekda ko'rilgan summa bilan tasdiqlaydi, ikkinchisini sabab bilan rad etadi; kabinet ikkalasini ko'radi; aynan bitta to'lov yoziladi.
- **Platforma obunasi:** `platform-card.spec.ts` va `platform-card-retry.spec.ts`.
- **To'rt funksiya:** kalendar (`calendar.spec.ts`, fake Google), custom maydonlar, make-up, chat (`*.spec.ts`).
- **Mobil ko'rinish va ruxsatsiz kirish:** `mobile.spec.ts`, `role-boundaries.spec.ts`, `session.spec.ts`.

**Test akkauntlari:**
- Lokal demo: `SETUP.md` dagi `*@bilimdon.uz` / `Demo12345` (faqat konteyner ichidagi `talimcrm` bazada).
- Brauzer to'plami har safar yangi `zzbr-*` akkauntlarini yaratadi.
- Tashqaridan kirish imkoni yo'q.

## Bajarilgan tekshiruvlar (aniq sonlar)

| Tekshiruv | Natija |
|---|---|
| Backend typecheck (`tsc --noEmit`) | o'tdi |
| Backend lint (`oxlint`) | 0 xato (eski ogohlantirishlar qoldi) |
| Backend unit (`vitest run`) | 376 o'tdi, 0 yiqildi, 0 skip (58 fayl) |
| Backend PostgreSQL E2E (to'liq) | 723 o'tdi, 0 yiqildi, 2 skip (live Google, kalit yo'q); 92 fayldan 91 tasi o'tdi, 1 tasi skip |
| Yangi va o'zgargan suite'lar alohida | `card-payments` 12/12, `platform-card` 16/16, `notice-outbox` 7/7, `platform-billing-race` 7/7 (×3), `calendar` 14/14, `makeups` 12/12, `chat` 12/12, `custom-fields` 14/14 |
| Backend build (`nest build`) | o'tdi |
| Frontend typecheck | o'tdi |
| Frontend lint | 0 xato, 86 ta ogohlantirish (eski; yangi ogohlantirish yo'q) |
| Frontend unit | 61/61 |
| Frontend production build | o'tdi |
| Brauzer (Playwright, butun to'plam, production build) | 71 o'tdi, 0 yiqildi, 0 skip |
| Brauzer, fake Google bilan | 1/1 |
| Migratsiya: zanjir (`db:verify-migrations`) | o'tdi (bo'sh baza va yangilash yo'llari) |
| Migratsiya: 0076 → 0077, eski chek qatori bilan | o'tdi, ma'lumot saqlandi, drift yo'q |
| Migratsiya: 0077 ni qaytarish va qayta qo'llash | o'tdi |
| `db:check-drift`, `db:check-migrations` | o'tdi |

Hech bir test o'chirilmagan yoki skip qilinmagan, assertion olib tashlanmagan, tasodifiy `sleep` qo'shilmagan. Kutishlar shart bo'yicha bajarildi: `pg_blocking_pids`, `outbox.drain()`.

**Testlarga kiritilgan o'zgarishlar:**
- **`card-payments` eski testi** "uzilishdan keyin o'sha to'lov bilan tugatadi" degan holatni tasdiqlardi, ya'ni xatoning o'zini. Endi u "uzilishda hech narsa saqlanmaydi" deb tekshiradi.
- **Telegram stub'i** `sendMessage` o'rniga `deliverMessage` ni almashtiradi (outbox shu orqali yuboradi).
- **Chat suite'i** IP bo'yicha so'rov chegarasini o'chiradi (`ThrottlerStorage`), xuddi `platform-card` suite'i kabi. Sabab: barcha so'rovlar bitta manzildan keladi.

## Migratsiya va qaytarish

**0077 (`notice_outbox`)** faqat qo'shadi:
- yangi jadval;
- `platform_payment_claims.request_hash` va `receipt_sha256` ustunlari (ikkalasi bo'sh bo'lishi mumkin).

Mavjud qatorlar o'zgarmaydi. Hash'i yo'q eski chek kalit bo'yicha qayta yuborilsa, faqat tarif bilan solishtiriladi.

**Qaytarish (sinab ko'rildi):**

```sql
DROP TABLE notice_outbox;
ALTER TABLE platform_payment_claims DROP COLUMN request_hash, DROP COLUMN receipt_sha256;
DELETE FROM app_migrations WHERE tag = '0077_notice_outbox.sql';
```

**Cheklovlar:**
- Kodni `50319df` ga qaytarish bazani qaytarmasdan ham ishlaydi (o'zgarishlar faqat qo'shimcha).
- Lekin o'sha paytda `PENDING` holatda turgan outbox xabarlarini eski kod yubormaydi. Qaytarishdan oldin `notice_outbox` da `status in ('PENDING','SENDING')` qatorlar yo'qligini tekshiring.

**Deploydan oldin:** `npx tsx scripts/check-platform-billing.ts` ni ishga tushiring. `student_receipt_pending_with_payment` topilsa, u eski kod qoldirgan holat. Uni tasdiqlash o'sha to'lovni bog'laydi, rad etish esa rad qilinadi.

## Patch

- **Bitta diff:** `card-pay-audit-2.diff` (repo ildizida, git'ga qo'shilmagan): `git diff 50319df..HEAD > card-pay-audit-2.diff`.
- **Commitlar bo'yicha:** `card-pay-audit-2-patches/` (`git format-patch 50319df..HEAD`), `git am` bilan qo'llanadi.
- Ikkalasi bulut konteyneridagi ishchi papkada. Konteyner vaqtinchalik, shuning uchun ularni yuklab oling.

## Keyingi eng muhim vazifalar

1. **Production'dan oldin:** `check-platform-billing.ts` ni production nusxasida ishga tushirib, eski `PENDING` + to'lov holatlarini ko'rib chiqish.
2. **Outbox monitoringi:** `FAILED` sonini alert'ga ulash va admin panelga ro'yxat sahifasini qo'shish (hozir faqat API bor).
3. **Markaz ↔ o'quvchi Click/Payme (`billing/`)** yengil ko'rib chiqildi: u yerda summa tranzaksiyaning o'zida qotirilgan va yakunlash bitta tranzaksiyada. Lekin 4-banddagi deterministik poyga testi u uchun yozilmadi.
4. **Haqiqiy Google Calendar testi:** `GOOGLE_LIVE_*` test akkaunti bilan (hozir bloklangan).
5. **Kabinetdan o'quvchi chek yuborishi** (`/portal/card-payment`) hali `Idempotency-Key` ishlatmaydi. Takroriy bosish ikkita `PENDING` chek yaratishi mumkin. Ular pul emas, lekin admin ikkalasini ko'radi.
6. **Avvalgi BACKLOG:** fiskal chek talablari, abonementlar, PWA push.
