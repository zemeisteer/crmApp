# TalimCRM — Staging muhiti

Staging — production stack'ining **to'liq alohida** ikkinchi nusxasi: o'z papkasi, konteynerlari, baza volume'i, uploads volume'i, sertifikati, sirlari va integratsiyalari. Production bilan hech narsa umumiy emas.

Xuddi shu `docker-compose.prod.yml` ishlatiladi; farq faqat `.env` da (`STACK_NAME`, `COMPOSE_PROJECT_NAME`, domen, sirlar). Production uchun standart qiymatlar o'zgarmagan.

## 0. Boshlash uchun kerak bo'ladigan narsalar

| # | Nima | Izoh |
|---|---|---|
| 1 | Server (Ubuntu 22.04/24.04, 2 CPU / 4 GB) | Production'dan **alohida** server tavsiya etiladi |
| 2 | Staging domeni va wildcard DNS | `staging.<domen>` va `*.staging.<domen>` → server IP |
| 3 | DNS provayderi (wildcard sertifikat uchun) | Cloudflare tokeni yoki TXT yozuvni qo'lda qo'shish imkoni |
| 4 | Staging uchun **alohida** Telegram bot | @BotFather → `/newbot`; production boti emas |
| 5 | Tasdiqlangan sinov chat(lar)i | Kimga xabar yuborish mumkinligi aniq aytilgan bo'lishi kerak |
| 6 | Click va Payme **test** merchant ma'lumotlari | Jonli merchant kalitlari emas |
| 7 | (ixtiyoriy) AI kaliti, sandbox email | Bo'sh qolsa — o'sha funksiya o'chiq |

## 1. O'rnatish va aniq reviziyani chiqarish

Bir marta (alohida server yoki kamida alohida papka, staging shabloni):

```bash
curl -fsSL https://raw.githubusercontent.com/zemeisteer/crmApp/dev/scripts/production/bootstrap-server.sh -o bootstrap.sh
sudo DIR=/opt/crmapp-staging ENV_TEMPLATE=.env.staging.example bash bootstrap.sh staging.<domen>
cd /opt/crmapp-staging
nano .env        # DOMAIN, LETSENCRYPT_EMAIL, CLOUDFLARE_API_TOKEN; integratsiyalar BO'SH qoladi
```

Har bir chiqarish (deploy) shu tartibda:

```bash
cd /opt/crmapp-staging
# 1. Aniq reviziya: commit SHA bilan (branch emas). Ishchi daraxt toza bo'lishi shart.
git fetch origin && git checkout --detach <commit-sha>
# 2. Sozlamalar tekshiruvi (sirlarni ko'rsatmaydi): izolyatsiya, domen, FRONTEND_URL,
#    /api, integratsiyalar o'chiqligi, off-server sozlamasi, toza checkout
bash scripts/staging/preflight-staging.sh            # production shu serverda bo'lsa: --prod-env /opt/crmapp/.env
bash scripts/production/preflight.sh                 # DNS (staging.<domen>, *.staging.<domen>) va Docker
# 3. Sertifikat (birinchi marta; mashq uchun --test-cert)
sudo bash scripts/production/init-ssl.sh
# 4. Qurish va ishga tushirish. Image'larga shu commit yoziladi (APP_REVISION);
#    backend ishga tushganda avval migratsiyalarni qo'llaydi, keyin API ochiladi.
bash scripts/production/stack.sh up -d --build --wait --wait-timeout 600
# 5. Nima ishlayapti: checkout, image'lar, ishlayotgan API, frontend qaysi domen uchun
#    qurilgani va migratsiyalar bir xilmi -> RELEASE OK yoki RELEASE MISMATCH
bash scripts/production/release-info.sh
# 6. Tashqi tekshiruvlar (sintetik "ZZ ..." markazlar yaratadi)
curl -fsS https://staging.<domen>/api/health                     # {"status":"ok",...,"revision":"<sha>"}
node scripts/staging/verify-flows.mjs --api https://staging.<domen>/api --root staging.<domen> --confirm staging.<domen>
cd e2e-browser && npm ci && npx playwright install chromium && \
  STAGING_ROOT=staging.<domen> STAGING_CONFIRM=staging.<domen> npm run test:staging; cd ..
# 7. Zaxira holati
bash scripts/production/stack.sh ps db-backup                    # healthy
sudo bash scripts/production/offsite.sh status                   # mahalliy / masofaviy / tiklash tekshiruvi
```

**Muammo bo'lsa (diagnostika):**

```bash
bash scripts/production/stack.sh ps                               # qaysi xizmat healthy emas
bash scripts/production/stack.sh logs --tail=100 backend          # migratsiya xatosi API'ni ochirmaydi
bash scripts/production/stack.sh logs --tail=100 nginx frontend
bash scripts/production/stack.sh exec backend node scripts/migrate.cjs --status
bash scripts/production/stack.sh exec nginx nginx -t
bash scripts/production/release-info.sh                           # nima nimaga mos emas
```

**Xavfsiz to'xtatish:** `bash scripts/staging/down.sh` (ma'lumot saqlanadi). To'liq o'chirish faqat `down.sh --purge` (stack nomini yozib tasdiqlash so'raladi).

### Orqaga qaytarish (rollback)

Ilovani qaytarish va bazani tiklash — **ikki xil amal**:

1. **Faqat ilova (baza o'zgarmagan bo'lsa).** Yangi reviziyada yangi migratsiya bo'lmasa (`release-info.sh` / `migrate.cjs --status` bilan solishtiring: oldingi va yangi reviziyaning `backend/drizzle/` ro'yxati bir xil), oldingi commitga qaytib qayta quriladi:
   ```bash
   git checkout --detach <oldingi-sha>
   bash scripts/production/stack.sh up -d --build --wait --wait-timeout 600
   bash scripts/production/release-info.sh
   ```
2. **Yangi reviziya migratsiya qo'llagan bo'lsa** — eski ilova yangi sxemaga mos ekani **kafolatlanmaydi** va migratsiyalarni avtomatik orqaga qaytarish yo'q (qilinmaydi ham: ma'lumot yo'qolishi mumkin). Tanlov:
   - **oldinga tuzatish** (afzal): xatoni tuzatgan yangi commitni chiqarish;
   - **bazani tiklash**: deploydan oldin olingan zaxira to'plamini `restore.sh <to'plam> --keep` bilan alohida bazaga tiklash, chiqargan buyruqlari bo'yicha ilovani unga o'tkazish, keyin oldingi reviziyani qurish. Zaxiradan keyingi barcha o'zgarishlar yo'qoladi — bu ongli qaror.

   Shuning uchun **har deploydan oldin**: `sudo bash scripts/production/backup.sh` (va off-server sozlangan bo'lsa `sudo bash scripts/production/offsite.sh push`).

- Migratsiyalar backend ishga tushganda o'zi qo'llanadi (`node scripts/migrate.cjs`); API undan keyin ochiladi.
- `bootstrap-server.sh` parollar va JWT sirini tasodifiy yaratadi; ular ekranga chiqmaydi.
- Production ham shu serverda bo'lsa: `bash scripts/staging/preflight-staging.sh --prod-env /opt/crmapp/.env` — birorta sir umumiy emasligini tekshiradi (qiymatlarni ko'rsatmaydi). Shu holatda `HTTP_PORT`/`HTTPS_PORT` ni boshqa portlarga o'zgartirish kerak; alohida server afzal.

**Staging'ni production'dan ajratib turadigan narsalar** (`.env`):

| O'zgaruvchi | Staging | Nima beradi |
|---|---|---|
| `STACK_NAME=talimcrm_staging` | konteynerlar `talimcrm_staging_*` | production konteynerlari bilan to'qnashmaydi |
| `COMPOSE_PROJECT_NAME=talimcrm_staging` | volume va tarmoq `talimcrm_staging_*` | o'z bazasi, uploads va sertifikat volume'lari |
| `POSTGRES_DB`, `POSTGRES_PASSWORD` | o'ziniki | o'z bazasi, o'z konteynerida |
| `DOMAIN`, `FRONTEND_URL` | `staging.<domen>` | CORS faqat `https://staging.<domen>` va uning bir darajali subdomenlari |
| `JWT_SECRET` | o'ziniki | production tokeni staging'da yaroqsiz va aksincha |
| `REMINDER_SCAN_MS=0` | avtomatik eslatmalar o'chiq | o'z-o'zidan xabar ketmaydi |

**Stack tanlash qoidasi.** Stack'ni faqat shu papkadagi `.env` belgilaydi; barcha buyruqlar `bash scripts/production/stack.sh ...` orqali. Terminaldan meros qolgan `COMPOSE_PROJECT_NAME` / `STACK_NAME` / `POSTGRES_DB` / `POSTGRES_USER` / `BACKUP_DIR` / `DOMAIN` / `COMPOSE_FILE` `.env` dan farq qilsa, skriptlar `REFUSED` deb to'xtaydi. `--prod-env` berilganda `preflight-staging.sh` sirlardan tashqari resurs nomlarini ham solishtiradi: Compose loyihasi (papka nomidan olinadigan standart ham), `STACK_NAME`, `POSTGRES_DB`, `DOMAIN`, zaxira papkasi, portlar.

## 2. Tekshirish

```bash
# 2.1 Domen, rollar, xodimni o'chirish, CORS va pilot yo'li (API orqali; sintetik ma'lumot yaratadi)
node scripts/staging/verify-flows.mjs --api https://staging.<domen>/api --root staging.<domen> --confirm staging.<domen>

# 2.2 Zaxira va tiklash mashqi (jonli bazaga tegmaydi)
sudo bash scripts/production/backup.sh
sudo bash scripts/production/restore.sh backups/talimcrm_staging_<vaqt>Z      # tiklash to'plami papkasi
bash scripts/production/restore-rehearsal.sh   # ixtiyoriy: bir martalik konteynerlarda to'liq tiklash mashqi
```

`verify-flows.mjs` ikki sinov markazi ("ZZ Staging Check …") yaratadi va tekshiradi: HTTPS va HTTP→HTTPS, markaz subdomenida HTTPS, login → markaz, handoff, refresh, ikki markaz/ikki rol, xodimni o'chirish, ruxsatsiz markaz va origin, lid → sinov darsi → qabul → davomat → hisob-faktura → to'lov, balanslarning to'lovlar sahifasi/moliya xulosasi/direktor hisoboti/kabinetda bir xilligi, tarixiy narxni tasdiqlash. Login limitiga (8/daq) rioya qiladi — kutadi, chetlab o'tmaydi.

**`verify-flows.mjs` qayerga murojaat qiladi (manzil qoidalari).** Skript faqat tasdiqlangan manzilga so'rov yuboradi; qoidaga to'g'ri kelmasa **birorta ham tarmoq so'rovisiz** to'xtaydi:
- `--api` aynan `https://<--root>/api` bo'lishi kerak (standart port); `--confirm` `--root` bilan bir xil yoziladi.
- API boshqa hostda bo'lsa: `--confirm-api-host <host[:port]>` bilan alohida tasdiqlanadi va host nomi sinov muhitiga o'xshashi kerak (`staging`, `stage`, `stg`, `test`).
- Rad etiladi: noto'g'ri URL, `http(s)` dan boshqa protokol, URL ichidagi login/parol, query/fragment, boshqa yo'l, production'ga o'xshash manzil.
- Redirect'lar kuzatilmaydi (boshqa hostga olib ketolmaydi).
- Lokal sinov: `--local --api http://127.0.0.1:<port>/api --root staging.localhost --confirm staging.localhost` — faqat loopback manzil va `.localhost` domeni.

Skript markazlar izolyatsiyasini ham tekshiradi: har ikki markazda farqlanadigan yozuvlar yaratadi, A markaz tokeni bilan B markaz ma'lumotiga header/query orqali o'tishga urinadi va javobning o'zini tekshiradi, B ning ID'lariga to'g'ridan-to'g'ri o'qish/o'zgartirish/to'lov so'rovlari 403/404 qaytarishini va B yozuvlari o'zgarmaganini tasdiqlaydi.

**Brauzerda qo'lda** (skript qamramaydi):
- [ ] `https://staging.<domen>/login` → markaz subdomenidagi `/dashboard` ga o'tadi; sahifani yangilaganda sessiya saqlanadi.
- [ ] Markaz subdomenida login sahifasi markaz nomini ko'rsatadi; "boshqa markaz" havolasi ishlaydi.
- [ ] Telefonda: login, to'lov qabul qilish, davomat, o'quvchi kabineti.
- [ ] O'chirilgan xodimning ochiq oynasi keyingi amalda login sahifasiga chiqadi.

## 3. Telegram (alohida staging boti bilan)

Oldin: sinov chat(lar)i aniq tasdiqlangan bo'lishi kerak. Production botining tokeni staging'ga **hech qachon** qo'yilmaydi.

```bash
bash scripts/production/set-telegram-webhook.sh
```
Skript token qaysi botga tegishli ekanini va hozir qayerga ulanganini ko'rsatadi; bot nomi `.env` dagi `TELEGRAM_BOT_USERNAME` ga mos kelmasa yoki bot boshqa hostga ulangan bo'lsa — **rad etadi** (`--replace` faqat shu bot haqiqatan staging'niki bo'lsa).

- [ ] Xodim: Lidlar → Telegram eslatmalari → Ulash → botda Start → menyu chiqadi.
- [ ] O'quvchi: kabinetdan bog'lash; to'lov qabul qilinganda xabar keladi.
- [ ] Qarz eslatmasi: sinov o'quvchisida joriy oy qarzi bo'lsin → To'lovlar → "Qarzdorlarga eslatma" → xabar keladi.
- [ ] Tasdiqlanmagan tarixiy qarz: faqat "taxminiy" qarzi bor o'quvchiga eslatma **kelmaydi**.
- [ ] Xodim markazdan o'chirilgach botda xodim menyusi chiqmaydi.
- [ ] Avtomatik eslatmalar kerak bo'lsa: `REMINDER_SCAN_MS=300000` — faqat bazada faqat sinov chatlari bo'lganda.

## 4. Click / Payme (faqat test merchant bilan)

Provayder kabinetida (test rejimi) callback manzillari:
- Click: `https://staging.<domen>/api/billing/click/webhook`
- Payme: `https://staging.<domen>/api/billing/payme/webhook`
- Platforma obunasi: `/api/platform-billing/click/webhook`, `/api/platform-billing/payme/webhook`

- [ ] To'lov havolasi ochiladi (o'quvchi kabineti yoki To'lovlar → Havola).
- [ ] Muvaffaqiyatli to'lov → **bitta** to'lov yozuvi, hisob-faktura to'g'ri yopiladi, kvitansiya raqami bor.
- [ ] Provayder sandbox'idan o'sha callback'ni **qayta yuborish** → ikkinchi to'lov yaratilmaydi.
- [ ] Noto'g'ri imzo / avtorizatsiya → rad etiladi (Click `-1`, Payme `-32504`).
- [ ] Muvaffaqiyatsiz va bekor qilingan to'lov hech narsani yopmaydi.

Bu holatlar lokal testlarda (`test/billing-gateways.e2e-spec.ts`, 25 test) **soxta so'rovlar** bilan o'tgan; provayder sandbox'i bilan tekshiruv alohida va hali bajarilmagan.

## 5. To'xtatish va tozalash

```bash
bash scripts/staging/down.sh            # to'xtatadi, ma'lumot saqlanadi
bash scripts/staging/down.sh --purge    # volume'larni ham o'chiradi (stack nomini yozib tasdiqlash so'raladi)
```
Skript `.env` dagi `STACK_NAME` va `COMPOSE_PROJECT_NAME` ikkalasida ham `staging`/`test` bo'lmasa **hech narsa qilmaydi** — production papkasida yuritilsa ham rad etadi.
