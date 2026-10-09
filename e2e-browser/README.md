# Brauzer testlari (Playwright)

Eng muhim oqimlar haqiqiy brauzerda, backend va frontendning **production build**'lari bilan, bir martalik bazada. Har bir yo'nalish alohida faylda (`tests/`):

| Fayl | Nima tekshiriladi |
|---|---|
| `session.spec.ts` | Asosiy saytda login → markaz subdomeni → yangilaganda sessiya saqlanadi; chiqish; brauzer ochiq turganda xodim o'chiriladi → keyingi so'rov rad etiladi (oldingi sahifaning so'rovlari tugashini kutib, poygasiz) |
| `role-boundaries.spec.ts` | Bir kishi, ikki markaz, har birida boshqa rol; o'qituvchi faqat o'z guruhini ko'radi, to'lov/hisobot/lid/sozlamalar yopiq (sahifa ham, API ham) |
| `admissions.spec.ts` | Brauzer New York vaqtida: lidning qayta aloqasi va sinov darsi markaz vaqtida (Asia/Tashkent) saqlanadi va ko'rsatiladi; yangi o'quvchi — javob yo'qolgandan keyingi qayta yuborishda bitta |
| `capacity.spec.ts` | To'lgan guruh yangi o'quvchini qabul qilmaydi va sababini aytadi |
| `teaching.spec.ts` | O'qituvchi o'z guruhida davomat qiladi; brauzer sanasi markaznikidan farq qilganda ham davomat markaz kunida yoziladi |
| `tuition.spec.ts` | To'lov: ikki marta bosish va javob yo'qolgandan keyingi qayta yuborish — har biri bitta to'lov; kunlik kassani yopish (kutilgan naqd, sanalgan, farq; ikkinchi yopish rad etiladi) |
| `payroll.spec.ts` | Hisobchi oylikni ikki qismda to'laydi; ikki marta bosish va qayta yuborish — bitta to'lov, har biriga bitta xarajat; xato to'lov storno qilinadi |
| `parent-portal.spec.ts` | Ota-ona telefon va PIN bilan kiradi, farzandini faqat kuzatadi (AI repetitor yo'q) |
| `reports.spec.ts` | Direktor hisobotida oylik to'lovi xarajatda bir marta hisoblanadi |
| `import.spec.ts` | Yangi markaz Excel'dan to'ldiriladi: o'qituvchilar, guruhlar, o'quvchilar; qayta yuklash hech narsa qo'shmaydi; xatoli qator importni to'xtatadi (fayllar backend'dagi `exceljs` bilan yasaladi) |
| `makeups.spec.ts` | Kelmagan o'quvchiga "Qoldirilgan darslar"da kredit beriladi, boshqa guruh darsiga yoziladi, jadvalda "Keldi" belgilanadi — kredit ishlatilgan bo'ladi; guruh sahifasida bitta dars bekor qilinadi va tiklanadi |
| `calendar.spec.ts` | Kalendar sahifasida ICS havola yaratiladi va nusxalanadi, kalendar ilovasi uni o'qiydi (`text/calendar`); yangi havoladan keyin eskisi 404, o'chirilgandan keyin yangisi ham 404; Google Calendar sozlanmaganini aytadi |
| `mobile.spec.ts` | 390 px ekranda 20 ta asosiy sahifa sig'adi: sahifa yonga surilmaydi, keng jadval faqat o'z kartochkasi ichida suriladi |

```bash
cd e2e-browser
npm ci
npx playwright install chromium        # yoki: PW_CHANNEL=chrome (o'rnatilgan Chrome)
npm --prefix ../backend run build
npm run build:frontend                 # frontend/.next-browser ga, test API manzili bilan
npm test
```

- Baza: `DATABASE_URL` nomiga `_browser_e2e` qo'shilgan baza (har yurishda qayta yaratiladi) yoki `BROWSER_DATABASE_URL` (nomi `_e2e`/`_test` bilan tugashi shart).
- Portlar: API 4300, sahifalar 3300 (`BROWSER_API_PORT`, `BROWSER_WEB_PORT`). Band bo'lsa test boshlanmaydi.
- Backend `NODE_ENV=development` bilan ishlaydi — faqat `http://*.localhost` uchun CORS qoidalari sababli; kod production build. Tashqi xizmatlar (AI, email, SMS, Telegram, Click, Payme) o'chiq.
- Server bir manzildan daqiqasiga 8 ta ro'yxatdan o'tish va 8 ta kirishga ruxsat beradi (lokal, staging va production bir xil). Testlar bu limitni pasaytirmaydi: `authSlot` (tests/support.ts) bo'sh joyni kutadi, shuning uchun to'plam ~2 daqiqa davom etadi.
- O'rnatilgan boshqa reviziyadagi Chromium: `PW_EXECUTABLE_PATH=/path/to/chrome npm test`.
- Xatoda faqat skrinshotlar saqlanadi (sintetik ma'lumot). Trace va video yozilmaydi: ular so'rov sarlavhalari va tokenlarni saqlaydi.
- Bu lokal infratuzilmadagi tekshiruv, haqiqiy staging domeni va HTTPS emas.
