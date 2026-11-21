# Reliz: 2026-noyabr (`dev` → `main`, PR #43)

17–20-noyabrda `dev`ga qo'shilgan o'zgarishlar (PR #31–#42) va ularni productionga chiqarishdan oldin qilinadigan ishlar.

## 1. Deploy oldidan

1. **Migratsiyalar 0084–0088 qo'llanishi kerak.**
   - Fayllar: `0084_group_individual`, `0085_chat_attachments`, `0086_makeup_auto_issue`, `0087_teacher_profile`, `0088_mock_sessions`.
   - Buyruq: `npm run db:migrate` (Docker konteyneri ishga tushganda o'zi qiladi).
   - Tekshirish: `npm run db:migrate:status`.
   - Hech qachon `drizzle-kit migrate` yoki `db:push` ishlatmang.
2. **`ROOT_DOMAIN`.** Platforma paneli (`/admin` va `@Roles('SUPERADMIN')` marshrutlari) markaz manzilidan (`<sub>.<ROOT_DOMAIN>`) kelgan so'rovga 403 `PLATFORM_MAIN_DOMAIN_ONLY` qaytaradi.
   - `docker-compose.prod.yml` bilan deploy qilsangiz, hech narsa qilish shart emas: `ROOT_DOMAIN` u yerda `.env` dagi `DOMAIN` dan olinadi va `DOMAIN` bo'sh bo'lsa, compose ishga tushmaydi.
   - Docker'siz ishga tushirsangiz (`backend/.env`), `ROOT_DOMAIN` ni asosiy domen qilib qo'ying. Bo'sh qolsa yoki `localhost` bo'lsa, faqat `*.localhost` aniqlanadi va bu himoya ishlamaydi.
3. **Ixtiyoriy: `GEMINI_TTS_MODEL`.** Listening audiosi uchun Gemini TTS modeli. Bo'sh qoldirilsa, standart tartib ishlatiladi (`gemini-3.8-flash-tts`, keyin `gemini-2.5-flash-preview-tts`). Audio uchun `GEMINI_API_KEY` kerak.
4. **Tarif limitlarini tekshiring** (Admin → Tariflar). Narxlar sahifasi endi tarif matnini emas, uning haqiqiy limitlarini (filial, o'quvchi, xodim) ko'rsatadi. Productiondagi tariflar saqlangan limitlarini saqlab qoladi; limit qo'yilmagan bo'lsa "Cheksiz" chiqadi.

## 2. Nima o'zgardi

### Xavfsizlik
- **Click**: to'lov Click tomonida o'tmaganda yuboriladigan "Complete" (`error < 0`) endi o'quvchi to'lovini yozmaydi. Tranzaksiya `FAILED` bo'ladi va javob `-9`.
  - "Complete" markazning `merchant_prepare_id` sini ko'tarishi shart.
  - Bekor qilingan yoki muvaffaqiyatsiz tranzaksiya qayta bajarilmaydi.
- **Payme**
  - Bekor qilingan tranzaksiyani bajarib bo'lmaydi (`-31008`).
  - To'langan tranzaksiyani bekor qilib bo'lmaydi (`-31007`): pulni markazning o'zi qaytaradi.
- **Kabinet PIN**: bir telefon uchun 15 daqiqada 10 ta noto'g'ri PIN'dan keyin PIN bilan kirish yopiladi (429 `PIN_LOCKED`); Telegram kodi bilan kirish ishlayveradi.
  - Hisob server xotirasida yuritiladi. Bir nechta API serveri bo'lsa, har biri alohida sanaydi; bunda bazadagi jadval kerak bo'ladi.
- **Superadmin** faqat o'zi faol a'zo bo'lgan markaz ichida ishlaydi (kirishda, markaz almashtirishda, tokenni yangilashda va har bir so'rovda tekshiriladi). Platforma panelidan markazga "kirib ko'rish" tugmasi olib tashlangan.
- Next.js 16.4.2 → 16.4.6 (xavfsizlik tuzatishi).

### Ro'yxatdan o'tish va tariflar
- Tanlangan tarif (`/register?plan=<KEY>`) sinov davrida saqlanadi; noma'lum yoki faol bo'lmagan kalit STARTER'ga tushadi.
- Onboarding qisqardi: yo'nalish va fanlar bitta qadam, "Kurslar" qadami olib tashlangan.
- Dev mashinada markaz `<sub>.localhost:<port>` da ochiladi.
- Dashboard'da tarif kartasi (tarif, sinovdan qolgan kunlar yoki qaysi sanagacha to'langani, oylik narx).
- Tarifga kirmaydigan bo'lim (mock, AI, sertifikat, telefoniya) havola orqali ochilsa ham yopiq.

### Hisob
- "Mening profilim" (`/profile`): ism va parolni almashtirish. Parol uchun joriy parol (va 2FA kodi) kerak; boshqa qurilmalar tizimdan chiqariladi.
- Email va telefon bu sahifadan o'zgarmaydi (ota-onani bog'lash va taklifnomalar shular bo'yicha odamni topadi).

### AI mock testlar
- Butun IELTS mock bo'limma-bo'lim yoziladi; yiqilgan qism "Qayta urinish" bilan qayta yoziladi (bir vaqtda ikki marta bosilsa, bittasi ishlaydi).
- Listening audiosi Gemini TTS bilan; audio yo'q bo'lsa, test nashr qilinmaydi.

### Qabul (lidlar)
- Lead'ning hamma fanlari hisobga olinadi (daraja testi, mos guruhlar).
- Sinov darsini o'tkazgan o'qituvchi fikr yozadi (bilim darajasi, faollik, tavsiya, izoh). Menejer buni lead sahifasida ko'radi.
- Sinov darsi band qilinganda yoki ko'chirilganda lead'ga SMS ketadi. Faqat tarifda SMS bor, SMS akkaunti sozlangan va oylik limit tugamagan markazlarda; aks holda hech narsa yuborilmaydi.

### Boshqa
- Kassa: sanalgan naqd pul avtomatik to'ldiriladi (hech qachon 0 dan past emas).
- Uy vazifalari grafiklari filtrlarga bo'ysunadi.
- AI materiallar: darajalar yo'nalish guruhlaridan olinadi; vazifaga bog'langan material shu vazifaga PDF bo'lib qo'shiladi.
- O'quvchi ID kartasida markazning nomi va o'z manzili.
- Imtihon tavsifi uchun "AI bilan yozdirish" ishlaydi.

## 3. Ma'lum cheklovlar
- O'quvchi ID kartasidagi QR rasm tashqi `api.qrserver.com` xizmatida yasaladi (o'quvchi ID'si shu serverga yuboriladi). Tuzatish uchun QR kutubxonasi kerak.
- Superadmin biror markazda a'zo bo'lsa, o'sha markazda a'zolik roli emas, to'liq SUPERADMIN huquqlari bilan ishlaydi.

## 4. Nosozlikda
| Belgi | Sabab | Nima qilish |
|---|---|---|
| Kabinetga PIN bilan kirishda 429 `PIN_LOCKED` | 15 daqiqada 10 ta noto'g'ri PIN | Kutish, yoki Telegram kodi bilan kirish. Server qayta ishga tushsa hisob tozalanadi. |
| `/admin` markaz manzilida 403 `PLATFORM_MAIN_DOMAIN_ONLY` | Platforma paneli faqat asosiy domenda | `https://<ROOT_DOMAIN>/admin` dan kiring. |
| Click to'lovi o'quvchiga yozilmadi, jurnalda `-9` | Click to'lov muvaffaqiyatsiz deb yubordi | Click kabinetida to'lovni tekshiring; pul olinmagan bo'lsa, qayta to'lash kerak. |
| Payme bekor qilishga `-31007` javob beradi | To'lov allaqachon bajarilgan | Pulni markaz o'zi qaytaradi, so'ng to'lovni CRM'da bekor qiling. |
| Sinov darsi SMS'i ketmadi | Tarifda SMS yo'q, akkaunt sozlanmagan yoki limit tugagan | Sozlamalar → Xabarnomalar va bildirishnomalar jurnali. |
