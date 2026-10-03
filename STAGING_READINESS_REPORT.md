# TalimCRM — Staging va pilot tayyorligi hisoboti

- **Asos commit (push qilingan):** `59d857e12f77fdb901ac4ccfbe515d6f2f031b3a` (`dev`).
- **Shu commit uchun CI:** GitHub Actions `36995711222` — yashil: backend 245 unit / 186 E2E / 34 migratsiya, frontend tekshiruvlari va build, Docker image smoke test.
- **Shu hisobotdagi yangi ish:** asos commit ustidagi **lokal, commit qilinmagan** o'zgarishlar (9-bo'lim). Ular uchun CI **hali yurmagan** — push qilinmagan.
- **Sana:** 2026-10-02.

Har bir natija qaysi manbadan ekanligi ko'rsatilgan:

| Belgi | Ma'nosi |
|---|---|
| **CI** | `59d857e` uchun GitHub Actions natijasi (yangi o'zgarishlarni qamramaydi) |
| **Lokal-API** | shu kompyuterda, bir martalik bazada, API orqali yoki skript testlari bilan |
| **Lokal-brauzer** | shu kompyuterda, haqiqiy brauzerda (`localhost` va `*.localhost` subdomenlari, `next dev`) |
| **Staging** | haqiqiy staging domeni va HTTPS — **mavjud emas, birorta tekshiruv yuritilmagan** |
| **Sandbox** | provayderning rasmiy test muhiti (Telegram, Click, Payme) — **yuritilmagan** |

## 1. Xulosa

**Hukm: integratsiyalar o'chirilgan holda cheklangan pilotga tayyor — ikki shart bilan** (7-bo'lim):

1. lokal o'zgarishlar push qilinib, CI yashil bo'lishi kerak (ayniqsa yangi `recovery` ishi: konteynerda zaxira → tiklash → ilova tekshiruvi hali **bir marta ham yurmagan**);
2. pilot serverida HTTPS, zaxira va tiklash mashqi haqiqatda bir marta o'tkazilishi kerak.

Telegram, SMS, Click va Payme tekshirilmagan — pilot ularsiz (kassa to'lovlari, qo'lda xabar) boshlanadi.

## 2. Ishlatilgan muhit

| | |
|---|---|
| Mashina | lokal ishlab chiqish kompyuteri (Windows 11); **Docker yo'q** |
| Backend | production build (`node dist/main.js`), port 4100, `ROOT_DOMAIN` — `localhost` |
| Frontend | `next dev`, port 3100 (production build alohida muvaffaqiyatli yig'ildi) |
| Baza | PostgreSQL 18.3, bir martalik `talimcrm_stagingsim` (yaratildi → ishlatildi → **o'chirildi**) |
| Integratsiyalar | AI, Telegram, SMS, email, Click, Payme — hammasi bo'sh; eslatmalar o'chiq |
| Ma'lumot | faqat sintetik markazlar va `@example.test` manzillari; hech kimga xabar yuborilmagan |
| Tegilmagan | ishlab chiqish bazasi (`talimcrm`), har qanday server, production |

Bu **staging emas**: nginx, HTTPS, wildcard sertifikat va konteynerlar qatnashmagan.

## 3. 1-bosqich — staging vositalari (Lokal-API)

| Tekshiruv | Natija |
|---|---|
| Stack tanlash: `.env` yagona manba, loyiha har doim `-p` bilan; meros qolgan `COMPOSE_PROJECT_NAME`/`STACK_NAME`/baza sozlamalari/`COMPOSE_FILE` farq qilsa `REFUSED`; `.env` yo'q; production standartlari; `down` va `--purge`; boshqa papkadan chaqirish; `--prod-env` bilan resurs nomlarini solishtirish — soxta Docker bilan (`scripts/staging/tooling.test.sh`) | **69/69** |
| `verify-flows.mjs` manzil qoidalari: URL tahlili, root↔API aniq bog'liqligi, alohida host tasdig'i, login/parolli URL, noto'g'ri protokol, production'ga o'xshash manzil, cheklangan lokal rejim, redirect; rad etilgan sozlama **0 ta tarmoq so'rovi** (`target.test.mjs`) | **10/10** (testlar bitta haqiqiy bo'shliqni topdi — root hostda boshqa port; tuzatildi) |
| `verify-flows.mjs` lokal yurishi, markazlar izolyatsiyasi bilan (ikkala markazda farqli yozuvlar, 7 ta o'tish urinishi javobi tekshirilgan, begona ID'ga o'qish/o'zgartirish/a'zo qilish/to'lov/narx tarixi → 403/404, B yozuvlari o'zgarmagan) | **25 o'tdi, 0 yiqildi, 1 yuritilmadi (HTTPS)** |
| Skript fayllari bajariladigan (`100755`) va hujjatdagi buyruqlar `bash scripts/...` ko'rinishida | git indeksida tuzatildi; toza checkout'dan tekshirish CI `ops-scripts` ishiga qo'shildi — **hali yurmagan** |

## 4. 2-bosqich — zaxira va tiklash

| Tekshiruv | Manba | Natija |
|---|---|---|
| Yagona zaxira dasturi (`backup-core.sh`): `pg_dump` darhol yiqilishi, yarim yozib yiqilishi, kesilgan dump, bo'sh dump, buzuq gzip, disk to'lishi, fayl arxivi xatosi, tiklash tekshiruvi xatosi, oldingi zaxira saqlanishi, muvaffaqiyatdan keyin tozalash, minimal saqlash soni, boshqa stack to'plamlari, ustma-ust yurish/eskirgan qulf, healthcheck | Lokal-API (soxta pg vositalari) | **137/137** |
| `init-ssl.sh` ketma-ketligi va xatolari, `backup.sh` buyrug'i, `restore.sh` faqat o'zi yaratgan bazani o'chirishi, buzilgan to'plam | Lokal-API (soxta Docker) | **63/63** |
| Haqiqiy PostgreSQL bilan: zaxira → alohida bazaga tiklash → ilovani tiklangan nusxada ishga tushirish → login/rollar, yozuvlar, balans, fayl sha256 | Lokal-API (konteynersiz) | zaxira 7–10 s (dump ~20 KB), tiklash 3 s, jami 13–17 s; manba va nusxa barmoq izlari bir xil; ilova tekshiruvi 7/7 |
| **Konteynerda to'liq mashq** (`restore-rehearsal.sh`): production compose, alohida baza serveri va alohida fayl volume'i, TLS/nginx tekshiruvi | — | **yuritilmagan** (Docker yo'q). Faqat sintaksis (`bash -n`). CI `recovery` ishi tayyor, push'dan keyin birinchi marta yuradi |
| Yangi `db-backup` va `certbot` servis ta'riflarining haqiqiy Compose'da ishlashi | — | **yuritilmagan** |
| Birinchi sertifikat va yangilanish haqiqiy Let's Encrypt bilan | Staging | **bloklangan** (domen yo'q) |
| Zaxirani serverdan tashqariga ko'chirish | — | hujjatlashtirildi (to'ldiriladigan joylar bilan); **sozlanmagan va tekshirilmagan** |

Topilgan va tuzatilgan haqiqiy nuqsonlar: (1) tungi zaxira `pg_dump | gzip` ko'rinishida edi — `pg_dump` yiqilsa ham "muvaffaqiyat" bo'lib ko'rinardi va yuklangan fayllarni olmasdi; (2) `certbot` konteynerida yangilash sikli entrypoint bo'lgani uchun `init-ssl.sh` chaqirgan `certonly` umuman bajarilmasdi — birinchi sertifikat olinmasdi.

O'lchovlar ~20 KB li sintetik baza uchun; haqiqiy hajmda tiklash vaqti **o'lchanmagan**.

## 5. 3-bosqich — brauzer tekshiruvi (Lokal-brauzer)

Ikki sintetik markaz (A, B) + UI orqali yangi yaratilgan uchinchi markaz ("Pilot Sinov"). Skrinshot va chiqishlarda token yoki parol yo'q.

### 5.1. Kirish va markaz sessiyalari

| Ssenariy | Natija | Dalil |
|---|---|---|
| Asosiy manzilda login → markaz subdomenidagi `/dashboard` | o'tdi | manzil subdomen; asosiy manzil xotirasi bo'sh; kod manzil satridan olib tashlangan |
| Bir martalik handoff kodi | o'tdi | birinchi almashtirish 201, takrori 401, noto'g'ri kod 401 |
| Sahifani yangilash, yangi oyna | o'tdi | sessiya saqlanadi; B markaz subdomenida sessiya yo'q → login |
| Token yangilanishi | o'tdi | yaroqsiz access token bilan sahifa ochildi: 401 → bitta `/auth/refresh` → 200; eski refresh token qayta ishlamaydi |
| Bir kishi, ikki markazda ikki rol | o'tdi | tanlash oynasi: A — Hisobchi, B — O'qituvchi; A da to'lovlar 200, xodimlar 403 |
| Markazni almashtirish | o'tdi (tuzatishdan keyin) | menyudagi "Boshqa markazlarim" → B markazga parolsiz; A manzilida sessiya yopildi |
| Chiqish, keyin himoyalangan sahifa | o'tdi (tuzatishdan keyin) | xotira tozalandi, `/payments` → login; **eski access token ham 401** |
| Xodim A dan o'chirildi, brauzeri ochiq | o'tdi | keyingi amalda login sahifasiga chiqarildi, xotira bo'sh |
| A dan o'chirilgan, B qolgan | o'tdi | login to'g'ri B ga (O'qituvchi) olib kirdi; B da to'lovlar/xodimlar 403 |
| Yagona markazidan ham o'chirilgan xodim | o'tdi | login rad etildi: "Sizning markazdagi a'zoligingiz faol emas" |
| O'quvchi va ota-ona kabineti sessiyasi xodim sahifalarida | o'tdi | kabinet tokeni: o'quvchilar/to'lovlar/xodimlar/hisobot 403, `/auth/me` 401; `/payments`, `/students` → login |
| Taklifnoma → xodim paroli → kirish | o'tdi | O'qituvchi roli; to'lovlar va xodimlar 403 |

### 5.2. Kundalik ish — UI orqali

| Qadam | Natija |
|---|---|
| Ro'yxatdan o'tish → 8 qadamli sozlash (profil, vaqt zonasi, yo'nalish, fan, kurs, manzil, filial, taklif) | o'tdi |
| O'qituvchi qo'shish | o'tdi |
| Guruh (fan, o'qituvchi, filial, kunlar, vaqt, sana, 400 000 so'm); majburiy maydon xatosi o'zbekcha | o'tdi |
| Lid → aloqa yozuvi → "Bog'lanildi" → sinov darsi → "Qatnashdi" → "Tayyor" | o'tdi |
| O'quvchiga aylantirish (6 qadam, guruh va oktabr hisob-fakturasi bilan, bitta amalda) | o'tdi; ota-ona telefoni liddan ko'chdi |
| Davomat | o'tdi (1 dars, 100%) |
| Qisman to'lov 150 000 → kvitansiya | o'tdi |
| Qolgan to'lov: narx 250 000 − chegirma 10 000 = 240 000 → kvitansiyada narx/chegirma/to'lov | o'tdi |
| **Yakun: kutilgan 400 000 / to'langan 390 000 / chegirma 10 000 / qarz 0** | to'lovlar sahifasi = qarzdorlar ro'yxati = hisob-faktura = moliya xulosasi = direktor hisoboti = o'quvchi kabineti |
| Ikki marta bosish (o'qituvchidan tashqari har bir forma, ~90 ms oraliq) | bitta yozuv: tugma birinchi bosishda o'chadi; to'lovlar server tomonida ham takrorlanmas kalit bilan himoyalangan |
| Tarmoq xatosida to'lov | "Xatolik yuz berdi", kvitansiya yo'q, jami o'zgarmadi |
| O'quvchi kabineti (telefon + PIN), ota-ona kabineti | o'tdi: jadval, davomat 1/1, "To'langan — Oktabr", to'lovlar tarixi |
| Rol cheklovi UI va serverda: o'qituvchi `/payments`, `/settings` | "Bu bo'lim sizning rolingiz uchun ochiq emas" + server 403 (tuzatishdan keyin) |

### 5.3. Qulaylik (kompyuter va 375 px telefon o'lchami)

| Tekshiruv | Natija |
|---|---|
| 11 sahifada gorizontal siljish (bosh sahifa, o'quvchilar, o'quvchi, guruhlar, guruh, lidlar, lid, o'qituvchilar, hisobotlar, sozlamalar, jadval) | yo'q |
| To'lov formasi telefonda | sig'adi; moliyaviy jadvallar o'z ichida siljiydi |
| Kabinet telefonda | gorizontal siljish yo'q |
| Dialoglarni klaviatura bilan yopish (Escape) | o'tdi (tuzatishdan keyin) |
| Haqiqiy telefon qurilmasida sinov | **yuritilmagan** (faqat brauzerda o'lcham emulyatsiyasi) |

### 5.4. Topilgan nuqsonlar

| # | Nuqson | Ta'sir | Holat |
|---|---|---|---|
| 1 | Chiqishdan (logout) yoki sessiya bekor qilingandan keyin access token 7 kungacha ishlayverardi | xavfsizlik | **tuzatildi**: token sessiyaga bog'landi (`sid`), har so'rovda sessiya tekshiriladi; yangi E2E test (`session-tokens.e2e-spec.ts`) |
| 2 | 1-tuzatishdan kelib chiqqan poyga: markaz manziliga ko'chish paytida yo'ldagi so'rov 401 olib, foydalanuvchini login sahifasiga otardi | kirish | **tuzatildi**, brauzerda qayta tekshirildi |
| 3 | Tizimga kirgan xodim asosiy manzildan kelganda yana login formasini ko'rardi | qulaylik | **tuzatildi**, qayta tekshirildi |
| 4 | Rolga yopiq sahifa manzili to'g'ridan-to'g'ri ochilsa, bo'sh sahifa (0 so'm, "+ Yangi to'lov") ko'rinardi; ma'lumot chiqmasdi (server 403) | chalg'ituvchi | **tuzatildi**: menyu qoidasi sahifaga ham qo'llanadi |
| 5 | O'qituvchiga "+ Yangi guruh", "Tahrirlash", "O'chirilganlar" ko'rinardi (server rad etadi) | chalg'ituvchi | **tuzatildi** |
| 6 | Dialoglar Escape bilan yopilmasdi; `dialog` roli yo'q edi | klaviatura | **tuzatildi** (umumiy `Modal`) |
| 7 | Ko'p tanlovli ro'yxat dialog ichida butun oyna kengligiga yoyilardi | ko'rinish | **tuzatildi** |
| 8 | Ro'yxatdan o'tishda juda qisqa parol xatosi inglizcha xom matn edi | til | **tuzatildi** (o'zbekcha, 8 belgi qoidasi bilan bir xil) |
| 9 | Ilova ichida markazlar orasida almashtirgich yo'q edi (qayta login kerak edi) | noqulay | **tuzatildi**: menyuda "Boshqa markazlarim" — parolsiz o'tadi, eski markaz sessiyasi yopiladi; brauzerda tekshirildi (A → B, rol O'qituvchi) |
| 10 | Forma maydonlari nomi ekran o'quvchisiga yetmasdi; xato xabarlarida `role="alert"` yo'q edi | ekran o'quvchilari | **qisman tuzatildi**: 7 ta umumiy `Field` maydon guruhiga nom berildi, 42 ta xato bloki `alert`; boshqa formalardagi alohida `<label>` lar (≈100) hali bog'lanmagan |
| 11 | Kelajakdagi sinov darsini bugun "Qatnashdi"/"Kelmadi" deb belgilash ogohlantirishsiz edi | mantiq | **tuzatildi**: tasdiq so'raladi ("hali bo'lmagan"); rad etilsa holat o'zgarmaydi — tekshirildi. Server cheklamaydi (oldindan belgilash ba'zan kerak) |
| 12 | Kabinetda chegirma alohida ko'rsatilmasdi | tushunarlilik | **tuzatildi**: "To'landi 390 000 · Chegirma 10 000 · Narx 400 000" — tekshirildi |
| 13 | Lidlar sahifasida texnik matn "(TELEGRAM_BOT_TOKEN)" | matn | **tuzatildi**: oddiy tilda yozildi |
| 14 | O'qituvchi/o'quvchi yaratishda serverda takrorlanishdan himoya yo'q edi | past | **tuzatildi**: bir xil so'rov 10 s ichida bitta yozuv beradi (bir vaqtda kelsa ham); yangi E2E test `double-submit.e2e-spec.ts` |

Brauzer regressiya testlarini avtomatlashtirish **bloklangan**: loyihada brauzer test vositasi yo'q, uni o'rnatish internetdan brauzer yuklab olishni talab qiladi (ruxsat kerak). 1-nuqson uchun server E2E testi qo'shildi; qolgan tuzatishlar shu hisobotdagi qo'lda tekshiruv bilan tasdiqlangan.

## 6. Integratsiyalar

| Integratsiya | Lokal soxta testlar (CI) | Haqiqiy tekshiruv | Kerak bo'lgan narsa |
|---|---|---|---|
| Telegram | bot mantig'i unit/E2E (yuborish soxta) | **yuritilmagan** | alohida staging boti tokeni (`.env` ga o'zingiz yozasiz) va tasdiqlangan sinov chati |
| Click | `billing-gateways.e2e`: to'lov, takroriy callback, noto'g'ri imzo, bekor qilish — soxta so'rovlar | **yuritilmagan** | Click test kabinetidan merchant/service ID va kalit; ochiq HTTPS staging manzili |
| Payme | xuddi shunday | **yuritilmagan** | Payme sandbox merchant ID va kaliti; ochiq HTTPS staging manzili |
| SMS / email | o'chiq | **yuritilmagan** | provayder test kaliti va tasdiqlangan qabul qiluvchi |

Lokal soxta callback'lar provayder isboti emas. Tayyor: `set-telegram-webhook.sh` (boshqa botning webhook'ini almashtirmaydi), `docs/STAGING.md` 3–4-bo'limlardagi tekshiruv ro'yxatlari.

## 7. To'siqlar (ta'siri bo'yicha)

**Pilotni boshlashdan oldin shart:**
1. Lokal o'zgarishlar push qilinmagan → yangi CI ishlari (`ops-scripts`, `recovery`) yurmagan. Konteynerdagi zaxira/tiklash va yangi `db-backup`/`certbot` ta'riflari **birinchi marta CI'da sinaladi**; yiqilsa tuzatish kerak bo'ladi.
2. Server va domen yo'q: HTTPS, nginx, wildcard sertifikat, haqiqiy subdomenlar tekshirilmagan.
3. Zaxiraning serverdan tashqaridagi nusxasi sozlanmagan (manzil va kalit berilmagan).

**Pilotni cheklaydi, to'xtatmaydi:**
4. Telegram, Click, Payme, SMS tekshirilmagan → pilotda o'chiq turadi.
5. Haqiqiy telefonda sinov o'tkazilmagan.
6. Haqiqiy hajmda tiklash vaqti o'lchanmagan.

**Ma'lum kamchiliklar:** 5.4-jadval, 10-band (alohida `<label>` lar).

**Joylashtirishda e'tibor:** 1-tuzatishdan keyin eski (sessiya raqamisiz) access tokenlar rad etiladi — ochiq brauzerlar refresh token orqali o'zi yangi token oladi, foydalanuvchi buni sezmaydi.

## 8. Birinchi markazni ulash ro'yxati

**Sozlamalar**
- [ ] Markaz nomi, telefoni, logotipi; vaqt zonasi (Toshkent) va valyuta to'g'ri.
- [ ] Markaz manzili (`<markaz>.<domen>`) tanlangan — keyin o'zgartirish xodimlarning havolalarini buzadi.

**Xodimlar va rollar**
- [ ] Har bir xodim o'z hisobi bilan taklif qilingan (umumiy parol yo'q); roli: rahbar, administrator, menejer, qabulxona, hisobchi, o'qituvchi.
- [ ] Rahbar biladi: xodimni o'chirish darhol kuchga kiradi (ochiq brauzeri ham yopiladi).

**Guruhlar**
- [ ] Har guruhning oylik narxi, o'qituvchisi, kunlari va boshlanish sanasi kiritilgan.
- [ ] Har o'quvchining guruhga qo'shilgan sanasi haqiqiy sana bilan (qarz shu sanadan hisoblanadi).

**Boshlang'ich qoldiqlar**
- [ ] Tizimga o'tish oyi belgilangan; undan oldingi qarzlar/ortiqcha to'lovlar qanday kiritilishi hisobchi bilan kelishilgan.
- [ ] O'tgan oylar narxi hisobchi tomonidan tasdiqlangan (tasdiqlanmagan o'tgan narx qarz sifatida ko'rsatilmaydi va eslatma yuborilmaydi).

**Mas'uliyat**
- [ ] To'lovni kim kiritadi (hisobchi / qabulxona), chegirmani kim beradi.
- [ ] Davomatni kim va qachon belgilaydi (o'qituvchi, dars kuni).
- [ ] O'quvchi/ota-ona kabineti uchun PIN'ni kim beradi.

**Zaxira va yordam**
- [ ] Tungi zaxira yurmoqda (`db-backup` — `healthy`), tashqi nusxa ko'chirilmoqda; mas'ul shaxs belgilangan.
- [ ] Tiklash mashqi shu serverda bir marta o'tkazilgan (`restore.sh`).
- [ ] Muammo bo'lsa kimga murojaat qilinadi; `RUNBOOK.md` qayerda.

## 9. Lokal o'zgarishlar (commit va push qilinmagan)

| Soha | Fayllar |
|---|---|
| Stack tanlash va staging | `scripts/production/lib.sh`, `stack.sh` (yangi), `scripts/staging/down.sh`, `preflight-staging.sh`, `target.mjs` (yangi), `verify-flows.mjs`, testlar: `tooling.test.sh`, `target.test.mjs` |
| Zaxira va tiklash | `backup-core.sh` (yangi), `backup.sh`, `restore.sh`, `restore-rehearsal.sh` (yangi), `rehearsal-seed.mjs`, `rehearsal-verify.mjs`, `docker-compose.prod.yml` (`db-backup`, `certbot`), testlar: `backup-core.test.sh`, `ops.test.sh` |
| TLS | `init-ssl.sh` |
| CI | `.github/workflows/ci.yml` — `ops-scripts`, `recovery` |
| Backend | `auth.service.ts`, `common/jwt.strategy.ts` (token ↔ sessiya), `auth/dto/register.dto.ts`, `common/double-submit.ts` (yangi), `teachers.service.ts`, `students.service.ts`, `portal.service.ts`, testlar: `session-tokens.e2e-spec.ts`, `double-submit.e2e-spec.ts` (yangi), ikki unit test mock'i |
| Frontend | `lib/api.ts`, `lib/auth-context.tsx`, `lib/i18n.ts`, `app/login/page.tsx`, `app/groups/page.tsx`, `app/leads/[id]/page.tsx`, `components/DashboardShell.tsx`, `Sidebar.tsx` (markaz almashtirgich), `Modal.tsx`, `MultiSelect.tsx`, `portal/PortalTabs.tsx`, 7 ta `Field` va 42 ta xato bloki (bir nechta sahifa) |
| Hujjatlar | `docs/STAGING.md`, `docs/DEPLOYMENT_GUIDE.md`, `RUNBOOK.md`, `.env.*.example`, shu hisobot |

**Shu o'zgarishlar bilan lokal yuritilgan tekshiruvlar:** backend build va lint; unit **245/245**; E2E **189/189** (33 fayl, bir martalik `_e2e` bazada); frontend `tsc` xatosiz, lint 0 xato (106 ogohlantirish), production build muvaffaqiyatli; skript testlari 69 + 10 + 137 + 63.

**Yuritilmagan:** shu o'zgarishlar uchun CI; Docker bilan bog'liq hamma narsa; staging; provayder sandbox'lari.

**Ruxsat kutayotgan amallar:** (1) `dev` ga push; (2) staging/pilot serverini tayyorlash (`bootstrap-server.sh`, `init-ssl.sh`, `stack.sh up -d --build`); (3) staging botiga webhook; (4) tasdiqlangan sinov chatiga xabar; (5) tashqi zaxira manzili.
