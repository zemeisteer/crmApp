# TalimCRM — Staging va pilot tayyorligi hisoboti

- **Oxirgi tekshirilgan commit:** `4828f4d7df68d01cbfd5d5d92f64d5468fdf58c8` (`dev`, push qilingan).
- **Shu commit uchun CI:** GitHub Actions `37116211070` — natijalar foydalanuvchi tomonidan tekshirilgan (log'larni o'qish uchun GitHub autentifikatsiyasi kerak; bu yerdan faqat ishlar ro'yxati va holati ko'rindi):
  - backend: 245 unit, 189 E2E — **o'tdi**; frontend tekshiruvlari — **o'tdi**; `ops-scripts` — **o'tdi**; production image smoke test — **SMOKE OK**;
  - `recovery` — **YIQILDI** 1/7-qadamda ("unexpected certbot output"). Zaxira olish va tiklash qadamlariga yetib bormagan: **konteynerda tiklash tasdiqlanmagan**.
- **Shu hisobotning yangi ishi:** `4828f4d` ustidagi **lokal, commit qilinmagan** o'zgarishlar (10-bo'lim). Ular uchun CI **yurmagan** (push qilinmagan). Lokal natijalar `4828f4d` ga emas, shu ishchi daraxtga tegishli.
- **Sana:** 2026-10-03.

| Belgi | Ma'nosi |
|---|---|
| **CI 4828f4d** | `37116211070` natijasi (yangi lokal o'zgarishlarni qamramaydi) |
| **Lokal** | shu kompyuterda (Windows 11, Docker yo'q), bir martalik bazalarda: skript, API va brauzer testlari |
| **Staging** | haqiqiy staging domeni va HTTPS — **mavjud emas, birorta tekshiruv yuritilmagan** |
| **Sandbox** | provayderning rasmiy test muhiti (Telegram, Click, Payme) — **yuritilmagan** |

## 1. Xulosa

**Hukm: pilotga tayyorgarlik davom etmoqda.**

- Konteynerda zaxira → tiklash mashqi (`recovery`) hali **bir marta ham to'liq o'tmagan**: CI'da 1-qadamda yiqilgan, tuzatish lokal, Docker'siz yurgizib bo'lmadi (10.1).
- O'quvchi/o'qituvchi yaratishdagi takroriy yuborish himoyasi qayta yozildi va lokal testlardan o'tdi (10.2), lekin CI'da hali tekshirilmagan.

Cheklangan pilot uchun shartlar: (1) push qilib, `recovery` ishi 7/7 qadam bilan yashil bo'lishi; (2) haqiqiy staging/pilot domenida HTTPS tekshiruvi; (3) zaxiraning serverdan tashqaridagi nusxasi sozlanib, undan tiklash sinalishi; (4) Telegram, SMS, Click, Payme o'chiq turadi (sandbox'da sinalmagan); (5) brauzer testlari faqat lokal infratuzilmada yurgan, haqiqiy domenda emas.

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
| **Konteynerda to'liq mashq** (`restore-rehearsal.sh`): production compose, alohida baza serveri va alohida fayl volume'i, TLS/nginx tekshiruvi | CI 4828f4d | **YIQILDI** 1/7-qadamda (certbot matn tekshiruvi noto'g'ri edi; 10.1). Keyingi qadamlar yurmagan |
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
1. Konteynerda zaxira/tiklash mashqi CI'da 1/7-qadamda yiqilgan (`4828f4d`); tuzatish (10.1) lokal va push qilinmagan, Docker'siz yurgizilmagan. 7/7 qadam yashil bo'lmaguncha tiklash tasdiqlanmagan.
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

## 9. `4828f4d` ga kirgan o'zgarishlar (avval lokal bo'lgan)

| Soha | Fayllar |
|---|---|
| Stack tanlash va staging | `scripts/production/lib.sh`, `stack.sh` (yangi), `scripts/staging/down.sh`, `preflight-staging.sh`, `target.mjs` (yangi), `verify-flows.mjs`, testlar: `tooling.test.sh`, `target.test.mjs` |
| Zaxira va tiklash | `backup-core.sh` (yangi), `backup.sh`, `restore.sh`, `restore-rehearsal.sh` (yangi), `rehearsal-seed.mjs`, `rehearsal-verify.mjs`, `docker-compose.prod.yml` (`db-backup`, `certbot`), testlar: `backup-core.test.sh`, `ops.test.sh` |
| TLS | `init-ssl.sh` |
| CI | `.github/workflows/ci.yml` — `ops-scripts`, `recovery` |
| Backend | `auth.service.ts`, `common/jwt.strategy.ts` (token ↔ sessiya), `auth/dto/register.dto.ts`, `common/double-submit.ts` (yangi), `teachers.service.ts`, `students.service.ts`, `portal.service.ts`, testlar: `session-tokens.e2e-spec.ts`, `double-submit.e2e-spec.ts` (yangi), ikki unit test mock'i |
| Frontend | `lib/api.ts`, `lib/auth-context.tsx`, `lib/i18n.ts`, `app/login/page.tsx`, `app/groups/page.tsx`, `app/leads/[id]/page.tsx`, `components/DashboardShell.tsx`, `Sidebar.tsx` (markaz almashtirgich), `Modal.tsx`, `MultiSelect.tsx`, `portal/PortalTabs.tsx`, 7 ta `Field` va 42 ta xato bloki (bir nechta sahifa) |
| Hujjatlar | `docs/STAGING.md`, `docs/DEPLOYMENT_GUIDE.md`, `RUNBOOK.md`, `.env.*.example`, shu hisobot |

**O'shanda lokal yuritilgan tekshiruvlar** (keyin CI `37116211070` da tasdiqlandi, `recovery` dan tashqari): backend build va lint; unit **245/245**; E2E **189/189** (33 fayl, bir martalik `_e2e` bazada); frontend `tsc` xatosiz, lint 0 xato (106 ogohlantirish), production build muvaffaqiyatli; skript testlari 69 + 10 + 137 + 63.

**Yuritilmagan:** konteynerda tiklash (CI'da yiqildi); staging; provayder sandbox'lari.

**Ruxsat kutayotgan amallar:** (1) 10-bo'lim o'zgarishlarini `dev` ga push; (2) staging/pilot serverini tayyorlash (`bootstrap-server.sh`, `init-ssl.sh`, `stack.sh up -d --build`); (3) staging botiga webhook; (4) tasdiqlangan sinov chatiga xabar; (5) tashqi zaxira manzili.

## 10. `4828f4d` dan keyingi ish (lokal, commit qilinmagan)

### 10.1. Konteynerda tiklash mashqi (`restore-rehearsal.sh`)

**Ildiz sababi.** 1-qadam `certbot certificates` chiqishida "certbot" so'zini qidirardi. Certbot sertifikat yozuvi bo'lmaganda faqat "Saving debug log to /var/log/letsencrypt/letsencrypt.log" va "No certificates found." deb yozadi — "certbot" so'zi yo'q. Mashqdagi sertifikat esa certbot chiqarmagan, volume'ga nusxalangan o'z-o'zidan imzolangan sertifikat; certbot'da uning yozuvi bo'lmaydi. Buyruq muvaffaqiyatli bo'lgan, tekshiruv noto'g'ri edi. (Bu Certbot'ning chiqish matniga asoslangan tahlil: CI log'i bu yerdan o'qilmadi — GitHub autentifikatsiyasi yo'q, Docker ham yo'q, shuning uchun image bilan qayta takrorlanmadi.)

**Tuzatish.**
- `certbot --version` → oxirgi qator `certbot X.Y` bo'lishi shart (renewal sikli yoki shell javob bersa yiqiladi); image nomi va digest chiqariladi.
- `certbot certificates` → muvaffaqiyatli tugashi va "No certificates found" deyishi shart (nusxalangan sertifikatda certbot yozuvi bo'lmasligi kutiladi).
- Har ikki buyruq va `up --wait` vaqt bilan cheklangan (180 s / 600 s), CI ishi 45 daqiqa.
- Har yurish o'z nomlarida (`talimcrm_rehearsal_<run>_src/_dst`, bazalar ham) va bo'sh portlarda; tozalash faqat shu yurishning loyihalarini o'chiradi.
- Xatoda: qadam nomi, buyruqning chiqish kodi, yurmagan tekshiruvlar ro'yxati, konteyner holati va log'lar — shu yurishning sirlari va sintetik parol `<redacted>` bilan almashtirilgan. CI'da shu matn artifact sifatida saqlanadi (env fayl, dump, token yo'q).

**Tekshirildi (Lokal):** `rehearsal.test.sh` — soxta `docker` bilan 17/17: haqiqiy certbot javoblari qabul qilinadi, renewal sikli va shell aniqlanadi, xato hisobotida sir yo'q, yurmagan qadamlar sanaladi. `bash -n` toza. CI `ops-scripts` ishiga qo'shildi.

**Tekshirilmadi:** 7 qadamning birortasi haqiqiy konteynerlarda yurmadi (Docker yo'q). Keyingi qadamlar kod bo'yicha ko'rib chiqildi (healthcheck kutishi, alohida baza serveri va uploads volume, restore nomi, uploads arxiv tuzilishi), lekin yurmagani uchun ular ham **tasdiqlanmagan**. Zaxira hajmi va vaqtlari bu bosqichda o'lchanmadi; avvalgi Docker'siz o'lchovlar (4-bo'lim) production RTO/RPO emas.

### 10.2. O'quvchi va o'qituvchi yaratish: aniq idempotentlik kaliti

**Muammo.** 10 soniyalik "o'xshash yozuv" qoidasi guruhlar, filial, tug'ilgan sana va boshqa maydonlarni solishtirmasdi va ikkinchi so'rovning guruhlarini jimgina tashlab yuborardi; o'qituvchida qulf kaliti email bilan, qidiruv esa emailsiz edi; bo'sh telefon `""` saqlanib, `IS NULL` qidiruvi uni topmasdi.

**Yechim** (to'lovlardagi usul): forma `Idempotency-Key` sarlavhasini yuboradi; kalit va normallashtirilgan so'rov xeshi yaratilgan yozuvning o'zida saqlanadi (`students`/`teachers`, markaz bo'yicha noyob indeks).
- bir xil kalit + bir xil so'rov → birinchi yozuv qaytadi; guruhga yozish, audit va webhook qayta bajarilmaydi;
- bir xil kalit + boshqa so'rov → **409**;
- yangi kalit → yangi yozuv (bir xil ism yoki telefon birlashtirilmaydi — bu biznes qoidasi emas);
- kalitsiz so'rov (eski mijozlar, skriptlar) → oddiy yaratish;
- kalit transaksiya ichida qulflanadi; transaksiya yiqilsa kalit ham saqlanmaydi;
- normallashtirish: satrlar `trim`; bo'sh satr, `null` va yo'q maydon bir xil; guruhlar to'plam sifatida (tartib va takror ahamiyatsiz); saqlashda bo'sh telefon/email `null`.
- Frontend: kalit forma mazmuni o'zgarmaguncha bir xil (ikki marta bosish, javob yo'qolgandan keyingi qayta yuborish), muvaffaqiyatdan yoki forma tozalangandan keyin yangilanadi.

**Migratsiya:** `0034_create_idempotency.sql` — `students` va `teachers` ga ikki ustun va noyob indeks (`IF NOT EXISTS`, qayta qo'llansa xatosiz). Tekshirildi: yangi baza; 0033 dagi mavjud yozuvli bazani yangilash (eski qatorlar o'zgarmadi, qayta yurish "up to date"); `db:verify-migrations` 49/49; `drizzle-kit generate` — o'zgarish yo'q; drift yo'q. Lokal dev bazaga ham qo'llandi (faqat qo'shimcha).

**Testlar (Lokal):** `double-submit.e2e-spec.ts` 9/9 — bir kalit bilan bir vaqtdagi o'quvchi va o'qituvchi so'rovlari (bitta yozuv, bitta guruh yozuvi, bitta audit, bitta webhook); guruh, filial, tug'ilgan sana, ota-ona telefoni, izoh, email, fan, maosh o'zgarsa 409; normallashtirish; yangi kalit = yangi yozuv; markazlar va operatsiyalar bo'yicha ajratish; javob yo'qolgandan keyingi qayta yuborish; yiqilgan transaksiyadan keyin qayta yuborish; noto'g'ri kalit 400. Normallashtirish unit testi 6/6.

### 10.3. Avtomatik brauzer testlari (`e2e-browser/`, Playwright 1.63)

Backend va frontendning **production build**'lari (`node dist/main.js`, `next start`), bir martalik `_browser_e2e` baza; backend faqat `http://*.localhost` CORS qoidalari uchun `NODE_ENV=development`. Tashqi xizmatlar o'chiq. Lokal: o'rnatilgan Chrome (`PW_CHANNEL=chrome`); CI: yuklab olinadigan Chromium.

| Oqim | Natija (Lokal) |
|---|---|
| Asosiy saytda login → markaz subdomeni → yangilash; asosiy saytda sessiya qolmaydi | o'tdi |
| Ikki markaz, ikki rol, menyudan almashtirish; o'qituvchiga to'lovlar yopiq | o'tdi |
| Chiqish → himoyalangan sahifa rad etiladi, tokenlar o'chgan | o'tdi |
| Brauzer ochiq turganda xodim o'chiriladi → keyingi so'rov login'ga | o'tdi |
| To'lov: ikki marta bosish va javob yo'qolgandan keyin qayta yuborish → 2 ta to'lov (150 000 va 100 000), ortig'i yo'q | o'tdi |
| Yangi o'quvchi: javob yo'qolgandan keyin qayta yuborish → bitta o'quvchi, telefon saqlangan | o'tdi |

6/6, ~4,5 daqiqa (asosan backend ishga tushishi). CI'ga `browser` ishi qo'shildi (30 daqiqa chegarasi, xatoda faqat skrinshotlar; trace yozilmaydi — u tokenlarni saqlaydi). **CI'da hali yurmagan.** Bular haqiqiy staging domenida emas.

### 10.4. Shu ishchi daraxtda yuritilgan tekshiruvlar

- Backend: unit 245/245 + 6/6 (yangi), lint xatosiz, `tsc` xatosiz, build; E2E **196/196** (33 fayl).
- Migratsiyalar: `--check`, `db:verify-migrations` 49/49, yangilash sinovi, drift yo'q, `drizzle-kit generate` bo'sh.
- Frontend: `tsc` xatosiz, lint 0 xato, brauzer testlari uchun production build.
- Skriptlar: `rehearsal.test.sh` 17/17, `tooling.test.sh`, `backup-core.test.sh` — o'tdi.
- Brauzer: 6/6.

**Yuritilmagan:** `restore-rehearsal.sh` (Docker yo'q); yangi CI ishlari (push qilinmagan); staging; sandbox.
