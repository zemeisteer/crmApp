# TalimCRM

O'quv markazlari uchun CRM: o'quvchilar, guruhlar, dars jadvali, davomat, to'lovlar, lidlar, o'quvchi va ota-ona kabineti.

| Papka | Nima |
|---|---|
| `backend/` | NestJS + Drizzle ORM + PostgreSQL (REST API, `/api`) |
| `frontend/` | Next.js (App Router) |
| `e2e-browser/` | Playwright brauzer testlari |
| `scripts/` | Production va staging skriptlari (zaxira, tiklash, smoke test) |
| `nginx/` | Production nginx sozlamalari |
| `docs/` | Mahsulot spetsifikatsiyasi, deploy, staging, pilot qo'llanmalari |

## Hujjatlar

- [SETUP.md](SETUP.md) — lokal o'rnatish, demo ma'lumotlar va loginlar
- [RUNBOOK.md](RUNBOOK.md) — productionda kundalik ishlar, zaxira, tiklash
- [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) — serverga o'rnatish
- [docs/STAGING.md](docs/STAGING.md) — staging muhiti
- [docs/PILOT_ONBOARDING.md](docs/PILOT_ONBOARDING.md) — pilot markazni ulash
- [docs/CRMAPP_MASTER_SPEC_V2.md](docs/CRMAPP_MASTER_SPEC_V2.md) — mahsulot spetsifikatsiyasi

Sozlamalar namunalari: `backend/.env.example`, `frontend/.env.example`, `.env.production.example`, `.env.staging.example`.
