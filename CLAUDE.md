# TalimCRM (crmApp)

CRM for education centers: students, groups, timetable, attendance, payments, leads, student and parent cabinets. Multi-tenant SaaS. Human docs are in Uzbek: [SETUP.md](SETUP.md) (local setup, demo logins), [RUNBOOK.md](RUNBOOK.md) (operations), [docs/](docs/).

## Packages

| Folder | What | Stack |
|---|---|---|
| `backend/` | REST API under `/api`, port 4000 | NestJS 12, Drizzle ORM, PostgreSQL 16+, Vitest, oxlint, Prettier |
| `frontend/` | Web app, port 3000 | Next.js 16 (App Router), React 19, Tailwind 4, ESLint. **Read [frontend/CLAUDE.md](frontend/CLAUDE.md) first**: this Next.js differs from your training data |
| `e2e-browser/` | Critical flows in Chromium against production builds | Playwright |

Each package has its own `package.json` and lock file; run npm inside the package folder. CI: `.github/workflows/ci.yml` (Node 22).

## Commands

Backend (`cd backend`, install with `npm install --legacy-peer-deps`):
- dev: `npm run start:dev` · build: `npm run build` · typecheck: `npx tsc --noEmit`
- lint: `npm run lint` (oxlint src/ test/) · format: `npm run format`
- unit: `npm run test` (Vitest, `src/**/*.spec.ts`)
- e2e: `npm run test:e2e` (`test/*.e2e-spec.ts`, real PostgreSQL). Never touches the dev DB: it rebuilds `<db>_e2e` every run (see `backend/README.md` -> "The end-to-end database"). The DB user needs CREATEDB.
- migrations: `npm run db:generate` (drizzle-kit, from `src/db/schema.ts`), `npm run db:migrate`, `npm run db:migrate:status`, `npm run db:check-migrations`, `npm run db:check-drift`, `npm run db:verify-migrations`

Frontend (`cd frontend`): `npm run dev` · `npm run build` · `npm run lint` · `npx tsc --noEmit` · `npm test` (node --test `lib/*.test.ts`; CI runs it with `TZ=America/Los_Angeles`) · CI also runs `node ../scripts/redesign/check-no-raw-colors.mjs` (design tokens only).

Browser tests (`cd e2e-browser`), always on fresh builds:
```
npm --prefix ../backend run build
npm run build:frontend      # frontend/.next-browser with the test API URL
npm test                    # npm run test:google for the fake-Google suite
```
Ports 4300/3300, database `<db>_browser_e2e` (recreated). Takes minutes (sign-up rate limit is not lowered); run it in the background.

## Local environment (Windows)

- PostgreSQL runs locally as a Windows service; its tools may not be on PATH (`C:\Program Files\PostgreSQL\<ver>\bin\psql.exe`). Connection string: `backend/.env` -> `DATABASE_URL` (never print or commit it).
- First run: `createdb talimcrm` then `npm run db:migrate` (SETUP.md §1). Demo center: `npm run demo:seed` with the backend running (logins in SETUP.md §3; staff at `http://bilimdon.localhost:3000/login`).
- Dev servers start through `.claude/launch.json` with the preview tool: `backend` (4000), `frontend` (3000); `dev-backend`/`dev-frontend` (4100/3100) run the `../crmApp-dev` worktree. Ports may be taken by another local project: check before stopping any process.
- Docker alternative: `docker compose up --build` (Postgres + backend + frontend; the container applies migrations on start).

## Rules

- **Migrations.** The schema changes only through versioned SQL in `backend/drizzle/` applied by `scripts/migrate.cjs` (`npm run db:migrate`, one transaction per file). Never `drizzle-kit migrate`, never `db:push` on a real DB. **Never edit a migration that is already committed/listed in `drizzle/meta/_journal.json`**: write a new one. Use the `/db-migration` skill.
- **Tenant isolation is the main security layer.** Every tenant-scoped query filters by the JWT's `tenantId` (`@CurrentUser('tenantId')`); access comes from active `organization_memberships`, never from `users.tenantId` / `users.role`. Controllers use `@UseGuards(JwtAuthGuard, RolesGuard, ...)` with `@Roles(...)` / `@RequirePermissions(...)` (`backend/src/common/`). The `tenant-security-reviewer` agent checks diffs in auth/access/billing/payments/ledger/invoices/cash.
- **Money** columns are `integer` so'm; inputs are capped by `MAX_MONEY` (`src/common/money.ts`), and sums are cast `::bigint` (an `::int` sum overflows past 2,147,483,647). Payment and payroll creation take an idempotency key (double submit = one row); multi-row money writes run in one transaction.
- Tests turn AI, e-mail, Telegram and SMS off; never add real keys to tests. Use synthetic data only.
- **New reports and write-ups go into `docs/`** (not the repo root). Sprint reports: `/sprint-report` skill.
- Do not edit `.env*` files (only `*.example`), `package-lock.json` by hand, or `backend/backups/`. A PreToolUse hook enforces this.

## Claude Code setup in this repo

- `.claude/settings.json` hooks: `guard-protected-files.cjs` (blocks the files above) and `format-and-lint.cjs` (after Edit/Write: backend Prettier + oxlint, frontend `eslint --fix`; Prettier only on files already Prettier-clean at HEAD, since most backend files are not).
- Skills: `/db-migration <change>`, `/sprint-report`. Agents: `tenant-security-reviewer`, `e2e-test-writer`.
- MCP (`.mcp.json`): `context7` (library docs), `postgres-dev` (Google MCP Toolbox, role `crm_mcp_readonly` on `talimcrm_dev`; password from the `CRM_DEV_DB_PASSWORD` user variable, other `CRM_DEV_DB_*` have defaults; setup in SETUP.md §5). Both packages are pinned (an unpinned `npx -y` asks the registry on every start); the first start downloads them, so `settings.json` raises `MCP_TIMEOUT` to 90 s.
