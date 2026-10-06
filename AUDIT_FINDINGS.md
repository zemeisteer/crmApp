# CRMApp audit findings

Statuses: PASS, FAIL, FIXED AND VERIFIED, BLOCKED, NOT TESTED, NOT APPLICABLE.
Severity: Critical / High / Medium / Low / Info. Environment: disposable DB `crmapp_audit`,
backend `NODE_ENV=development` on :4000, built frontend on :3000, synthetic data only.
Reproduction scripts live outside the repo during the run (audit scratchpad: `probe.mjs`,
`probe2.mjs`, …); the regression tests added to the repo are the durable evidence.

## Summary table

All code findings are fixed on the working branch, verified by re-running the
black-box probe against the rebuilt backend, and pinned by regression tests
(`backend/test/audit-hardening.e2e-spec.ts` + unit specs). Commit `7f95958`.

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
