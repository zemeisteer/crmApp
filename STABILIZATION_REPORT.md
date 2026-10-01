# TalimCRM — barqarorlashtirish hisoboti

Hisobot ikki bosqichni qamraydi:

| | Boshlang'ich commit | Holat |
|---|---|---|
| **1-bosqich** (migratsiyalar, auth, to'lovlar, qarz, AI/import, CI) | `78d9cef` | `dev` ga push qilingan (`1e28f7e`), GitHub CI yashil |
| **2-bosqich** (a'zolik, narx tarixi, test bazasi, AI repetitor limiti) | `1e28f7ec9d17559bbfce0a8929a0872bcdf316a6` | **faqat lokal**, commit va push qilinmagan — ko'rib chiqish uchun |

**Ma'lum asos:** GitHub CI yurishi `36840295303` (`1e28f7e`) o'tgan — 236 unit, 173 E2E, migratsiya/yangilanish tekshiruvlari, sxema farqi, typecheck, lint va ikkala build.
**2-bosqich o'zgarishlari** shu asosdan keyin qilingan va **faqat lokal tekshirilgan** (5-bo'lim). Ular uchun CI hali yurmagan.

**Tayyorlik bahosi:** 1–2 markaz bilan cheklangan pilotga tayyor, 7-bo'limdagi shartlar bilan.

---

## 1. 2-bosqich: tasdiqlangan topilmalar

| # | Muammo | Tasdiq |
|---|---|---|
| 1 | Xodimni o'chirish (`StaffService.remove`) a'zolik qatorini **butunlay o'chirar** edi. A'zolik qatori qolmagan akkaunt esa `JwtStrategy`, `resolveWorkspace` va `completeLogin` da "eski (legacy) akkaunt" deb qabul qilinib, `users.tenantId` / `users.role` bo'yicha **yana ichkariga kiritilar edi** | Kod va yangi test bilan tasdiqlandi: yagona a'zoligi o'chirilgan xodim eski tokeni, refresh va yangi login bilan markazga qayta kira olar edi |
| 2 | Telegram bot (`findStaff`) a'zolik holatini tekshirmas, a'zolik bo'lmasa `users.role` ga tayanar edi | To'xtatilgan yoki o'chirilgan xodim botda xodim menyusini olar edi |
| 3 | Platforma admini yaratgan markazning admini (`tenants.createByAdmin`) umuman a'zoliksiz yaratilar edi | U faqat o'sha "legacy" qoidasi tufayli ishlar edi |
| 4 | 0030 migratsiyasi mavjud guruhning **hozirgi** narxini guruh yaratilgan kundan beri amalda deb yozgan; `priceAt()` birinchi yozuvdan oldingi oylar uchun ham eng eski narxni qaytarar edi | Ilgari 400 000 turgan, hozir 600 000 turadigan guruhning hisob-fakturasiz eski oyi "600 000 qarz" bo'lib chiqar edi |
| 5 | O'tgan oy uchun "oylik hisob-faktura yaratish" ham hozirgi narxda chiqarar edi | Taxmin tasdiqlangan majburiyatga aylanar edi |
| 6 | E2E testlar ishlab chiqish bazasida yurar edi | Lokal bazada 2 080 ta test markazi va 3 848 ta foydalanuvchi to'planib qolgan |
| 7 | AI repetitor (chat) limiti "avval sanab, keyin yozish" edi | Bir vaqtdagi so'rovlar limitdan o'tar edi |

Tasdiqlanmagan: oraliq 401 xatosi qayta chiqmadi (4-bo'lim).

## 2. 2-bosqich: tuzatishlar

### 2.1. A'zolik yo'q — kirish yo'q
- Markazga kirish **faqat ACTIVE a'zolik qatoridan** keladi. `users.tenantId` va `users.role` endi hech narsaga ruxsat bermaydi — "a'zoligi yo'q = eski akkaunt" qoidasi `JwtStrategy`, `resolveWorkspace` va `completeLogin` dan olib tashlandi.
- Shu bilan barcha yo'llar yopildi: mavjud access token, refresh, parol bilan login, 2FA login, markaz tanlash, handoff yaratish va almashtirish, `/me` va himoyalangan endpointlar.
- Xodimni o'chirish endi qatorni o'chirmaydi: `SUSPENDED` + `removed_at` + `removed_by_user_id` ("tombstone"). Shu tranzaksiyada o'sha markazga bog'langan sessiyalar va handoff kodlari o'chiriladi. Audit jurnaliga yoziladi.
- Qayta qo'shish (Xodimlar → qo'shish yoki taklifnoma) — ataylab qaytarishning yagona yo'li; `removed_at` tozalanadi.
- Telegram bot faqat faol a'zoga javob beradi.
- Platforma admini yaratgan markaz adminiga haqiqiy a'zolik beriladi.
- SUPERADMIN o'zgarmagan (a'zoliksiz ishlaydi). O'quvchi/ota-ona kabineti alohida tokenlarda — o'zgarmagan.

**Migratsiya 0032 (qo'shuvchi):** ikki ustun, va bitta aniq holat uchun to'ldirish — **markaz asoschisi**: hech qayerda a'zoligi yo'q `OWNER` akkaunt, markazida boshqa OWNER a'zoligi (faol yoki nofaol) va boshqa shunday akkaunt bo'lmasa. OWNER'ni xodimlar API'si orqali o'chirib bo'lmaydi, shuning uchun bu holat noaniq emas.
Qolgan a'zoliksiz akkauntlar (ADMIN, MANAGER, TEACHER...) ataylab o'chirilgan xodim bo'lishi mumkin — ularga **kirish qaytarilmaydi**. Ro'yxati: `node scripts/list-unlinked-accounts.cjs` (faqat o'qiydi). Kerak bo'lganlarini markaz rahbari qayta qo'shadi.

### 2.2. Yozilmagan tarixiy narx — tasdiqlangan qarz emas
- `group_price_history.source`: `RECORDED` (ilovada o'rnatilgan yoki qo'lda tasdiqlangan narx) va `ASSUMED` (0030 yozgan qator).
- `ASSUMED` qator faqat bitta faktni bildiradi: **yozilgan paytda** guruh shuncha turgan. U o'sha oydan boshlab hisobga olinadi, guruh yaratilgan kundan emas.
- Narxi yozilmagan oy uchun hisob-fakturasiz o'qish **taxmin** bo'lib, alohida ko'rsatiladi:
  - o'quvchi qatorida `unverifiedAmount` / `unverifiedDebt`, holati `UNVERIFIED`;
  - jami: `totalUnverifiedDebt`, `unverifiedCount`, `unverifiedGroups`;
  - `debtAmount`, `totalDebt`, `debtorCount`, yig'im foizi — **faqat tasdiqlangan** qarz.
- Bir xil ajratish hamma joyda: qarzdorlar ro'yxati, moliya xulosasi (`unverifiedDebt`), direktor hisoboti (har oy va jami `unverifiedDebt`), bosh sahifa, kabinet.
- Eslatmalar (avtomatik va qo'lda) faqat tasdiqlangan qarz bo'yicha yuboriladi.
- O'tgan oy uchun hisob-faktura faqat **yozilgan narxda** chiqariladi; narxi noma'lum guruhlar o'tkazib yuboriladi va `skippedUnverified` da qaytariladi.
- **Tasdiqlash oqimi:** `POST /groups/:id/price-history` `{ month, monthlyPrice, note? }` — "shu oydan boshlab guruh shuncha turgan". Ruxsat: OWNER, ADMIN, ACCOUNTANT. Yangi `RECORDED` qator yoziladi (kim tasdiqlagani bilan), audit jurnaliga tushadi. Eski yozuvlar o'chirilmaydi — tuzatish ham yangi qator. Hisob-faktura va to'lovlarga tegmaydi. `GET /groups/:id/price-history` — tarix.
- To'lovlar sahifasida: sariq ogohlantirish, guruh bo'yicha narx kiritish va "Tasdiqlash" tugmasi, "Tasdiqlanmagan" belgisi.

**Migratsiya 0033 (qo'shuvchi):** uch ustun; 0030 yozgan qatorlar (`gph_<guruh id>`) `ASSUMED` deb belgilanadi — narx va sanalar o'zgarmaydi. 0030 ning o'zi qayta yozilmagan. Ilovada keyin qilingan narx o'zgarishlari (`RECORDED`) saqlanadi. Tarixiy summa o'ylab topilmaydi.

**Yangilanishdan keyin kutiladigan o'zgarish:** hisob-fakturasiz o'tgan oylar qarzi "taxmin"ga o'tadi va tasdiqlanmaguncha jami qarzga kirmaydi. Joriy oy o'zgarmaydi.

### 2.3. E2E uchun alohida baza
- `npm run test:e2e` endi ishlab chiqish bazasiga ulanmaydi: `DATABASE_URL` dagi nomga `_e2e` qo'shiladi (`talimcrm` → `talimcrm_e2e`) yoki `E2E_DATABASE_URL` olinadi.
- Himoya: nomi `_e2e` yoki `_test` bilan tugamaydigan baza **ulanishdan oldin** rad etiladi; `NODE_ENV=production` ham.
- `_e2e` baza har yurishda o'chirilib qayta quriladi (`E2E_KEEP_DB=1` — saqlash). CI'dagi `_test` baza hech qachon o'chirilmaydi. Boshqa hech narsa o'chirilmaydi.
- Sxema production runner (`scripts/migrate.cjs`) bilan quriladi.
- AI, e-mail, Telegram va SMS kalitlari yurish uchun bo'shatiladi.
- Hujjat: `backend/README.md` → "The end-to-end database".

### 2.4. AI repetitor limiti
- Savol AI'ga yuborilishidan **oldin** bitta shartli `INSERT ... ON CONFLICT DO UPDATE` bilan band qilinadi (`ai_usage`, tur `TUTOR`). Sxema o'zgarmagan.
- Web kabinet va Telegram bot bitta servis va bitta hisoblagichdan foydalanadi.
- Kun — markaz vaqt zonasi bo'yicha.
- Javob saqlanmasa (AI xatosi yoki yozishdagi xato) birlik **bir marta** qaytariladi; hisoblagich noldan pastga tushmaydi.

## 3. Yangi regressiya testlari

| Fayl | Testlar | Mazmuni |
|---|---|---|
| `test/staff-removal.e2e-spec.ts` (yangi) | 6 | haqiqiy `DELETE /staff/:id` orqali: yagona a'zoligi o'chirilgan xodim eski token, refresh, yangi login, markaz tanlash, oldin olingan handoff kodi bilan kira olmaydi; qatori butunlay yo'q akkaunt ham; 2FA kodi ham ochmaydi; A markazdan o'chirish B markazdagi ishni buzmaydi; to'xtatilgan a'zo yopiq; qayta qo'shish va taklifnoma ishlaydi; platforma admini yaratgan admin a'zolikka ega |
| `test/debt-history.e2e-spec.ts` | +4 (jami 10) | 400 000 → 600 000 guruh: eski oy "600 000 qarz" emas, `UNVERIFIED`; aralash oy; xulosa = direktor hisoboti; eslatma yuborilmaydi; hisob-faktura chiqarilmaydi; tasdiqlashdan keyin 400 000; tuzatish; audit; ruxsatsiz rol 403 |
| `test/portal-tutor.e2e-spec.ts` | +3 (jami 6) | sayt + bot orqali 12 ta bir vaqtdagi savol, limit 4 → aynan 4 ta; AI xatosi → hisoblanmaydi, noldan pastga tushmaydi; markaz yarim tunida kun almashishi, boshqa vaqt zonasi |
| `src/ledger/ledger.spec.ts` | +4 | yozilmagan narx, hisob-faktura ustunligi, tasdiqlangan narx, aralash holat |
| `src/common/e2e-database.spec.ts` (yangi) | 4 | test bazasini tanlash va rad etish qoidalari |
| `src/staff`, `src/telegram` spec | yangilandi | tombstone; faol a'zoligi yo'q akkaunt botda xodim emas |
| `scripts/verify-migrations.cjs` | +3 tekshiruv | asoschi a'zolik oladi; noaniq akkaunt olmaydi; eski narx qatori `ASSUMED` |

Moslashtirilgan mavjud testlar: `payments-atomic` (poyga testi joriy oyga o'tkazildi) va `reminders` (narx tarixi orqaga surildi) — ikkalasi yozilmagan o'tgan oy narxiga tayangan edi.

## 4. Oraliq 401 xatosi

- **Qayta chiqmadi.** Alohida bazada to'liq E2E to'plami ketma-ket yuritildi (5-bo'lim) — birorta ham 401 yo'q.
- Tekshirilgan sabablar va natija:
  - *Identifikator to'qnashuvi:* `teacher-${suffix}@test.uz` faqat bitta faylda ishlatiladi; `users.email` unikal; bazada takror email yo'q — tasdiqlanmadi.
  - *Throttling:* login limiti (8/daqiqa) oshganda javob **429**, 401 emas (yangi testlarda aynan shunday ko'rindi) — sabab emas.
  - *Autentifikatsiya hayot sikli:* login JWT tekshirmaydi; a'zolik `staff.create` da ketma-ket yaratiladi — xato topilmadi.
  - *Umumiy holat:* ilgarigi ikkala xato ishlab chiqish serveri va 2 000+ eski test markazi bilan **umumiy bazada** chiqqan. Bu holat endi yo'q.
- **Xulosa:** aniq sabab ko'rsatilmadi. Xato qayta urinish yoki zaiflashtirilgan tekshiruv bilan yashirilmagan; test javob matnini chiqaradigan holatda qoldirilgan.

## 5. Bajarilgan buyruqlar va haqiqiy natijalar (2-bosqich, lokal, 2026-10-01)

**Backend** (`backend/`)

| Buyruq | Natija |
|---|---|
| `npx tsc --noEmit` | xatosiz |
| `npm run lint` | 0 xato (faqat ogohlantirishlar) |
| `npm run db:check-migrations` | `34 migrations, journal and files agree` |
| `npm run db:check-drift` | `No schema drift` |
| `npx drizzle-kit generate --name ci-check` | `No schema changes` |
| `npm run db:verify-migrations` | `Migration chain verified` (22 tekshiruv) |
| `npm test` | **245 / 245** (38 fayl) |
| `npm run test:e2e` (baza: `talimcrm_e2e`) | **186 / 186** (31 fayl); ketma-ket 8 marta toza. Undan oldingi 6 yurishda faqat yuqorida aytilgan ikki moslashtirilgan test yiqilgan (401 emas) |
| `npm run build` | muvaffaqiyatli |
| `npm audit --omit=dev --audit-level=high` | exit 0 (2 ta moderate: `exceljs` → `uuid`) |

**Frontend** (`frontend/`)

| Buyruq | Natija |
|---|---|
| `npx tsc --noEmit` | xatosiz |
| `npm run lint` | 0 xato, 107 ogohlantirish |
| `npm run build` | muvaffaqiyatli |
| `npm audit --omit=dev --audit-level=high` | `found 0 vulnerabilities` |

**Test bazasi himoyasi:** `E2E_DATABASE_URL=.../talimcrm` → `refusing to use database "talimcrm"`; `NODE_ENV=production` → `refusing to run with NODE_ENV=production`.

**Brauzerda (localhost, sinov markazi):** login → to'lovlar → qarzdorlar, avgust: sariq ogohlantirish, o'quvchi "Tasdiqlanmagan", jami qarz 0. Narx 250 000 deb tasdiqlangach: jami qarz 250 000, holat "To'lanmagan". Oktabr (joriy oy) o'zgarmagan: 3 qarzdor, 1 300 000.

**Tekshirilmagan:** Docker image'lar — bu mashinada Docker yo'q. GitHub CI — 2-bosqich push qilinmagan.

## 6. Yangilash tartibi

1. Zaxira nusxa: `npm run db:backup` (yoki `pg_dump`).
2. `node scripts/migrate.cjs --status`, keyin `node scripts/migrate.cjs` (konteyner ishga tushganda o'zi bajaradi). Qo'llanadi: 0021–0033.
3. Bazada jadvallar bor, lekin migratsiya yozuvi yo'q bo'lsa: `node scripts/migrate.cjs --baseline <teg>`.
4. `npm run db:check-drift` → `No schema drift`.
5. **Yangi:** `node scripts/list-unlinked-accounts.cjs` — markazga kira olmaydigan xodim akkauntlari. Ishlashi kerak bo'lganlarini markaz rahbari Xodimlar bo'limida qayta qo'shadi.
6. **Yangi:** To'lovlar → Qarzdorlar, o'tgan oylar: sariq ogohlantirish chiqsa, guruhlarning o'sha paytdagi narxini tasdiqlang.

| Migratsiya | Nima qiladi |
|---|---|
| 0029 | sessiyalarga markaz yoziladi |
| 0030 | guruhlarga narx-tarix qatori; to'lovlarga takror himoyasi ustunlari |
| 0031 | AI hisoblagichi, import navbati |
| 0032 | a'zolik "tombstone" ustunlari; asoschi (OWNER) a'zoligi to'ldiriladi |
| 0033 | narx manbasi; 0030 qatorlari `ASSUMED` deb belgilanadi |

Sozlamalar: `IMPORT_CONCURRENCY`, `IMPORT_POLL_MS`, `IMPORT_QUEUE`; testlar uchun `E2E_DATABASE_URL`, `E2E_KEEP_DB`.

## 7. Qolgan cheklovlar

**Cheklangan pilotni to'xtatib turgan narsalar**
1. 2-bosqich o'zgarishlari commit/push qilinmagan va CI'dan o'tmagan.
2. Docker image'lar qurib ko'rilmagan.
3. Staging'da tekshirilmagan: domen/subdomen logini, zaxiradan tiklash, Telegram, Click/Payme (8-bo'lim).

**Ma'lum cheklovlar**
4. Oraliq 401 ning sababi aniqlanmagan (4-bo'lim).
5. Lokal ishlab chiqish bazasida eski test ma'lumotlari qolgan (2 080 markaz). O'chirilmadi — bu sizning bazangiz; xohlasangiz alohida tozalash mumkin.
6. To'xtatish sanasi faqat yangilanishdan keyin yoziladi; undan oldin to'xtatilgan o'quvchining eski oylari hisoblanmaydi.
7. Narxni tasdiqlash "shu oydan boshlab" ishlaydi; narx bir necha marta o'zgargan bo'lsa, har bir o'zgarish oyi alohida tasdiqlanadi.
8. `Idempotency-Key` yubormaydigan tashqi API mijozlari takrordan himoyalanmagan.
9. Ortiqcha to'lov (avans) keyingi oyga avtomatik o'tmaydi.
10. Yangilanish kuni AI hisoblagichlari (mashq va repetitor) noldan boshlanadi.
11. Backend'da 2 ta moderate (`exceljs` → `uuid`); yagona taklif — major versiyani tushirish, qo'llanmadi.
12. Brauzer tekshiruvi uchun sinov markazida (`rep-a-...`) bitta a'zolik sanasi orqaga surildi va bitta narx tasdiqlandi — faqat lokal sinov ma'lumoti.

## 8. Staging nazorat ro'yxati

**Domen va subdomen logini**
- [ ] `https://<domen>/login` → markaz manziliga o'tadi (`https://<markaz>.<domen>/dashboard`), sahifa yangilanganda sessiya saqlanadi.
- [ ] 20 daqiqadan keyin ham ishlaydi (refresh markazni saqlaydi).
- [ ] Ikki markazli xodim: tanlash oynasi, har markazda o'z roli.
- [ ] Xodimni o'chirish → uning ochiq oynasi keyingi so'rovda chiqib ketadi; qayta login 401.
- [ ] Wildcard SSL va CORS: `*.<domen>` dan API so'rovlari o'tadi.

**Zaxira va tiklash**
- [ ] `npm run db:backup` → fayl hosil bo'ladi.
- [ ] Bo'sh bazaga tiklash → `node scripts/migrate.cjs --status` hammasi qo'llangan, `db:check-drift` toza.
- [ ] Tiklangan bazada login va to'lovlar sahifasi ochiladi.

**Telegram**
- [ ] Webhook o'rnatilgan (`set-telegram-webhook.sh`), bot `/start` ga javob beradi.
- [ ] O'quvchi: bog'lash, AI savol, limit tugaganda xabar.
- [ ] Xodim: bog'lash, kunlik xulosa; markazdan o'chirilgach bot xodim menyusini bermaydi.
- [ ] To'lov xabari va qarz eslatmasi haqiqiy chatga keladi; "tasdiqlanmagan" qarz bo'yicha eslatma kelmaydi.

**Click / Payme**
- [ ] Test merchant kalitlari bilan to'lov havolasi ochiladi.
- [ ] Muvaffaqiyatli to'lov: bitta to'lov yozuvi, hisob-faktura yopiladi, kvitansiya.
- [ ] Webhook ikki marta kelganda ikkinchi to'lov yaratilmaydi.
- [ ] Bekor qilingan / muvaffaqiyatsiz to'lov hech narsani yopmaydi.

---

## 9. 1-bosqich (ma'lumot uchun, `78d9cef` → `1e28f7e`, CI yashil)

| Yo'nalish | Nima qilingan |
|---|---|
| Migratsiyalar | Jurnal 0021–0027 bilan to'ldirildi; `migrate.cjs` jurnal tartibida, `drizzle-kit` bazasini qabul qiladi, yozuvsiz bazani `--baseline` siz rad etadi; `verify-migrations.cjs` |
| Sessiya | `sessions.tenant_id`; refresh markaz va rolni saqlaydi; a'zolik har so'rovda tekshiriladi; handoff refresh token beradi; `safeNextPath` |
| To'lovlar | bitta tranzaksiya, o'quvchi bo'yicha advisory qulf + `FOR UPDATE`; `Idempotency-Key` (boshqa mazmun — 409); bir necha hisob-fakturada muddati eng eskisidan; Click/Payme ham shu qoidada; xabarlar commit'dan keyin |
| Tarixiy qarz | yagona hisoblagich `src/ledger/`: avval oyning hisob-fakturalari, keyin a'zolik sanalari va o'sha oydagi narx; to'xtatgan/ketgan/o'chirilgan o'quvchi eski qarzini saqlaydi; barcha ekranlar bitta manbadan |
| AI va import | AI mashq limiti atomik, yaratilmasa qaytariladi; import — bazadagi navbat (`SKIP LOCKED`, heartbeat, 3 urinish, dublikatsiz); Speaking bahosi "faqat transkript bo'yicha" deb belgilangan |
| CI | `npm ci`; production paketlarida HIGH/CRITICAL build'ni to'xtatadi; lint, jurnal va yangilanish tekshiruvlari; `next` 16.3.8 |

1-bosqich testlari: `auth-workspaces` (5), `payments-atomic` (7), `debt-history` (6), `ai-quota-imports` (8), `core-journey` (8).

Commitlar: `3aefdeb`, `8623ba5`, `a599a2e`, `e0051b7`, `1e28f7e`.
