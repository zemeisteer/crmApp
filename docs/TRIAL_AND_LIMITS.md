# Bepul sinov, markaz holatlari va limitlar

Kod: `backend/src/trial/` (`trial-rules.ts`, `trial-access.ts`, `trial-limits.ts`,
`trial-lifecycle.service.ts`, `trial-claims.service.ts`), SMS: `backend/src/notifications/notifications.service.ts`.
Testlar: `test/trial-access.e2e-spec.ts`, `test/trial-protection.e2e-spec.ts`,
`test/trial-purge-outbox.e2e-spec.ts`, `test/signup-integrity.e2e-spec.ts`.

## 1. Markaz holati bo'yicha ruxsatlar (bitta jadval)

`trial-access.ts` dagi `centerAccess()` — `TrialGuard` ham, global `TrialInterceptor` ham
shu funksiyadan javob oladi, shuning uchun ikkalasi bir xil kod qaytaradi.

| Holat | O'qish (GET) | Yozish | Doim ochiq yo'llar* | Rad kodi |
|---|---|---|---|---|
| ACTIVE (to'lagan) | ha | ha | ha | — |
| TRIAL (sinov davom etmoqda) | ha | ha (limitlar bilan) | ha | `TRIAL_LIMIT`, `TRIAL_AI_LIMIT` |
| READ_ONLY (sinov tugagan, `TRIAL_READONLY_DAYS`) | ha | yo'q | ha | 403 `TRIAL_READ_ONLY` |
| LOCKED (read-only kunlar ham o'tgan) | yo'q | yo'q | ha | 403 `TRIAL_LOCKED` |
| SUSPENDED (platforma to'xtatgan) | ha | yo'q | ha | 403 `CENTER_SUSPENDED` |

\* Doim ochiq: `/api/auth/*` (kirish, chiqish, 2FA), `GET /api/plans/public`,
`POST /api/platform-billing/(click|payme)/link` (tarif sotib olish),
`GET /api/tenants/me/export` (ma'lumotni olib ketish), `DELETE /api/tenants/me`.
To'lov provayderi callback'lari (`/api/platform-billing/*/webhook`, `/api/billing/*/webhook`)
foydalanuvchisiz keladi va bu jadvalga tushmaydi.

Platforma admini (SUPERADMIN) va o'quvchi/ota-ona kabineti jadvaldan tashqarida; kabinetning
pul turadigan eshiklari (AI, SMS) alohida tekshiriladi (quyida).

HTTP bo'lmagan ishlar uchun `centerWorkRefusal()` — faqat ACTIVE va TRIAL'da ruxsat:
taklifnomani qabul qilish, AI ustoz, o'quvchi topshirgan ishni AI baholashi, SMS, avtomatik eslatmalar.

## 2. Sinov limitlari va ularning barcha eshiklari

| Limit | Eshik | Qayerda tekshiriladi |
|---|---|---|
| O'quvchilar (`TRIAL_MAX_STUDENTS`, 30) | qo'lda qo'shish | `students.service.ts` (tranzaksiya + advisory lock) |
| | savatdan tiklash | `students.service.ts restore` |
| | liddan o'quvchiga aylantirish | `lead-conversion.service.ts` |
| | fayldan import | `import.service.ts` — sinovda import yo'q |
| Xodimlar (`TRIAL_MAX_STAFF`, 3) | xodim yaratish / qayta faollashtirish | `staff.service.ts` |
| | o'qituvchiga akkaunt | `teachers.service.ts createAccount` → `staff.create` |
| | taklifnoma yuborish | `invitations.service.ts create` (kutilayotganlar ham sanaladi) |
| | taklifnomani qabul qilish | `invitations.service.ts accept` — tranzaksiyada, a'zolar sanaladi; yopiq markazga hech kim qo'shilmaydi |

## 3. AI limiti (`TRIAL_AI_PER_DAY`, kuniga 20) — qamrov

Bitta hisoblagich: `trial_ai_usage` (markaz + markaz vaqt zonasidagi kun), `chargeTrialAi()` —
bitta SQL, limitdan oshib keta olmaydi. Sinovdagi markazning barcha AI eshiklari shu hisoblagichdan oladi:

| Kim | Eshik | Qamrov |
|---|---|---|
| Xodim (veb) | `@UsesAi` yo'llar: `ai.controller` (5), `exams` (3), `mock-tests` (4), `placement` (3) | `TrialInterceptor` |
| O'quvchi (veb kabinet) | AI ustoz `POST /api/portal/ai/ask` | `StudentTutorService.ask` |
| O'quvchi (Telegram bot) | AI ustoz | `StudentTutorService.ask` (o'sha funksiya) |
| O'quvchi (veb kabinet) | mock test yozma/og'zaki bo'limini topshirish → AI baholash | `MockTestsService.gradeWithAi / gradePracticeWithAi` (limit tugasa — o'qituvchi baholaydi, holat REVIEW) |
| O'quvchi (veb kabinet) | AI mashq to'plami yaratish | `MockTestsService.generateForStudent` |
| Xodim | mock testni AI bilan qayta baholash | interceptor sanaydi; ichkarida qayta sanalmaydi |
| Platforma admini | tarif matnini tarjima (`plans/translate`) | sinovga aloqasi yo'q |

O'quvchining o'z kunlik limiti (`studentAiDailyLimit`) bundan tashqari amal qiladi.
Telegram bot boshqa AI chaqirmaydi (xodim botidagi baholash — AI emas).
Ma'lum chegara: AI javob bermasa, sinov hisoblagichi qaytarilmaydi (o'quvchi limiti qaytariladi).

## 4. SMS — platforma hisobi

`smsRoute()` platformaning Eskiz/PlayMobile tokeni bilan **yubormaydi**, agar:
markaz yo'q (`NO_CENTER`); markaz faol emas — sinov tugagan yoki to'xtatilgan (`CENTER_INACTIVE`);
tarif platforma ro'yxatida yo'q yoki SMS kirmagan (`NOT_IN_PLAN`); markaz SMS'ni o'chirgan (`OFF`).
O'z tokeni bor markaz o'z hisobidan yuboradi (tarifda SMS bo'lishi shart).

Har bir SMS `sms_sends` jadvalida idempotency kaliti bilan yoziladi:

- **Byudjet**: `PLATFORM_SMS_PER_CENTER_MONTH` (1000) har markazga, `PLATFORM_SMS_PER_MONTH` (0 = cheklanmagan) hammasiga; oyiga, faqat platforma hisobidagi xabarlar. Joy olish oy bo'yicha advisory lock ostida — parallel so'rovlar limitdan o'ta olmaydi. Tugasa: `SMS_QUOTA`.
- **Takror**: bir xil kalit — bitta xabar (`SMS_DUPLICATE`). Avtomatik eslatmalar kalit beradi (`PAYMENT_DUE:<o'quvchi>:<oy>`, `DEBT:<eslatma id>`).
- **Provayder javobi**: aniq rad — `FAILED`, byudjet qaytadi, o'sha kalit 3 martagacha qayta urinishi mumkin. Timeout / 5xx — `UNKNOWN`: yuborilgan bo'lishi mumkin, avtomatik qayta yuborilmaydi, byudjetda qoladi. So'rovga 20 s timeout.
- Loglarda telefon raqami niqoblangan (`+99890***67`), matn yozilmaydi.
- Narxlar o'zgartirilmagan.

Avtomatik eslatmalar (`reminders.service.ts`) faqat ACTIVE va davom etayotgan TRIAL markazlarga ishlaydi.

## 5. To'lanmagan sinovni o'chirish (`TRIAL_PURGE`, sukut bo'yicha O'CHIQ)

Batafsil: `trial-lifecycle.service.ts` izohi. Qisqasi: ikki xat (14 va 7 kun oldin) outbox orqali;
faqat provayder QABUL QILGAN xat hisoblanadi; provayder yo'q / xat ketmadi / oluvchi yo'q — o'chirish yo'q;
o'chirishdan oldin tranzaksiyada qayta tekshiruv (holat, sinov muddati, to'lov, xatlar, sana);
sinov uzaytirilsa yoki to'lov bo'lsa sikl bekor. Oldindan ko'rish (hech narsa yozmaydi/yubormaydi):
`GET /api/platform/trial-purge/preview`. Productionda yoqmang, avval preview'ni ko'ring.
