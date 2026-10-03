# Brauzer testlari (Playwright)

Eng muhim oqimlar haqiqiy brauzerda, backend va frontendning **production build**'lari bilan, bir martalik bazada:

1. Asosiy saytda login → markaz subdomeni → sahifani yangilaganda sessiya saqlanadi.
2. Bir kishi, ikki markaz, har birida boshqa rol: menyudan markaz almashtirish.
3. Chiqish (logout) → himoyalangan sahifalar ochilmaydi.
4. Brauzer ochiq turganda xodim o'chiriladi → keyingi so'rov rad etiladi.
5. To'lov: ikki marta bosish va javob yo'qolgandan keyingi qayta yuborish — har biri bitta to'lov.
6. Yangi o'quvchi: javob yo'qolgandan keyingi qayta yuborish — bitta o'quvchi, kiritilgan ma'lumot bilan.

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
- Xatoda faqat skrinshotlar saqlanadi (sintetik ma'lumot). Trace va video yozilmaydi: ular so'rov sarlavhalari va tokenlarni saqlaydi.
- Bu lokal infratuzilmadagi tekshiruv, haqiqiy staging domeni va HTTPS emas.
