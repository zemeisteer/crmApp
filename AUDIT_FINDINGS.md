# CRMApp audit findings

Statuses: PASS, FAIL, FIXED AND VERIFIED, BLOCKED, NOT TESTED, NOT APPLICABLE.
Severity: Critical / High / Medium / Low / Info. Environment: disposable DB `crmapp_audit`,
backend `NODE_ENV=development` on :4000, built frontend on :3000, synthetic data only.
Reproduction scripts live outside the repo during the run (audit scratchpad: `probe.mjs`,
`probe2.mjs`, …); the regression tests added to the repo are the durable evidence.

## Summary table

All code findings are fixed on the working branch, verified by re-running the
black-box probe against the rebuilt backend, and pinned by regression tests
(`backend/test/audit-hardening.e2e-spec.ts` + unit specs). Commits `7f95958`
(F-01…F-11), `513334f` (F-12…F-14, payload trim) and `4b18fa6` (A-01…A-05,
L-01: accessibility and translation fixes in the frontend).

| ID | Severity | Area | Title | Status |
|---|---|---|---|---|
| F-01 | High | Availability / auth | Behind nginx every client shared one rate-limit bucket (`trust proxy` not set) | FIXED AND VERIFIED |
| F-02 | High | Authorization (in-tenant) | Teacher could create/edit/grade another group's lessons, homework, exams | FIXED AND VERIFIED |
| F-03 | High | Privacy (in-tenant) | Teacher without the group read its students' phones via homework roster / certificates / exams | FIXED AND VERIFIED |
| F-04 | High | Cross-tenant privacy | Any center admin could look up any platform user by phone/id and attach them as a parent (name/e-mail exposed, membership injected) | FIXED AND VERIFIED |
| F-05 | High | SSRF | Outbound webhooks POSTed to any URL incl. loopback / 169.254.169.254 / private ranges, followed redirects, no timeout | FIXED AND VERIFIED |
| F-06 | Low | Secrets in logs | Request log lines contained invitation tokens (path) and e-mail-verification tokens (query); no-provider e-mail fallback logged reset links | FIXED AND VERIFIED |
| F-07 | Low | Robustness | `PATCH /branches/:id` and `PATCH /webhooks/:id` with an empty body -> 500 | FIXED AND VERIFIED |
| F-08 | Low | Misleading success | Cross-tenant `PATCH`/`DELETE /webhooks/:id` and foreign `DELETE /auth/sessions/:id` answered 200 although nothing changed | FIXED AND VERIFIED |
| F-10 | Medium | Sessions | Cabinet (student/parent) tokens (30 d) could not be revoked; survived PIN re-issue and student deletion | FIXED AND VERIFIED |
| F-11 | High | Stored XSS | Uploaded `.html`/`.svg` kept the client extension and was served from the app origin as runnable script | FIXED AND VERIFIED |
| F-12 | Medium | Availability | A PostgreSQL restart (or any dropped idle connection) crashed the API process: no `error` handler on the pg pool | FIXED AND VERIFIED |
| F-13 | Medium | Finance / reports | Report, salary, ledger and platform totals cast `sum()` to `int`; once a total passed 2,147,483,647 so'm `/reports/overview` etc. answered 500 | FIXED AND VERIFIED |
| F-14 | Low | Validation | Money inputs (payment, discount, expense, invoice, group price, salary, plan price, cash count) had no upper bound; values above int4 reached the DB and answered 500 | FIXED AND VERIFIED |
| P-01 | Low | Performance | `/payments` and `/invoices` embedded the full student profile in every row (5.4 MB / 2.1 MB on a 2,400-student center) | FIXED AND VERIFIED (3.0 MB / 1.2 MB) |
| A-01 | Medium | Accessibility | Muted grey and green text below WCAG AA contrast (237 failing nodes across 16 scanned pages) | FIXED AND VERIFIED (24 left, see notes) |
| A-02 | Medium | Accessibility | Inputs showed no focus indicator; no skip link; no `<main>` landmark | FIXED AND VERIFIED |
| A-03 | Medium | Accessibility | Modals: focus stayed behind the dialog, Tab escaped it, close button had no name, focus not restored | FIXED AND VERIFIED |
| A-04 | Medium | Accessibility | Settings: 5 inputs and the brand-colour swatches had no accessible name (axe "critical" ×10) | FIXED AND VERIFIED |
| A-05 | Low | Accessibility | Sidebar `scrollIntoView` moved the keyboard Tab start point into the menu; on short screens the active item ended up out of view | FIXED AND VERIFIED |
| L-01 | Low | Localization | 13 alerts/confirms/errors hard-coded in Uzbek (shown untranslated in RU/EN) | FIXED AND VERIFIED |
| L-02 | Low | Localization | Tariff plan feature lists are free text stored once (Uzbek) and shown as-is on the RU/EN landing page | NOT FIXED (backlog: needs per-language plan text, schema change) |
| N-01 | Info | Files | `/uploads/*` served without per-object authentication (unguessable 24-char cuid names; now `nosniff`+sandbox) | NOT A FINDING (accepted; see notes) |
| N-02 | Info | Design | A teacher can see the center-wide schedule and teacher directory (group names, not student PII) | NOT A FINDING (access catalog grants `schedule.view`/`teachers.view` to all staff) |

Original numbering kept F-09 for the uploads-auth item, now reclassified N-01.
Details follow per finding (reproduction, impact, fix, regression evidence).

## Fix + evidence per finding

- **F-01** `backend/src/app.setup.ts` `trustProxySetting`; `TRUST_PROXY=1` in
  `docker-compose.prod.yml` (API port unpublished, so XFF only from nginx).
  Unit: `app.setup.spec.ts`.
- **F-02 / F-03** `common/teacher-scope.ts` (`assertTeacherGroups`,
  `STUDENT_STAFF_COLUMNS`); scoped homework (service+controller), exams
  (`ExamTeacherScopeGuard` + list/create), certificates, schedule
  create/update (teacher cannot bypass conflict check via `allowCollision`).
  Re-probe: T2 → 403 on all writes, 403 on roster/exam/cert reads, lists
  exclude G1; T1 unaffected. Regression: `audit-hardening.e2e-spec.ts`
  "F-02/F-03".
- **F-04** `students/students.service.ts` `linkGuardian`: requires an ACTIVE
  membership of this center; unknown and foreign users both get 404; no
  membership injected. Re-probe with an A-only user: 404, 0 memberships, 0
  links. Regression: "F-04".
- **F-05** `common/outbound-url.ts` `assertPublicHttpUrl`; checked at
  create/update and again at delivery; `redirect: 'manual'`, 10 s timeout;
  `WEBHOOK_ALLOW_PRIVATE=true` for local dev. Unit: `outbound-url.spec.ts`;
  regression: "F-05" (loopback/localhost/metadata/private → 400, public → 201).
- **F-06** `common/log-redact.ts` on the pino serializer; prod e-mail fallback
  no longer logs the body. Unit: `log-redact.spec.ts`.
- **F-07 / F-08** empty `PATCH` → no-op 200 (`branches`, `webhooks`);
  cross-tenant webhook write/delete and foreign session delete → 404.
  Regression: "F-07 / F-08".
- **F-10** `portal/portal-auth.guard.ts`: cabinet token checked against a
  live, non-deleted student and the PIN's `updatedAt` (re-issue signs out
  older tokens). Regression: "F-10".
- **F-11** `common/upload.util.ts` `safeUploadExtension` + `setUploadHeaders`
  (via `app.setup.ts`): stored extension from the declared type only; images/
  PDF/recordings inline, everything else a sandboxed download, always
  `nosniff`. Unit: `upload.util.spec.ts`; regression: "F-11".

- **F-12** `db/db.module.ts`: `pool.on('error')` logs the lost client; the pool
  opens a new one on the next query. Verified: `service postgresql restart`
  while the API runs — process stays up, next request 200.
- **F-13** `reports/reports.service.ts` (7 sums), `salary`, `ledger`, `tenants`:
  `sum(...)::bigint` mapped to `Number`. Verified on a seeded tenant with
  2.56 bn so'm year-to-date: `/reports/overview` 200, totals equal SQL.
  Regression: "F-13 / F-14 money" (two 1.5 bn payments → 200, total ≥ 3 bn).
- **F-14** `common/money.ts` `MAX_MONEY = 2_000_000_000`, `@Max` on 13 DTO
  money fields. Regression: oversized payment/expense/group/invoice → 400.
- **P-01** `STUDENT_LIST_COLUMNS` for the payment and invoice lists (the
  screens only show name/phone/status).
- **A-01…A-05** (frontend, commit `4b18fa6`): `#8A8D96`/`#71737C` muted text →
  `#686B75`, green text `#1FA463` → `#167A48` (fills unchanged); global
  `:focus-visible` ring on inputs; skip link + `<main id="main-content">` in
  `DashboardShell`; `Modal` focus management (initial focus, Tab trap, Escape,
  restore, named close button); settings `aria-label`s and `aria-pressed`
  swatches; sidebar keeps the active item centred by adjusting `scrollTop`
  (no focus side effect) and re-checks while the panel resizes. Verified with
  axe-core 4.14 and scripted keyboard runs (25 Tab presses never leave an open
  dialog; Escape closes; focus returns to the opener).
- **L-01** new `msg.*` keys in `lib/i18n.ts` (UZ/RU/EN) used by settings,
  exams, students/[id], schedule, announcements, onboarding, reports,
  verify/[code], payments.

### Notes on accepted items

- **N-01 uploads auth.** Attachments are served statically under
  content-addressed 24-char cuid names, now with `X-Content-Type-Options:
  nosniff` and a download/sandbox CSP for non-media. Names are unguessable and
  the URLs are only shown to authorized users. True per-object authorization
  (signing each `/uploads` URL, or proxying downloads through a guard) is a
  worthwhile hardening but is an architecture change (the master spec already
  flags S3 + signed URLs for production); left as a backlog item, not a
  blocker. No change made beyond the response headers.
- **N-02 teacher sees center schedule/directory.** `access/catalog.ts` grants
  `schedule.view` and `teachers.view` to all staff roles (`template: ALL`),
  so a teacher seeing lesson times and colleague names (group *names*, never
  student PII) is intended and owner-configurable. Only the PII-bearing reads
  (rosters, exam results, certificates) were scoped. No change.

## Verified as working (black-box probe, 2 tenants, 2026-10-06)

| Check | Result |
|---|---|
| Anonymous call of every non-public route (300 routes) | PASS — 299 × 401; `GET /billing/config` public by design (`{clickEnabled, paymeEnabled}`) |
| Tenant B owner on Tenant A object ids, every parameterised route (reads, writes, deletes) | PASS for data — no 2xx with Tenant A data, no Tenant A object modified (verified by re-reading A); see F-07/F-08 for status codes |
| Tenant B owner, every list route | PASS — no Tenant A marker in 68 × 200 responses |
| Cabinet student / cabinet parent tokens on 234 back-office routes | PASS — 233 × 403 (+ public `/billing/config`) |
| Parent account (role PARENT) on 221 back-office routes | PASS — 220 × 403 |
| Parent account -> unlinked child / other tenant's child | PASS — 403 |
| Cabinet student -> other tenant's exam / invoice checkout | PASS — 404 |
| Cabinet parent viewer submitting homework | PASS — 403 (watch-only) |
| Receptionist takes payment / cancels invoice / exports payments | PASS — 403 |
| Manager invites ADMIN, removes staff; accountant invites; ADMIN creates OWNER | PASS — 403 / 400 |
| Teacher issues cabinet PIN, reads finance, exports students | PASS — 403 |
| Unassigned teacher marks attendance / grades homework in another group | PASS — 403 |
| Existing user accepting an invitation without password | PASS — 400; with password 201, second membership created |
| Schedule conflict: same teacher/group same slot | PASS — 409 with both conflicts listed |

## Accessibility scan (axe-core 4.14, WCAG 2.0/2.1 A+AA, 16 pages, 2026-10-07)

| | Before | After |
|---|---|---|
| Critical violations | 10 (unnamed inputs/buttons on settings) | **0** |
| Serious: colour contrast (nodes) | 237 | **24** |
| Keyboard: visible focus on inputs | FAIL | PASS |
| Keyboard: skip to content, main landmark | FAIL | PASS |
| Keyboard: modal focus trap / restore | FAIL | PASS |

The 24 remaining contrast nodes are status colours chosen inside ternaries
(`#3EAF7A`, `#EA7A3A`, `#6760e9`, `#9CA3AF` on tinted chips) and the landing
hero mock-up; listed for the design backlog. Screen readers (NVDA/VoiceOver)
were NOT TESTED — no assistive technology is available in this container.

## Performance sample (seeded tenant, 2026-10-07)

Fixture (seeded directly with SQL into the disposable DB, labelled `perf-*`):
2,400 students, 80 groups, 20 teachers, 31,200 attendance rows, 6,400
payments, 2,400 invoices, 1,000 leads. One warm request each, measured with
`pg_stat_statements` (q = SQL statements per request).

| Endpoint | ms | KB | q | DB ms |
|---|---|---|---|---|
| `/reports/overview` | 1020 | 14 | 32 | 79 |
| `/reports/director` | 843 | 222 | 12 | 60 |
| `/reports/dashboard` | 788 | 10 | 19 | 59 |
| `/notifications/debtor-reminders/preview` | 733 | 92 | 11 | 46 |
| `/payments/debtors` | 619 | 703 | 8 | 31 |
| `/attendance` (no filter, not used by the UI) | 458 | 6413 | 4 | 31 |
| `/students` | 211 | 2796 | 4 | 47 |
| `/payments` | 170 | 3054 (was 5.4 MB) | 4 | 29 |
| `/invoices` | 82 | 1247 (was 2.1 MB) | 5 | 22 |
| `/groups`, `/teachers`, `/leads`, `/schedule`, `/auth/me` | 7–19 | ≤ 61 | 4–6 | ≤ 7 |

No N+1 patterns: query counts are constant (4–32) regardless of row counts.
Report latency is dominated by in-process aggregation in Node (DB time is
50–100 ms of ~0.8–1 s). Backlog (not defects at this size): server-side
pagination/search for `/students`, `/payments`, `/attendance`; the group page's
"add student" picker loads every student; SQL-side aggregation for reports.
Load/concurrency testing: NOT TESTED.

## Localization check (2026-10-07)

- Dictionary `lib/i18n.ts`: 2,980 keys + 13 new, every key has UZ/RU/EN; all
  2,396 keys referenced in code exist (0 missing). Six empty values are
  intentional word-order suffixes (e.g. RU/EN put the number last).
- RU and EN crawl of 23 pages (public, staff, cabinet): no untranslated UI
  strings except L-02 (plan feature text from the DB) and the language name
  "O'zbek tili" (correct). Hard-coded Uzbek messages found by code search →
  L-01, fixed.
