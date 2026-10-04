# Birinchi markazni ulash (cheklangan pilot)

Pilot **qo'lda to'lov** bilan o'tadi: Telegram, SMS, Click va Payme sozlanmaydi, chunki ular sinov muhitida tekshirilmagan. Real o'quvchi ma'lumotlarini yuklash, real xodimlarni taklif qilish va xabar yuborish faqat markaz egasining aniq roziligidan keyin qilinadi.

## Pilotda ishlamaydigan imkoniyatlar

| Imkoniyat | Pilotda | Nima qilinadi |
|---|---|---|
| Onlayn to'lov (Click, Payme), kabinetdagi "to'lash" tugmasi | ko'rinmaydi | to'lov kassada qabul qilinadi va hisobchi tizimga kiritadi |
| Telegram xabarlari (davomat, to'lov, qarz eslatmasi, ota-ona boti, lid haqida xabar) | yo'q | ota-onaga qo'ng'iroq yoki shaxsiy xabar |
| SMS | yo'q | — |
| Kabinetga Telegram orqali kirish | yo'q | telefon raqami va markaz bergan PIN |
| Email (parolni tiklash xati) | yuborilmaydi, faqat server logida | parolni markaz administratori yoki texnik yordam qayta o'rnatadi |
| Avtomatik eslatmalar | o'chiq | — |
| AI imkoniyatlari | kalit bo'lmasa ishlamaydi | alohida qaror |

## 1. Markaz

- [ ] Markaz nomi, telefoni, logotipi.
- [ ] Manzil (subdomen): `<nom>.<domen>`. Keyin o'zgartirsa, xodimlarning saqlangan havolalari ishlamay qoladi.
- [ ] Vaqt zonasi: Asia/Tashkent; valyuta: UZS.
- [ ] Filial(lar).

## 2. Xodimlar va rollar

Har bir xodim o'z hisobi bilan taklif qilinadi; umumiy parol ishlatilmaydi.

| Rol | Kim | Nima qila oladi |
|---|---|---|
| Rahbar (OWNER) | markaz egasi | hamma narsa, xodimlarni boshqarish, markazni o'chirish |
| Administrator | | guruhlar, o'quvchilar, o'qituvchilar, sozlamalar |
| Hisobchi | | to'lovlar, chegirmalar, hisob-fakturalar, qarzdorlar, hisobotlar |
| O'qituvchi | | faqat o'z guruhlari: davomat, uy vazifasi; to'lovlarni ko'rmaydi |
| Qabulxona / menejer | | lidlar, sinov darslari |

- [ ] Xodim o'chirilsa, ochiq turgan brauzeri ham darhol yopilishini rahbar biladi.

## 3. Guruhlar va o'quvchilar

- [ ] Har guruh: fan, o'qituvchi, filial, dars kunlari va vaqti, oylik narxi, sig'imi, boshlangan sanasi.
- [ ] Har o'quvchining guruhga **haqiqiy qo'shilgan sanasi** kiritiladi: qarz shu sanadan hisoblanadi.
- [ ] O'quvchi va ota-ona telefonlari.

## 4. Boshlang'ich qoldiqlar va eski qarz

- [ ] Tizimga o'tish oyi kelishiladi (masalan, noyabr).
- [ ] O'tish oyidan oldingi qarzlar va ortiqcha to'lovlar qanday kiritilishi hisobchi bilan yozma kelishiladi.
- [ ] O'tgan oylar narxini hisobchi tasdiqlaydi ("narx tarixi"). Tasdiqlanmagan o'tgan narx qarz sifatida ko'rsatilmaydi va u bo'yicha eslatma yuborilmaydi.

## 5. O'quvchi va ota-ona kabineti

- [ ] O'quvchi sahifasida "PIN yaratish". PIN faqat bir marta ko'rsatiladi; uni o'quvchiga yoki ota-onaga shaxsan beriladi.
- [ ] Kirish: `<nom>.<domen>/portal` → telefon raqami → PIN. Ota-ona o'z telefoni va o'sha PIN bilan kiradi.

## 6. Kundalik mas'uliyat

| Ish | Mas'ul | Qachon |
|---|---|---|
| To'lovni kiritish, chegirma | hisobchi (yoki qabulxona) | to'lov kuni; kvitansiya chop etiladi |
| Davomat | o'qituvchi | dars kuni |
| Yangi lidlar, sinov darslari | qabulxona/menejer | har kuni |
| Oylik qarzdorlar ro'yxati | hisobchi | har oy boshida |

## 7. Zaxira, tiklash va yordam

- [ ] Tungi zaxira ishlayapti: `bash scripts/production/stack.sh ps db-backup` → `healthy`.
- [ ] Off-server nusxa sozlangan va ishlayapti: `sudo bash scripts/production/offsite.sh status --check` → `STATUS OK`.
- [ ] Zaxiradan tiklash mashqi pilot serverida kamida bir marta o'tkazilgan (`restore.sh`, masofaviy nusxadan — `offsite.sh fetch`).
- [ ] Mas'ul shaxs belgilangan: zaxira holatini kim kuzatadi, tiklashni kim boshlaydi.
- [ ] Off-server shifrlash kaliti va `rclone.conf` nusxasi serverdan tashqarida, mas'ul shaxsda saqlanadi.
- [ ] Muammo bo'lsa kimga murojaat qilinadi (telefon yoki chat) va `RUNBOOK.md` qayerda.

## 8. Pilotni boshlashdan oldin

- [ ] Staging haqiqiy domenda tekshirilgan: `verify-flows.mjs` va brauzer testlari (`npm run test:staging`) o'tgan.
- [ ] Production `.env`: o'z sirlari; `preflight.sh` toza; `release-info.sh` → RELEASE OK.
- [ ] Markaz egasi yuqoridagi "pilotda ishlamaydigan imkoniyatlar" ro'yxatini ko'rgan va rozi.
