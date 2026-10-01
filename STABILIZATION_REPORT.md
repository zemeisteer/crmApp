# TalimCRM — barqarorlashtirish hisoboti

- **Ko'rib chiqilgan commit:** `78d9cef` (`feat(auth): the login page lives on the center's address too`)
- **Boshlang'ich branch:** `dev`
- **Yakuniy commit:** shu hisobot bilan birga `dev` ga push qilingan (quyidagi "Commitlar" bo'limi)
- **Sana:** 2026-10-01
- **Muhit:** Windows 11, Node 22, PostgreSQL (lokal), AI / e-mail / Telegram / SMS testlarda o'chirilgan

## 1. Xulosa

Pilot uchun xavfli bo'lgan oltita yo'nalish tuzatildi va har biri test bilan yopildi.
Mavjud funksiyalar, dizayn va tarixiy ma'lumotlar o'zgartirilmadi; migratsiyalar faqat qo'shadi.

| Tekshiruv | Boshida | Hozir |
|---|---|---|
| Unit testlar | 224 | **236 o'tdi** (37 fayl) |
| E2E testlar (haqiqiy PostgreSQL) | 139 | **173 o'tdi** (30 fayl) |
| Migratsiyalar (jurnalda) | 21 ta (0000–0020) | **32 ta** (0000–0031) |

**Tayyorlik bahosi:** 1–2 markaz bilan **cheklangan pilotga tayyor**, 7-bo'limdagi shartlar bilan.
Onlayn to'lov (Click/Payme) haqiqiy merchant bilan sinalmaguncha pilotda faqat kassa to'lovlari tavsiya etiladi.

## 2. Topilmalar

### Tasdiqlangan va tuzatilgan

| # | Muammo | Oqibati |
|---|---|---|
| 1 | `_journal.json` 0020 da tugagan, 0021–0027 SQL fayllari jurnalda yo'q edi | CI (`drizzle-kit migrate`) ularni qo'llamas, production runner esa qo'llar edi — ikki xil sxema |
| 2 | Handoff almashinuvi refresh token qaytarmas edi; frontend `"undefined"` satrini saqlar edi | Markaz manziliga o'tgandan keyin sessiya 15 daqiqada uzilar edi |
| 3 | `/me`, refresh va 2FA `users.tenantId` / `users.role` dan o'qir edi | Ikki markazda ishlaydigan xodim refreshdan keyin boshqa markazga, boshqa rol bilan tushib qolar edi |
| 4 | A'zolik faqat login paytida tekshirilar edi | Markazdan chiqarilgan xodim token muddati tugaguncha ishlay olar edi |
| 5 | `PaymentsService.create()` — alohida yozuvlar, tranzaksiya, qulf va takror himoyasi yo'q | Ikki kassir yoki ikki marta bosish hisob-fakturani ortiqcha to'ldirar yoki to'lovni ikki marta yozar edi |
| 6 | Bir oyda bir nechta hisob-faktura bo'lsa, "birinchi topilgani" tanlanar edi | Natija tasodifiy |
| 7 | Click/Payme yakunlash ham alohida yozuvlardan iborat edi | O'rtada uzilsa: tranzaksiya PAID, to'lov esa yo'q |
| 8 | `getDebtors()` o'tgan oylarni ham hozirgi ACTIVE o'quvchilar va hozirgi narxdan hisoblar edi | Ketgan/to'xtatgan o'quvchining eski qarzi yo'qolar, narx o'zgarsa o'tgan oylar qayta yozilar edi |
| 9 | Qarz to'rt joyda to'rt xil formulada hisoblanar edi (to'lovlar sahifasi, direktor hisoboti, kabinet, eslatmalar) | Raqamlar bir-biriga to'g'ri kelmas edi |
| 10 | "Joriy oy" server vaqti (UTC) bo'yicha olinar edi | Oy almashgan kechasi noto'g'ri oy |
| 11 | AI mashq limiti: avval sanab, keyin yozish | Bir vaqtdagi so'rovlar limitdan o'tib ketar edi |
| 12 | PDF import ishlari faqat xotirada; server ishga tushganda barcha `QUEUED/RUNNING` ishlar `FAILED` qilinar edi | Ikkinchi server birinchisining ishlarini o'ldirar edi; qayta urinish yo'q |
| 13 | AI Speaking bahosi transkriptdan qo'yilishi interfeysda aytilmagan edi | Talaffuz baholangandek taassurot |
| 14 | CI: `npm install`, `npm audit ... \|\| true` | Lockfile'dan chetlash va zaifliklar CI'ni to'xtatmas edi |
| 15 | `next 16.3.5` — critical (GHSA-vcvr-r3jv-pc5j) | 16.3.8 ga ko'tarildi |
| 16 | E2E testlar `.env` dagi haqiqiy Resend kalitidan foydalanar edi (logda 403 javoblar) | Testlar tashqi xizmatga chiqar edi |

### Sprintdan oldin allaqachon to'g'ri bo'lgan

- Handoff kodlari: sha256 bilan saqlanadi, bir martalik, atomik olinadi, 60 soniya.
- Click/Payme webhook'ida bir xil tranzaksiyani ikki marta yakunlashdan himoya.
- To'lov bilan berilgan chegirma hisob-fakturani yopadi (`fbf731d`).
- O'quvchi/ota-ona tokenlari boshqaruv paneliga kira olmaydi (RolesGuard).
- Speaking prompt'i talaffuzni baholamaydi (faqat yorliq yetishmas edi).
- E2E testlarda AI kalitlari bo'sh.

### Tasdiqlanmagan

- **Haqiqiy sxema farqi yo'q.** Qat'iy solishtirish faqat kosmetik farq topdi: 35 ta FK nomi (`_fkey` / `_fk`) va ikki enum qiymatlari tartibi. Tuzatish talab qilinmaydi.
- SUPERADMIN / STUDENT / PARENT xatti-harakatida xato topilmadi; o'zgarmagan holda saqlandi va testlar bilan qoplangan.

## 3. O'zgarishlar va sabablari

### 1-bosqich — migratsiyalar
- Jurnal 0021–0027 bilan to'ldirildi; `0028_schema_snapshot` — bo'sh (`SELECT 1`) migratsiya, faqat to'liq snapshot uchun. Qayta raqamlash va reset yo'q.
- `scripts/migrate.cjs` tartibni jurnaldan oladi, `drizzle-kit` bilan migratsiya qilingan bazani o'ziga qabul qiladi, yozuvi yo'q lekin jadvallari bor bazani `--baseline` siz rad etadi.
- `scripts/verify-migrations.cjs` — bo'sh baza, mavjud ma'lumotli bazani yangilash, qabul qilish va rad etishni vaqtinchalik bazalarda tekshiradi.

### 2-bosqich — markazga bog'langan sessiya
- `sessions.tenant_id` (0029): refresh tanlangan markaz va uning rolini saqlaydi.
- `JwtStrategy` har so'rovda a'zolikni tekshiradi: rol va ruxsatlar joriy a'zolikdan olinadi, to'xtatilgan a'zo darhol 401 oladi.
- Handoff refresh token qaytaradi; frontend token bo'lmagan qiymatni saqlamaydi; o'tishdan keyingi manzil faqat shu saytdagi yo'l (`safeNextPath`).

### 3-bosqich — to'lovlar
- Bitta to'lov = bitta tranzaksiya: o'quvchi bo'yicha advisory qulf + hisob-faktura qatorlariga `FOR UPDATE`.
- `Idempotency-Key` (so'rov tanasida yoki sarlavhada), markaz doirasida unikal. Takror — birinchi to'lov qaytadi; boshqa mazmun bilan — `409`.
- Qoidalar: summa + chegirma qoldiqdan oshmaydi; bekor qilingan hisob-fakturaga to'lov yo'q; oy mos kelishi shart; `PENDING` to'lov hech narsani yopmaydi.
- Hisob-faktura ko'rsatilmasa: shu oyning ochiq hisob-fakturalari **muddati eng eskisidan** boshlab to'ldiriladi, ortgani keyingisiga o'tadi; hammasidan ortgani to'lovda avans bo'lib qoladi.
- Click/Payme yakunlash ham bitta tranzaksiyada, shu qoidalar bilan. Xabar va webhook faqat commit'dan keyin.
- Oylik hisob-faktura chiqarish ham shu qulf ostida — ikki marta bosilsa bitta chiqadi.

### 4-bosqich — tarixiy qarz
- Yagona hisoblagich `src/ledger/`. Manbalar ishonch tartibida:
  1. shu oyning hisob-fakturalari (summa chiqarilgan paytda muhrlangan);
  2. hisob-fakturasi yo'q a'zolik uchun — a'zolik sanalari va **o'sha oydagi** guruh narxi (`group_price_history`).
- To'xtatgan, ketgan, bitirgan va o'chirilgan o'quvchi oldingi oylar qarzini saqlaydi.
- To'lovlar sahifasi, moliya xulosasi, bosh sahifa, direktor hisoboti, eslatmalar va o'quvchi kabineti endi bitta manbadan o'qiydi.
- Avtomatik eslatmalar faqat hozir o'qiyotgan o'quvchilarga boradi.

**Eski ma'lumotlar bo'yicha ehtiyotkor qoidalar (hech bir yozuv o'zgartirilmaydi):**
- Hisob-fakturaga bog'lanmagan eski to'lovlar o'z oyi uchun hisobga olinadi — faqat o'qishda.
- Narx tarixi yangilanishdan boshlab yuritiladi. Mavjud guruhlar uchun yagona ma'lum narx — hozirgisi, guruh yaratilganidan beri amalda deb yoziladi.
- Sana saqlanmagan holatlarda **qarz to'qib chiqarilmaydi**: sanasiz tugagan a'zolik, yangilanishdan oldin to'xtatilgan o'quvchi, hamda ketish/to'xtatish oyining o'zi — hisob-faktura bo'lmasa — hisoblanmaydi.
- Aniq raqam kerak bo'lsa: har oy hisob-faktura chiqarish.

### 5-bosqich — AI limiti va import
- AI mashq limiti bitta shartli `INSERT ... ON CONFLICT DO UPDATE` bilan band qilinadi. Mashq yaratilmasa (AI xatosi, bo'sh javob) birlik qaytariladi.
- Import ishi — `mock_imports` jadvalidagi qator: `FOR UPDATE SKIP LOCKED` bilan olinadi, 30 soniyada bir "tirikman" belgisi, 3 daqiqa jim turgan ishni boshqa server oladi, 3 urinish (30 s / 60 s tanaffus).
- Testlar `(import_id, import_index)` bo'yicha unikal — qayta urinish dublikat yaratmaydi; topilgan reja saqlanadi va qayta ishlatiladi.
- Yuklangan PDF ish tugaganda (muvaffaqiyatli yoki butunlay muvaffaqiyatsiz) o'chiriladi; ishga tushish boshqa serverning ishlariga tegmaydi.
- AI Speaking bahosi yonida: "faqat transkript bo'yicha, talaffuz baholanmagan, yakuniy bahoni o'qituvchi qo'yadi".

### 6-bosqich — CI
- `npm ci` (CI va ikkala Dockerfile).
- Audit siyosati: production paketlarida HIGH/CRITICAL — build to'xtaydi; build/test vositalari — faqat hisobot. `npm audit fix --force` ishlatilmaydi.
- CI'ga qo'shildi: lint, jurnal tekshiruvi, production runner'ning yangilanish testi.
- Yangi doimiy test: `test/core-journey.e2e-spec.ts` (pilot yo'li boshidan oxirigacha).

## 4. Bajarilgan buyruqlar va haqiqiy natijalar

Hammasi 2026-10-01 da, yakuniy kod ustida bajarilgan.

**Backend** (`backend/`)

| Buyruq | Natija |
|---|---|
| `npx tsc --noEmit` | xatosiz |
| `npm run lint` | 0 xato (faqat ogohlantirishlar) |
| `npm run db:check-migrations` | `32 migrations, journal and files agree` |
| `npm run db:check-drift` | `No schema drift` |
| `npx drizzle-kit generate --name ci-check` | `No schema changes` |
| `npm run db:verify-migrations` | `Migration chain verified` (20 tekshiruv) |
| `npm test` | **236 / 236** |
| `npm run test:e2e` | **173 / 173** |
| `npm run build` | muvaffaqiyatli |
| `npm audit --omit=dev --audit-level=high` | exit 0 (2 ta moderate: `exceljs` → `uuid`) |

**Frontend** (`frontend/`)

| Buyruq | Natija |
|---|---|
| `npx tsc --noEmit` | xatosiz |
| `npm run lint` | 0 xato, 107 ogohlantirish |
| `npm run build` | muvaffaqiyatli (next 16.3.8) |
| `npm audit --omit=dev --audit-level=high` | `found 0 vulnerabilities` |

**Yangi testlar nimani isbotlaydi**

| Fayl | Testlar | Mazmuni |
|---|---|---|
| `auth-workspaces.e2e-spec.ts` | 5 | ikki markaz/ikki rol, refresh, 2FA, a'zolik to'xtatilishi, handoff muddati va takrori |
| `payments-atomic.e2e-spec.ts` | 7 | 10 ta bir vaqtdagi to'lov → aynan 5 tasi; 8 ta bir xil kalit → 1 to'lov, 1 xabar; o'rtadagi uzilish → hech narsa qolmaydi; Click + kassa poygasi |
| `debt-history.e2e-spec.ts` | 6 | narx o'zgarishi, to'xtatish/ketish/o'chirish, hisob-faktura muhri, eski to'lovlar, ro'yxat = xulosa = direktor hisoboti, vaqt zonasi |
| `ai-quota-imports.e2e-spec.ts` | 8 | 12 so'rov → aynan 5 mashq; qaytarish; qayta urinish dublikatsiz; boshqa serverning ishiga tegmaslik; bir vaqtda bitta ish |
| `core-journey.e2e-spec.ts` | 8 | markaz → xodim logini → lid → sinov darsi → qabul → davomat → hisob-faktura → to'lov → o'quvchi va ota-ona kabineti |

**Brauzerda (localhost, test akkaunt):**
- Asosiy login → markaz manziliga o'tish, haqiqiy refresh token, `/auth/refresh` 201, `/me` o'sha markaz.
- To'lovlar sahifasi → qarzdorlar ro'yxati ochildi; to'lov formasida "saqlash" ikki marta bosildi → bitta `POST`, bitta to'lov, qarzdorlar 4 → 3.

## 5. Yangilash tartibi

1. **Zaxira nusxa:** `npm run db:backup` (yoki `pg_dump`).
2. Holatni ko'rish: `node scripts/migrate.cjs --status`.
3. Migratsiya: `node scripts/migrate.cjs` (konteyner ishga tushganda o'zi bajaradi). Qo'llanadi: 0021–0031.
4. Agar baza jadvallarga ega, lekin migratsiya yozuvi yo'q bo'lsa, runner to'xtaydi. Bazaning haqiqiy holatiga mos tegni ko'rsating: `node scripts/migrate.cjs --baseline <teg>`, keyin 3-qadam.
5. Tekshirish: `npm run db:check-drift` → `No schema drift`.

Migratsiyalar nima qiladi:
- 0029 — mavjud sessiyalarga foydalanuvchining asosiy markazi yoziladi (xodimlar qayta login qilmaydi).
- 0030 — har bir guruhga bitta narx-tarix qatori (hozirgi narx bilan); to'lovlarga ikki bo'sh ustun.
- 0031 — eski runner'dan tugallanmay qolgan importlar `FAILED` deb yopiladi (eski kod buni har ishga tushishda qilar edi).

Yangi ixtiyoriy sozlamalar: `IMPORT_CONCURRENCY` (standart 1), `IMPORT_POLL_MS` (standart 15000; 0 — fon tekshiruvi yo'q), `IMPORT_QUEUE` (standart `default`).

Bir nechta server bo'lsa: `uploads` papkasi umumiy diskda bo'lishi shart.

## 6. Qolgan to'siqlar va xavflar

**Pilotdan oldin tekshirish shart**
1. **GitHub CI natijasi ko'rilmagan** (`gh` autentifikatsiya qilinmagan). Push'dan keyingi birinchi ishga tushishni ko'zdan kechirish kerak — ayniqsa Linux'da `npm ci` va `db:verify-migrations` qadamlari.
2. **Docker image'lar lokal qurilmagan** (bu mashinada Docker yo'q). `npm ci` ga o'tgan Dockerfile'lar serverda birinchi marta quriladi.
3. **Click/Payme haqiqiy merchant bilan sinalmagan**; Telegram bot haqiqiy chat bilan sinalmagan.

**Ma'lum cheklovlar**
4. **Beqaror test:** `capacity-and-conflicts.e2e` dagi o'qituvchi logini ~16 to'liq yurishdan 2 tasida 401 qaytardi, alohida va keyingi 8 yurishda o'tdi. Sababi aniqlanmagan; test endi javob matnini chiqaradi.
5. `Idempotency-Key` yubormaydigan tashqi API mijozlari takrordan himoyalanmagan (kalit ixtiyoriy; frontend har doim yuboradi).
6. Ortiqcha to'lov (avans) keyingi oyga avtomatik o'tkazilmaydi.
7. Narx tarixi va to'xtatish sanasi faqat yangilanishdan keyin aniq (3-bo'lim, 4-bosqich).
8. AI repetitor (chat) kunlik limiti hali "sanab, keyin yozish" usulida — bu sprint doirasiga kirmagan; eng yomon holatda bir necha ortiqcha savol.
9. Yangilanish kuni AI mashq hisoblagichi noldan boshlanadi (o'sha kuni yaratilganlar hisobga kirmaydi).
10. Lokal ishlab chiqish serveri va e2e testlar bitta bazadan foydalanadi. Import navbati ajratilgan, lekin alohida test bazasi tavsiya etiladi.
11. Backend'da 2 ta moderate (`exceljs` → `uuid`): taklif qilingan yagona "tuzatish" — `exceljs` ni eski major versiyaga tushirish, shu sabab qo'llanmadi.

## 7. Pilot nazorat ro'yxati

- [ ] GitHub CI yashil (backend va frontend).
- [ ] Bazadan zaxira nusxa olindi va tiklash sinab ko'rildi.
- [ ] `node scripts/migrate.cjs --status` → hammasi qo'llangan; `db:check-drift` toza.
- [ ] `.env`: `JWT_SECRET`, `DATABASE_URL`, domen va CORS sozlamalari production qiymatlarida.
- [ ] Markaz vaqt zonasi to'g'ri (`Asia/Tashkent`).
- [ ] Har oy boshida "Oylik hisob-fakturalarni yaratish" bosiladi.
- [ ] Bitta sinov o'quvchi bilan: lid → qabul → davomat → hisob-faktura → to'lov → kabinet.
- [ ] Ikki xodim, ikki rol: har biri faqat o'ziga ruxsat etilgan sahifalarni ko'radi.
- [ ] Xodimni markazdan chiqarish → u darhol tizimdan chiqadi.
- [ ] Onlayn to'lov yoqilsa: Click va Payme test merchant bilan bitta to'liq to'lov.
- [ ] Telegram bot haqiqiy chat bilan: to'lov xabari va eslatma.
- [ ] AI yoqilgan bo'lsa: bitta PDF import va bitta AI mashq.

## 8. Commitlar (`dev`)

| Commit | Mazmuni |
|---|---|
| `3aefdeb` | migratsiyalar: jurnal, yagona ro'yxat, yangilanish tekshiruvi |
| `8623ba5` | auth: sessiya tanlangan markazda qoladi, a'zolik har so'rovda |
| `a599a2e` | to'lovlar, tarixiy qarz, AI limiti, import navbati |
| `e0051b7` | CI, audit siyosati, next 16.3.8 |
| (shu commit) | asosiy yo'l testi va ushbu hisobot |
