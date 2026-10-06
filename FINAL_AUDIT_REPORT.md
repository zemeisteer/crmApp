# CRMApp — final audit report

**Date:** 2026-10-06 · **Branch:** `claude/admiring-goldberg-jkri02` ·
**Base commit:** `c6e480b` · **Audit commit:** `7f95958` (+ reports commit) ·
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

What remains uncertain / out of scope: real external integrations (Telegram,
SMS, Click/Payme live merchant, Resend e-mail) were not exercised with real
credentials — their code paths are covered by mocked e2e tests only; Docker
image build and the restore rehearsal could not run in this environment
(network policy blocks the Alpine package CDN) and rely on GitHub CI for the
same commit; load/scale behaviour was not measured.

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
- New files (reports): `AUDIT_FINDINGS.md`, `UI_TEST_MATRIX.md`,
  `COMPETITOR_GAP_ANALYSIS.md`, `OVERNIGHT_PROGRESS.md`, this file.

## 3. Findings, by severity

High: F-11 stored XSS via uploads; F-02 teacher writes across groups; F-03
teacher reads another group's student PII; F-04 cross-tenant user disclosure +
membership injection via guardian link; F-05 webhook SSRF; F-01 shared
rate-limit bucket behind nginx. Medium: F-10 unrevocable cabinet tokens. Low:
F-06 tokens in logs; F-07 empty-PATCH 500; F-08 false-success cross-tenant
writes. Full reproduction, impact and fix per finding: `AUDIT_FINDINGS.md`.

## 4. Fixes implemented (affected files)

See `AUDIT_FINDINGS.md` "Fix + evidence per finding" and the commit `7f95958`
message. In short: a shared teacher-scope rule now covers homework/exams/
certificates/schedule; guardian linking requires center membership; an
outbound-URL guard blocks SSRF; uploads are stored and served as non-
executable; `trust proxy` is set behind nginx; cabinet tokens end on PIN
re-issue and student deletion; request logs and the dev e-mail fallback no
longer leak tokens; empty/cross-tenant writes return correct codes.

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
| Backend e2e | `cd backend && npm run test:e2e` | 40 files, **248/248** (was 39/236; +12, `audit-hardening`) |
| Backend typecheck / lint / build | `npx tsc --noEmit` · `npm run lint` · `npm run build` | pass · 0 errors (71 warnings) · pass |
| Frontend typecheck / lint / build | `npx tsc --noEmit` · `npm run lint` · `npm run build` | pass · 0 errors (71 warnings) · pass |
| Frontend unit | `TZ=America/Los_Angeles npm test` | **9/9** |
| Browser (Playwright) | `cd e2e-browser && npm run build:frontend && npm test` | **20/20** |
| DB migrations | `npm run db:migrate` · `db:check-drift` · `db:verify-migrations` | pass (40 migrations, no drift, 7 upgrade scenarios) |

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
- Load/scale and real-dataset performance — NOT TESTED.
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
(`7f95958` and the reports commit). A portable patch bundle covering all audit
changes is written to the scratchpad and its location is reported in the chat
summary.

## 14. Confirmation

Nothing was pushed to any remote, no pull request was created, and no
deployment or publish was performed. All work is local to this workspace.
