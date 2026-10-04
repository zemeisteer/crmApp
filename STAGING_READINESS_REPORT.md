# TalimCRM — tayyorlik hisoboti

**Sana:** 2026-10-04

| | |
|---|---|
| **Oxirgi tasdiqlangan commit** | `ba2939ad1303af9e5ef99ed0606f79d9ce0d917d` (`dev`) |
| **Uning CI'si** | [GitHub Actions 37122610214](https://github.com/zemeisteer/crmApp/actions/runs/37122610214) — 6 ish ham yashil; log'lari foydalanuvchi tomonidan o'qilgan |
| **Keyingi commit** | `0413557` (off-server nusxa, reviziya belgisi, staging brauzer rejimi, hujjatlar) — [CI 37193868954](https://github.com/zemeisteer/crmApp/actions/runs/37193868954): 6 ish ham **o'tdi**, jumladan `recovery` (tiklash endi off-server nusxadan). Natija ishlar holatidan o'qildi; log'lar (o'lchovlar) GitHub autentifikatsiyasisiz o'qilmadi |
| **Staging (haqiqiy domen)** | **mavjud emas** — server va domen berilmagan; hech narsa deploy qilinmagan |
| **Provayder sandbox'lari** | **yuritilmagan** — Telegram, SMS, Click, Payme sinov ma'lumotlari berilmagan |

## 1. Hukm (to'rt bosqich alohida)

| Bosqich | Holat |
|---|---|
| 1. Avtomatik tekshiruvlar bir martalik CI infratuzilmasida o'tdi | **o'tdi** — `ba2939a`, 37122610214 |
| 2. Staging'ga chiqarishga tayyor | **tayyor, server va domen kutilmoqda** — buyruqlar ketma-ketligi, preflight, reviziya tekshiruvi, rollback tartibi bor (`docs/STAGING.md`); `0413557` CI'dan o'tgan |
| 3. Staging haqiqiy domenda tasdiqlangan | **o'tmagan (bloklangan)** — staging yo'q |
| 4. Birinchi pilot markazni qabul qilishga tayyor | **tayyor emas** — 3-bosqich va off-server nusxa haqiqiy xotirada sinalmagan |

1-bosqichning o'tgani 3 va 4-bosqichlarni anglatmaydi: CI'dagi brauzer va tiklash testlari bir martalik lokal konteynerlarda yuradi, haqiqiy domen, sertifikat va tashqi xotira bilan emas.

## 2. Joriy dalillar

| Commit | Run | Ish / ssenariy | Natija | Muhit | Muhim cheklov |
|---|---|---|---|---|---|
| `ba2939a` | [37122610214](https://github.com/zemeisteer/crmApp/actions/runs/37122610214) | backend | o'tdi: 251 unit, 196 E2E, migratsiya tekshiruvlari | CI, bir martalik PostgreSQL 16 | — |
| `ba2939a` | 37122610214 | frontend | o'tdi | CI | — |
| `ba2939a` | 37122610214 | ops-scripts | o'tdi | CI, soxta docker | skript mantig'i, haqiqiy konteyner emas |
| `ba2939a` | 37122610214 | images | o'tdi: 35/35 migratsiya API'dan oldin, SMOKE OK | CI, Docker | — |
| `ba2939a` | 37122610214 | browser (6 oqim) | o'tdi | CI, lokal production build'lar, `*.localhost` | haqiqiy domen va HTTPS emas |
| `ba2939a` | 37122610214 | recovery (7/7 qadam) | o'tdi, REHEARSAL OK | CI, ikki bir martalik Compose loyihasi, o'z-o'zidan imzolangan sertifikat | sintetik kichik ma'lumot; tiklash lokal to'plamdan |
| ishchi daraxt (`0413557` dan oldin) | — | `offsite.test.sh` | o'tdi 33/33 | lokal simulyatsiya (papka va soxta rclone) | haqiqiy provayder emas |
| ishchi daraxt (`0413557` dan oldin) | — | masofaviy nusxadan tiklash mashqi | o'tdi | lokal simulyatsiya: haqiqiy PostgreSQL 18, backend build, "masofa" = lokal papka | Docker'siz; tashqi xotira emas |
| ishchi daraxt (`0413557` dan oldin) | — | backend unit (251), lint, `tsc` | o'tdi | lokal | `/api/health` o'zgarishi bilan |
| ishchi daraxt (`0413557` dan oldin) | — | `ops.test.sh` (+ `release-info.sh`), `backup-core.test.sh`, `tooling.test.sh`, `rehearsal.test.sh`, `smoke-lib.test.sh`, `target.test.mjs` | o'tdi | lokal, soxta docker | — |
| ishchi daraxt (`0413557` dan oldin) | — | brauzer, 6 oqim (lokal rejim) | o'tdi 6/6 | lokal Chrome, production build'lar | — |
| ishchi daraxt (`0413557` dan oldin) | — | brauzer, staging rejimi | **yuritilmagan** | — | staging yo'q; noto'g'ri manzillarni rad etishi sinalgan |
| `0413557` | [37193868954](https://github.com/zemeisteer/crmApp/actions/runs/37193868954) | backend, frontend, ops-scripts (offsite.test.sh bilan), images (reviziya label'lari), browser, recovery (off-server nusxadan tiklash) | o'tdi (6/6) | CI | "masofaviy" xotira = lokal papka |
| — | — | haqiqiy domen: HTTPS, wildcard, nginx, `verify-flows.mjs` | **bloklangan** | — | server va domen yo'q |
| — | — | off-server: haqiqiy xotiraga yuborish va undan tiklash | **bloklangan** | — | manzil va kalit yo'q |

**Tiklash o'lchovlari** (faqat kichik sintetik ma'lumot; production RTO/RPO **belgilanmagan**):

| Manba | Dump (gzip) | Uploads | Zaxira | Tiklash |
|---|---|---|---|---|
| CI 37122610214 (konteyner) | 16 049 bayt | 49 406 bayt | 2 s | bo'sh serverdan ishlayotgan ilovagacha 32 s (dump yuklash 1 s) |
| Lokal simulyatsiya (masofaviy nusxadan) | 15 685 bayt | 49 406 bayt | 8,3 s (o'z tiklash tekshiruvi bilan) | uzatish 3,0 s, yuklab olish 1,4 s, tiklash 9,9 s, ilova ishga tushishi 13,6 s |

## 3. Nima tasdiqlangan (joriy holat)

- **Kirish va markazlar:** login → markaz subdomeni, bir martalik kod, sahifani yangilaganda sessiya saqlanishi, markaz almashtirish, chiqish, ochiq brauzerdagi xodimni o'chirish — CI brauzer testlari va API testlari.
- **Takroriy yuborish:** to'lov, o'quvchi va o'qituvchi yaratish aniq `Idempotency-Key` bilan himoyalangan: bir xil kalit va bir xil ma'lumot birinchi natijani qaytaradi, kalit boshqa ma'lumot bilan kelsa 409, yangi kalit yangi yozuv.
- **Pul:** 400 000 / 390 000 / chegirma 10 000 / qarz 0 misoli to'lovlar sahifasi, qarzdorlar ro'yxati, moliya xulosasi, direktor hisoboti va kabinetda bir xil.
- **Zaxira va tiklash:** zaxira to'plami (baza, uploads, manifest, checksum'lar), yiqilgan zaxira eski to'plamni buzmasligi, alohida baza serveri va uploads volume'iga tiklash, ilova tiklangan nusxada ishlashi — CI `recovery` (7/7).
- **Off-server (lokal simulyatsiya):** faqat tugallangan to'plamlar yuboriladi; `COMPLETE` belgisi bayt-ma-bayt solishtirishdan keyin yoziladi; uzatish yiqilganda lokal to'plamlar qoladi va qayta yuborish xavfsiz; masofadan hech narsa o'chirilmaydi; yuklab olingan nusxa tekshiriladi; server yo'qolganda masofaviy nusxadan tiklangan ilova ishladi va fayl yuklab olingan arxivdan berildi.

## 4. Qolgan to'siqlar (ta'siri bo'yicha)

1. **Staging serveri va domeni** — 3- va 4-bosqichlar shunga bog'liq.
2. **Off-server xotira** — server yo'qolganda tiklash imkoni.
3. **Integratsiyalar** — Telegram, SMS, Click, Payme pilotda o'chiq (cheklangan pilotni to'xtatmaydi; `docs/PILOT_ONBOARDING.md`).
4. **Haqiqiy hajmdagi tiklash vaqti** o'lchanmagan.

## 5. `0413557` da kiritilgan o'zgarishlar

| Soha | Nima |
|---|---|
| Reviziya | `APP_REVISION` image'larga yoziladi (backend `ENV` va label, frontend label'lari: commit, ildiz domen, API manzili); `/api/health` `revision` qaytaradi; `lib.sh` o'zgarishli checkout'ni `-dirty` deb belgilaydi; `release-info.sh` checkout, image, ishlayotgan API, frontend build domeni va migratsiyalarni solishtiradi |
| Staging preflight | FRONTEND_URL va DOMAIN mosligi, `/api`, off-server sozlamasi, toza checkout |
| Off-server | `offsite.sh` (push, status, fetch; rclone yoki papka); `backup-core.sh` tashqariga ko'chirilmagan to'plamni tozalamaydi; `restore.sh` oxirgi tiklash tekshiruvini qayd etadi; `.env` shablonlari; `offsite.test.sh`; CI `recovery` endi masofaviy nusxadan tiklaydi |
| Brauzer testlari | `playwright.staging.config.ts`: faqat tasdiqlangan, test ko'rinishidagi HTTPS domen; bazaga tegmaydi; `zzbr-` markazlar yaratadi va o'zinikini o'chiradi |
| Hujjatlar | `docs/STAGING.md` (chiqarish ketma-ketligi, diagnostika, rollback), `docs/DEPLOYMENT_GUIDE.md` (off-server, yangilash), `RUNBOOK.md`, `docs/PILOT_ONBOARDING.md`, shu hisobot |

## 6. Kerakli ma'lumotlar

| Nima | Qayerga |
|---|---|
| Staging serveri (Ubuntu 22.04/24.04, 2 vCPU, 4 GB RAM, 40+ GB) va SSH kirish | SSH kalit orqali; parol chatga yozilmaydi |
| Domen va DNS: `staging.<domen>`, `*.staging.<domen>` → server IP | DNS panel; wildcard sertifikat uchun Cloudflare token — serverdagi `.env` (`CLOUDFLARE_API_TOKEN`) |
| `LETSENCRYPT_EMAIL` | serverdagi `.env` |
| Off-server xotira (S3-mos bucket yoki SFTP) va kirish kaliti | serverdagi `rclone.conf` (`sudo rclone config`); `.env` da faqat `OFFSITE_DRIVER=rclone`, `OFFSITE_TARGET=<remote>:<bucket>/<yo'l>`; shifrlash kaliti egasida |
| (Ixtiyoriy) staging Telegram boti va ruxsat etilgan sinov chati; Click/Payme test merchant | serverdagi `.env` |

## 7. Tarix (joriy holat emas)

- `4828f4d` (CI 37116211070): `recovery` 1/7-qadamda yiqilgan — certbot tekshiruvi "certbot" so'zini kutardi, sertifikat yozuvi yo'q bo'lganda certbot uni yozmaydi. `7d74229` da tuzatilgan; CI 37122037051 da `recovery` o'tdi, `backend` test faylidagi tip xatosi tufayli yiqildi; `5e13f82` (CI 37122276297) va `ba2939a` (CI 37122610214) to'liq yashil.
- O'quvchi/o'qituvchi yaratishdagi 10 soniyalik "o'xshash yozuv" qoidasi `7d74229` da aniq `Idempotency-Key` bilan almashtirilgan (migratsiya 0034).
- Brauzer testlari dastlab qo'lda bajarilgan; `7d74229` dan beri Playwright bilan avtomatik va CI'da yuradi.
- Avvalgi lokal sinovlarda topilib tuzatilgan nuqsonlar: chiqishdan keyin access token ishlab turishi, rolga yopiq sahifalar, dialog Escape, markaz almashtirgich yo'qligi, kabinetda chegirma ko'rinmasligi va boshqalar (`7d74229` gacha bo'lgan commitlar).
