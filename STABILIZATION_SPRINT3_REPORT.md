# Uchinchi sprint: davomat dars bo'yicha, a'zolik tarixi. Yakuniy hisobot

Sana: 2026-10-12. Branch: `claude/admiring-goldberg-jkri02`.

**Ish joyi.** Vazifa matnida "cloud talabi ustuvor" deyilgan. So'ralganda yana "Shu yerda, lokal" tanlandi,
shuning uchun ish shu kompyuterda bajarildi: alohida test bazalari, sintetik akkauntlar. **Cloud preview
yo'q** (6-bo'limda BLOCKED). Push, PR, merge va deploy qilinmadi.

**CI.** `224e5ad` uchun CI holatini o'zim o'qiy olmadim (`gh` bu kompyuterda tizimga kirmagan). Vazifa
matnidagi raqamlar (unit 334/334, e2e 422/422 va h.k.) tashqi tekshiruvniki; bu hisobotdagi raqamlar
faqat shu sessiyada olingan.

## 1. Boshlang'ich va yakuniy holat

- Boshlang'ich SHA: `224e5ade7d2d4ea1e4523a2a302e35fe10e3c8ac` (GitHub'dagi branch uchi).
- Lokal commit'lar (GitHub'da yo'q), eskidan yangiga:

| Commit | Mazmuni |
|---|---|
| `4c9ba9e` | 1-band: guruh formasining konflikt endpointidagi ruxsat xatosi |
| `9dc3dd3` | 2-3-bandlar (backend): davomat dars bo'yicha, kredit shu darsniki |
| `b7fd3c2` | 4-band: a'zolik davrlari va ulardan foydalanadigan modullar |
| `f1e167d` | Frontend: dars tanlagich, kabinetda dars bo'yicha natija, a'zolik tarixi |
| `3976cb4` | 6-band: brauzer sayohatlari |
| oxirgi commit (`git log -1`) | Shu hisobot va checkpoint |

Aniq oxirgi SHA va hajm: `git log --oneline 224e5ad..HEAD`, `git diff --shortstat 224e5ad..HEAD`.

## 2. Tuzatilgan muammolar

1. **`GET /api/groups/schedule-conflicts` o'quvchi ismini ochardi.** Guruh nomi bo'lmagan to'qnashuvda (o'quvchining
   make-up'i) `name` maydoniga xabar matni yozilar, unda ism bo'lardi; endpoint har qanday guruh IDsiga javob
   berardi. Endi: so'rovchining roli, IDsi va ruxsatlari service'ga uzatiladi; javob tuzilishidan **oldin**
   `redactConflicts` qo'llanadi; guruh markazniki bo'lishi shart (aks holda 404); teacher faqat o'z guruhi
   haqida so'raydi (403); begona yoki yo'q teacher IDsi bo'sh javob beradi.
   Test: `group-conflicts-access.e2e-spec.ts` (3 ta; ikkitasi tuzatishdan oldingi kodda yiqiladi, tekshirildi).
2. **Bir kunda ikki darsli guruhda davomat bitta edi.** 3-bo'limdagi qoidalar.
3. **`ABSENT` krediti kun bo'yicha edi.** Endi shu darsning yo'qlamasiga bog'langan.
4. **Qayta qo'shilganda oldingi a'zolik davri yo'qolardi.** Endi har bir davr saqlanadi.
5. **Bitta o'quvchini bitta guruhga bir vaqtda ikki marta qo'shish 500 berardi** (yangi test topdi): mavjud
   yozuv guruh qulfidan oldin o'qilar edi. Endi qulf ostida qayta o'qiladi; ikkinchi so'rov 400 oladi.
6. **QR skaner sanani UTC bo'yicha olardi.** Endi markazning o'z kuni.

## 3. Davomat va a'zolik tarixining yakuniy qoidalari

**Davomat.**

- Belgi darsga tegishli: dars = jadval qatori (`attendance.schedule_id`) + sana. Belgi bilan birga darsning
  o'sha paytdagi boshlanish vaqti saqlanadi (`start_time`). `schedule_id` oddiy kalit, foreign key emas:
  dars jadvaldan o'chirilsa ham belgi va uning vaqti qoladi.
- Bir o'quvchi + bir dars + bir sana uchun bitta belgi (unique indeks, upsert): takroriy va parallel
  saqlash dublikat bermaydi. Bitta saqlash bitta tranzaksiya: bitta noto'g'ri yozuv bo'lsa hech narsa
  saqlanmaydi.
- Kunda bir nechta dars bo'lsa `scheduleId` shart (`LESSON_AMBIGUOUS`); bitta bo'lsa o'zi tanlanadi.
- Dars vaqti o'zgarsa belgi shu darsda qoladi (qator IDsi o'zgarmaydi).
- Bir martalik darslar ham xuddi shunday.
- Bekor qilingan darsga yangi belgi yozilmaydi (`LESSON_CANCELLED`, 409); oldingi belgilar tarix sifatida qoladi.
- Jadvalda dars yo'q kunga yoki jadval qatori yo'q guruhga belgi avvalgidek **kun bo'yicha** saqlanadi
  (`schedule_id` NULL).
- Teacher o'z guruhining darslarini yoki aynan o'ziga berilgan darsni (o'rinbosar) belgilaydi.
- Belgilanayotgan dars o'quvchiniki bo'lishi kerak (pastdagi a'zolik qoidasi, yumshoq rejim), aks holda
  `NOT_A_MEMBER`.
- QR skaner: hozir ketayotgan (boshlanishidan 30 daqiqa oldindan) yoki eng yaqin dars.
- Dars mavzusi (`lesson_topics`) hali ham guruh + kun bo'yicha: o'sha kunning barcha darslarida ko'rinadi.

**Eski yozuvlar (migratsiya 0053).** Eski belgi faqat o'sha sanada guruhning aynan bitta darsi bo'lsa
bog'lanadi. 0 yoki 2+ dars bo'lsa kun bo'yicha belgi bo'lib qoladi: hech bir darsga ko'paytirilmaydi yoki
taxminan biriktirilmaydi. Admin uchun: guruh sahifasidagi bildirishnoma, `GET /api/attendance/unbound`,
`npm run db:report-attendance-links`. Kimdir shu kun uchun aniq darsni tanlab belgi qo'ysa, eski kun
belgisi shu darsniki bo'ladi (qator IDsi o'zgarmaydi, unga berilgan kredit ham ergashadi).

**Make-up.** `ABSENT` krediti belgining darsini oladi (`origin_schedule_id`). Bir kundagi ikki yo'qlama
uchun ikki mustaqil kredit; bitta dars uchun ikkinchi kredit `DUPLICATE_CREDIT`. Davomat tuzatilsa faqat shu
darsning krediti hal qilinadi: ishlatilmagani bekor bo'ladi, bronlangani tuzatishni to'xtatadi
(`CREDIT_BOOKED`), ishlatilgani tarix bo'lib qoladi. `eligible` ro'yxati va `issue` bitta qoidadan
foydalanadi (`makeups/eligibility.ts`).

**A'zolik davrlari (`enrollment_periods`, migratsiya 0054).**

- Har bir davr bitta qator: `[started_at, ended_at)`. Boshlanish davrga kiradi, tugash kirmaydi.
- Bir o'quvchi + bir guruh uchun ko'pi bilan bitta ochiq davr (unique indeks). Eski davr qayta
  qo'shilishda ustidan yozilmaydi: yangi davr ochiladi.
- Davr ochiladi: guruhga qo'shilganda, o'quvchi yaratilganda, lid konvertatsiyasida, pauzadan/savatdan
  qaytganda. Yopiladi: guruhdan chiqarilganda (`LEFT_GROUP`), o'quvchi `PAUSED`, `LEFT`, `GRADUATED`
  bo'lganda yoki o'chirilganda (`REMOVED`).
- **PAUSED ma'nosi:** o'quvchi guruhdagi joyini saqlaydi (enrollment va sig'im qoidasi o'zgarmadi), lekin
  darslarda qatnashmaydi: davr yopiladi. Qayta faollashsa hali yozilgan har bir guruhda **yangi** davr ochiladi.
- Boshqa guruhga ko'chish: birida davr yopiladi, ikkinchisida ochiladi.
- "O'quvchi dars paytida guruhda bo'lganmi" degan savolga faqat `enrollments/membership.ts` javob beradi.
  Dars vaqti ma'lum bo'lsa lahza bo'yicha: `started_at <= t < ended_at` (10:00 da qo'shilgan o'quvchi o'sha
  kunning 09:00 darsida bo'lmagan; 12:00 da chiqqan 09:00 da bo'lgan, 15:00 da bo'lmagan). Faqat sana
  ma'lum bo'lsa kun bo'yicha: davr o'sha kunga tegsa (markazning vaqt zonasida).
- Ikki rejim. **Qat'iy** (davr ichida): markaz bekor qilgan dars uchun kredit, kalendar, kabinetdagi o'tgan
  darslar. **Yumshoq** (davr ichida yoki ma'lum bo'lgan birinchi davrdan oldin): davomat belgilash va
  `ABSENT` krediti, chunki markaz o'quvchini tizimga kechroq kiritib, oldingi darslarni keyin yozishi mumkin.
  Ikki davr orasidagi tanaffus va oxirgi davrdan keyingi vaqt hech bir rejimda o'quvchiniki emas.
- Foydalanuvchilar: make-up `eligible` va `issue`, davomat belgilash, student/parent kalendari (ICS, Google),
  kabinetdagi o'tgan darslar. Chatdagi guruh a'zoligi va sig'im avvalgidek joriy enrollment holatidan olinadi.

**Migratsiyada tarix o'ylab topilmadi.** Mavjud enrollment qatoridan ko'pi bilan bitta davr yasaladi va
`LEGACY` deb belgilanadi (boshlanishi qator bilgan oxirgi qo'shilish; undan oldingi davrlar bor-yo'qligi
noma'lum). Tugagan, lekin chiqish vaqti yozilmagan enrollment uchun davr yaratilmaydi. Yangi yozuvlar
`RECORDED`. O'quvchi sahifasida `LEGACY` davr "eski yozuvdan (taxminiy)" deb ko'rsatiladi.

## 4. Migratsiyalar va noaniq legacy yozuvlar

| Migratsiya | Nima |
|---|---|
| `0053_attendance_per_lesson` | `attendance.schedule_id`, `start_time`; ikki qisman unique indeks; bir ma'noli eski belgilarni bog'lash; kreditni belgi ortidan bog'lash |
| `0054_enrollment_periods` | `enrollment_periods` jadvali, indekslar, mavjud enrollment'lardan `LEGACY` davrlar |

Ikkalasi idempotent. Yangi konfiguratsiya o'zgaruvchisi yo'q. Yangi buyruqlar:
`npm run db:report-attendance-links`, `npm run db:report-membership`.

**Lokal dev baza (`talimcrm`, demo ma'lumot) uchun haqiqiy sonlar** (qo'llashdan oldin zaxira:
`backend/backups/talimcrm_before_0053_2026-10-12.dump`):

| Ko'rsatkich | Son |
|---|---|
| Davomat belgilari | 602 |
| Darsga bog'landi | 83 |
| Jadval qatori yo'q guruhlardagi kun belgilari (bog'lash uchun dars yo'q) | 418 |
| Jadvali bor guruhda bog'lanmagan (noaniq legacy) | 101 belgi, 84 kun |
| shundan "o'sha kuni bir nechta dars" | 0 |
| shundan "o'sha kuni jadvalda dars yo'q" | 84 kun |
| A'zolik davrlari | 2506, hammasi `LEGACY`; ochiq 2195, yopiq 311 |
| Davrsiz enrollment (tugash vaqti noma'lum) | 0 |
| Ustma-ust davrlar | 0 |

Production bazasi uchun sonlar o'sha yerda `db:report-*` buyruqlari bilan olinadi; bu yerda production
ma'lumotiga tegilmadi.

**Yangilash sinovi** (dev bazaning nusxasi, 0052 holatida, ichiga eski uslubdagi sintetik qatorlar qo'shilgan):
mavjud jadvallardagi qatorlar soni, IDlar, statuslar, sanalar va to'lov summalari o'zgarmadi; bitta darsli
kunning belgisi bog'landi, ikki darsli kunniki tegilmadi; kredit belgi ortidan bog'landi; chiqish vaqti
yo'q enrollment davr olmadi; runner qayta yuritilganda "up to date"; ikkala fayl qo'lda ikkinchi marta
yuritilganda xato yo'q va ma'lumot o'zgarmadi; sxema farqi yo'q. Build qilingan ilova shu nusxada ishga
tushirildi (tashqi integratsiyalar o'chirilgan holda), login va so'rovlar javob berdi, qayta ishga
tushirilgandan keyin ma'lumot bir xil. Nusxa o'chirildi.

## 5. Bajarilgan testlar va haqiqiy natijalar (shu sessiyada)

| Tekshiruv | Buyruq | Natija |
|---|---|---|
| Backend typecheck | `npx tsc --noEmit` | xatosiz |
| Backend lint | `npx oxlint src/ test/` | exit 0 |
| Backend unit | `npx vitest run` | 343 tadan 342; 1 tasi yiqildi (`outbound-url.spec.ts`: Windows'da `openssl` yo'q) |
| Backend API/e2e (haqiqiy PostgreSQL) | `npx vitest run --config ./vitest.config.e2e.ts` | 59 fayl / 439 test, hammasi o'tdi |
| Backend build | `npm run build` | o'tdi |
| Migratsiya jurnali | `npm run db:check-migrations` | 55 migratsiya, mos |
| Bo'sh baza va yangilash zanjiri | `npm run db:verify-migrations` | "Migration chain verified" |
| Sxema farqi (dev baza, yangilangan nusxa) | `npm run db:check-drift` | farq yo'q |
| Frontend typecheck | `npx tsc --noEmit` | xatosiz |
| Frontend lint | `npm run lint` | 0 xato, 75 ogohlantirish (sprint boshida 73) |
| Frontend unit | `npm test` | 55 / 55 |
| Frontend production build | `npm run build:frontend` (e2e-browser) | o'tdi |
| Brauzer testlari | `PW_CHANNEL=chrome npx playwright test` | 47 / 47 o'tdi (10.8 daqiqa): 45 mavjud + 2 yangi |
| Google brauzer testi (soxta Google) | `PW_CHANNEL=chrome npm run test:google` | 1 / 1 o'tdi |

Yangi testlar: `group-conflicts-access` (3), `attendance-per-lesson` (9), `membership-history` (5),
`membership.spec` (4, unit), `past-lessons-per-lesson.spec` (5, unit), brauzer `attendance-membership.spec` (2).

Yashirmasdan:

- To'liq e2e bu sprintda to'rt marta yuritildi. Dastlabki uchtasida `staff-access.e2e-spec.ts` yiqildi:
  har bir ruxsat uchun har bir yo'lni aylanadigan test 30 soniyalik chegaraga urildi (kesh sovuq, 59 fayl
  parallel; birida dev serverlar ham yoqiq edi). Alohida yuritilganda 9/9 o'tdi. Timeout oshirilmadi, test
  o'zgartirilmadi (faqat yangi admin yo'li ro'yxatiga qo'shildi). Oxirgi to'liq yurgizishda u ham o'tdi:
  439 / 439. Bu test sekin mashinada yana yiqilishi mumkin.
- Ikki eski unit test faylidagi soxta baza obyektlari yangi so'rovlarga mos kelmay yiqildi; mock'lar
  to'ldirildi (ilova kodi emas).
- `membership-history` testining birinchi yurgizishida 5 tadan 3 tasi yiqildi: bittasi haqiqiy xato
  (2-bo'lim, 5-band), ikkitasi testning o'zidagi sana hisobi.
- Brauzer sayohatining oxirgi qadami ikki marta test tomonidagi sabab bilan yiqildi (7-bo'lim, birinchi band;
  tugash vaqti kiritilmagan edi).

**Moliyaviy ta'sir.** To'lov, qarzdorlik va o'qituvchi hisob-kitobi kodi o'zgartirilmadi; ular enrollment
va davomat qatorlaridan avvalgidek foydalanadi. Dalil: tegishli mavjud e2e to'plamlari (to'lovlar, ledger,
payroll, hisobotlar) o'zgarishsiz o'tdi; yangilash sinovida to'lovlar soni va summasi bir xil. Bitta
ma'noviy o'zgarish bor: bir kunda ikki darsli guruhda endi ikki belgi bo'lishi mumkin, shuning uchun
belgilar sonini sanaydigan ko'rsatkichlar (davomat foizi, hisobotlar) o'sha kunni ikki dars deb sanaydi.
Eski ma'lumotda bunday kunlar yo'q edi (har o'quvchi + guruh + kun uchun bitta belgi), shuning uchun
tarixiy raqamlar o'zgarmaydi.

## 6. BLOCKED yoki tekshirilmagan

- **BLOCKED: cloud muhiti va cloud preview.** Bu cloud sessiya emas; tashqaridan ochiladigan URL yo'q. Lokal
  manzil (`http://localhost:3000`, `http://bilimdon.localhost:3000`) cloud preview emas va faqat shu
  kompyuterda, serverlar yoqilganda ochiladi.
- **BLOCKED: `224e5ad` uchun yakuniy CI holati.** `gh` tizimga kirmagan.
- **BLOCKED: haqiqiy Google, Telegram, SMS, email, to'lov tizimlari.** Test kalitlari yo'q; Google faqat
  soxta server bilan.
- **Davomat eksporti (Excel) va Telegram botdagi davomat ko'rinishi.** Kod o'qildi (qatorlarni sanaydi yoki
  ro'yxatlaydi), alohida test yozilmadi.
- **Brauzerda yozilmagan:** o'quvchini boshqa guruhga ko'chirish va pauza (API testida bor); kabinetdagi
  "o'tgan darslar" ro'yxati sahifa orqali (API orqali tekshirildi, davomat ro'yxati sahifa orqali);
  bir martalik darsga davomat (API testida bor).
- **Haqiqiy telefon.** Faqat 390 px emulyatsiya.
- **Production migratsiyasi.** Faqat dev baza va uning nusxasida.

## 7. Bilib qo'yish kerak bo'lganlar

- **Guruhlar sahifasi faqat `groups.view` + `groups.edit` bor akkauntga "Forbidden resource" ko'rsatadi:**
  sahifa o'qituvchilar ro'yxatini ham yuklaydi va unga `teachers.view` kerak. Ma'lumot ochilmaydi, lekin
  bunday cheklangan akkaunt sahifadan foydalana olmaydi. Brauzer testida akkauntga `teachers.view` va
  `schedule.view` ham berildi. Tuzatilmadi.
- Guruh sahifasidagi davomat ro'yxati hozirgi a'zolarni ko'rsatadi: guruhdan chiqib ketgan o'quvchini
  o'tgan dars uchun API orqali belgilash mumkin, sahifa orqali emas.
- Kun bo'yicha belgi ikki darsli kunda kabinetda har ikki dars yonida "kun uchun umumiy belgi" deb
  ko'rinadi va hech birining o'z belgisi hisoblanmaydi.
- Aniq darsni tanlab belgi qo'yish eski kun belgisini shu darsga o'tkazadi. Bu inson qarori; agar eski
  belgi aslida boshqa dars uchun bo'lgan bo'lsa, uni tizim bila olmaydi.
- `LEGACY` davrdan oldingi tarix noma'lum: yumshoq rejim uni "o'quvchiniki bo'lishi mumkin" deb oladi,
  qat'iy rejim olmaydi.
- Google: oldingi sprintdagi kechiktirish hali kuchda (dev ulanishingizda avtomatik sinxronlash 18-oktabrgacha
  to'xtatilgan).

## 8. Patch va bundle

Repozitoriy ildizidagi `handoff/` papkasida (git'ga kirmaydi):

- `handoff/sprint3-224e5ad..HEAD.patch`: `git am` uchun.
- `handoff/sprint3.bundle`: `git fetch handoff/sprint3.bundle HEAD` bilan olinadi.

## 9. Keyingi eng muhim vazifalar

1. Commit'larni ko'rib chiqib push qilish (CI shunda ishga tushadi).
2. Guruhlar sahifasini cheklangan akkaunt uchun ishlaydigan qilish (o'qituvchilar ro'yxatisiz ham ochilsin).
3. Davomat ro'yxatida o'tgan dars uchun o'sha paytdagi a'zolarni ko'rsatish.
4. Dars mavzusini ham dars darajasiga o'tkazish.
5. Excel eksport va Telegram ko'rinishida dars vaqtini ko'rsatish; ularga test.
6. Production'da migratsiyadan oldin `db:report-*` bilan noaniq yozuvlar sonini ko'rish.
