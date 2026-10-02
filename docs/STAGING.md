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

## 1. O'rnatish

```bash
# Serverda, bir marta (alohida papka va staging shabloni):
curl -fsSL https://raw.githubusercontent.com/zemeisteer/crmApp/dev/scripts/production/bootstrap-server.sh -o bootstrap.sh
sudo DIR=/opt/crmapp-staging ENV_TEMPLATE=.env.staging.example bash bootstrap.sh staging.<domen>

cd /opt/crmapp-staging
nano .env                                   # POSTGRES_USER/DB, bot, test merchant ...
./scripts/staging/preflight-staging.sh      # izolyatsiya tekshiruvi (sirlarni ko'rsatmaydi)
./scripts/production/preflight.sh           # DNS va Docker
./scripts/production/init-ssl.sh            # staging.<domen> va *.staging.<domen>
docker compose -f docker-compose.prod.yml up -d --build
```

- Migratsiyalar backend ishga tushganda o'zi qo'llanadi (`node scripts/migrate.cjs`); API undan keyin ochiladi.
- `bootstrap-server.sh` parollar va JWT sirini tasodifiy yaratadi; ular ekranga chiqmaydi.
- Production ham shu serverda bo'lsa: `./scripts/staging/preflight-staging.sh --prod-env /opt/crmapp/.env` — birorta sir umumiy emasligini tekshiradi (qiymatlarni ko'rsatmaydi). Shu holatda `HTTP_PORT`/`HTTPS_PORT` ni boshqa portlarga o'zgartirish kerak; alohida server afzal.

**Staging'ni production'dan ajratib turadigan narsalar** (`.env`):

| O'zgaruvchi | Staging | Nima beradi |
|---|---|---|
| `STACK_NAME=talimcrm_staging` | konteynerlar `talimcrm_staging_*` | production konteynerlari bilan to'qnashmaydi |
| `COMPOSE_PROJECT_NAME=talimcrm_staging` | volume va tarmoq `talimcrm_staging_*` | o'z bazasi, uploads va sertifikat volume'lari |
| `POSTGRES_DB`, `POSTGRES_PASSWORD` | o'ziniki | o'z bazasi, o'z konteynerida |
| `DOMAIN`, `FRONTEND_URL` | `staging.<domen>` | CORS faqat `https://staging.<domen>` va uning bir darajali subdomenlari |
| `JWT_SECRET` | o'ziniki | production tokeni staging'da yaroqsiz va aksincha |
| `REMINDER_SCAN_MS=0` | avtomatik eslatmalar o'chiq | o'z-o'zidan xabar ketmaydi |

## 2. Tekshirish

```bash
# 2.1 Domen, rollar, xodimni o'chirish, CORS va pilot yo'li (API orqali; sintetik ma'lumot yaratadi)
node scripts/staging/verify-flows.mjs --api https://staging.<domen>/api --root staging.<domen> --confirm staging.<domen>

# 2.2 Zaxira va tiklash mashqi (jonli bazaga tegmaydi)
./scripts/production/backup.sh
./scripts/production/restore.sh backups/talimcrm_staging_<sana>.sql.gz
```

`verify-flows.mjs` ikki sinov markazi ("ZZ Staging Check …") yaratadi va tekshiradi: HTTPS va HTTP→HTTPS, markaz subdomenida HTTPS, login → markaz, handoff, refresh, ikki markaz/ikki rol, xodimni o'chirish, ruxsatsiz markaz va origin, lid → sinov darsi → qabul → davomat → hisob-faktura → to'lov, balanslarning to'lovlar sahifasi/moliya xulosasi/direktor hisoboti/kabinetda bir xilligi, tarixiy narxni tasdiqlash. Login limitiga (8/daq) rioya qiladi — kutadi, chetlab o'tmaydi.

**Brauzerda qo'lda** (skript qamramaydi):
- [ ] `https://staging.<domen>/login` → markaz subdomenidagi `/dashboard` ga o'tadi; sahifani yangilaganda sessiya saqlanadi.
- [ ] Markaz subdomenida login sahifasi markaz nomini ko'rsatadi; "boshqa markaz" havolasi ishlaydi.
- [ ] Telefonda: login, to'lov qabul qilish, davomat, o'quvchi kabineti.
- [ ] O'chirilgan xodimning ochiq oynasi keyingi amalda login sahifasiga chiqadi.

## 3. Telegram (alohida staging boti bilan)

Oldin: sinov chat(lar)i aniq tasdiqlangan bo'lishi kerak. Production botining tokeni staging'ga **hech qachon** qo'yilmaydi.

```bash
./scripts/production/set-telegram-webhook.sh
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
./scripts/staging/down.sh            # to'xtatadi, ma'lumot saqlanadi
./scripts/staging/down.sh --purge    # volume'larni ham o'chiradi (stack nomini yozib tasdiqlash so'raladi)
```
Skript `.env` dagi `STACK_NAME` va `COMPOSE_PROJECT_NAME` ikkalasida ham `staging`/`test` bo'lmasa **hech narsa qilmaydi** — production papkasida yuritilsa ham rad etadi.
