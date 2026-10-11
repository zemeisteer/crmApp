# Barqarorlashtirish sprinti: yakuniy hisobot

Sana: 2026-10-10 / 11. Branch: `claude/admiring-goldberg-jkri02`.

Ish vazifa matnidagi "cloud muhiti" o'rniga foydalanuvchining tanlovi bilan **lokal kompyuterda** bajarildi.
Push, PR, merge va deploy qilinmadi; hamma narsa lokal commit'larda.

## 1. Boshlang'ich va yakuniy holat

- Boshlang'ich SHA: `1130062768f4e19eb3711639a96909f27d024048` (GitHub'dagi branch uchi).
- Yakuniy lokal commit'lar (GitHub'da yo'q), eskidan yangiga:

| Commit | Mazmuni |
|---|---|
| `b5bdb17` | Dars xatosi, jadval va make-up, konflikt API ruxsatlari (1-3-bandlar) |
| `443dbd8` | Google Calendar (4-band) |
| `d5b3365` | Chat (5-band) |
| `b5b2bf1` | Custom maydonlar (6-band) |
| `c6fb8ea` | To'lov formasida qidiruvli tanlash, filtrlar manzilda (7-band) |
| `f6c74cd` | Platforma to'lovi poygasi, platforma testlari, brauzer build skripti, CI trigger |
| oxirgi commit (`git log -1`) | Make-up formasida xonalar ro'yxati, klaviatura fokusi, `.env.example`, shu hisobot |

Aniq oxirgi SHA va diff hajmi: `git log --oneline 1130062..HEAD`, `git diff --shortstat 1130062..HEAD`.
Patch va bundle: 8-bo'limga qarang.

## 2. Topilgan va tuzatilgan muammolar

**Yuqori ustuvorlik**

1. **Bekor qilingan dars qayta paydo bo'lardi.** Guruhning barcha haftalik jadval yozuvlari `CANCELLED` bo'lsa
   yoki jadvaldan o'chirilsa, eski guruhlar uchun mo'ljallangan fallback (`groups.scheduleDays`) darsni
   kalendarda, darslar ro'yxatida va make-up bronida qaytarardi. Endi `groups.timetable_managed` belgisi
   (migratsiya 0049) eski guruhni ataylab bekor qilingan guruhdan ajratadi. Vazifada faqat `CANCELLED`
   holati aytilgan edi; jadvaldan **o'chirish** holati ham xuddi shu xatoni berardi, u ham tuzatildi.
2. **Konflikt API ma'lumot ochardi.** `POST /api/schedule/check-conflict` har qanday guruh IDsi uchun javob
   berardi va o'quvchi ismlarini `schedule.view` huquqi bor hammaga ko'rsatardi. Endi: guruh so'rovchining
   markaziga tegishli bo'lishi shart (begona yoki yo'q ID bir xil 404), o'qituvchi faqat o'z guruhlari
   bo'yicha so'raydi, ismlar faqat `schedule.edit` + `students.view` bo'lganlarga (ro'yxatda ham, `message`
   matnida ham); create/update 409 javoblarida ham shu qoida.
3. **Bir o'quvchili ikki guruhga bir vaqtda dars yaratish o'tib ketardi.** Qulflar o'qituvchi/xona/guruh
   bo'yicha edi. Endi markaz bo'yicha bitta "jadval yozuvchisi" qulfi bor (jadval, dars bekor qilish,
   make-up broni); barcha tekshiruvlar qulfdan keyin, tranzaksiya ichida qayta o'qiladi.
4. **Google'dan uzishda tadbirlar izsiz qolardi.** 429, 5xx yoki timeout bo'lsa ham ulanish o'chirilardi va
   o'chmay qolgan tadbirlarni topib bo'lmasdi. Endi tartib qat'iy: sinxronlashni to'xtatish → tadbirlarni
   o'chirish (xatoda saqlab, backoff bilan qayta urinish) → shundan keyingina tokenni bekor qilish →
   token va yozuvni unutish. Ruxsat allaqachon bekor qilingan bo'lsa, qolgan tadbirlar soni va sanalari
   foydalanuvchiga ko'rsatiladi.
5. **Chat oqimi ruxsat tugagandan keyin ham ochiq qolardi.** `chat.use` olib tashlansa yoki markaz
   almashtirilsa oqim yopilmasdi. Endi har bir bildirishnoma yetkazilishidan oldin mijoz bazadan keshsiz
   tekshiriladi va ruxsat yo'q bo'lsa `revoked` bilan yopiladi.
6. **Platformada qo'lda to'lovni ikki marta bosish 500 berardi.** Endi markaz bo'yicha ketma-ket, ikkinchisi 409.

**O'rta ustuvorlik**

7. Konflikt tekshiruvi bir tomonlama edi: yangi dars mavjud make-up mashg'ulotining o'qituvchisi/xonasi yoki
   o'quvchining make-up'i bilan to'qnashishi tekshirilmasdi. Endi ikki tomonlama.
8. Dars vaqti/kuni/xonasi/o'qituvchisi o'zgarganda bog'langan make-up bronlari eski ma'lumotda qolardi.
   Qoida: dars shu sanada qolsa bron unga ergashadi; dars shu sanadan ketsa, o'quvchi yangi vaqtda band
   bo'lsa yoki qaysi dars nazarda tutilgani noaniq bo'lsa, bron bekor qilinadi va kredit qaytadi.
   Javobda `makeups: {moved, released}` qaytadi, jadval sahifasi buni ko'rsatadi.
9. Bir kunda ikki darsli guruhda make-up har doim birinchi darsga bog'lanardi. Endi tanlangan darsga
   (boshlanish vaqti bo'yicha), joylar ham dars bo'yicha sanaladi.
10. Jadvaldagi o'zgarish guruh formasidagi kunlar/soatlarga yozilmasdi (jadvaldan o'chirilgan kunni formadan
    qaytarib bo'lmasdi). Endi jadval tahriri guruhning o'z kunlari va soatlarini ham yangilaydi.
11. Shu Google hisobiga qayta ulanishda tanlangan kalendar `primary`ga qaytardi. Endi hisob taniladi va
    tanlov saqlanadi; boshqa hisobga o'tilsa eski hisob o'z tokeni bilan tozalanadi, yangi token bilan
    eski hisobga tegilmaydi.
12. Ishlab turgan sync worker uzish yoki kalendar almashtirishdan keyin ham yozishda davom etardi. Endi
    `epoch` hisoblagichi va har yozuvdan oldingi tekshiruv bor.
13. LISTEN ulanishi uzilganda xabarlar boshqa serverlarga yetmasdi. Endi NOTIFY har doim yuboriladi,
    listener tiklanganda mijozlarga `resync` boradi.
14. O'quvchi maydonining turi o'zgarsa, unga bog'langan lid maydoni osilib qolardi va konvertatsiya
    `TYPE_MISMATCH` bilan to'xtardi. Endi bog'lanish shu tranzaksiyada uziladi va sozlamalarda aytiladi.
15. To'lovlar sahifasi markazning butun o'quvchilar ro'yxatini yuklardi. Endi tanlagich serverda qidiradi
    (10 tadan, "Yana ko'rsatish"), jadvaldagi ismlar ID bo'yicha olinadi (`GET /api/students?ids=`).

**Past ustuvorlik**

16. Jadval sahifasidagi "Dars qo'shish" oynasining CSS'i yo'q edi (oldingi bosqichda tuzatilgan).
17. To'lovlar va o'quvchilar sahifasidagi filtrlar yangilashda yo'qolardi. Endi manzilda saqlanadi.
18. Telefonda klaviatura ochilganda chat maydoni: sahifa ko'rinadigan balandlik (`--vvh`) bo'yicha o'lchanadi.
19. "+" formasi klaviatura bilan: fokus formaga kiradi va yopilganda tugmaga qaytadi.
20. Brauzer testlari build skripti `backend/.env`dagi `NODE_ENV=development` sabab yiqilardi.
21. `db:verify-migrations` PostgreSQL 18 da yiqilardi (RESTRICT xato kodi 23001).

**Yakuniy tekshiruvda topilgan (o'rta ustuvorlik)**

22. Make-up'ni "Alohida mashg'ulot"ga yozish formasida **xonalar ro'yxati bo'sh qolardi**: o'qituvchilar
    ro'yxati xonalarnikidan oldin kelsa, xonalar javobi tashlab yuborilardi (avvaldan bor poyga). Brauzer
    testi (`makeups.spec.ts`) shuni ushladi. Endi ikkala ro'yxat birga o'rnatiladi.

## 3. To'rtta funksiyaning holati

| Funksiya | Holat | Izoh |
|---|---|---|
| Make-up darslar | Ishlaydi | Jadval bilan ikki tomonlama to'qnashuv, bron darsga ergashadi, poyga testlari bor |
| Kalendar (ICS + Google) | Ishlaydi; Google faqat mock bilan sinalgan | 4-bo'limga qarang |
| Chat | Ishlaydi | Ikki API jarayoni, oqimli proksi, LISTEN uzilishi sinalgan |
| Custom maydonlar | Ishlaydi | 8 ta chekka holatdan 7 tasi avvaldan to'g'ri edi, 1 tasi tuzatildi |

## 4. Bajarilgan tekshiruvlar va haqiqiy natijalar (shu sessiyada)

| Tekshiruv | Buyruq | Natija |
|---|---|---|
| Backend typecheck | `npx tsc --noEmit` | xatosiz |
| Backend lint | `npx oxlint src/ test/` | exit 0 |
| Backend unit | `npx vitest run` | 334 tadan 333 o'tdi; 1 tasi yiqildi (pastga qarang) |
| Backend e2e (haqiqiy PostgreSQL) | `npx vitest run --config ./vitest.config.e2e.ts` | 54 fayl / 382 test, hammasi o'tdi |
| Backend build | `npm run build` | o'tdi |
| Migratsiya jurnali | `npm run db:check-migrations` | 51 migratsiya, mos |
| Sxema farqi | `npm run db:check-drift` | farq yo'q |
| Bo'sh baza va yangilash yo'llari | `npm run db:verify-migrations` | "Migration chain verified" |
| Frontend typecheck | `npx tsc --noEmit` | xatosiz |
| Frontend lint | `npm run lint` | 0 xato, 73 ogohlantirish |
| Frontend unit | `npm test` | 55 / 55 |
| Frontend production build | `NEXT_DIST_DIR=.next-verify npm run build` | o'tdi |
| Brauzer testlari (production build, alohida baza) | `PW_CHANNEL=chrome npx playwright test` | 39 / 39 o'tdi (8.0 daqiqa); tarixi pastda |
| Google kalendar brauzer testi (lokal **soxta** Google) | `PW_CHANNEL=chrome npm run test:google` | 1 / 1 o'tdi (ulash, kalendar tanlash, sinxronlash, qayta ulash, uzish) |

Yiqilgan bitta unit test: `src/common/outbound-url.spec.ts` (`openssl` buyrug'i Windows PATH'da yo'q). Bu
muhitga bog'liq, kodga emas; Linux CI'da o'tadi deb kutiladi, lekin bu sessiyada tekshirilmadi.

Brauzer testlari tarixi (yashirmasdan): birinchi to'liq yurgizishda 39 tadan 36 tasi o'tdi. Yiqilgan uchtadan
ikkitasi (`a11y`, `admissions`) kompyuter uyqu rejimiga o'tgan paytga to'g'ri kelgan (bitta test "5.2 soat"
davom etgan deb yozilgan) va alohida qayta yuritilganda o'tdi. Uchinchisi (`makeups.spec.ts`, alohida
mashg'ulot) haqiqiy xato edi (2-bo'lim, 22-band): tuzatilgach frontend qayta build qilindi va butun to'plam
boshidan yuritildi: 39 / 39.

Yangi test fayllari: `lesson-integrity` (18), `calendar-google` (12), `custom-fields-edges` (8),
`platform-admin` (5), `chat-instances`ga 7 ta qo'shimcha test, platforma yordamchilari uchun unit testlar.

**Google: mock va haqiqiy.** Barcha Google testlari hisoblar bilan ishlaydigan soxta Google'da
(`FakeGoogleAccounts`) o'tdi; ular Google'ga so'rov yubormaydi. Haqiqiy Google bilan nazoratli sinov
(qayta ulanish, uzish, hisob almashtirish) **o'tkazilmadi**: buning uchun brauzerda Google roziligi kerak.
Yagona haqiqiy kuzatuv: foydalanuvchining mavjud ulanishi yangi kod bilan fon rejimida bir marta
muvaffaqiyatli sinxronlandi (xatosiz, 106 ta tadbir bog'langan). Bu to'liq live test emas.

## 5. Tekshirilmagan yoki BLOCKED

- **BLOCKED: cloud muhiti va cloud preview.** Ish lokal bajarildi, cloud preview havolasi yo'q. Sayt
  faqat shu kompyuterda ochiladi (`http://localhost:3000`, `http://bilimdon.localhost:3000`) va faqat
  serverlar yoqilganda.
- **BLOCKED: haqiqiy Google bilan nazoratli sinov** (yuqoriga qarang).
- **BLOCKED: Telegram, SMS, email, Click, Payme, AI.** Test kalitlari yo'q; testlarda o'chirilgan.
- **nginx.** Proksi orqali chat Node'dagi oqimli proksi bilan sinaldi, haqiqiy nginx bilan emas.
- **Haqiqiy telefon klaviaturasi.** Faqat 375x420 emulyatsiyada tekshirildi.
- **Har bir tugmaning qo'lda inventari.** To'liq qo'lda o'tilmadi; qamrov avtomatik testlar orqali.
  Yangi platforma sahifalari va jadvaldagi sudrash uchun brauzer testi yozilmagan (API testlari bor).
- **GitHub CI.** Push qilinmagani uchun ishga tushmadi.
- **Docker image build, tiklash mashqi, yuklama testi.** Bajarilmadi.
## 6. CI nega bu branchda ishlamaydi

`.github/workflows/ci.yml` faqat `main`/`dev`ga push va shularga ochilgan PR'da ishga tushardi. Bu branch
`claude/…` va unga PR ochilmagan, shuning uchun hech bir tekshiruv ishga tushmagan. Ishchi nusxada
tayyorlangan o'zgarish: `claude/**` branchlariga push, `workflow_dispatch` (qo'lda) va yangi push eskisini
bekor qiladigan `concurrency`. Push qilinmadi; workflow faylini push qilish uchun `workflow` huquqli token kerak.

## 7. Migratsiyalar va konfiguratsiya

| Migratsiya | Nima |
|---|---|
| `0049_group_timetable_managed` | `groups.timetable_managed` + mavjud guruhlar uchun to'ldirish |
| `0050_calendar_connection_epoch` | `calendar_connections.account_key`, `epoch`, `leftover_events` |

(`0048_platform_settings` oldingi bosqichda push qilingan.) Ikkalasi idempotent, bo'sh bazada va eski
sxemadan yangilashda tekshirildi. Lokal dev bazaga qo'llandi; oldin zaxira olindi
(`backend/backups/talimcrm_before_0049_2026-10-10.dump`).

Konfiguratsiya nomlari (qiymatlarsiz): `SETTINGS_KEY`, `GOOGLE_TRANSLATE_API_KEY`,
`TRANSLATE_PUBLIC_FALLBACK` (ixtiyoriy, `false` bo'lsa kalitsiz ochiq tarjima manzili ishlatilmaydi).
Mavjudlari o'zgarmadi: `CALENDAR_TOKEN_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI`, `CHAT_HEARTBEAT_MS`, `CALENDAR_SYNC_MS`.

## 8. Patch va bundle

Repozitoriy ildizidagi `handoff/` papkasida (git'ga kirmaydi):

- `handoff/stabilization-1130062..HEAD.patch`: `git am` yoki `git apply` uchun.
- `handoff/stabilization.bundle`: `git fetch handoff/stabilization.bundle HEAD` bilan olinadi.

## 9. Bilib qo'yish kerak bo'lgan cheklovlar

- Dars bekor qilish (`lesson_cancellations`) guruh + sana bo'yicha: bir kunda ikki darsi bor guruhda ikkalasi
  birga bekor bo'ladi. Make-up broni esa aniq darsga bog'lanadi.
- Guruh formasi bitta vaqt juftligini saqlaydi: jadvalda kunlar har xil vaqtda bo'lsa, formadan saqlash
  ularni bir xil vaqtga qaytaradi (avvaldan shunday).
- Eslatmalar va ba'zi hisobotlar bugungi darslarni guruh formasidagi kunlardan oladi. Endi jadval tahriri
  formani ham yangilagani uchun ular mos keladi, lekin manba hali ham ikkita.
- Sync ijarasi (5 daqiqa) uzaytirilmaydi: 5 daqiqadan uzoq sinxronlashda ikkinchi worker ishni olishi mumkin.
- Chat bildirishnomasi endi har bir ochiq oqim uchun bazadan tekshiriladi (keshsiz): to'g'riroq, lekin
  yuzlab ochiq oqimli markazda har xabarga ko'proq so'rov.

## 10. Keyingi eng muhim ishlar

1. Shu commit'larni ko'rib chiqib push qilish va `dev`ga PR ochish (CI shunda ishga tushadi).
2. Haqiqiy Google hisobi bilan nazoratli sinov: qayta ulanish, kalendar tanlash, uzish.
3. Yangi platforma sahifalari va jadvaldagi ko'chirish uchun brauzer testlari.
4. Dars bekor qilishni dars darajasiga o'tkazish (hozir guruh-kun).
5. Jadval va guruh formasi uchun yagona manba.
6. Production: `SETTINGS_KEY`, domen, Click/Payme sandbox.
