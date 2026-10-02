# TalimCRM — Staging tayyorligi hisoboti

- **Tekshirilgan commit:** `fa98eff99727df6636e26f2d181797eeedc3ab25` (`dev`) + shu bosqichning lokal o'zgarishlari (commit va push qilinmagan).
- **Asos:** GitHub Actions `36862631040` — uchala ish o'tgan (backend 245 unit / 186 E2E / migratsiya; frontend; Docker smoke `SMOKE OK`, 34/34 migratsiya API'dan oldin).
- **Sana:** 2026-10-01.

## 1. Qisqacha

**Staging muhiti mavjud emas** — server, domen va integratsiya ma'lumotlari berilmagan, hech qayerga deploy qilinmagan. Bu bosqichda:

- staging uchun barcha konfiguratsiya, himoya skriptlari va tekshiruv vositalari **tayyorlandi**;
- ular **lokal simulyatsiyada** sinovdan o'tkazildi (production build + bir martalik PostgreSQL bazasi, sintetik ma'lumot);
- haqiqiy domen, HTTPS, nginx, Telegram va Click/Payme tekshiruvlari **bloklangan** — 6-bo'limdagi ma'lumotlar kerak.

## 2. Ishlatilgan muhit

| | |
|---|---|
| Mashina | lokal ishlab chiqish kompyuteri (Windows 11), Docker **yo'q** |
| Ilova | backend production build (`node dist/main.js`, `NODE_ENV=production`), `ROOT_DOMAIN=staging.localhost` |
| Baza | PostgreSQL 18.3, bir martalik `talimcrm_stagingsim` (yaratildi → ishlatildi → o'chirildi) |
| Integratsiyalar | AI, Telegram, SMS, email, Click, Payme — hammasi bo'sh; eslatmalar o'chiq |
| Ma'lumot | faqat sintetik (`ZZ Staging Check …` markazlari) |
| Tegilmagan | ishlab chiqish bazasi (`talimcrm`) va boshqa bazalar; hech qanday server |

Bu **staging emas**: nginx, HTTPS, wildcard sertifikat, haqiqiy subdomen marshrutlash va konteynerlar bu yerda qatnashmagan.

## 3. O'tgan tekshiruvlar va dalillar

### 3.1. Domen, markaz va pilot yo'li — API orqali (lokal simulyatsiya)

`node scripts/staging/verify-flows.mjs` → **21 o'tdi, 0 yiqildi, 1 yuritilmadi (HTTPS)**; login limiti uchun 60 s kutildi.

| Tekshiruv | Natija |
|---|---|
| Xodim logini o'z markaziga tushadi, refresh token bilan | o'tdi |
| Handoff: bir martalik kod, o'z sessiyasi, takror rad etiladi | o'tdi |
| Refresh markaz va rolni saqlaydi | o'tdi |
| Bir kishi, ikki markaz: A da MANAGER, B da TEACHER; B da to'lovlarga 403 | o'tdi |
| A'zo bo'lmagan markazni tanlash → 401; boshqa markaz ma'lumoti ko'rinmaydi | o'tdi |
| A dan o'chirish: eski token, `/me`, refresh, A ni tanlash, oldin olingan handoff kodi → 401 | o'tdi |
| O'sha odam uchun B ishlashda davom etadi | o'tdi |
| Yagona markazli xodim: o'chirilgach hech qanday yo'l yo'q; qayta qo'shilgach kiradi | o'tdi |
| CORS: `https://<root>` va `https://<markaz>.<root>` ruxsat etilgan | o'tdi |
| CORS: begona domen, o'xshash domen, ikki darajali subdomen, `http://` → rad | o'tdi |
| Tokensiz / buzuq token → 401 | o'tdi |
| Taklifnoma → xodim logini; lid → sinov darsi → qabul → hisob-faktura → davomat | o'tdi |
| Rol: qabulxona to'lov ololmaydi (403); hisobchi oladi; takror kalit bitta to'lov; boshqa mazmun 409; ortiqcha to'lov 400 | o'tdi |
| Balans bir xil: qarzdorlar ro'yxati = moliya xulosasi = direktor hisoboti = o'quvchi va ota-ona kabineti (400 000 / 390 000 / chegirma 10 000 / qarz 0) | o'tdi |
| O'quvchi va ota-ona kabineti ishlaydi; ularning tokeni boshqaruv paneliga 403 | o'tdi |
| O'tgan oy uchun qarz to'qilmaydi; narxni tasdiqlash: MANAGER 403, hisobchi yozadi, joriy oy hisob-fakturasi o'zgarmaydi | o'tdi |
| Xato xabarlari tushunarli (noto'g'ri oy → 400 izoh bilan; yo'q hisob-faktura → 404) | o'tdi |

Tekshiruv davomida skriptning o'zidagi bitta noto'g'ri kutish tuzatildi (production'da faqat `https` origin ruxsat etiladi — server to'g'ri ishlagan). Ilova kodida xato topilmadi.

### 3.2. Zaxira va tiklash (sintetik ma'lumot, lokal)

| Qadam | Natija |
|---|---|
| `backup.sh`: baza dump'i | 24 KB, 1 s |
| `backup.sh`: yuklangan fayllar arxivi | yaratildi, ichida sinov fayli bor |
| `restore.sh` (mashq): yangi alohida bazaga yuklash | **2 s**, xatosiz |
| Migratsiyalar | 34/34 qayd etilgan, kutilayotgan 0, noma'lum 0 |
| Qatorlar (tiklangan / manba) | markazlar 4/4, foydalanuvchilar 12/12, a'zoliklar 14/14, o'quvchilar 2/2, a'zoliklar (guruh) 2/2, davomat 2/2, hisob-fakturalar 2/2, to'lovlar 4/4, taqsimotlar 4/4 |
| Pul mosligi (6 tekshiruv) | hammasi toza |
| Mashqdan keyin vaqtinchalik baza | o'chirildi; manba bazaga tegilmadi |
| `--keep` bilan tiklangan nusxada ilova | ishga tushdi; `db:migrate` "up to date"; `db:check-drift` toza |
| Tiklangan nusxada login va balanslar | manba bilan **aynan bir xil** (login, rol, o'quvchilar, to'lovlar, taqsimotlar, xodimlar, kutilgan/to'langan/qarz, tushum) |
| Buzuq zaxira (gzip emas / SQL xatosi) | rad etildi, yarim baza qolmadi |
| To'liq mashq vaqti | **~10 s** |

**Cheklovlar (o'lchanmagan narsalar da'vo qilinmaydi):**
- Vaqtlar 24 KB li sintetik baza uchun. Haqiqiy hajmdagi baza uchun tiklash vaqti **o'lchanmagan** — RTO/RPO belgilanmagan.
- Skriptlar Docker'siz rejimda (`PG_LOCAL=1`) sinaldi; konteyner ichidagi yo'l (`docker compose exec postgres …`) **yuritilmagan**.
- Tungi avtomatik zaxira faqat bazani oladi; yuklangan fayllar faqat `backup.sh` bilan arxivlanadi. Zaxirani serverdan tashqariga ko'chirish sozlanmagan.
- Yuklangan fayllarni konteynerga qayta tiklash buyrug'i hujjatlashtirilgan, lekin yuritilmagan.

### 3.3. Staging himoya skriptlari (namunaviy `.env` fayllar bilan)

| Holat | Natija |
|---|---|
| Shablon o'zgartirilmagan (to'ldirgichlar) | `NOT SAFE`: 5 muammo |
| To'g'ri to'ldirilgan staging `.env` | "isolated", 2 ogohlantirish (production bilan solishtirilmagan; Docker yo'q) |
| Production'ga o'xshash `.env` | `NOT SAFE`: konteyner/volume/baza nomlari |
| `JWT_SECRET` production bilan bir xil | `FAIL JWT_SECRET is the SAME as production's` (qiymat ko'rsatilmaydi) |
| `down.sh` production'ga o'xshash `.env` da | `REFUSED`, hech narsa to'xtatilmadi |
| `down.sh` `.env` siz | `REFUSED` |
| `verify-flows.mjs` jonli ko'rinishdagi domen yoki `--confirm` siz | rad etadi |

Yuritilmagan (faqat `bash -n` sintaksis tekshiruvi): `set-telegram-webhook.sh` (bot tokeni kerak), `init-ssl.sh`, `bootstrap-server.sh`, `down.sh` ning Docker qismi, `backup.sh`/`restore.sh` ning konteyner yo'li. ShellCheck o'rnatilmagan.

## 4. Yiqilgan, bloklangan yoki yuritilmagan

| Tekshiruv | Holat | Sabab |
|---|---|---|
| HTTPS (asosiy domen va subdomenlar), HTTP→HTTPS, HSTS | **bloklangan** | staging serveri va domeni yo'q |
| nginx marshrutlash, wildcard sertifikat | **bloklangan** | shu |
| Brauzerda: login → subdomen → yangilash | **yuritilmagan** (staging'da) | oldinroq `localhost` subdomenlarida tekshirilgan; haqiqiy domen bilan emas |
| Mobil qulaylik | **yuritilmagan** | staging yo'q |
| `docker-compose.prod.yml` staging `.env` bilan | **tekshirilmagan** | Docker yo'q; CI'ga tekshiruv qo'shildi, hali yurmagan |
| Zaxira/tiklash konteynerda | **yuritilmagan** | Docker yo'q |
| Telegram (bog'lash, to'lov xabari, qarz eslatmasi) | **bloklangan** | staging boti va tasdiqlangan sinov chati yo'q |
| Click / Payme sandbox | **bloklangan** | test merchant ma'lumotlari yo'q |
| Staging'ga deploy | **bajarilmagan** | ruxsat va muhit kerak |

Yiqilgan tekshiruv yo'q.

## 5. Integratsiyalar holati

| Integratsiya | Lokal soxta testlar | Haqiqiy tekshiruv |
|---|---|---|
| Telegram | bot mantig'i unit/E2E testlarda (xabar yuborish stub) | **yo'q** |
| Click | `billing-gateways.e2e`: to'lov, takroriy webhook, noto'g'ri imzo, bekor qilish — soxta so'rovlar | **yo'q** (provayder sandbox'i emas) |
| Payme | xuddi shunday | **yo'q** |
| Email / SMS | o'chiq | **yo'q** |

Soxta testlar o'tgani integratsiyani tasdiqlamaydi.

Tayyorlangan: `set-telegram-webhook.sh` endi botni ko'rsatadi, `.env` dagi nomga mos kelmasa yoki bot boshqa hostga ulangan bo'lsa rad etadi — production botining webhook'ini tasodifan almashtirib bo'lmaydi. Tekshiruv ro'yxatlari: `docs/STAGING.md` 3–4-bo'limlar.

## 6. Qolgan to'siqlar (muhimligi bo'yicha)

1. **Staging serveri va domeni yo'q.** Kerak: server, `staging.<domen>` va `*.staging.<domen>` DNS yozuvlari, DNS provayderiga kirish (wildcard sertifikat).
2. **Deploy uchun ruxsat.** Aniq maqsad va amal 8-bo'limda.
3. **Staging Telegram boti va tasdiqlangan sinov chati.**
4. **Click va Payme test merchant ma'lumotlari.**
5. Shu bosqich o'zgarishlari push qilinmagan; CI'da `docker-compose.prod.yml` tekshiruvi hali yurmagan.
6. Zaxirani serverdan tashqariga ko'chirish (S3 yoki boshqa mashina) sozlanmagan.
7. Haqiqiy hajmda tiklash vaqti o'lchanmagan.

## 7. 1–2 markazli pilotni boshlash ro'yxati

- [ ] CI uchala ishda yashil (shu o'zgarishlar bilan).
- [ ] Staging: `verify-flows.mjs` — hammasi o'tdi, HTTPS tekshiruvlari bilan.
- [ ] Staging: brauzer va telefonda login → subdomen → yangilash.
- [ ] Staging: `backup.sh` → `restore.sh` mashqi konteynerda o'tdi; zaxira serverdan tashqariga ko'chirilmoqda.
- [ ] Telegram: staging botida bog'lash, to'lov xabari, qarz eslatmasi; tasdiqlanmagan qarzga eslatma kelmaydi.
- [ ] Click/Payme: test merchant bilan to'lov va takroriy callback — yoki pilot faqat kassa to'lovlari bilan boshlanadi.
- [ ] Production `.env`: o'z sirlari; `preflight.sh` toza.
- [ ] Har markaz uchun: vaqt zonasi, guruh narxlari, birinchi oy hisob-fakturalari.
- [ ] Markaz rahbariga: xodimni o'chirish darhol kuchga kirishi, o'tgan oy narxini tasdiqlash, zaxira qayerda.

## 8. Lokal o'zgarishlar va ruxsat kutayotgan qadamlar

**O'zgargan / yangi fayllar (commit qilinmagan):**

| Fayl | Nima |
|---|---|
| `docker-compose.prod.yml` | `STACK_NAME`, portlar, zaxira papkasi `.env` dan; production uchun standartlar o'sha-o'sha |
| `.env.staging.example` | staging shabloni, faqat to'ldirgichlar |
| `scripts/production/lib.sh` | skriptlar uchun umumiy qism (stack, `.env`, xavfsiz matn tekshiruvlari) |
| `scripts/production/backup.sh` | baza + yuklangan fayllar; yarim fayl qoldirmaydi; `pipefail` xatosi tuzatildi |
| `scripts/production/restore.sh` | **faqat alohida bazaga** tiklaydi va tekshiradi; jonli bazaga yozmaydi |
| `scripts/production/set-telegram-webhook.sh` | botni tekshiradi, boshqa hostdagi webhook'ni ruxsatsiz almashtirmaydi |
| `scripts/production/bootstrap-server.sh` | `ENV_TEMPLATE` (staging shabloni uchun) |
| `scripts/staging/preflight-staging.sh` | staging izolyatsiyasi tekshiruvi |
| `scripts/staging/down.sh` | faqat staging stack'ini to'xtatadi/o'chiradi |
| `scripts/staging/verify-flows.mjs` | API orqali staging tekshiruvi |
| `.github/workflows/ci.yml` | `docker-compose.prod.yml` ni ikkala shablon bilan tekshirish |
| `docs/STAGING.md`, `docs/DEPLOYMENT_GUIDE.md`, `RUNBOOK.md` | staging qo'llanmasi; zaxira/tiklash; eskirgan a'zolik ko'rsatmasi olib tashlandi |
| `STAGING_READINESS_REPORT.md`, `STABILIZATION_REPORT.md` | hisobotlar |

Ilova kodi (backend/frontend) o'zgarmagan.

**Ruxsat kutayotgan amallar** (tayyor, bajarilmagan):

1. Shu o'zgarishlarni `dev` ga push qilish.
2. Staging serverini tayyorlash: `sudo DIR=/opt/crmapp-staging ENV_TEMPLATE=.env.staging.example bash bootstrap.sh staging.<domen>` — maqsad: **siz ko'rsatgan staging serveri**.
3. Staging uchun sertifikat olish va stack'ni ko'tarish: `init-ssl.sh`, `docker compose -f docker-compose.prod.yml up -d --build`.
4. Staging botiga webhook o'rnatish: `set-telegram-webhook.sh` — maqsad: **faqat staging boti**.
5. Sinov chatiga xabar yuborish — **faqat tasdiqlangan chat**.
