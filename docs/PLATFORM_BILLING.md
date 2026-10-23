# Platforma: obuna, tarif imkoniyatlari, o'chirgichlar, o'z domeni

Markaz → CRMAPP to'lovi. O'quvchi → markaz to'lovlari bilan aralashtirilmaydi (`billing/` alohida).
Kod: `backend/src/platform-billing/`, `backend/src/plans/entitlements.ts`, `backend/src/feature-flags/`, `backend/src/custom-domains/`.

## 1. Obuna davri (to'langan muddat)

- `tenants.paid_until` — to'langan vaqt qayerda tugashi. Har to'lov **1 oy qo'shadi**, to'langan muddat tugagan joydan (oldindan to'lash hech narsa yo'qotmaydi) yoki hozirdan.
- Hisob-faktura: `platform_subscriptions` (oy belgisi bo'yicha); to'lov qaysi davrni sotib olgani yoziladi (`period_start/end`).
- Click, Payme va admin qo'lda qayd qilgan to'lov — **bitta yo'l**dan o'tadi (`billing-period.ts applyPayment`), qatorlar qulflangan: takroriy callback ikki marta uzaytirmaydi.
- **Hayot sikli** (`BILLING_ENFORCE`, sukut bo'yicha **o'chiq**):
  - muddat tugadi → `PAST_DUE`: `BILLING_GRACE_DAYS` (7) kun **odatdagidek ishlaydi**, ekranda banner;
  - grace tugadi → `SUSPENDED` + `suspended_reason=NON_PAYMENT`: faqat ko'rish (`403 BILLING_SUSPENDED`), tarif to'lash ochiq;
  - to'lov → darhol `ACTIVE`. Admin o'zi to'xtatgan markaz to'lovdan keyin ham to'xtatilgan qoladi (to'lov hisoblanadi).
  - Egalariga har bosqichda xat ketadi.
- Preview: admin panel → "Sinov va SMS nazorati" → "To'langan muddat: oldindan ko'rish" (hech narsa o'zgartirmaydi).
- Hech qachon billing orqali to'lamagan markazlar (`paid_until` bo'sh) tegilmaydi.

### Tarifni o'zgartirish (yuqoriga / pastga)
To'lov qaysi tarif uchun bo'lsa, markaz **o'sha to'lovdan boshlab** shu tarifda bo'ladi va muddatga 1 oy qo'shiladi. Proratsiya (qolgan kunlarni hisoblash) yo'q: tarif keyingi to'lov bilan almashadi. Pastroq tarifga o'tganda limitdan oshib ketgan mavjud ma'lumotlar o'chirilmaydi — faqat yangisini qo'shish to'xtaydi.

### Provayderlar (holat mashinasi)
- **Payme:** summa har qadamda tekshiriladi; bitta hisobga bitta tranzaksiya (`-31051`); `Create/Perform/Cancel` takrorlansa bir xil javob; 12 soatdan keyin bajarilmagan tranzaksiya bekor; to'lovdan keyingi `Cancel` (state `-2`) oyni qaytarib oladi.
- **Click:** to'langan hisob qayta tayyorlanmaydi/tasdiqlanmaydi (`-4`); bekor qilingani `-9`; Click xato bilan yakunlasa hisob bekor.
- Bitta oy uchun to'lov havolasi to'langan oyni **hech qachon** qayta ochmaydi (`409 ALREADY_PAID`).

## 2. Tarif imkoniyatlari (entitlements)

`plans.entitlements` — admin "Tariflar" sahifasida sozlaydi. **Kalit yo'q = kiritilgan / cheklovsiz** (sozlanmagan tarif hammasini o'z ichiga oladi).

| Kalit | Turi | Tekshiriladi |
|---|---|---|
| `AI_TOOLS` | funksiya | `@UsesAi` yo'llar, o'quvchi ishini AI baholash |
| `AI_TUTOR` | funksiya | o'quvchilar AI ustozi (kabinet + Telegram) |
| `MOCK_EXAMS` | funksiya | `mock-tests` (controller'da `@RequiresFeature`) |
| `CERTIFICATES` | funksiya | `certificates` |
| `CUSTOM_DOMAIN` | funksiya | o'z domeni |
| `MAX_STUDENTS` | limit | o'quvchi qo'shishning barcha yo'llari (qo'lda, tiklash, liddan, import) |
| `MAX_STAFF` | limit | xodim, o'qituvchi akkaunti, taklifnoma yuborish/qabul qilish |
| `MAX_BRANCHES` | limit | filial yaratish |

Javoblar: `403 PLAN_FEATURE` (`feature` bilan), `403 PLAN_LIMIT`. Menyu tarifda yo'q bo'limlarni yashiradi. SMS — `plans.smsIncluded` (alohida).

## 3. Platforma o'chirgichlari (feature flags)

Tarifdan farqi: bu **texnik** qaror (favqulodda to'xtatish, bosqichma-bosqich yoqish). Admin panel → "Platforma o'chirgichlari".

| Kalit | Nima to'xtaydi |
|---|---|
| `ai` | barcha AI (`503 FEATURE_DISABLED`; ustoz — "mavjud emas") |
| `sms` | SMS yuborish |
| `telegram` | Telegram xabarnomalari |
| `signups` | yangi ro'yxatdan o'tish (`503 SIGNUPS_PAUSED`) |

Sukut bo'yicha hammasi yoqiq. Global yoki markaz bo'yicha istisno (markazniki ustun). Har o'zgarish audit jurnalida. Qiymat 5 soniya keshlanadi.

## 4. Markazning o'z domeni

- Markaz sozlamalari → "Sayt" → "O'z domeningiz": domen qo'shiladi, DNS'ga `TXT _talimcrm.<domen> = <token>` qo'yiladi, "Tekshirish".
- Faqat **tasdiqlangan** domen ishlaydi; bitta domenni faqat bitta markaz tasdiqlay oladi (boshqasi faqat "da'vo" qila oladi, egasidan hech narsa olmaydi). Markazga 3 tagacha domen.
- Domen faqat **ommaviy sayt**ni ko'rsatadi (`/` → markaz sayti). Boshqa yo'llar (kirish, kabinet) markaz subdomeniga yo'naltiriladi — cookie va avtorizatsiya o'zgarmaydi.
- HTTPS sertifikati — serverda qo'lda (`docs/DEPLOYMENT_GUIDE.md`, "Markazning o'z domeni").
