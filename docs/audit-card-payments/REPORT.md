# Karta to'lovlari: mustaqil audit, tuzatish va testlar — hisobot

## Boshlang'ich holat

- **Branch / SHA:** `claude/platform-card-pay` @ `5d4aa371a07c220747d13f043d0a7894694c838e` (dev `b5c12e69d823816a2c9686304c28b476b3b68feb`). Brief bilan mos keldi, ishchi papka toza edi.
- **Ish branchi:** `claude/card-pay-audit`, faqat lokal.
- Brief "cloud" deydi, lekin egasining doimiy tanlovi bo'yicha ish lokalda bajarildi.
- GitHub'ga push, PR, merge va production deploy **qilinmadi**.
- Haqiqiy pul o'tkazmalari, email/SMS/Telegram xabarlari yuborilmadi: Telegram va email test ichida almashtirildi, Click/Payme callback'lari test kalitlari bilan chaqirildi.

## Topilgan va tuzatilgan muammolar

### 1. To'lov tasdig'i bitta tranzaksiyada (eng muhim)

**Muammo:** `PlatformCardService.confirm` chekni CONFIRMED qilish, invoysni to'lash, `paidUntil` va `subscriptionId` ni alohida qadamlarda yozardi. Jarayon o'rtada uzilsa, yarim tasdiqlangan holat qolardi. Audit "fire-and-forget" edi.

**Tuzatish:** chek qatori bloklanadi → markazning to'lov qulfi → invoys → markaz. Barcha pul yozuvlari va audit bitta tranzaksiyada. Xabarlar commit'dan keyin yuboriladi.

**Natija:**
- Takroriy tasdiq yoki ikki admin bir vaqtda bossa, ikkalasi ham bir xil javob oladi (`replay`) va obuna bir marta uzayadi.
- Tasdiq va rad bir vaqtda kelsa, aniq bittasi yutadi.

Fayllar:
- `backend/src/platform-billing/platform-card.service.ts`
- `backend/src/platform-billing/billing-period.ts` (`openMonthInvoice`)
- `backend/src/audit/audit.service.ts` (`record`)

Bir xil blok tartibi qo'llandi: Click/Payme havolalari (`platform-billing.service.ts`) va admin qo'lda yozadigan to'lov (`platform/platform.service.ts`).

**Shu turdagi xato yana bir joyda topildi va tuzatildi:** o'quvchi markazga karta orqali to'lagan chekni tasdiqlash (`card-payments/card-payments.service.ts`). Endi chek qatori qulf ostida, to'lov chek kaliti bilan avval yaratiladi, shuning uchun uzilishdan keyingi qayta urinish o'sha to'lovni topib ishni tugatadi.

**Faqat o'qiydigan tekshiruv:** `backend/scripts/check-platform-billing.ts`. U 8 xil nomuvofiqlikni ko'rsatadi va hech narsani o'zgartirmaydi.
- Dev bazada bitta eski demo yozuvni topdi: `s5ui-pay-a`, to'langan, lekin davri (period) yozilmagan.
- U taxmin bilan tuzatilmadi, odam ko'rib chiqishi kerak.

### 2. Takroriy cheklar va to'lov davri

**Muammo:** `submit` avval tekshirib, keyin yaratardi. Parallel ikki so'rov ikkita PENDING chek yaratardi. Oy faqat `YYYY-MM` shakli bo'yicha tekshirilardi (00 va 13 o'tib ketardi). Oyni brauzer tanlardi: Click/Payme `clock.month()`, karta `paidUntil` oyini yuborardi.

**Tuzatish — migratsiya 0076:**
- har markaz va oy uchun faqat bitta PENDING chek (unique index);
- har bir yuborish uchun `Idempotency-Key`: qayta urinish o'sha chekni qaytaradi, takroriy fayl o'chiriladi;
- rad etilgandan keyin qayta yuborish ishlaydi.

**Davr qoidasi:** `nextPaymentMonth` endi karta, Click va Payme uchun yagona.
- Oy markaz vaqt zonasida hisoblanadi, brauzer yuborgan oy e'tiborga olinmaydi.
- Oldindan uzaytirilsa, `paidUntil` tugaydigan oy olinadi.
- Muddati tugagan bo'lsa, joriy oy olinadi.
- To'langan oylar o'tkazib yuboriladi.

**Validatsiya:** `isMonthLabel` faqat 01–12 oylarni qabul qiladi. `assertRecordableMonth` admin qo'lda yozganda oyni 2 yil oldin – 1 yil keyin oralig'ida cheklaydi.

**Unit testlar:** yil almashishi, 31-yanvar, kabisa yili, vaqt zonasi chegarasi (`billing-period.spec.ts`).

### 3. Karta, Click va Payme to'qnashuvlari

- **Bekor qilingan invoys** endi qayta yozilmaydi. U provider tranzaksiya ID'si bilan tarix sifatida qoladi va yangi invoys yaratiladi. Payme o'sha tranzaksiya haqida so'rasa (`CheckTransaction`), to'g'ri javob oladi.
- **Davom etayotgan Payme tranzaksiyasi** karta tasdig'i tomonidan hech qachon egallab olinmaydi: 409 `PAYMENT_IN_PROGRESS` qaytadi.
- **12 soatdan oshgan Payme tranzaksiyasi** bekor qilingan deb yopiladi (sabab 4) va saqlanadi.
- **To'langan oy** qayta to'lanmaydi: karta uchun 409 `ALREADY_PAID`, Payme uchun -31051, Click uchun -4.

### 4. Admin va mijoz interfeysi

- **Chekni yuklash** endi umumiy kirish va token yangilash mexanizmidan foydalanadi (`authedFetch` / `fetchBlob`).
- Yuklanish, xato va qayta urinish holatlari ajratilgan. 401, 403, 404, tarmoq uzilishi va buzilgan fayl alohida, tushunarli matn bilan ko'rsatiladi.
- Eski so'rov bekor qilinadi, shuning uchun kech kelgan javob boshqa chek oynasiga tushmaydi.
- **Admin ro'yxati** sahifalangan: kutilayotganlar eskisidan yangisiga qarab chiqadi, tartib barqaror, hisoblagich bor. Eski kutilayotgan cheklar ham topiladi.
- **Mijoz tomoni:** bitta yuborish uchun bitta kalit, ko'rsatilgan oy serverniki.

**Brauzer testi topgan xato:** karta ma'lumoti yuklanmasdan oyna ochilsa, Click usulida qolib ketardi. Tuzatildi.

Fayllar:
- `frontend/components/billing/PlatformCardClaims.tsx`
- `frontend/components/billing/PlatformCardPay.tsx`
- `frontend/app/pricing/page.tsx`
- `frontend/lib/api.ts`

### 5. trial-purge-outbox testining beqarorligi

**Sabab (dalil bilan):** `deleteIfStillDue` ichida `AuditService.log` kutilmasdan va boshqa ulanishda chaqirilgan.
- Test audit yozuvi bazaga tushmasidan oldin sanab qo'yishi mumkin edi.
- O'chirish rollback bo'lsa ham audit yozuvi qolib ketardi.

**Tuzatish:** audit endi o'chirish tranzaksiyasi ichida yoziladi va kutiladi.
- Test o'zgartirilmadi.
- Ketma-ket 5 marta o'tdi (11/11).

### 6. Xavfsizlik va regressiya

**Yangi test `isolation-new-features.e2e-spec.ts`:**
- 2 ta markaz va OWNER, TEACHER, MANAGER, RECEPTIONIST, SUPERADMIN rollari yaratiladi.
- Boshqa markazning cheklari, fayl havolalari, signallari, tasnifi, nomzodlari, karta va to'lov hisoblariga to'g'ridan-to'g'ri API orqali kirib bo'lmasligi tekshirildi.
- Oddiy xodimlar admin endpointlarini chaqira olmasligi tekshirildi.
- Bu tekshiruvlarda zaiflik topilmadi.

**To'rt asosiy funksiya** (kalendar, custom maydonlar, make-up darslar, chat) mavjud backend va brauzer to'plamlari bilan tekshirildi. Natijalar pastda.

## Bajarilgan testlar

| Tekshiruv | Natija |
|---|---|
| Backend e2e (to'liq, 90 fayl) | 697 o'tdi, 2 skip, 1 yiqildi: mening testim to'liq yugurishdagi yuklamada vaqt chegarasiga urildi. Tuzatildi va o'sha fayllar yuklama bilan 2 marta qayta yugurildi: 54/54 |
| `platform-card.e2e-spec.ts` | 15/15 (alohida 3 marta) |
| Backend unit | 375/376. Yiqilgan yagona test avvaldan ma'lum `outbound-url` (TLS, faqat shu kompyuterda) |
| Backend typecheck, lint, build | o'tdi (lint xatosiz, faqat ogohlantirishlar) |
| Frontend typecheck, lint, unit (61), build | o'tdi |
| Migratsiya: bo'sh bazadan oxirgisigacha | o'tdi |
| Migratsiya: eski sxemadan (dev baza 0075 → 0076) | o'tdi |
| Migratsiya: takroriy PENDING cheklar ustida | aniq xabar bilan to'xtadi, ma'lumot o'chmadi. Hal qilingach ikki marta o'tdi |
| Brauzer (Playwright, butun to'plam, 66 test) | 65 o'tdi, 1 yiqildi: `sprint5-account` testi oynani Click usulida kutardi, endi esa karta bor bo'lsa oyna karta usuli bilan ochiladi. Testda Click aniq tanlab qo'yildi, maqsadi o'zgarmadi. Tariflar bilan bog'liq 4 fayl qayta yugurildi: 14/14 |

## Brauzerda tekshirilgan sahifa va tugmalar

- **Tariflar (markaz):**
  - "Faollashtirish" va "To'lash / uzaytirish" tugmalari;
  - karta usuli, karta raqami, server tanlagan oy;
  - chek tanlash, "Chekni yuborish";
  - yuborilgan cheklar ro'yxati.
- **Platforma → Obunalar → "Karta to'lovlari":**
  - "Tekshirish" tugmasi, chek rasmi;
  - Escape bilan yopish va qayta ochish;
  - sabab bilan "Rad etish";
  - "Tasdiqlash" va tasdiq oynasi.
- **Mijozda natija:** "Rad etildi: sabab", "Tasdiqlandi", to'langan muddat.
- **Telefon ekrani (390px):** to'lov oynasi gorizontal surilishsiz sig'adi, fayl tanlanmasa xato ko'rsatiladi.
- **Butun to'plam:** mavjud 64 ta brauzer testi (chat, kalendar, custom maydonlar, make-up, rollar, sessiya).

## Tekshirilmagan yoki cheklangan qismlar

- **Preview URL yo'q:** ish lokal kompyuterda bajarildi, cloud preview ochilmadi. Ishga tushirish buyruqlari pastda.
- **Xabarlar outbox'i yo'q:** xabarlar commit'dan keyin yuboriladi, lekin alohida "outbox" jadvaliga yozilmaydi. Server aynan commit'dan keyin to'xtasa, xabar yo'qolishi mumkin; to'lov holati esa izchil qoladi. Keyingi qadam sifatida qoldirildi.
- **To'rt funksiya bo'yicha yangi tuzatish yo'q:** mavjud testlar yashil bo'lgani uchun kalendar, custom maydonlar, make-up va chat chuqur qayta audit qilinmadi.
- **2FA va refresh** mavjud testlar bilan tekshirildi (`session.spec.ts`, `sprint5-account.spec.ts`, backend `auth-*`), yangi test yozilmadi.
- **Raqobatchilar taqqoslovi:** rasmiy saytlarning bosh sahifalari asosida qilindi. Ichki hujjatlar ochiq emas edi.

## Migratsiya va qaytarish

- **0076 (`platform_billing_integrity`):**
  - `platform_subscriptions` unique indeksi "bekor qilinmaganlar orasida" (partial) shakliga o'tdi;
  - `platform_payment_claims` ga `idempotency_key` ustuni, bitta PENDING indeksi va idempotentlik indeksi qo'shildi.
- **O'rnatishdan oldin:** `npx tsx scripts/check-platform-billing.ts` ni ishga tushiring. Takroriy PENDING cheklar bo'lsa, migratsiya to'xtaydi: avval ularni tasdiqlang yoki rad eting.
- **Qaytarish:** yangi indekslar va ustunni olib tashlash, `platform_subs_tenant_month_idx` ni qayta yaratish. Bu faqat bir oy uchun bitta bekor qilinmagan invoys mavjud bo'lsa ishlaydi: bekor qilingan tarix qatorlari bo'lsa, eski unique indeks tushmaydi. Shuning uchun kod bilan birga qaytarish tavsiya etiladi.

## Keyingi eng muhim vazifalar

1. Xabarlar uchun outbox (to'lov tasdig'i va rad xabarlari).
2. Payme/Click fiskal chek talablarini rasmiy hujjat bo'yicha tekshirish (`BACKLOG.md` §2).
3. Dev bazadagi `s5ui-pay-a` yozuvini ko'rib chiqish va tekshiruv skriptini CI yoki cron'ga qo'shish.
4. `BACKLOG.md`: abonementlar, PWA push.

## Ishga tushirish (lokal)

```
cd backend && npm run db:migrate && npm run start:dev       # API :4000 (yoki .env PORT)
cd frontend && npm run dev                                  # sayt :3000
cd e2e-browser && npm run build:frontend && PW_CHANNEL=chrome npx playwright test
```

Test akkauntlari brauzer testlarida har safar yangidan yaratiladi (`zzbr-*`, alohida baza). Lokal demo: `SETUP.md` dagi akkauntlar.

## Patch

- **Bitta diff:** `C:\Users\user\Documents\GitHub\crmApp-dev\card-pay-audit.diff` (`5d4aa37..claude/card-pay-audit`)
- **Commitlar bo'yicha:** `C:\Users\user\Documents\GitHub\crmApp-dev\card-pay-audit-patches\` (`git am` bilan qo'llanadi)
- **Lokal branch:** `claude/card-pay-audit` (push qilinmagan)
