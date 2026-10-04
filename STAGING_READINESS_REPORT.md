# TalimCRM — tayyorlik hisoboti

**Sana:** 2026-10-04

| | |
|---|---|
| **Oxirgi tasdiqlangan commit** | `0cc2e531011b1fb11c27afa27be5d59e5adb28f0` (`dev`, push qilingan) |
| **Uning CI'si** | [GitHub Actions 37202235519](https://github.com/zemeisteer/crmApp/actions/runs/37202235519) — 6 ish ham yashil (holat GitHub API orqali olingan; step log'lari login talab qiladi, o'qilmagan) |
| **Off-server tuzatishlari** | `fd60705` + `0cc2e53` (5-bo'lim). CI 37201317408 (`fd60705`) da `ops-scripts` yiqildi: `backup-core.test.sh` da ikki zaxira bir soniyada bir xil nom olardi (Linux tez, Windows'da ko'rinmagan) — `0cc2e53` da tuzatildi. O'sha run'da `browser` ham yiqildi; log o'qilmadi, kodi o'zgarmagan, lokal 6/6 va keyingi run'da o'tdi — beqaror (flaky) deb hisoblanadi, sababi aniqlanmagan |
| **Staging (haqiqiy domen)** | **mavjud emas** — server va domen berilmagan; hech narsa deploy qilinmagan |
| **Haqiqiy tashqi xotira (S3/SFTP)** | **sinalmagan** — manzil va kalit berilmagan; barcha off-server tekshiruvlar lokal papka yoki soxta rclone bilan |
| **Provayder sandbox'lari** | **yuritilmagan** — Telegram, SMS, Click, Payme sinov ma'lumotlari berilmagan |

## 1. Hukm (to'rt bosqich alohida)

| Bosqich | Holat |
|---|---|
| 1. Avtomatik tekshiruvlar bir martalik CI infratuzilmasida o'tdi | **o'tdi** — `0cc2e53`, 37202235519, off-server tuzatishlari va `recovery` dagi buzilgan nusxa qadami bilan |
| 2. Staging'ga chiqarishga tayyor | **tayyor, server va domen kutilmoqda** — buyruqlar ketma-ketligi, preflight, reviziya tekshiruvi, rollback tartibi bor (`docs/STAGING.md`). |
| 3. Staging haqiqiy domenda tasdiqlangan | **bloklangan** — staging yo'q |
| 4. Birinchi pilot markazni qabul qilishga tayyor | **tayyor emas** — 3-bosqich va haqiqiy tashqi xotiradan tiklash yo'q |

1-bosqichning o'tgani 3 va 4-bosqichlarni anglatmaydi: CI'dagi brauzer va tiklash testlari bir martalik lokal konteynerlarda yuradi, haqiqiy domen, sertifikat va tashqi xotira bilan emas.

## 2. Joriy dalillar

| Commit | Run | Ish / ssenariy | Natija | Muhit | Muhim cheklov |
|---|---|---|---|---|---|
| `0cc2e53` | [GitHub Actions 37202235519](https://github.com/zemeisteer/crmApp/actions/runs/37202235519) | backend, frontend, images, browser (6 oqim) | o'tdi | CI | haqiqiy domen va HTTPS emas |
| `0cc2e53` | 37202235519 | ops-scripts (`offsite.test.sh` 74 tekshiruv, `backup-core.test.sh` va b.) | o'tdi | CI, soxta docker va rclone, lokal "masofa" | haqiqiy provayder emas |
| `0cc2e53` | 37202235519 | recovery, yangi qadam bilan: masofadan `uploads.tar.gz` o'chiriladi → `status --check` ≠ 0 va `DAMAGED` → `push` tuzatadi → `verify` o'tadi; keyin yuklab olingan nusxadan tiklash | o'tdi | CI, ikki bir martalik Compose loyihasi | "masofaviy" xotira = lokal papka |
| — | — | haqiqiy domen: HTTPS, wildcard, nginx, `verify-flows.mjs`, staging brauzer testlari | **bloklangan** | — | server va domen yo'q |
| — | — | haqiqiy S3/SFTP: yuborish, yuklab olish, undan tiklash | **bloklangan** | — | manzil va kalit yo'q |

**Tiklash o'lchovlari** (faqat kichik sintetik ma'lumot; production RTO/RPO **belgilanmagan**):

| Manba | Dump (gzip) | Uploads | Zaxira | Tiklash |
|---|---|---|---|---|
| CI 37193868954, `0413557` (konteyner, "masofaviy" nusxadan) | 16 059 bayt | 49 409 bayt | 2 s | ishlayotgan ilovagacha 34 s |
| Lokal simulyatsiya (masofaviy nusxadan, Docker'siz; oldingi bosqich) | 15 685 bayt | 49 406 bayt | 8,3 s | uzatish 3,0 s, yuklab olish 1,4 s, tiklash 9,9 s, ilova ishga tushishi 13,6 s |

## 3. Nima tasdiqlangan (joriy holat)

- **Kirish va markazlar:** login → markaz subdomeni, bir martalik kod, sahifani yangilaganda sessiya saqlanishi, markaz almashtirish, chiqish, ochiq brauzerdagi xodimni o'chirish — CI brauzer testlari va API testlari.
- **Takroriy yuborish:** to'lov, o'quvchi va o'qituvchi yaratish aniq `Idempotency-Key` bilan himoyalangan.
- **Pul:** 400 000 / 390 000 / chegirma 10 000 / qarz 0 misoli barcha hisobotlarda bir xil.
- **Zaxira va tiklash:** zaxira to'plami, yiqilgan zaxira eski to'plamni buzmasligi, yuklab olingan nusxadan alohida baza serveri va uploads volume'iga tiklash, ilova tiklangan nusxada ishlashi — CI `recovery` (7/7).
- **Off-server (lokal simulyatsiya va CI'dagi lokal "masofa"):** masofaviy to'plam faqat nomi, manifesti, `SHA256SUMS` va `COMPLETE` belgisi bir-biriga mos bo'lsa ishlatiladi. Buzilgan, chala yoki o'qib bo'lmaydigan to'plam hech qachon "sog'" deb ko'rsatilmaydi. Eng yangisi buzilganda eng yangi tekshirilgan to'plam "fallback" deb alohida aytiladi. Lokal nusxasi bor buzilgan to'plam xavfsiz tuzatiladi. Faqat shu stack'ning to'plamlari tanlanadi.

## 4. Qolgan to'siqlar (ta'siri bo'yicha)

1. **Staging serveri va domeni** — 3- va 4-bosqichlar shunga bog'liq.
2. **Tashqi xotira** — haqiqiy S3/SFTP bilan hech narsa sinalmagan.
3. **Integratsiyalar** — Telegram, SMS, Click, Payme pilotda o'chiq (cheklangan pilotni to'xtatmaydi; `docs/PILOT_ONBOARDING.md`).
4. **Haqiqiy hajmdagi tiklash vaqti** o'lchanmagan.

## 5. Off-server tuzatishlari (`fd60705`, `0cc2e53`)

**Nuqson 1 — buzilgan masofaviy to'plam "sog'" ko'rinardi.** `push` va `status` faqat `COMPLETE` belgisiga qarardi. Masofadan `uploads.tar.gz` o'chirilsa ham `OFFSITE OK` va `STATUS OK` chiqardi, lokal tasdiq (`.ok`) saqlanib qolardi. Tuzatish:
- Ikki daraja kiritildi: `PRESENT` — metadata tekshiruvi (belgi, manifest va `SHA256SUMS` mos, fayllar joyida va o'z hajmida, ma'lumot o'qilmaydi) va `VERIFIED` — to'liq tarkib tekshiruvi (to'plam yuklab olinib, har bir bayt tekshiriladi).
- `status` eng yangi to'plamni to'liq tekshiradi. U buzilgan bo'lsa, fallback'ni topib ko'rsatadi va 1 bilan tugaydi. Xotirani o'qib bo'lmasa — `UNREADABLE`, hech qachon "OK" emas.
- `verify all` — haftalik to'liq tekshiruv. Har bir masofaviy amalning vaqt chegarasi bor.
- Tekshiruvdan o'tmagan to'plamning tasdig'i bekor qilinadi. Tasdiqlar manzilga (driver + target) bog'langan: manzil o'zgarsa, eski tasdiqlar hisoblanmaydi.
- Tuzatish tartibi: avval faqat shu to'plamning `COMPLETE` belgisi olib tashlanadi, fayllar qayta yuboriladi, yuklab olinib tekshiriladi, belgi eng oxirida yoziladi. Lokal nusxa bo'lmasa — xato va fallback ko'rsatiladi.
- Off-server amal yurayotganda tungi zaxira eski to'plamlarni o'chirmaydi; zaxira yurayotganda `push` boshlanmaydi.

**Nuqson 2 — `fetch latest` boshqa stack'ni tanlardi.** Ro'yxat barcha `COMPLETE` belgilarini olib, alifbo bo'yicha saralanardi, shuning uchun `zzz_production` staging'dan keyin turardi. Tuzatish:
- Faqat `<STACK_NAME>_YYYYMMDDTHHMMSSZ` nomli papkalar olinadi va nomdagi vaqt bo'yicha saralanadi; manifest va belgidagi stack ham tekshiriladi.
- Noto'g'ri nomlar va `../` kabi yo'llar rad etiladi.
- Boshqa stack faqat aniq so'ralsa olinadi: `fetch --from-stack <stack>` va `restore.sh --from-stack <stack>`. So'ralmagan holda `restore.sh` boshqa stack to'plamini rad etadi.
- Mavjud to'plamlar ishlashda davom etadi: haqiqiy `backup-core.sh` manifesti, uploads'siz to'plam ham. Oldingi formatdagi `COMPLETE` belgisi faqat to'liq tarkib tekshiruvidan keyin qabul qilinadi va yangi formatga almashtiriladi.

**Fayllar:** `offsite.sh`, `offsite.test.sh`, `backup-core.sh`, `backup-core.test.sh`, `restore.sh`, `restore-rehearsal.sh`, `docker-compose.prod.yml` (`BACKUP_OFFSITE_DRIVER/TARGET`), `docs/DEPLOYMENT_GUIDE.md`, `RUNBOOK.md`, shu hisobot.

## 6. Kerakli ma'lumotlar

| Nima | Qayerga |
|---|---|
| Staging serveri (Ubuntu 22.04/24.04, 2 vCPU, 4 GB RAM, 40+ GB) va SSH kirish | SSH kalit orqali; parol chatga yozilmaydi |
| Domen va DNS: `staging.<domen>`, `*.staging.<domen>` → server IP | DNS panel; wildcard sertifikat uchun Cloudflare token — serverdagi `.env` (`CLOUDFLARE_API_TOKEN`) |
| `LETSENCRYPT_EMAIL` | serverdagi `.env` |
| Tashqi xotira (S3-mos bucket yoki SFTP) va kirish kaliti; `COMPLETE` faylini o'chirish ruxsati | serverdagi `rclone.conf` (`sudo rclone config`); `.env` da faqat `OFFSITE_DRIVER=rclone`, `OFFSITE_TARGET=<remote>:<bucket>/<yo'l>`; shifrlash kaliti egasida |
| (Ixtiyoriy) staging Telegram boti va ruxsat etilgan sinov chati; Click/Payme test merchant | serverdagi `.env` |

## 7. Tarix (joriy holat emas)

- `fd60705` (CI 37201317408): `ops-scripts` (test nomlari bir soniyada to'qnashdi) va `browser` (flaky) yiqildi; `0cc2e53` da hammasi yashil.
- `0413557` (CI 37193868954): off-server nusxa, reviziya belgisi, staging brauzer rejimi qo'shildi — keyin `offsite.sh` da 5-bo'limdagi ikki nuqson topildi.
- `4828f4d` (CI 37116211070): `recovery` 1/7-qadamda yiqilgan — certbot tekshiruvi "certbot" so'zini kutardi. `7d74229` da tuzatilgan; CI 37122037051 da `recovery` o'tdi, `backend` test faylidagi tip xatosi tufayli yiqildi; `5e13f82`, `ba2939a` to'liq yashil.
- O'quvchi/o'qituvchi yaratishdagi 10 soniyalik "o'xshash yozuv" qoidasi `7d74229` da aniq `Idempotency-Key` bilan almashtirilgan (migratsiya 0034).
- Brauzer testlari dastlab qo'lda bajarilgan; `7d74229` dan beri Playwright bilan avtomatik va CI'da yuradi.
- Avvalgi lokal sinovlarda topilib tuzatilgan nuqsonlar: chiqishdan keyin access token ishlab turishi, rolga yopiq sahifalar, dialog Escape, markaz almashtirgich yo'qligi, kabinetda chegirma ko'rinmasligi va boshqalar.
