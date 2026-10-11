# Ikkinchi barqarorlashtirish sprinti: yakuniy hisobot

Sana: 2026-10-11. Branch: `claude/admiring-goldberg-jkri02`.

**Ish joyi.** Vazifa matnida "cloud muhiti" deyilgan. Ish oldingi sprintdagi tanlov bo'yicha **lokal
kompyuterda** bajarildi (alohida test bazalari, sintetik akkauntlar). Shu sabab cloud preview havolasi
yo'q: bu BLOCKED deb 6-bo'limda yozilgan. Push, PR, merge va deploy qilinmadi.

**Oldingi hisobot bilan solishtirish.** `STABILIZATION_SPRINT_REPORT.md` da "push qilinmadi" va "CI ishga
tushmadi" deyilgan. Bu eskirgan: `40b8721` keyin push qilingan. Vazifa matniga ko'ra shu commit uchun CI
o'tgan; men buni o'zim tekshira olmadim (`gh` bu kompyuterda tizimga kirmagan), shuning uchun bu
hisobotda CI natijasi mening kuzatuvim sifatida keltirilmaydi.

## 1. Boshlang'ich va yakuniy holat

- Boshlang'ich SHA: `40b8721aec656c9d56113ec7ed1c0a2f79300fc9` (GitHub'dagi branch uchi).
- Lokal commit'lar (GitHub'da yo'q), eskidan yangiga:

| Commit | Mazmuni |
|---|---|
| `af62be9` | 1-4-bandlar: darsning identifikatori, guruh/jadval uchun yagona yozish qoidasi, guruhni o'chirish/tiklash, kredit asosi |
| `e3e1f26` | 5-band: Google ulash holatlari va worker egaligi |
| `f4c2d76` | 7-band: yuklama o'lchovi, chat va konflikt tekshiruvini yengillatish; 6-band brauzer testlari |
| oxirgi commit (`git log -1`) | Shu hisobot va checkpoint fayli |

Aniq oxirgi SHA va hajm: `git log --oneline 40b8721..HEAD`, `git diff --shortstat 40b8721..HEAD`.

## 2. Tuzatilgan muammolar va ularni ushlaydigan testlar

**1-band. Make-up aynan tanlangan darsga bog'lanadi.**

- Sabab tasdiqlandi: `makeup-reconcile.ts` bronni sana + boshlanish vaqti bilan qidirar, topilmasa shu
  kundagi yagona qolgan darsga ko'chirardi. 09:00 darsi o'chirilsa bron 15:00 ga o'tardi.
- Endi dars = jadval qatori (`schedules.id`) + sana. Bron `target_schedule_id`, bekor qilish `schedule_id`,
  bekor qilingan dars uchun kredit `origin_schedule_id` orqali shu qatorni ko'rsatadi; ICS/Google UID
  `les-<qator>-<sana>`. Qator har qanday tahrirda (jadval sahifasi ham, guruh formasi ham) o'z IDsini
  saqlaydi, shuning uchun vaqtlar tartibi o'zgarsa ham identifikator almashmaydi.
- Qoida: dars vaqti o'zgarsa bron ergashadi; qator o'sha sanada dars bermay qo'ysa (o'chirildi, bekor
  qilindi, boshqa kunga ko'chdi, guruh yopildi) bron bekor qilinadi va kredit qaytadi. Boshqa darsga
  hech qachon ko'chirilmaydi.
- Bir kundagi ikki darsdan bittasini alohida bekor qilish mumkin (ikkita bo'lsa API qaysi biri ekanini
  so'raydi: `LESSON_AMBIGUOUS`).
- Migratsiya (`0051`): ochiq bron faqat aynan bitta dars mos kelsa bog'lanadi. Noaniq (0 yoki 2+ mos)
  bronlar tegilmaydi. Hisobot: `npm run db:report-makeup-links` (faqat o'qiydi). Xavfsiz qoida: bog'lanmagan
  bron shu guruh jadvali keyingi safar o'zgarganda ham bitta darsga mos kelmasa bekor qilinadi va kredit
  qaytadi; taxminan boshqa darsga biriktirilmaydi.
- Testlar: `lesson-identity.e2e-spec.ts` "a lesson is its timetable row" (5 ta), jumladan qabul mezoni:
  09:00 o'chirildi → bron `CANCELLED`, kredit `ISSUED`, 15:00 da bron yo'q.

**2-band. Guruh va jadval uchun yagona yozish qoidasi.**

- `GroupsService.create/update/remove/restore` endi guruh va uning haftalik darslarini bitta tranzaksiyada
  yozadi: avval markaz jadvali qulfi, keyin o'qish, keyin jadval sahifasining o'z tekshiruvi
  (`ScheduleService.findConflicts`: o'qituvchi, xona, umumiy o'quvchilar, make-up, bir martalik darslar).
  Konflikt bo'lsa hamma narsa orqaga qaytadi (yarim yangilangan guruh qolmaydi).
- Qatorlar joyida o'zgartiriladi. Faqat nom/tavsif o'zgarsa darslarga tegilmaydi. Formadagi vaqt
  o'zgarsa faqat formaning eski vaqtida turgan qatorlar ko'chadi; jadvalda o'z vaqti berilgan kun
  tekislanmaydi.
- Konflikt tekshiruvi sanani biladi: o'sha sanada bekor qilingan dars, hali boshlanmagan guruh va
  tugallangan/arxivlangan guruh vaqtni band qilmaydi. Bekor qilingan darsni tiklashda vaqti band bo'lib
  qolgan bo'lsa rad etiladi (`RESTORE_CONFLICT`).
- Testlar: "the group form and the timetable page decide alike" (5 ta): bir xil o'zgarish ikki yo'ldan
  bir xil konflikt turlarini beradi; rad etilgan saqlashdan hech narsa qolmaydi; parallel uchta guruh
  yaratishdan bittasi o'tadi.

**3-band. Guruhni o'chirish, arxivlash, tiklash.**

- O'chirish yoki `COMPLETED`/`ARCHIVED` ga o'tkazish: kelajakdagi ochiq bronlar bekor qilinadi, kredit bir
  marta qaytadi; o'tgan va belgilangan yozuvlar tegilmaydi; javobda `makeups.released`, auditda
  `releasedMakeups`; sahifada xabar chiqadi.
- Tiklash: darslari yagona qoida bilan qayta tekshiriladi, konflikt bo'lsa guruh savatda qoladi; bekor
  qilingan bronlar qayta faollashmaydi.
- Testlar: "deleting and restoring a group" (2 ta, jumladan o'chirish/tiklash bilan bron parallel, 4 raund).

**4-band. Kredit asosi.**

- `issue` endi tranzaksiyada va jadval qulfi ostida (darsni tiklash oladigan qulf): yo kredit bor va
  tiklash rad etiladi, yo dars tiklangan va kredit berilmaydi.
- `ABSENT` belgisi `FOR SHARE` bilan o'qiladi. Davomat tuzatilsa: ishlatilmagan kredit bekor qilinadi
  (`ATTENDANCE_CORRECTED`), darsga yozilgan kredit bo'lsa tuzatish rad etiladi (`CREDIT_BOOKED`, shu
  saqlashdagi boshqa belgilar ham yozilmaydi), ishlatilgan kredit tarix sifatida qoladi.
- `eligible` ro'yxati va `issue` bitta qoidadan foydalanadi (`makeups/eligibility.ts`), kunlar markaz vaqt
  zonasida hisoblanadi (oldin UTC edi).
- Savollarga javob: dars sanasidan oldin chiqib ketgan o'quvchiga kredit berilmaydi. Chiqib-qayta kirgan
  o'quvchining faqat oxirgi qo'shilgan kuni saqlanadi (bazada tarix yo'q): oldingi davrdagi bekor
  qilingan dars uchun kredit berilmaydi, o'sha davrda qo'yilgan `ABSENT` belgisi uchun beriladi (belgi
  o'zi dalil). Bu cheklov 7-bo'limda.
- Testlar: "a credit has a basis that is still true" (4 ta, jumladan ikki parallel poyga).

**5-band. Google ulash va worker.**

- Sabab tasdiqlandi: `listCalendars` xato bersa `accountKey = null` bo'lib, "boshqa hisob" deb qabul
  qilinar va eski tadbirlar/bog'lanishlar o'chirilardi.
- Endi uch xil natija: bir xil hisob (tasdiqlangan), boshqa hisob (tasdiqlangan), noma'lum. Noma'lum
  bo'lsa (429, 5xx, timeout, bo'sh ro'yxat, primary yo'q) hech narsa o'zgarmaydi: kalendar, token,
  tadbirlar joyida (`?google=unverified`).
- Boshqa hisob: eski hisob oddiy disconnect tozalashi bilan tozalanadi (holatda ko'rinadi, backoff bilan
  qayta uriniladi), yangi ruxsat kutib turadi va tozalash tugagach ulanishga aylanadi.
- `accountKey` yo'q eski ulanishlar: o'z kalendari yangi hisobda bo'lsa bir xil; aks holda eski ruxsat
  orqali so'raladi; eski ruxsat o'lgan bo'lsa tadbirlar o'z IDsi bilan joyida yangilanadi (nusxa chiqmaydi).
- Lease egasi bor (`lock_token`), har bir Google yozuvidan oldin yangilanadi. Workerning har bir yozuvi
  o'z tokeniga shartli: lease'ni yo'qotgan worker yangi egasining qulfini bo'shata olmaydi, ulanishni
  o'chira yoki holatini ustidan yoza olmaydi. Ikki bir vaqtdagi callback advisory lock bilan tartiblanadi.
- Testlar: `calendar-google-states.e2e-spec.ts` (24 ta): 5 xil "noma'lum" holat × 2 hisob, migratsiyalangan
  ulanishlar (4), hisob almashtirish (3), poygalar (6: cleanup paytida reconnect, sync paytida hisob
  almashtirish, ikki callback, lease'dan uzoq sync, to'xtagan worker va davomchisi, lease'ni yo'qotgan
  cleanup). **Hammasi soxta Google bilan.**

**6-band. Brauzer.**

- Make-up formasi: A guruhdan B ga tez o'tilganda A ning kechikkan javobi B ro'yxatini almashtirmaydi
  (tuzatildi; test 3 soniya kechiktirilgan javob bilan).
- Yangi fayl `e2e-browser/tests/lesson-identity.spec.ts` (2 ta sayohat), 3-bo'limda amallar ro'yxati.

**7-band. Yuklama.** 4-bo'limda raqamlar. O'lchovdan keyin ikkita o'zgarish: chat yetkazishda xodimlar
oqimi har yetkazishda 2 ta so'rov bilan tekshiriladi (oldin har oqim uchun alohida), "o'qiy oladimi"
har o'quvchi uchun bir marta so'raladi; konflikt tekshiruvi nomzodlarni SQL'da hafta kuni/sana bo'yicha
toraytiradi. Ruxsat har yetkazishda bazadan qayta o'qiladi, xabarlar orasida hech narsa keshlanmaydi;
ruxsat bekor qilish testlari (`chat-instances`, `chat`) o'zgarishsiz o'tdi.

## 3. Brauzerda tekshirilgan amallar (sahifa bo'yicha)

Faqat haqiqatan bajarilgan amallar. "Sahifa ochildi" tekshiruv hisoblanmagan.

| Sahifa | Bajarilgan amallar | Test |
|---|---|---|
| Qoplash darslari → Kreditlar → "Darsga yozish" | Guruh A tanlash, darhol guruh B tanlash (A javobi 3 s kech); ro'yxatda faqat B darslari; bir kundagi ikki darsdan ikkinchisini tanlash; yozish; API'da bron aynan shu darsga bog'langani | `lesson-identity.spec.ts` (yangi) |
| Guruh sahifasi → "Darsni bekor qilish" | Ikki dars alohida taklif qilinadi; bittasini bekor qilish; "1 ta qoplash yozuvi bekor bo'ldi" xabari; ikkinchi dars joyida | yangi |
| Guruh sahifasi → "Guruhni o'chirish" | Tasdiqlash; bekor bo'lgan bron haqida xabar; guruhlar ro'yxatiga qaytish | yangi |
| Kabinet (ota-ona telefoni + PIN) → Jadval | O'chirishdan oldin make-up ko'rinadi; ICS havolasi yaratish; o'chirishdan keyin make-up yo'q, ICS'da faol tadbir yo'q, o'z guruhi darslari joyida | yangi |
| Lid → o'quvchi konvertatsiyasi custom maydon bilan | Mavjud `custom-fields.spec.ts` | mavjud |
| Qolgan 39 ta mavjud sayohat | O'zgarishsiz | mavjud |

**Brauzerda yozilmadi** (vaqt yetmadi; API darajasidagi qamrov ko'rsatilgan):

- Platforma admin sahifalari (sozlamalar, obuna, qo'lda to'lov, kalitlar): API testi `platform-admin.e2e-spec.ts` bor.
- Jadval: sudrab ko'chirish, tugma orqali ko'chirish, undo, konflikt oynasi: API testlari bor, brauzer testi yo'q.
- Guruh formasi orqali vaqt o'zgartirish: API testi bor (`lesson-identity.e2e-spec.ts`), brauzer testi yo'q.
- Chat ruxsati olib tashlangandan keyingi ochiq tab: API testi bor (`chat-instances.e2e-spec.ts`), brauzer testi yo'q.
- Ikki markazli brauzer tekshiruvi: yangi sayohatlar bitta markazda; ikki markaz izolyatsiyasi mavjud
  `role-boundaries.spec.ts` va API testlarida.
- Klaviatura bilan asosiy amallar: yangi sayohatlarda alohida tekshirilmadi (mavjud `a11y.spec.ts` va
  `mobile.spec.ts` o'zgarishsiz).

## 4. Haqiqiy test natijalari (shu sessiyada)

| Tekshiruv | Buyruq | Natija |
|---|---|---|
| Backend typecheck | `npx tsc --noEmit` | xatosiz |
| Backend lint | `npx oxlint src/ test/` | exit 0 |
| Backend unit | `npx vitest run` | 334 tadan 333; 1 tasi yiqildi (`outbound-url.spec.ts`, Windows'da `openssl` yo'q) |
| Backend API/e2e (haqiqiy PostgreSQL) | `npx vitest run --config ./vitest.config.e2e.ts` | 56 fayl / 422 test, hammasi o'tdi |
| Backend build | `npm run build` | o'tdi |
| Migratsiya jurnali | `npm run db:check-migrations` | 53 migratsiya, mos |
| Bo'sh baza va yangilash zanjiri | `npm run db:verify-migrations` | "Migration chain verified" |
| Frontend typecheck | `npx tsc --noEmit` | xatosiz |
| Frontend lint | `npm run lint` | 0 xato, 73 ogohlantirish |
| Frontend unit | `npm test` | 55 / 55 |
| Frontend production build | `npm run build:frontend` (e2e-browser) | o'tdi |
| Brauzer testlari | `PW_CHANNEL=chrome npx playwright test` | 41 / 41 o'tdi (8.4 daqiqa): 39 ta mavjud + 2 ta yangi |
| Google brauzer testi (soxta Google) | `PW_CHANNEL=chrome npm run test:google` | 1 / 1 o'tdi (ikkinchi urinishda, pastga qarang) |

Yashirmasdan:

- Birinchi to'liq e2e yurgizishda 6 ta test yiqildi. 3 tasi (`calendar.e2e`) yangi Google to'plami bilan
  parallel yurganda bir-birining ulanishini o'z soxta Google'i bilan sinxronlagani uchun edi (test
  izolyatsiyasi, mahsulot xatosi emas): `syncDue` ga markazlar ro'yxati qo'shildi va uchala to'plam faqat
  o'z markazlarini sinxronlaydi. 3 tasi (`staff-access`) yuklama ostida 30 soniyalik chegaraga urildi;
  alohida va keyingi to'liq yurgizishda o'tdi. Yakuniy to'liq yurgizish: 422 / 422.
- Yangi brauzer testlari birinchi marta eski backend build bilan yurgizildi va ikkalasi yiqildi; backend
  qayta build qilingach o'tdi.
- Google brauzer testi to'liq brauzer to'plamidan keyin darhol yuritilganda yiqildi: login sahifasi 30
  soniyada "load" holatiga yetmadi (testning o'z qadamlarigacha bormadi). Alohida qayta yuritilganda o'tdi.
  Xuddi shunday yuklanish kechikishi oldingi sprintda ham bir marta kuzatilgan; sababi aniqlanmadi.
- Yuklama o'lchovining birinchi urinishi kompyuter uyquga ketgani uchun buzildi (bitta test "1398 s").
  Qayta yuritildi; sessiya davomida uyquni to'xtatib turish so'raldi.

**Yuklama o'lchovi** (`npm run test:load`, ikki API jarayoni, bitta PostgreSQL, shu noutbukda, e2e bazasi;
DB tranzaksiyalari `pg_stat_database` farqi bo'yicha, taxminiy):

| O'lchov | Oldin | Keyin |
|---|---|---|
| Chat, 400 ochiq oqim: xabar hamma oqimga yetishi (p50) | 537 ms | 65 ms |
| Chat, 400 oqim: bitta xabar uchun DB tranzaksiyalari | ~1058 | ~154 |
| Chat, 160 oqim: yetishi (p50) / tranzaksiyalar | 258 ms / ~415 | 31 ms / ~84 |
| Chat, 400 oqim + o'qimaydigan bitta sekin mijoz: yetishi (p50) | 446 ms | 66 ms |
| Chat, 400 dan 200 oqim birdan qayta ulanishi | 1180 ms | 902 ms |
| LISTEN uzilishi: mijozlarga `resync` kelishi | 2137 ms | 2147 ms |
| Konflikt tekshiruvi, 600 haftalik dars / 200 guruh / 1500 o'quvchi, bittadan (p50) | 104-113 ms | 91 ms |
| 40 ta tekshiruv birdan (p50) | 1981 ms | 1459 ms |
| Bitta darsni ko'chirish (qulf + tekshiruv + make-up) | 47 ms | 65 ms |

Xatolar: o'lchov davomida rad etilgan so'rov yoki yo'qolgan/takror xabar bo'lmadi. Izoh: o'lchovda 8 ta
foydalanuvchi ko'p oqim ochgan; har bir oqim alohida foydalanuvchi bo'lsa "o'qiy oladimi" so'rovi
foydalanuvchi soniga teng bo'ladi (sessiya va a'zolik so'rovlari baribir 2 ta). 40 ta tekshiruv birdan
natijasi test muhitidagi 4 ta ulanishli pool bilan olingan.

**Migratsiya, ma'lumotli bazadan yangilash.** Dev bazaning (`40b8721` holati, 0050 gacha) nusxasida:
0051 va 0052 qo'llandi; bron, kredit, davomat, bekor qilish, calendar link va boshqa jadvallardagi
qatorlar soni, IDlar, statuslar, sanalar va event key'lar o'zgarmadi (3 bron, 4 kredit, 602 davomat,
107 calendar link); bitta mos darsli bron bog'landi, ikki nomzodli va nomzodsiz bronlar tegilmadi va
hisobotda chiqdi; migratsiya runner qayta yuritilganda "up to date"; ikkala fayl qo'lda ikkinchi marta
yuritilganda xato yo'q va ma'lumot o'zgarmadi; sxema farqi yo'q. Nusxa o'chirildi. Ilova o'sha nusxada
ishga tushirilmadi (nusxada haqiqiy kontaktlar bo'lishi mumkin, pollerlar ularga tegmasligi uchun).

## 5. Migratsiyalar va konfiguratsiya

| Migratsiya | Nima |
|---|---|
| `0051_lesson_identity` | `makeup_bookings.target_schedule_id`, `lesson_cancellations.schedule_id`, `makeup_credits.origin_schedule_id`, indekslar, ochiq bronlarni bir ma'noli bog'lash |
| `0052_calendar_lease_owner` | `calendar_connections.lock_token`, `next_access_token_enc`, `next_refresh_token_enc`, `next_token_expires_at`, `next_account_key` |

Ikkalasi idempotent. Yangi konfiguratsiya o'zgaruvchisi yo'q. Yangi buyruqlar: `npm run db:report-makeup-links`,
`npm run test:load`.

**Lokal dev baza (`talimcrm`).** Sayt shu kompyuterda ishlashi uchun ikkala migratsiya qo'llandi; oldin
zaxira olindi (`backend/backups/talimcrm_before_0051_2026-10-11.dump`). Bog'lanmagan ochiq bron: 0.

**Google haqida muhim.** Dars UID'i o'zgargani uchun mavjud Google ulanishlarida keyingi sinxronlashda
eski tadbirlar o'chirilib, yangilari yaratiladi (bir marta). Sizning dev ulanishingizda bu sizdan
so'ramasdan bo'lmasligi uchun avtomatik sinxronlash 7 kunga kechiktirildi (`next_attempt_at`). Kalendar
sahifasida "Hozir sinxronlash" bosilsa yoki 7 kun o'tsa, tadbirlar bir marta qayta yaratiladi.

## 6. Tekshirilmagan yoki BLOCKED

- **BLOCKED: cloud muhiti va cloud preview.** Ish lokal bajarildi. Sayt faqat shu kompyuterda ochiladi
  (`http://localhost:3000`, `http://bilimdon.localhost:3000`), serverlar yoqilganda. Preview havolasi yo'q.
- **BLOCKED: haqiqiy Google bilan nazoratli sinov.** Brauzerda Google roziligi va sinov hisobi kerak. Barcha
  Google testlari soxta Google bilan; bu live sinov emas.
- **BLOCKED: haqiqiy nginx.** O'rnatilmagan; Docker daemon ishlamayapti va image yuklab olinmadi. Chat ikki
  API jarayonida bevosita va (oldingi sprint testida) Node'dagi oqimli proksi orqali o'lchandi.
- **BLOCKED: Telegram, SMS, email, Click, Payme, AI.** Test kalitlari yo'q.
- **GitHub CI yangi commit'lar uchun.** Push qilinmagan, shuning uchun ishga tushmagan.
- **6-banddagi brauzer qamrovining bir qismi** (3-bo'limdagi ro'yxat).
- **Haqiqiy telefon, haqiqiy klaviatura.** Tekshirilmadi.
- **Docker image build, tiklash mashqi.** Bajarilmadi.

## 7. Bilib qo'yish kerak bo'lgan cheklovlar

- Davomat hamon guruh + sana bo'yicha: bir kunda ikki darsli guruhda yo'qlama ikkala dars uchun bitta.
  Shu sabab `ABSENT` krediti ham kun bo'yicha; bekor qilingan dars krediti esa dars bo'yicha.
- A'zolik tarixi saqlanmaydi (bitta qator, oxirgi qo'shilgan kun): 2-bo'lim, 4-banddagi qoida shundan.
- Guruh formasi vaqtni o'zgartirganda faqat formaning eski vaqtidagi qatorlar ko'chadi. Hamma kun o'z
  vaqtida bo'lsa forma vaqti hech qaysi darsni ko'chirmaydi; bu ataylab, lekin formada alohida aytilmaydi.
- Tiklash qat'iy: konflikt bo'lsa guruh savatda qoladi, avval band qilgan darsni ko'chirish kerak.
- Legacy ulanish (hisob yozilmagan, eski ruxsat o'lgan, kalendar `primary`) boshqa hisobga qayta ulansa,
  eski hisobdagi tadbirlar sanalmaydi (ularga yetib bo'lmaydi va qaysi hisob ekanini bilib bo'lmaydi).
- Lease'ni yo'qotgan worker o'sha paytda yuborib bo'lgan bitta Google so'rovi baribir bajariladi; tadbir
  IDlari barqaror bo'lgani uchun nusxa chiqmaydi (test bor).
- Bitta API testi (`staff-access`, har bir ruxsat uchun har bir yo'lni aylanadi) to'liq parallel
  yurgizishda 30 soniyalik chegaraga yaqin: sekin mashinada vaqti-vaqti bilan yiqilishi mumkin.

## 8. Patch va bundle

Repozitoriy ildizidagi `handoff/` papkasida (git'ga kirmaydi):

- `handoff/sprint2-40b8721..HEAD.patch`: `git am` uchun.
- `handoff/sprint2.bundle`: `git fetch handoff/sprint2.bundle HEAD` bilan olinadi.

## 9. Keyingi qadamlar

1. Commit'larni ko'rib chiqib push qilish (CI shunda ishga tushadi).
2. Qolgan brauzer testlari: platforma sahifalari, jadvalda ko'chirish/undo/konflikt oynasi, guruh formasi,
   ruxsat olib tashlangandan keyingi chat tab.
3. Haqiqiy Google hisobi bilan nazoratli sinov; haqiqiy nginx ortida chat.
4. Davomatni dars darajasiga o'tkazish; a'zolik tarixini saqlash.
