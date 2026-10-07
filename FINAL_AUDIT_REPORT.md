# CRMApp — final audit report

**Date:** 2026-10-06 – 2026-10-07 · **Branch:** `claude/admiring-goldberg-jkri02` ·
**Base commit:** `c6e480b` · **Audit commits:** `7f95958`, `513334f`, `4b18fa6` (+ reports commits) ·
**Mode:** local only — nothing pushed, no PR, no deploy.

## 1. Overall result

A running instance of CRMApp (NestJS 12 + Drizzle + PostgreSQL backend,
Next.js 16 frontend) was brought up on a disposable database, populated
through the real API with two organizations and every role, and probed as a
black box over all 300 API routes plus a browser crawl of all 41 page routes.

The established foundations hold up well: tenant isolation, authentication,
session binding, RBAC with per-member access lists, the admissions→enrollment→
billing flow, payments idempotency, scheduling conflict detection and
localization all behaved correctly under adversarial probing. **10 defects
were found, fixed, and verified** (1 high stored-XSS, 5 high auth/SSRF/privacy,
1 medium session, 3 low robustness/log), each pinned by a regression test. Two
further items were examined and consciously accepted as not-findings with
reasons recorded.

A second pass (2026-10-07) covered resilience, money limits, performance,
accessibility and localization: **3 more backend defects** (F-12 API crash on
a database restart, F-13 reports failing with 500 once totals pass 2^31 so'm,
F-14 oversized amounts → 500), a payload trim on the payment/invoice lists,
**5 accessibility fixes** (axe critical 10 → 0, contrast nodes 237 → 24,
keyboard focus, modal focus trap) and **13 untranslated messages** were fixed
and verified. One localization gap (plan feature text, L-02) is left for the
backlog because it needs a schema change.

What remains uncertain / out of scope: real external integrations (Telegram,
SMS, Click/Payme live merchant, Resend e-mail) were not exercised with real
credentials — their code paths are covered by mocked e2e tests only; Docker
image build and the restore rehearsal could not run in this environment
(network policy blocks the Alpine package CDN) and rely on GitHub CI for the
same commit; a single-user performance sample on a 2,400-student seeded
tenant was taken (no N+1, reports ~0.8–1 s), but concurrent load was not
measured; no screen reader was available for the accessibility pass.

## 2. Starting branch/commit and final local change inventory

- Start: `claude/admiring-goldberg-jkri02` @ `c6e480b`, clean working tree.
- New files (code): `backend/src/app.setup.ts`, `common/outbound-url.ts`,
  `common/log-redact.ts`, `exams/exam-teacher-scope.guard.ts`.
- New files (tests): `backend/test/audit-hardening.e2e-spec.ts`,
  `src/app.setup.spec.ts`, `src/common/{outbound-url,log-redact,upload.util}.spec.ts`.
- Modified (code): `main.ts`, `common/{teacher-scope,upload.util}.ts`,
  `auth/auth.service.ts`, `branches/branches.service.ts`,
  `certificates/{service,controller}.ts`, `exams/{service,controller}.ts`,
  `homework/{service,controller}.ts`, `schedule/{service,controller}.ts`,
  `students/students.service.ts`, `portal/portal-auth.guard.ts`,
  `email/email.service.ts`, `webhooks/webhooks.service.ts`,
  `docker-compose.prod.yml`.
- Second pass, new: `backend/src/common/money.ts`. Modified: `db/db.module.ts`,
  13 money DTOs (billing, cash, expenses, groups, invoices, payments, plans,
  salary, teachers), `reports`/`salary`/`ledger`/`tenants` services,
  `payments`/`invoices` services, `common/teacher-scope.ts`,
  `test/audit-hardening.e2e-spec.ts`; frontend: `globals.css`,
  `components/{DashboardShell,Modal,Sidebar}.tsx`, `lib/i18n.ts`, colour
  tokens in ~90 page/component files, 9 pages for translated messages.
- New files (reports): `AUDIT_FINDINGS.md`, `UI_TEST_MATRIX.md`,
  `COMPETITOR_GAP_ANALYSIS.md`, `OVERNIGHT_PROGRESS.md`, this file.

## 3. Findings, by severity

High: F-11 stored XSS via uploads; F-02 teacher writes across groups; F-03
teacher reads another group's student PII; F-04 cross-tenant user disclosure +
membership injection via guardian link; F-05 webhook SSRF; F-01 shared
rate-limit bucket behind nginx. Medium: F-10 unrevocable cabinet tokens. Low:
F-06 tokens in logs; F-07 empty-PATCH 500; F-08 false-success cross-tenant
writes. Second pass: Medium F-12 (crash on DB restart), F-13 (report sums
overflow), A-01…A-04 (contrast, focus, modal, unnamed inputs); Low F-14
(oversized money → 500), P-01 (list payloads), A-05 (sidebar focus start),
L-01 (hard-coded Uzbek messages), L-02 (plan text, not fixed). Full
reproduction, impact and fix per finding: `AUDIT_FINDINGS.md`.

## 4. Fixes implemented (affected files)

See `AUDIT_FINDINGS.md` "Fix + evidence per finding" and the commit `7f95958`
message. In short: a shared teacher-scope rule now covers homework/exams/
certificates/schedule; guardian linking requires center membership; an
outbound-URL guard blocks SSRF; uploads are stored and served as non-
executable; `trust proxy` is set behind nginx; cabinet tokens end on PIN
re-issue and student deletion; request logs and the dev e-mail fallback no
longer leak tokens; empty/cross-tenant writes return correct codes.
Second pass (`513334f`, `4b18fa6`): the pg pool survives lost connections;
money totals are summed as bigint; money inputs are capped at 2 bn; the
payment/invoice lists send only the student's list fields; frontend contrast,
focus ring, skip link, `<main>`, modal focus management, settings labels,
sidebar scroll without focus side effects, and `msg.*` translations.

## 5. Features added

None. Per the task's priority order, effort went to confirmed security and
correctness defects. Worthwhile product gaps (make-up lessons, two-way
messaging, custom fields, calendar sync) are documented and left in the
backlog — `COMPETITOR_GAP_ANALYSIS.md`.

## 6. Test results (exact commands)

Disposable DB `talimcrm_test` (unit) / `*_e2e` (e2e), `crmapp_audit` (probes).

| Suite | Command | Result |
|---|---|---|
| Backend unit | `cd backend && npm run test` | 48 files, **290/290** (was 44/273; +17 audit unit tests) |
| Backend e2e | `cd backend && npm run test:e2e` | 40 files, **250/250** (was 39/236; +14, `audit-hardening`) |
| Backend typecheck / lint / build | `npx tsc --noEmit` · `npm run lint` · `npm run build` | pass · 0 errors (71 warnings) · pass |
| Frontend typecheck / lint / build | `npx tsc --noEmit` · `npm run lint` · `npm run build` | pass · 0 errors (71 warnings) · pass |
| Frontend unit | `TZ=America/Los_Angeles npm test` | **9/9** |
| Browser (Playwright) | `cd e2e-browser && NODE_ENV=production npm run build:frontend && npm test` | **20/20** (re-run after the second pass) |
| Accessibility | axe-core 4.14 WCAG 2.1 A/AA, 16 pages | critical **0** (was 10); contrast nodes 24 (was 237) |
| Performance | 27 endpoints, seeded 2,400-student tenant, `pg_stat_statements` | no N+1 (4–32 queries/request); slowest `/reports/overview` 1.0 s |
| Localization | dictionary check + RU/EN crawl of 23 pages | 0 missing keys; L-01 fixed; L-02 open |
| DB migrations | `npm run db:migrate` · `db:check-drift` · `db:verify-migrations` | pass (40 migrations, no drift, 7 upgrade scenarios) |

All rows above were re-run on the final commit `4b18fa6` on 2026-10-07.
Note: in this workspace `backend/.env` sets `NODE_ENV=development`, which the
browser-test build inherits and then fails prerendering; set
`NODE_ENV=production` for `build:frontend` locally (CI has no `.env`, so it is
unaffected).

Not runnable here (network policy): Docker image build / smoke / restore
rehearsal — covered by GitHub CI `images`/`recovery` on `c6e480b`.

## 7. UI coverage

122 page loads (6 staff roles × 17 pages desktop, owner ×17 mobile, platform
admin, student + parent cabinet): **0 unexpected API errors, 0 console/page
errors, 0 empty pages**. Control-gating confirmed (receptionist lacks the
take-payment button and invoice/P&L tabs; teacher dashboard scoped to own
groups and salary). Full matrix: `UI_TEST_MATRIX.md`.

## 8. Fresh-account, role and cross-tenant scenarios

Two organizations built through the real register/invite flows; principals:
owner, admin, manager, receptionist, accountant, two teachers (one with a
group, one without), a parent account, student & parent cabinets, a user
belonging to both organizations, and a platform admin. Cross-tenant: Tenant B
could not read or modify any Tenant A object across all parameterised routes,
lists or query-param overrides. Details: `UI_TEST_MATRIX.md`,
`AUDIT_FINDINGS.md`.

## 9. Migration & configuration changes

No schema/migration changes (all fixes are application-layer; the 40 existing
migrations apply cleanly with no drift). Configuration: `TRUST_PROXY=1` added
to the production backend service; new optional `WEBHOOK_ALLOW_PRIVATE` (dev
only) to permit loopback webhook targets.

## 10. Competitor comparison highlights

Benchmarked against Alfa CRM (CIS/Uzbekistan), Teachworks and TutorBird.
CRMApp meets or exceeds the market on trilingual UI, Telegram-first comms,
Click/Payme, admissions funnel, AI tutor/exam tooling, IELTS mocks, per-member
permissions and multi-org identity. Genuine gaps (backlog, not blockers):
make-up lessons/credits, two-way messaging, custom fields, calendar sync,
saved-card auto-charge. Sources and the full gap matrix:
`COMPETITOR_GAP_ANALYSIS.md`.

## 11. Remaining issues, blockers, untested areas

- Live external integrations (Telegram/SMS/Click/Payme/e-mail) — code paths
  only mock-tested; need sandbox credentials. BLOCKED on credentials.
- Docker image build & restore rehearsal — BLOCKED here (Alpine CDN denied);
  rely on GitHub CI.
- Concurrent load testing — NOT TESTED (single-user sample only, see
  `AUDIT_FINDINGS.md` "Performance sample"). Backlog: server-side pagination
  for students/payments/attendance, SQL-side report aggregation.
- Screen-reader testing — NOT TESTED (no assistive technology here); 24
  contrast nodes on status chips remain (design backlog).
- L-02 plan feature text is stored in one language — backlog (schema change).
- Backlog product gaps (section 10) — NOT STARTED by design.
- N-01 per-object `/uploads` authorization — accepted with nosniff+sandbox;
  signed-URL/proxy download is a future hardening.

## 12. How to resume and run the corrected app

```bash
# backend (disposable DB)
createdb crmapp_audit
cd backend && npm ci --legacy-peer-deps
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmapp_audit \
  JWT_SECRET=dev-secret NODE_ENV=development npm run db:migrate
DATABASE_URL=... JWT_SECRET=dev-secret NODE_ENV=development ROOT_DOMAIN=localhost \
  node dist/main.js            # after: npm run build
# frontend
cd ../frontend && npm ci && npm run build && npx next start -p 3000
# demo data for a click-through (optional): see SETUP.md "Demo"
# tests
cd backend && npm run test && npm run test:e2e
cd e2e-browser && npm run build:frontend && PW_EXECUTABLE_PATH=<chromium> npm test
```

## 13. Reports & change bundle

In the repo root: `FINAL_AUDIT_REPORT.md` (this), `AUDIT_FINDINGS.md`,
`UI_TEST_MATRIX.md`, `COMPETITOR_GAP_ANALYSIS.md`, `OVERNIGHT_PROGRESS.md`.
Code + tests are committed locally on `claude/admiring-goldberg-jkri02`
(`7f95958`, `513334f`, `4b18fa6` and the reports commits). A portable patch bundle covering all audit
changes is written to the scratchpad and its location is reported in the chat
summary.

## 14. Confirmation

Nothing was pushed to any remote, no pull request was created, and no
deployment or publish was performed. All work is local to this workspace.
