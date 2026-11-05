# IP telefoniya (Zadarma)

Markazning o'z IP-telefoniya akkaunti CRM'ga ulanadi:
- kiruvchi qo'ng'iroqlar jurnalga tushadi
- notanish raqamdan lid ochiladi
- qo'ng'iroq jiringlaganda menejerga qo'ng'iroqchining kartasi ko'rinadi
- raqam yonidagi 📞 tugmasi orqali bir bosishda qo'ng'iroq qilinadi

Birinchi provayder Zadarma. Kod provayder interfeysi orqali yozilgan, keyin Novofon, Binotel va boshqalar qo'shiladi.

Kod: `backend/src/telephony/` va `frontend/components/telephony/`, `frontend/components/settings/TelephonySettings.tsx`, `frontend/app/calls/`.

## Markaz uchun sozlash

1. Zadarma'da akkaunt ochiladi, PBX'da ichki raqamlar yaratiladi (100, 101, ...).
2. **CRM → Sozlamalar → Integratsiyalar → IP telefoniya** (faqat direktor va admin):
   - Zadarma'ning **API key** va **API secret**'i kiritiladi. Zadarma'da ular *Settings → Integrations and API → API keys* bo'limida turadi.
   - Secret shifrlangan holda saqlanadi va qaytib ko'rsatilmaydi.
   - "Tekshirish" tugmasi kalitlarni Zadarma'da sinab ko'radi.
3. CRM ko'rsatgan **webhook manzili** Zadarma'ga qo'yiladi: *Settings → Integrations and API → Notifications → PBX call notifications*, keyin **Enable**. Zadarma manzilni `zd_echo` bilan tekshiradi, CRM unga avtomatik javob beradi.
4. **Ichki raqamlar:** har bir ichki raqamga xodim biriktiriladi. Qo'ng'iroq oynasi va click-to-call shunga qarab ishlaydi.
5. **Kim nimani ko'radi:**

   | Sozlama | Variantlar |
   |---|---|
   | Menejerlar qaysi qo'ng'iroqlarni ko'radi | faqat o'zinikini (standart) yoki markazning hamma qo'ng'iroqlarini |
   | Yozuvlarni kim tinglaydi | faqat direktor va admin (standart) yoki qo'ng'iroqni ko'ra oladigan hamma |

   Direktor va admin har doim hammasini ko'radi.

Xodimlarga ruxsatlar (Sozlamalar → Xodimlar va huquqlar):
- `calls.view`: jurnal va qo'ng'iroq oynasi. Standart holatda menejer va qabulxonada bor.
- `calls.make`: click-to-call. Standart holatda menejer va qabulxonada bor.
- `calls.stats`: statistika. Standart holatda faqat direktor va admin.

Tarif: `TELEPHONY` funksiyasi (Platforma → Tariflar). Kalit yozilmagan tarifda telefoniya yoqilgan hisoblanadi.

## Qanday ishlaydi

- **Markazni aniqlash:** webhook manzilida markazning maxfiy tokeni bor (`/api/telephony/webhook/<token>`). Xabar shu markazning secret'i bilan imzolangan bo'lishi shart (Zadarma'ning `Signature` sarlavhasi). Markaz hech qachon xabar ichidagi ma'lumotdan aniqlanmaydi.
- **Takroriy xabar:** har bir xabar `call_events` jadvaliga bir marta yoziladi (`dedupe_key`), qayta yetkazilgani hech narsani o'zgartirmaydi. Xabarlar istalgan tartibda kelishi mumkin. Javob berilgan qo'ng'iroq keyingi "leg"ning tugashi bilan javobsizga aylanmaydi.
- **Raqamni topish** (hammasi `+998XXXXXXXXX` ko'rinishida), shu tartibda:
  1. ochiq lid
  2. o'quvchi
  3. ota-ona: qo'ng'iroq farzandning kartasiga yoziladi
  4. o'quvchiga aylangan lid

  Hech kim topilmasa, kiruvchi qo'ng'iroq (javob berilgan ham, javobsiz ham) `PHONE` manbali yangi lid ochadi. Lid qo'ng'iroqqa javob bergan xodimga biriktiriladi.
- **Lid tarixi:** tugagan qo'ng'iroq lid tarixiga bir marta yoziladi.
- **Qo'ng'iroq oynasi:** `GET /api/calls/stream` (SSE + PostgreSQL NOTIFY).
  - Faqat ichki raqami jiringlayotgan xodimga keladi.
  - Javob berilganda yoki qo'ng'iroq tugaganda u ochilgan hamma tab'da yopiladi.
  - Har xabardan oldin sessiya, a'zolik va ruxsat qayta tekshiriladi.
- **Yozuvlar:** Zadarma'da qoladi. ▶️ bosilganda yangi, qisqa muddatli havola so'raladi, chunki havola muddati 30 daqiqa.

## Server sozlamalari (`.env`)

| O'zgaruvchi | Nima uchun |
|---|---|
| `SETTINGS_KEY` | **Majburiy.** Usiz markaz kalitlarni saqlay olmaydi. Click va Payme kalitlari bilan bir xil kalit ishlatiladi. |
| `PUBLIC_API_URL` | Webhook manzili shundan yasaladi (yo'q bo'lsa `FRONTEND_URL` + `/api`). |
| `TELEPHONY_ZADARMA_IPS` | Ixtiyoriy, masalan `185.45.152.40/30` (Zadarma tavsiyasi). Faqat nginx haqiqiy IP'ni uzatayotgani tekshirilgandan keyin yoqing, aks holda hamma xabarlar rad etiladi. |
| `ZADARMA_API_URL` | Ixtiyoriy. Zadarma sandbox uchun `https://api-sandbox.zadarma.com`. |

Webhook limiti har bir markaz tokeni bo'yicha sanaladi (daqiqasiga 600 ta), chunki hamma markazlarning xabarlari Zadarma'ning bir xil IP'laridan keladi. O'ylab topilgan tokenlar bilan kelgan so'rovlar esa IP bo'yicha cheklanadi: daqiqasiga 30 tadan keyin `429`.

## Lokal sinash (haqiqiy qo'ng'iroqsiz)

1. Sozlamalarda provayder sifatida **Sinov (mock)** tanlanadi (u faqat production bo'lmagan muhitda chiqadi). Istalgan key va secret, masalan `demo-secret`.
2. O'zingizga ichki raqam biriktirasiz (masalan 100).
3. Qo'ng'iroqni taqlid qilasiz:

```bash
cd backend
node scripts/telephony-mock-call.cjs --url <webhook manzili> --secret demo-secret --from "+998 97 555 44 33" --ext 100 --record
node scripts/telephony-mock-call.cjs --url <webhook manzili> --secret demo-secret --from +998902220001 --missed
node scripts/telephony-mock-call.cjs --url <webhook manzili> --secret demo-secret --from +998901112233 --out
```

Skript faqat lokal manzillarga yuboradi. Mock provayderda click-to-call qo'ng'iroqni o'zi "o'ynab beradi", ▶️ esa sinov ohangini chaladi.

Testlar:
- `backend/src/telephony/**/*.spec.ts`: imzolar, PHP'da hisoblangan namunalar bilan.
- `backend/test/telephony-webhook.e2e-spec.ts` va `backend/test/telephony-calls.e2e-spec.ts`.

## Yangi provayder qo'shish

1. `backend/src/telephony/providers/` ga `TelephonyProvider` interfeysini bajaradigan adapter yoziladi: `verify`, `parse` (provayder xabari → `CallEvent`), `startCallback`, `recordingLink`, `testCredentials`, `handshake`.
2. `TelephonyProviders` ga bitta qator qo'shiladi.
3. `telephony_provider` enum'iga qiymat qo'shiladi (migratsiya bilan).
4. Frontend'da provayder tanlash ro'yxatiga qo'shiladi.

Qolgan hamma narsa (jurnal, raqam topish, oyna, statistika) provayderga bog'liq emas.

## Ma'lum cheklovlar

- Zadarma hujjatida aniq yozilmagan, haqiqiy akkauntda tekshirish kerak:
  - `duration` faqat suhbat vaqtimi yoki jiringlash bilan birgami ("o'rtacha suhbat" shunga bog'liq)
  - click-to-call qo'ng'iroqlari `NOTIFY_OUT_START` bo'lib keladimi
- Zadarma `call_start` ni qaysi vaqt zonasida yuborishi aytilmagan. Shuning uchun boshlanish vaqti sifatida xabar serverga kelgan vaqt olinadi, Zadarma'ning o'z vaqti xabar ichida saqlanadi.
- Har markazga bitta telefoniya akkaunti.
