# TalimCRM — barqarorlashtirish hisoboti

| Bosqich | Boshlang'ich commit | Holat |
|---|---|---|
| **1-bosqich** — migratsiyalar, auth, to'lovlar, qarz, AI/import, CI | `78d9cef` | push qilingan (`1e28f7e`); GitHub CI `36840295303` **o'tgan** |
| **2-bosqich** — a'zolik, narx tarixi, test bazasi, AI repetitor limiti | `1e28f7e` | push qilingan (`9d4a369`); GitHub CI `36856454988` **yiqilgan** (migratsiya qadami) |
| **3-bosqich** — migratsiya buyrug'i birligi, staging tayyorligi | `9d4a369` | push qilingan (`8f97529`); GitHub CI `36860153468`: backend va frontend **o'tgan**, `images` ishi **yiqilgan** (smoke skriptining o'zidagi xato) |
| **4-bosqich** — smoke skriptini tuzatish, `SETUP.md` ni tiklash | `8f97529` | push qilingan (`fa98eff`); GitHub CI `36862631040`: **uchala ish o'tgan** |
| **5-bosqich** — staging tayyorgarligi | `fa98eff99727df6636e26f2d181797eeedc3ab25` | lokal; `STAGING_READINESS_REPORT.md` ga qarang |

**`fa98eff` bo'yicha CI'da tasdiqlangan** (yurish `36862631040`, PostgreSQL 16):
- backend: 245 unit, 186 E2E, migratsiya va yangilash tekshiruvlari, build;
- frontend: typecheck, lint, build;
- production Docker image'lar: smoke test **`SMOKE OK`** — 34/34 migratsiya API ishga tushishidan oldin qo'llangan; ro'yxatdan o'tish, `/auth/me`, markazni ochiq qidirish, qayta ishga tushirish xavfsizligi va ma'lumot saqlanishi o'tgan.

Smoke testda tashqi integratsiyalar ataylab o'chirilgan. **Hali tekshirilmagan:** haqiqiy domen va subdomen marshrutlash, zaxirani konteynerda tiklash, Telegram, Click/Payme. Bular staging'da tekshiriladi — holati `STAGING_READINESS_REPORT.md` da.

**Tayyorlik bahosi:** stabilizatsiya ishlari yakunlangan va CI yashil. Cheklangan pilotgacha qolgani — staging muhiti va undagi tekshiruvlar.

---

## 0. 3-bosqich: migratsiya buyrug'i birligi va staging tayyorligi

### 0.1. CI xatosining sababi

```
unsafe use of new value "OWNER" of enum type role          (PostgreSQL 55P04)
HINT: New enum values must be committed before they can be used.
```

- `0002_core_schema_catchup.sql` `role` enumiga `OWNER` qiymatini qo'shadi.
- `0032_membership_tombstones.sql` asoschi a'zoligini to'ldirishda `'OWNER'` ni ishlatadi.
- CI `npm run db:migrate` = `drizzle-kit migrate` edi. U **barcha** kutilayotgan fayllarni **bitta tranzaksiyada** qo'llaydi; PostgreSQL esa enum qiymatini uni qo'shgan tranzaksiya ichida ishlatishga ruxsat bermaydi.
- Production runner (`scripts/migrate.cjs`) har migratsiyani alohida tranzaksiyada qo'llaydi, shuning uchun unda muammo yo'q. Ya'ni CI va production **ikki xil yo'l** bilan migratsiya qilar edi — xato shu farqdan chiqdi.
- Nega lokalda ko'rinmagan: lokal PostgreSQL 18.3, CI'da 16. Bo'sh bazadan bitta tranzaksiya 18 da o'tadi (enum turi shu tranzaksiyada yaratilgan bo'lsa ruxsat beriladi), 16 da o'tmagan. Enum turi oldindan commit qilingan bazada esa **har qanday versiyada** yiqiladi.

**Qayta chiqarildi** (bir martalik bazada): 0000–0001 commit qilingan baza, qolgan 0002–0033 bitta tranzaksiyada:

```
FAILED in 0032_membership_tombstones, statement 4/4:
  unsafe use of new value "OWNER" of enum type role   (code 55P04)
  SQL: INSERT INTO "organization_memberships" (...) SELECT 'om_founder_' || u."id", ..., 'OWNER', 'ACTIVE' FROM "users" u ...
```
Tranzaksiya to'liq bekor bo'ladi (baza 0001 holatida qoladi). Xuddi shu bazada `drizzle-kit migrate` — exit 1; `npm run db:migrate` — 0002…0033 qo'llanadi.

### 0.2. Yagona migratsiya buyrug'i

**`npm run db:migrate`** = `node scripts/migrate.cjs` — har migratsiya o'z tranzaksiyasida, `app_migrations` da qayd etiladi.

| Kirish nuqtasi | Oldin | Hozir |
|---|---|---|
| `npm run db:migrate` | `drizzle-kit migrate` | `node scripts/migrate.cjs` |
| `npm run db:migrate:status` | — | yangi: qo'llangan / kutilayotgan |
| CI "Apply versioned migrations" | `drizzle-kit migrate` | `npm run db:migrate` |
| Docker konteyner ishga tushishi | `node scripts/migrate.cjs` | o'zgarmagan (o'sha fayl) |
| E2E test bazasi (`test/global-setup.ts`) | `node scripts/migrate.cjs` | o'zgarmagan |
| `npm run db:verify-migrations` | runner + bir joyda `drizzle-kit migrate` | hammasi `npm run db:migrate` orqali |
| Lokal o'rnatish (`SETUP.md`) | `npm run db:push` | `npm run db:migrate` |
| Docker hujjatlari (`SETUP.md`, `DEPLOYMENT_GUIDE.md`) | `exec backend npm run db:push` (image'da yo'q vosita) | konteyner o'zi qo'llaydi; `migrate.cjs --status` |

- **`drizzle-kit migrate` endi qo'llab-quvvatlanmaydi** — bu `migrate.cjs` boshida, `backend/README.md`, `SETUP.md` va CI izohida yozilgan. `drizzle-kit` faqat migratsiya yaratish (`db:generate`) va sxema solishtirish (`db:check-drift`) uchun qoladi.
- Saqlangan: jurnal tartibi va jurnal/fayl mosligi tekshiruvi; `app_migrations` qaydi; ilgari `drizzle-kit` bilan migratsiya qilingan bazani qabul qilish; migratsiya ichida xato bo'lsa to'liq rollback; qayta yuritish xavfsizligi; drift va snapshot tekshiruvlari; yozuvi yo'q bazani `--baseline` siz rad etish.
- Migratsiya fayllari o'zgartirilmagan; hech bir baza reset qilinmagan.

### 0.3. Yangi o'rnatish va yangilash — dalillar

`npm run db:verify-migrations` (faqat `<baza>_..._migcheck` nomli vaqtinchalik bazalarda; ishlab chiqish bazasiga tegmaydi) — **49 tekshiruv, hammasi o'tdi**:

| # | Stsenariy | Nima tekshirildi |
|---|---|---|
| 1 | Bo'sh baza → 0033 | sxema `schema.ts` ga teng; qayta yuritish "up to date" |
| 2 | 0020 dagi baza + ma'lumot → 0033 | 8 jadvaldagi qatorlar o'zgarmagan; asoschi a'zolik oladi; noaniq akkaunt olmaydi; eski narx qatori `ASSUMED` |
| 3 | **Enum regressiyasi**: 0001 dagi baza (enum turi commit qilingan) | bitta tranzaksiya `0032 … 55P04 unsafe use of new value "OWNER"` bilan yiqilishi tasdiqlanadi; `npm run db:migrate` esa 0002 → 0033 ni qo'llaydi. Eski migratsiyalar o'tkazib yuborilmaydi |
| 4 | **0031 dagi baza + vakillik ma'lumoti → 0032, 0033** | pastda |
| 5 | Ilgari `drizzle-kit` migratsiya qilgan baza (0000–0031 yozuvi bilan) | 32 tasi qabul qilinadi, qayta qo'llanmaydi; faqat 0032–0033 qo'llanadi |
| 6 | Jadvallari bor, yozuvi yo'q baza | rad etiladi; `--baseline` dan keyin davom etadi |

4-stsenariy tafsiloti (0031 → 0033):
- Qatorlar o'zgarmagan: `tenants` 3, `users` 8, `groups`, `students`, `enrollments`, `invoices`, `payments`, `payment_allocations`, `sessions`.
- **OWNER to'ldirish cheklovlari:** yagona asoschi → a'zolik oladi; markazda allaqachon OWNER a'zoligi bor → ikkinchi OWNER yaratilmaydi; ikki nomzod OWNER → noaniq, hech biriga berilmaydi. Butun bazada aynan **bitta** a'zolik qo'shildi.
- **O'chirilgan yoki noaniq xodim:** a'zoligi yo'q ADMIN akkaunt hech narsa olmaydi; `SUSPENDED` a'zolik `SUSPENDED` qoladi; faol a'zolik o'zgarmaydi.
- **Narx tarixi:** 0030 yozgan qator (`gph_…`) → `ASSUMED`, narxi va sanalari o'sha-o'sha; ilovada qilingan narx o'zgarishi → `RECORDED`, o'zgarmagan.
- Qayta yuritish: "up to date" va **birorta jadvalda birorta qator o'zgarmadi** (to'liq dump solishtirildi).

Ilova darajasida (migratsiyadan keyin o'chirilgan xodim kira olmasligi): `test/staff-removal.e2e-spec.ts` — 6 test, o'tdi.

### 0.4. Bajarilgan buyruqlar va haqiqiy natijalar (3-bosqich, lokal, PostgreSQL 18.3)

| Buyruq | Natija |
|---|---|
| `npm run db:check-migrations` | `34 migrations, journal and files agree` |
| `npm run db:verify-migrations` | `Migration chain verified`, 49 tekshiruv |
| `npm run db:check-drift` | `No schema drift` |
| `npx drizzle-kit generate --name ci-check` | `No schema changes` |
| `npx tsc --noEmit` (backend) | xatosiz |
| `npm run lint` (backend) | 0 xato |
| `npm test` | **245 / 245** (38 fayl) |
| `npm run test:e2e` (baza `talimcrm_e2e`, qayta qurilgan) | **186 / 186** (31 fayl) |
| `npm run build` (backend) | muvaffaqiyatli |
| `npm audit --omit=dev --audit-level=high` (backend) | exit 0 |
| `npx tsc --noEmit` (frontend) | xatosiz |
| `npm run lint` (frontend) | 0 xato |
| `npm run build` (frontend) | muvaffaqiyatli |
| `npm audit --omit=dev --audit-level=high` (frontend) | `found 0 vulnerabilities` |

**Keyin CI'da tasdiqlandi** (`8f97529`, yurish `36860153468`): shu tekshiruvlar PostgreSQL 16 da ham o'tdi — migratsiya, yangilash, 245 unit, 186 E2E, ikkala build.

### 0.5. Docker — CI'da tasdiqlangan

Bu mashinada Docker yo'q, shuning uchun tekshiruv GitHub CI'da o'tadi. `8f97529` da smoke test skript xatosi bilan to'xtagan (0.7-bo'lim); tuzatishdan keyin `fa98eff` da **`SMOKE OK`** (yurish `36862631040`).

Ko'rib chiqildi (o'qish orqali):
- `backend/Dockerfile`: `npm ci`; runner bosqichiga `drizzle/` va `scripts/migrate.cjs` ko'chiriladi; `CMD node scripts/migrate.cjs && node dist/main.js` — migratsiya muvaffaqiyatsiz bo'lsa API ishga tushmaydi, tartib kafolatlangan.
- `frontend/Dockerfile`: `npm ci`, standalone build.
- `docker-compose.prod.yml`: backend postgres `service_healthy` ni kutadi; frontend backend `service_healthy` ni kutadi (`/api/health`).

Tayyorlab qo'yildi (ishga tushirilmagan):
- `docker-compose.smoke.yml` — o'sha Dockerfile'lar va `runner` target'lari; PostgreSQL xotirada (tmpfs), nginx/sertifikat/zaxira yo'q; barcha tashqi integratsiyalar bo'sh, eslatmalar o'chiq; portlar faqat `127.0.0.1`.
- `scripts/production/smoke-test.sh` — image'larni quradi; stack sog'lom bo'lishini kutadi; migratsiyalar API'dan **oldin** tugaganini log tartibidan tekshiradi; `--status` bo'yicha hammasi qo'llanganini; `/api/health`, frontend `/login`, API orqali ro'yxatdan o'tish → `/auth/me`; backend qayta ishga tushganda "up to date" va hech bir migratsiya ikki marta qo'llanmaganini; tashqi kalitlar bo'shligini. Oxirida hammasini o'chiradi.
- CI'ga `images` ishi qo'shildi — shu skriptni GitHub runner'da yuritadi.

Docker bor mashinada: `bash scripts/production/smoke-test.sh` (kutiladigan oxirgi satr: `SMOKE OK`).

### 0.6. Staging'gacha qolgan to'siqlar

1. ~~CI'da `images` ishi~~ — bajarildi: `fa98eff`, `SMOKE OK`.
2. Staging muhiti (server, domen, integratsiya ma'lumotlari) — `STAGING_READINESS_REPORT.md`.
3. Quyidagi staging ro'yxati. Tashqi integratsiyalar **tekshirilmagan** — mock testlar o'tgani ularni tasdiqlamaydi.

**Staging nazorat ro'yxati**

- [ ] **Login zanjiri:** asosiy domenda login → markaz subdomeniga o'tish → sahifani yangilash → 20 daqiqadan keyin ham ishlaydi (refresh markazni saqlaydi).
- [ ] **Ikki markaz, ikki rol:** bitta xodim A da ACCOUNTANT, B da TEACHER — tanlash oynasi, har markazda faqat o'z roliga ruxsat.
- [ ] **Xodimni o'chirish:** ochiq oynasi keyingi so'rovda chiqib ketadi; qayta login 401; Telegram botda xodim menyusi yo'q; qayta qo'shilgach kiradi.
- [ ] **Zaxira:** `db:backup` → **alohida** bazaga tiklash → `migrate.cjs --status` hammasi qo'llangan, `db:check-drift` toza, login ishlaydi.
- [ ] **Tarixiy narx:** o'tgan oyda sariq ogohlantirish; narx tasdiqlangach jami qarz o'zgaradi; qarzdorlar ro'yxati = moliya xulosasi = direktor hisoboti.
- [ ] **Telegram** (haqiqiy bot, haqiqiy chat): webhook, `/start`, o'quvchi AI savoli va limit, to'lov xabari, qarz eslatmasi.
- [ ] **Click / Payme** (test merchant): to'lov havolasi → muvaffaqiyatli to'lov → bitta yozuv, hisob-faktura yopiladi; **webhook ikki marta** kelganda ikkinchi to'lov yaratilmaydi; bekor qilingan to'lov hech narsani yopmaydi.

---

### 0.7. 4-bosqich: smoke skriptidagi xato va tuzatish

**CI'dagi xato** (`images` ishi, 3-qadam):

```
scripts/production/smoke-test.sh: line 33: echo: write error: Broken pipe
SMOKE FAILED: no migration output on first start
```

**Sabab — skriptda, ilovada emas.** Skript `set -euo pipefail` bilan ishlaydi va shunday tekshirar edi:

```bash
echo "$LOGS" | grep -q "migrate: applied 0000_"
```

`grep -q` birinchi mos satrni topishi bilan chiqadi; `echo` esa hali yozayotgan bo'ladi, `SIGPIPE` oladi ("Broken pipe"), va `pipefail` tufayli butun quvur **muvaffaqiyatsiz** deb hisoblanadi — matn topilgan bo'lsa ham. Ya'ni migratsiya loglari bor edi; skript ularni topib, "topilmadi" deb xabar bergan.

**Tuzatish:**
- Matn tekshiruvlari `scripts/production/smoke-lib.sh` ga chiqarildi (`has_text`, `count_lines`, `first_line`, `last_line`, `json_string`). Matn here-string bilan beriladi; erta chiqadigan o'quvchi (`grep -q`, `head`) hech qayerda quvur ortida turmaydi.
- Skript to'liq ko'rib chiqildi: `echo | grep -q` (5 joy), `curl | grep -q` (2 joy), `... | head -1`, `exec ... | grep -c` — hammasi almashtirildi.
- HTTP so'rovlari: avval `curl` ning chiqish kodi tekshiriladi, keyin saqlangan javob o'qiladi; xato bo'lsa HTTP holati yoki `curl` xabari chiqadi.
- Buyruq natijasini o'zgaruvchiga olish joylari xato bo'lsa aniq xabar bilan to'xtaydi.
- **Frontend tayyorligi** endi haqiqatan tekshiriladi: smoke compose'da frontend uchun healthcheck (`/login` sahifasi), skriptda bir daqiqagacha qayta urinish va javob HTML ekani.
- `set -euo pipefail` saqlangan; umumiy `|| true` yo'q; hech bir tekshiruv olib tashlanmagan. Qo'shilgan: logdagi qo'llangan migratsiyalar soni = fayllar soni; qayta ishga tushgandan keyin kutilayotgan migratsiya yo'qligi.
- `count_lines` da yagona istisno: `grep -c` ning "mos satr yo'q" kodi (1) — bu javob 0, xato emas; haqiqiy xato (2) baribir to'xtatadi.

**Tekshiruv (lokal):**

| Tekshiruv | Natija |
|---|---|
| `bash -n` (3 fayl) | sintaksis to'g'ri |
| ShellCheck | **o'rnatilmagan — yuritilmadi** |
| `bash scripts/production/smoke-lib.test.sh` — 9,5 MB, 90 005 satrli sun'iy log, mos satr boshida | 19 tekshiruv o'tdi |
| ↳ eski usul (`echo \| grep -q`) o'sha logda | **exit 141** (SIGPIPE) — CI xatosi qayta chiqdi |
| ↳ `has_text` erta mos satrda | topadi, 25 martadan 25 marta |
| ↳ yo'q matn | "yo'q" deb to'g'ri qaytaradi |
| Skript mantig'i soxta `docker` va soxta HTTP server bilan | pastda |

Soxta muhitda skriptning boshidan oxirigacha yurishi (haqiqiy konteyner **emas**):

| Holat | Natija |
|---|---|
| hammasi joyida | `SMOKE OK`, tozalash chaqirildi |
| kutilayotgan migratsiya bor | `SMOKE FAILED: applied 34/34, pending 1` |
| qayta ishga tushganda migratsiya ikki marta | `SMOKE FAILED: a migration was applied twice` |
| tashqi kalit o'rnatilgan | `SMOKE FAILED: external integrations are configured ...` |
| oxirgi migratsiya logda yo'q | `SMOKE FAILED: the latest migration ... was not applied` |
| API migratsiyadan oldin boshlangan | `SMOKE FAILED: the API started (log line 1) before migrations finished (line 35)` |
| migratsiya logi umuman yo'q | `SMOKE FAILED: no migration output on first start` |
| backend javob bermaydi | `SMOKE FAILED: backend health: ... curl: (7) Failed to connect` |

Har bir holatda tozalash (`down --volumes`) bajarildi.

**To'liq Docker smoke testi:** lokalda yuritib bo'lmadi (Docker yo'q); push'dan keyin CI'da **o'tdi** — `fa98eff`, yurish `36862631040`, `SMOKE OK`. CI'ga yordamchi funksiyalar testi ham qo'shilgan (`smoke-lib.test.sh`).

**Hujjat:** oldingi o'zgarish `SETUP.md` dan migratsiya bo'limi bilan birga keraksiz ravishda **frontend o'rnatish, Telegram, email, zaxira, testlar, arxitektura** bo'limlarini ham o'chirib yuborgan edi. Ular `9d4a369` dagi matndan tiklandi. Saqlangan: `npm run db:migrate` yagona buyruq, Docker migratsiyani o'zi qo'llaydi. Tiklanmagan: `drizzle-kit migrate` / `db:push` oddiy o'rnatish sifatida, va `migrate-memberships.ts` ko'rsatmasi (u barcha akkauntlarga a'zolik berib, o'chirilgan xodimlarni qaytarar edi). O'sha skriptning o'ziga ham himoya qo'yildi: maxsus bayroqsiz ishlamaydi. Kalitlar o'rniga to'ldirgichlar.

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

> Bular `9d4a369` uchun **lokal** natijalar. CI'da bu commit migratsiya qadamida yiqilgan (0.1-bo'lim).

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

**Tekshirilmagan:** Docker image'lar — bu mashinada Docker yo'q. GitHub CI — `9d4a369` da yiqilgan (0.1-bo'lim).

## 6. Yangilash tartibi

1. Zaxira nusxa: `npm run db:backup` (yoki `pg_dump`).
2. `npm run db:migrate:status`, keyin `npm run db:migrate` (konteynerda: `node scripts/migrate.cjs`; ishga tushganda o'zi bajaradi). Qo'llanadi: 0021–0033. `drizzle-kit migrate` ishlatilmaydi.
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

**Cheklangan pilotni to'xtatib turgan narsalar** — 0.6-bo'limga qarang (CI, Docker smoke, staging).

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
