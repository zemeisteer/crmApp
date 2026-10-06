# UI & route coverage matrix

Environment: built frontend (`next build` + `next start`) on `:3000`, backend
on `:4000` (DB `crmapp_audit`), Chromium (Playwright). Two organizations and
every role were created through the real API/invitation flows; the crawl
seeded each principal's token for the center origin (`a-ymonf.localhost:3000`)
to avoid the 8/min login limit, then visited each page capturing HTTP status,
API responses (`:4000/api/*`), browser console errors and page errors.

## Coverage totals

| Surface | Routes | Loads exercised | Unexpected API (5xx / non-auth 4xx) | Console / page errors | Empty/broken pages |
|---|---|---|---|---|---|
| Center app (6 roles × 17 pages, desktop) | 17 | 102 | 0 | 0 | 0 |
| Center app (owner, 17 pages, mobile 390px) | 17 | 17 | 0 | 0 | 0 |
| Platform admin (`/admin`) | 1 | 1 | 0 | 0 | 0 |
| Student cabinet (`/portal`, mobile) | 1 | 1 | 0 | 0 | 0 |
| Parent cabinet (`/portal`, mobile) | 1 | 1 | 0 | 0 | 0 |
| **Total** | 41 page routes exist | **122 page loads** | **0** | **0** | **0** |

Frontend routes discovered: 41 `page.tsx` files. Public/auth routes
(`/login`, `/register`, `/onboarding`, `/invite/[token]`, `/verify/[code]`,
`/t/[token]`, `/site/[subdomain]`, `/forgot-password`, `/reset-password`,
`/pricing`, `/terms`, `/privacy`) were exercised through the fixture build and
the browser e2e suite rather than the token-seeded crawl.

## Role → page reachability (center app)

All 17 back-office pages render for every staff role (no hard redirect). This
is by design: the master spec (§9) makes the backend the sole authority and
treats frontend permission checks as UX. Privileged **controls** are hidden
per role in the UI, and every privileged **action** is enforced server-side
(see the API role matrix below and `AUDIT_FINDINGS.md`).

| Page | OWNER | ADMIN | MANAGER | RECEPTION | ACCOUNTANT | TEACHER |
|---|---|---|---|---|---|---|
| /dashboard … /audit-log (17 pages) | renders | renders | renders | renders | renders | renders |

UI control-gating spot checks (defense in depth, verified):

| Control | Owner | Receptionist | Teacher |
|---|---|---|---|
| "+ Yangi to'lov" (take payment) on /payments | shown | **hidden** | n/a |
| Invoices / P&L tabs on /payments | shown | **hidden** | n/a |
| Sidebar: Payments, Reports, Settings, Leads, Audit | shown | partial | **hidden** |
| Teacher dashboard shows only own groups + own salary | n/a | n/a | **yes** |

## API authorization matrix (black-box, server-enforced)

Probed with real tokens for every principal of two tenants over all 300 mapped
API routes. Full status grids: audit scratchpad `probe-results.json`,
`probe2-matrix.json`, `probe3` output.

| Scenario | Routes probed | Result |
|---|---|---|
| Anonymous → every non-public route | 300 | 299 × 401; only `GET /billing/config` public by design |
| Tenant B owner → Tenant A object ids (read/write/delete) | 120 | no 2xx carrying Tenant A data; no Tenant A object changed |
| Tenant B owner → every list route | 74 | no Tenant A marker in any 200; query-param tenant override ineffective |
| Cabinet student / cabinet parent → back-office routes | 234 each | 233 × 403 (+ public config) |
| Parent account (role PARENT) → back-office routes | 221 | 220 × 403 |
| Teacher without the group → write/read that group | 13 targeted | all 403 after fix (F-02/F-03) |
| Role escalation (manager/accountant invite ADMIN; receptionist take money; teacher issue PIN/finance/export) | 18 targeted | all 403/400 |
| Parent → unlinked child / other tenant's child | 3 | 403 |

## Workflows exercised end to end (through the API/UI, synthetic data)

Registration → onboarding complete; invitation issue + accept (staff, teacher,
parent); existing-user invitation requires password (400 without, 201 with);
multi-org user with one session re-bound per workspace (MANAGER in A,
ACCOUNTANT in B); workspace list/select; subject → course → group → teacher →
room → schedule (conflict 409 on clash); student create in ACTIVE/PAUSED/LEFT
states; enrollment; attendance mark; invoice create → partial cash payment by
accountant → receipt `RCP-…`; debtor summary; cabinet sign-in by phone+PIN
(student + parent viewer); parent sees only linked child; lead create →
CONTACTED → trial; expense; announcement; homework/exam/certificate/mock/
placement create. Idempotency, overpayment, Click/Payme webhook, cash day,
payroll, debt history and timezone correctness are covered by the passing
backend e2e suites (`billing-gateways` 25, `payments-atomic`, `double-submit`,
`cash-day`, `payroll-disbursement`, `director-report`, `tenant-timezone`,
`debt-history`).
